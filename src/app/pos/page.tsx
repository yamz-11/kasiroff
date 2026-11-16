'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, createSale, nextReceiptNo, type Product } from '@/lib/offline';

type Line = { p: Product; qty: number };
type Method = 'cash' | 'qris' | 'transfer' | 'card';
const METHODS: { id: Method; label: string }[] = [
  { id: 'cash', label: 'Tunai' }, { id: 'qris', label: 'QRIS' },
  { id: 'transfer', label: 'Transfer' }, { id: 'card', label: 'Kartu' },
];
const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

function Receipt({ r }: { r: any }) {
  return (
    <div className="w-72 font-mono text-xs">
      <div className="text-center font-bold">{r.branchName}</div>
      <div className="text-center">{new Date(r.sold_at).toLocaleString('id-ID')}</div>
      <div className="text-center">{r.receipt_no}</div>
      <hr className="my-2 border-dashed" />
      {r.items.map((i: any) => (
        <div key={i.product_id} className="mb-1">
          <div>{i.name}</div>
          <div className="flex justify-between">
            <span>{i.qty} x {i.price.toLocaleString('id-ID')}</span>
            <span>{i.subtotal.toLocaleString('id-ID')}</span>
          </div>
        </div>
      ))}
      <hr className="my-2 border-dashed" />
      <div className="flex justify-between"><span>Subtotal</span><span>{rp(r.subtotal)}</span></div>
      {r.discount > 0 && <div className="flex justify-between"><span>Diskon</span><span>-{rp(r.discount)}</span></div>}
      <div className="flex justify-between font-bold"><span>Total</span><span>{rp(r.total)}</span></div>
      <div className="flex justify-between"><span>Bayar ({r.method})</span><span>{rp(r.received)}</span></div>
      {r.received > r.total && <div className="flex justify-between"><span>Kembali</span><span>{rp(r.received - r.total)}</span></div>}
      <div className="mt-2 text-center">Terima kasih</div>
    </div>
  );
}

export default function Pos() {
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Line[]>([]);
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState<Method>('cash');
  const [received, setReceived] = useState(0);
  const [receipt, setReceipt] = useState<any>(null);
  const [err, setErr] = useState('');

  const products = useLiveQuery(() => db.products.toArray(), []);
  const stock = useLiveQuery(() => db.stock.toArray(), []);
  const pending = useLiveQuery(() => db.outbox.count(), []);
  const branch = useLiveQuery(() => db.meta.get('branch'), []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (products ?? []).filter(p => p.is_active && !p.deleted_at &&
      (!s || p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s)));
  }, [products, q]);

  const subtotal = cart.reduce((a, l) => a + l.p.price * l.qty, 0);
  const total = Math.max(0, subtotal - discount);
  const stockOf = (id: string) => stock?.find(s => s.product_id === id && s.branch_id === branch?.value.id)?.qty ?? 0;

  function add(p: Product) {
    setCart(c => c.some(l => l.p.id === p.id)
      ? c.map(l => (l.p.id === p.id ? { ...l, qty: l.qty + 1 } : l))
      : [...c, { p, qty: 1 }]);
  }
  function change(id: string, d: number) {
    setCart(c => c.map(l => (l.p.id === id ? { ...l, qty: l.qty + d } : l)).filter(l => l.qty > 0));
  }

  async function bayar() {
    setErr('');
    if (!branch) return setErr('Cabang belum tersedia. Login saat online terlebih dulu.');
    if (!cart.length) return setErr('Keranjang kosong.');
    if (method === 'cash' && received < total) return setErr('Uang diterima kurang dari total.');
    const b = branch.value;
    const sale = await createSale({
      branch_id: b.id,
      receipt_no: await nextReceiptNo(b.code),
      discount,
      items: cart.map(l => ({ product_id: l.p.id, name: l.p.name, qty: l.qty, price: l.p.price, cost: l.p.cost })),
      payments: [{ method, amount: total }],
    });
    setReceipt({ ...sale, branchName: b.name, method, received: method === 'cash' ? received : total });
    setCart([]); setDiscount(0); setReceived(0);
  }

  return (
    <>
      <div className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-[1fr_22rem] print:hidden">
        <section>
          <div className="mb-3 flex items-center gap-3">
            <Link href="/" className="text-sm underline">← Beranda</Link>
            <input className="flex-1 border p-2" placeholder="Cari produk / SKU" value={q} onChange={e => setQ(e.target.value)} />
            <span className="text-xs text-gray-500">Antrean: {pending ?? 0}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {list.map(p => (
              <button key={p.id} onClick={() => add(p)} className="border p-3 text-left active:bg-gray-100">
                <div className="font-medium">{p.name}</div>
                <div className="text-sm">{rp(p.price)}</div>
                <div className={'text-xs ' + (stockOf(p.id) <= 0 && p.track_stock ? 'text-red-600' : 'text-gray-500')}>
                  stok {stockOf(p.id)}
                </div>
              </button>
            ))}
            {!list.length && <p className="col-span-full text-sm text-gray-500">Belum ada produk (sinkronisasi saat online).</p>}
          </div>
        </section>

        <aside className="border p-3">
          <h2 className="mb-2 font-bold">Keranjang</h2>
          <ul className="mb-3 divide-y">
            {cart.map(l => (
              <li key={l.p.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div>{l.p.name}</div>
                  <div className="text-gray-500">{rp(l.p.price * l.qty)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="border px-2" onClick={() => change(l.p.id, -1)}>−</button>
                  <span>{l.qty}</span>
                  <button className="border px-2" onClick={() => change(l.p.id, 1)}>+</button>
                </div>
              </li>
            ))}
            {!cart.length && <li className="py-2 text-sm text-gray-500">Kosong</li>}
          </ul>

          <label className="mb-2 block text-sm">Diskon (Rp)
            <input type="number" min={0} className="w-full border p-2" value={discount || ''} onChange={e => setDiscount(Number(e.target.value))} />
          </label>
          <div className="mb-3 flex justify-between text-lg font-bold"><span>Total</span><span>{rp(total)}</span></div>

          <div className="mb-2 grid grid-cols-4 gap-1">
            {METHODS.map(m => (
              <button key={m.id} onClick={() => setMethod(m.id)}
                className={'border py-1 text-sm ' + (method === m.id ? 'bg-black text-white' : '')}>{m.label}</button>
            ))}
          </div>
          {method === 'cash' && (
            <label className="mb-2 block text-sm">Uang diterima
              <input type="number" min={0} className="w-full border p-2" value={received || ''} onChange={e => setReceived(Number(e.target.value))} />
              {received >= total && total > 0 && <span className="text-xs text-gray-600">Kembali {rp(received - total)}</span>}
            </label>
          )}
          {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
          <button onClick={bayar} className="w-full bg-black p-3 text-white">Bayar</button>
        </aside>
      </div>

      {receipt && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 print:hidden">
          <div className="bg-white p-4">
            <Receipt r={receipt} />
            <div className="mt-3 flex gap-2">
              <button className="flex-1 border p-2" onClick={() => window.print()}>Cetak</button>
              <button className="flex-1 bg-black p-2 text-white" onClick={() => setReceipt(null)}>Selesai</button>
            </div>
          </div>
        </div>
      )}
      {receipt && <div className="hidden print:block"><Receipt r={receipt} /></div>}
    </>
  );
}
