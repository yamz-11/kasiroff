'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, supabase, refreshProfile, syncNow, type Product } from '@/lib/offline';
import { useOnline } from '@/lib/useOnline';

type Branch = { id: string; name: string; code: string };

const num = (n: number) => Number(n).toLocaleString('id-ID');
const rp = (n: number) => 'Rp ' + num(Number(n));
const field = 'h-11 w-full rounded-md border border-line bg-white px-3 text-base';

function pesan(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'Kode produk (SKU) sudah dipakai produk lain.';
  if (/row-level security|permission/i.test(error.message)) return 'Akun Anda tidak punya izin untuk perubahan ini.';
  if (/failed to fetch|network/i.test(error.message)) return 'Tidak ada koneksi internet.';
  return error.message;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={e => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 sm:rounded-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-sm text-muted underline">Tutup</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Label({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium">
      {text}
      <div className="mt-1 font-normal">{children}</div>
      {hint && <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

function ProductForm({ initial, branches, defaultBranch, categories, onClose, onSaved }: {
  initial: Product | null; branches: Branch[]; defaultBranch: string; categories: string[];
  onClose: () => void; onSaved: (m: string) => void;
}) {
  const [f, setF] = useState({
    name: initial?.name ?? '', sku: initial?.sku ?? '', category: initial?.category ?? '',
    price: initial ? String(initial.price) : '', cost: initial ? String(initial.cost) : '',
    track: initial?.track_stock ?? true, min: String(initial?.min_stock ?? 5),
    active: initial?.is_active ?? true, stock: '', branch: defaultBranch,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const text = (k: 'name' | 'sku' | 'category' | 'price' | 'cost' | 'min' | 'stock' | 'branch') =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!f.name.trim()) return setErr('Nama produk wajib diisi.');
    if (f.price === '' || Number(f.price) < 0) return setErr('Harga jual wajib diisi.');
    setBusy(true);

    const row = {
      name: f.name.trim(), sku: f.sku.trim() || null, category: f.category.trim() || null,
      price: Number(f.price), cost: Number(f.cost || 0),
      track_stock: f.track, min_stock: Number(f.min || 0), is_active: f.active,
    };

    let message = 'Produk diperbarui.';
    if (initial) {
      const { error } = await supabase.from('products').update(row).eq('id', initial.id);
      if (error) { setBusy(false); return setErr(pesan(error)); }
    } else {
      const { data, error } = await supabase.from('products').insert(row).select('id').single();
      if (error || !data) { setBusy(false); return setErr(pesan(error ?? { message: 'Gagal menyimpan.' })); }
      message = 'Produk ditambahkan.';
      if (f.track && Number(f.stock) > 0) {
        const m = await supabase.from('stock_movements').insert({
          branch_id: f.branch, product_id: data.id, type: 'purchase', qty_delta: Number(f.stock), note: 'Stok awal',
        });
        if (m.error) message = `Produk ditambahkan, tetapi stok awal gagal disimpan (${pesan(m.error)}). Tambahkan lewat tombol Stok.`;
      }
    }
    await syncNow();
    onSaved(message);
    onClose();
  }

  return (
    <Modal title={initial ? 'Ubah produk' : 'Tambah produk'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Label text="Nama produk">
          <input className={field} value={f.name} onChange={text('name')} autoFocus required />
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <Label text="Kode / barcode" hint="Opsional. Bisa dipindai di kasir.">
            <input className={field} value={f.sku} onChange={text('sku')} />
          </Label>
          <Label text="Kategori" hint="Opsional.">
            <input className={field} list="kategori" value={f.category} onChange={text('category')} />
            <datalist id="kategori">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </Label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Label text="Harga jual (Rp)">
            <input className={field} type="number" min={0} inputMode="numeric" value={f.price} onChange={text('price')} required />
          </Label>
          <Label text="Harga modal (Rp)">
            <input className={field} type="number" min={0} inputMode="numeric" value={f.cost} onChange={text('cost')} />
          </Label>
        </div>

        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="size-5 accent-brand" checked={f.track} onChange={e => setF({ ...f, track: e.target.checked })} />
          Hitung stok produk ini
        </label>

        {f.track && (
          <div className="grid grid-cols-2 gap-3">
            <Label text="Batas stok menipis" hint="Muncul di dashboard bila sisa sama atau kurang.">
              <input className={field} type="number" min={0} inputMode="numeric" value={f.min} onChange={text('min')} />
            </Label>
            {!initial && (
              <Label text="Stok awal" hint="Opsional.">
                <input className={field} type="number" min={0} inputMode="numeric" value={f.stock} onChange={text('stock')} />
              </Label>
            )}
          </div>
        )}
        {!initial && f.track && Number(f.stock) > 0 && branches.length > 1 && (
          <Label text="Stok awal masuk ke cabang">
            <select className={field} value={f.branch} onChange={text('branch')}>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Label>
        )}

        {initial && (
          <label className="flex items-center gap-3 text-sm font-medium">
            <input type="checkbox" className="size-5 accent-brand" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} />
            Tampilkan di kasir
          </label>
        )}

        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <button disabled={busy} className="h-12 w-full rounded-md bg-brand font-semibold text-white">
          {busy ? 'Menyimpan…' : initial ? 'Simpan perubahan' : 'Tambah produk'}
        </button>
      </form>
    </Modal>
  );
}

function StockForm({ product, branches, defaultBranch, current, onClose, onSaved }: {
  product: Product; branches: Branch[]; defaultBranch: string;
  current: (branchId: string) => number; onClose: () => void; onSaved: (m: string) => void;
}) {
  const [mode, setMode] = useState<'in' | 'fix'>('in');
  const [branch, setBranch] = useState(defaultBranch);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(qty);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!qty || !n) return setErr('Isi jumlah.');
    if (mode === 'in' && n < 0) return setErr('Jumlah barang masuk harus lebih dari 0.');
    setBusy(true);
    const { error } = await supabase.from('stock_movements').insert({
      branch_id: branch, product_id: product.id,
      type: mode === 'in' ? 'purchase' : 'adjustment', qty_delta: n,
      note: note.trim() || (mode === 'in' ? 'Barang masuk' : 'Koreksi stok'),
    });
    setBusy(false);
    if (error) return setErr(pesan(error));
    await syncNow();
    onSaved(`Stok ${product.name} diperbarui.`);
    onClose();
  }

  return (
    <Modal title={`Stok ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {branches.length > 1 && (
          <Label text="Cabang">
            <select className={field} value={branch} onChange={e => setBranch(e.target.value)}>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Label>
        )}
        <p className="text-sm text-muted">Stok saat ini di cabang ini: <span className="font-medium text-ink tabular-nums">{num(current(branch))}</span></p>

        <div role="group" aria-label="Jenis perubahan" className="grid grid-cols-2 overflow-hidden rounded-md border border-line">
          {([['in', 'Barang masuk'], ['fix', 'Koreksi stok']] as const).map(([m, label]) => (
            <button type="button" key={m} aria-pressed={mode === m} onClick={() => setMode(m)}
              className={'border-l border-line py-2.5 text-sm first:border-l-0 ' + (mode === m ? 'bg-ink font-medium text-white' : 'bg-white')}>
              {label}
            </button>
          ))}
        </div>

        <Label text="Jumlah" hint={mode === 'fix' ? 'Pakai tanda minus untuk mengurangi, misalnya -3 untuk barang rusak atau hilang.' : undefined}>
          <input className={field} type="number" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} autoFocus />
        </Label>
        <Label text="Catatan" hint="Opsional, misalnya nama pemasok.">
          <input className={field} value={note} onChange={e => setNote(e.target.value)} />
        </Label>

        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <button disabled={busy} className="h-12 w-full rounded-md bg-brand font-semibold text-white">
          {busy ? 'Menyimpan…' : 'Simpan stok'}
        </button>
      </form>
    </Modal>
  );
}

export default function ProdukPage() {
  const online = useOnline();
  const role = useLiveQuery(() => db.meta.get('role'), []);
  const branchesMeta = useLiveQuery(() => db.meta.get('branches'), []);
  const activeBranch = useLiveQuery(() => db.meta.get('branch'), []);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const stock = useLiveQuery(() => db.stock.toArray(), []);

  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [stockFor, setStockFor] = useState<Product | null>(null);
  const [notice, setNotice] = useState('');

  const allowed = role?.value === 'owner' || role?.value === 'manager';
  const branches: Branch[] = branchesMeta?.value ?? [];

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
    refreshProfile();
    syncNow();
  }, []);

  useEffect(() => {
    if (!branchId) setBranchId(activeBranch?.value.id ?? branches[0]?.id ?? '');
  }, [branchId, activeBranch, branches]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (products ?? [])
      .filter(p => !p.deleted_at)
      .filter(p => !s || p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s) || p.category?.toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name, 'id'));
  }, [products, q]);
  const categories = useMemo(
    () => [...new Set((products ?? []).map(p => p.category).filter(Boolean) as string[])].sort(), [products]);

  const stockOf = (productId: string, bId = branchId) =>
    stock?.find(s => s.product_id === productId && s.branch_id === bId)?.qty ?? 0;

  function saved(m: string) {
    setNotice(m);
    setTimeout(() => setNotice(''), 4000);
  }

  if (hasSession === false) {
    return <div className="mx-auto max-w-md px-6 py-20 text-sm text-muted">Anda belum masuk. <Link href="/" className="underline">Masuk dulu</Link>.</div>;
  }
  if (role && !allowed) {
    return <div className="mx-auto max-w-md px-6 py-20 text-sm text-muted">Kelola produk hanya untuk pemilik dan manajer. <Link href="/" className="underline">Kembali ke Beranda</Link>.</div>;
  }
  if (!role) {
    return <div className="mx-auto max-w-md px-6 py-20 text-sm text-muted">{online ? 'Memuat data akun…' : 'Data akun belum tersimpan di perangkat ini. Buka Beranda saat online terlebih dulu.'}</div>;
  }

  return (
    <div className="mx-auto min-h-dvh max-w-5xl border-x border-line bg-surface">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <Link href="/" className="text-sm text-muted underline">Beranda</Link>
        <h1 className="text-xl font-bold">Produk</h1>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <input type="search" aria-label="Cari produk" placeholder="Cari nama, kode, kategori" value={q} onChange={e => setQ(e.target.value)}
            className={field + ' !h-10 !w-56'} />
          {branches.length > 1 && (
            <select aria-label="Tampilkan stok cabang" value={branchId} onChange={e => setBranchId(e.target.value)}
              className="h-10 rounded-md border border-line bg-white px-2 text-sm">
              {branches.map(b => <option key={b.id} value={b.id}>Stok {b.name}</option>)}
            </select>
          )}
          <button disabled={!online} onClick={() => setEditing('new')} className="h-10 rounded-md bg-brand px-4 text-sm font-semibold text-white">
            Tambah produk
          </button>
        </div>
      </header>

      {!online && (
        <div role="status" className="border-y border-warn-line bg-warn-soft px-4 py-2 text-sm text-warn">
          Anda sedang offline. Menambah atau mengubah produk membutuhkan internet.
        </div>
      )}
      {notice && <div role="status" className="border-y border-brand/30 bg-brand-soft px-4 py-2 text-sm">{notice}</div>}

      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="px-4 py-2 font-medium">Produk</th>
              <th className="px-3 py-2 text-right font-medium">Harga jual</th>
              <th className="px-3 py-2 text-right font-medium">Modal</th>
              <th className="px-3 py-2 text-right font-medium">Stok</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map(p => {
              const s = stockOf(p.id);
              const low = p.track_stock && s <= Number(p.min_stock ?? 5);
              return (
                <tr key={p.id} className={'border-b border-line ' + (p.is_active ? '' : 'opacity-60')}>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {p.name}
                      {!p.is_active && <span className="ml-2 rounded border border-line px-1.5 text-xs font-normal text-muted">Disembunyikan</span>}
                    </div>
                    {(p.sku || p.category) && <div className="text-xs text-muted">{[p.sku, p.category].filter(Boolean).join(', ')}</div>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{rp(p.price)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted">{rp(p.cost)}</td>
                  <td className={'px-3 py-3 text-right tabular-nums ' + (!p.track_stock ? 'text-muted' : s <= 0 ? 'font-medium text-danger' : low ? 'font-medium text-warn' : '')}>
                    {p.track_stock ? num(s) : 'Tidak dihitung'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button disabled={!online} onClick={() => setEditing(p)} className="mr-3 underline">Ubah</button>
                    {p.track_stock && <button disabled={!online} onClick={() => setStockFor(p)} className="underline">Stok</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {products && !items.length && (
          <p className="px-4 py-8 text-sm text-muted">
            {products.length ? 'Tidak ada produk yang cocok dengan pencarian.' : 'Belum ada produk. Ketuk Tambah produk untuk mulai.'}
          </p>
        )}
      </div>

      {editing && (
        <ProductForm initial={editing === 'new' ? null : editing} branches={branches} defaultBranch={branchId}
          categories={categories} onClose={() => setEditing(null)} onSaved={saved} />
      )}
      {stockFor && (
        <StockForm product={stockFor} branches={branches} defaultBranch={branchId}
          current={b => stockOf(stockFor.id, b)} onClose={() => setStockFor(null)} onSaved={saved} />
      )}
    </div>
  );
}
