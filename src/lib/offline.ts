// lib/offline.ts
// npm i dexie @supabase/supabase-js
// Offline-first: semua baca/tulis kasir ke IndexedDB dulu, lalu disinkronkan ke Supabase.
import Dexie, { type Table } from 'dexie';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ---------- Tipe ----------
export interface Product {
  id: string; sku?: string; name: string; category?: string;
  price: number; cost: number; track_stock: boolean; min_stock?: number;
  is_active: boolean; deleted_at?: string | null; updated_at: string;
}
export interface StockRow { key: string; branch_id: string; product_id: string; qty: number }
export interface OutboxItem {
  id: string;                       // uuid entitas (idempotency key)
  kind: 'sale' | 'cash_entry' | 'cash_shift';
  payload: any;
  createdAt: number;
  attempts: number;
  lastError?: string;
}
export interface SaleInput {
  branch_id: string; receipt_no: string; discount?: number; tax?: number;
  items: { product_id: string; name: string; qty: number; price: number; cost: number }[];
  payments: { method: 'cash' | 'qris' | 'transfer' | 'card'; amount: number }[];
}

// ---------- IndexedDB ----------
class LocalDB extends Dexie {
  products!: Table<Product, string>;
  stock!: Table<StockRow, string>;
  outbox!: Table<OutboxItem, string>;
  meta!: Table<{ key: string; value: any }, string>;
  constructor() {
    super('kasir-umkm');
    this.version(1).stores({
      products: 'id, sku, name, category, updated_at',
      stock: 'key, branch_id, product_id',
      outbox: 'id, kind, createdAt',
      meta: 'key',
    });
  }
}
export const db = new LocalDB();

// ---------- Tulis lokal: transaksi penjualan (jalan offline maupun online) ----------
export async function createSale(input: SaleInput) {
  const id = crypto.randomUUID();
  const items = input.items.map(i => ({ ...i, subtotal: i.qty * i.price }));
  const subtotal = items.reduce((a, i) => a + i.subtotal, 0);
  const total = subtotal - (input.discount ?? 0) + (input.tax ?? 0);

  const payload = {
    id, branch_id: input.branch_id, receipt_no: input.receipt_no,
    subtotal, discount: input.discount ?? 0, tax: input.tax ?? 0, total,
    sold_at: new Date().toISOString(), items, payments: input.payments,
  };

  await db.transaction('rw', db.outbox, db.stock, async () => {
    await db.outbox.add({ id, kind: 'sale', payload, createdAt: Date.now(), attempts: 0 });
    for (const it of items) {                      // kurangi stok lokal langsung
      const key = `${input.branch_id}:${it.product_id}`;
      const row = await db.stock.get(key);
      if (row) await db.stock.update(key, { qty: row.qty - it.qty });
    }
  });

  void syncNow();                                  // coba kirim jika sedang online
  return payload;
}

export async function addCashEntry(e: {
  branch_id: string; type: 'in' | 'out'; category?: string; amount: number; note?: string;
}) {
  const id = crypto.randomUUID();
  await db.outbox.add({
    id, kind: 'cash_entry', createdAt: Date.now(), attempts: 0,
    payload: { id, ...e, occurred_at: new Date().toISOString() },
  });
  void syncNow();
  return id;
}

// ---------- Sinkronisasi ----------
let syncing = false;

export async function syncNow() {
  if (syncing || typeof navigator === 'undefined' || !navigator.onLine) return;
  syncing = true;
  try {
    await pushOutbox();
    await pullAll();
  } finally {
    syncing = false;
  }
}

async function pushOutbox() {
  const items = await db.outbox.orderBy('createdAt').toArray();
  for (const item of items) {
    const { error } = await send(item);
    if (!error) { await db.outbox.delete(item.id); continue; }

    const networkErr = !navigator.onLine || /fetch|network/i.test(error.message);
    await db.outbox.update(item.id, { attempts: item.attempts + 1, lastError: error.message });
    if (networkErr) break;                         // berhenti, coba lagi nanti
    // error validasi (mis. data salah) -> tetap di outbox utk ditinjau manual, lanjut item berikutnya
  }
}

function send(item: OutboxItem) {
  switch (item.kind) {
    case 'sale':
      return supabase.rpc('push_sale', { p: item.payload });          // idempotent di server
    case 'cash_entry':
      return supabase.from('cash_entries').upsert(item.payload, { onConflict: 'id', ignoreDuplicates: true });
    case 'cash_shift':
      return supabase.from('cash_shifts').upsert(item.payload, { onConflict: 'id' });
  }
}

// Tarik data master & stok (cursor berdasar updated_at)
async function pullAll() {
  await pullTable('products', 'products');
  await pullStock();
}

async function pullTable(remote: 'products', local: 'products') {
  const cursorKey = `cursor:${remote}`;
  let cursor: string = (await db.meta.get(cursorKey))?.value ?? '1970-01-01T00:00:00Z';
  for (;;) {
    const { data, error } = await supabase.from(remote).select('*')
      .gt('updated_at', cursor).order('updated_at').limit(1000);
    if (error || !data?.length) return;
    await db.table(local).bulkPut(data);
    cursor = data[data.length - 1].updated_at;
    await db.meta.put({ key: cursorKey, value: cursor });
    if (data.length < 1000) return;
  }
}

async function pullStock() {
  const { data, error } = await supabase.from('branch_stock').select('branch_id, product_id, qty');
  if (error || !data) return;

  // stok server + penjualan yang belum terkirim (agar tampilan lokal tetap akurat)
  const pending = new Map<string, number>();
  for (const o of await db.outbox.where('kind').equals('sale').toArray()) {
    for (const it of o.payload.items) {
      const k = `${o.payload.branch_id}:${it.product_id}`;
      pending.set(k, (pending.get(k) ?? 0) + it.qty);
    }
  }
  await db.stock.bulkPut(data.map(r => {
    const key = `${r.branch_id}:${r.product_id}`;
    return { key, branch_id: r.branch_id, product_id: r.product_id, qty: Number(r.qty) - (pending.get(key) ?? 0) };
  }));
  await db.meta.put({ key: 'lastSync', value: Date.now() });   // dipakai untuk status "Tersinkron HH.MM"
}

// ---------- Pemicu otomatis (panggil sekali di root layout, client component) ----------
export function startSyncLoop() {
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  const t = setInterval(syncNow, 30_000);
  void syncNow();
  return () => { window.removeEventListener('online', syncNow); clearInterval(t); };
}

// ---------- Nomor struk unik per perangkat (aman dibuat offline) ----------
export async function nextReceiptNo(branchCode: string) {
  let dev = (await db.meta.get('deviceId'))?.value as string | undefined;
  if (!dev) {
    dev = crypto.randomUUID().slice(0, 4).toUpperCase();
    await db.meta.put({ key: 'deviceId', value: dev });
  }
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, '');   // YYMMDD
  const key = `seq:${day}`;
  const seq = await db.transaction('rw', db.meta, async () => {
    const n = (((await db.meta.get(key))?.value as number) ?? 0) + 1;
    await db.meta.put({ key, value: n });
    return n;
  });
  return `${branchCode}-${day}-${dev}-${String(seq).padStart(3, '0')}`;
}

// ---------- Profil: peran & cabang aktif disimpan di perangkat (dipakai saat offline) ----------
export async function refreshProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || typeof navigator === 'undefined' || !navigator.onLine) return;
  const [{ data: prof }, { data: br }] = await Promise.all([
    supabase.from('profiles').select('role, branch_id').eq('user_id', session.user.id).maybeSingle(),
    supabase.from('branches').select('id,name,code').order('name'),
  ]);
  if (prof) await db.meta.put({ key: 'role', value: prof.role });
  if (br?.length) {
    await db.meta.put({ key: 'branches', value: br });
    // Kasir: cabang pada profilnya. Owner/manager tanpa cabang: cabang pertama.
    const mine = prof?.branch_id ? br.find(b => b.id === prof.branch_id) : br[0];
    if (mine) await db.meta.put({ key: 'branch', value: mine });
  }
}
