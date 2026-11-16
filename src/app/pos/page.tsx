'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, createSale, nextReceiptNo, type Product } from '@/lib/offline';
import { useOnline } from '@/lib/useOnline';
import { OfflineBanner, StatusPill } from '@/components/ConnectionStatus';

type Line = { p: Product; qty: number };
type Method = 'cash' | 'qris' | 'transfer' | 'card';

const METHOD_LABEL: Record<Method, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', card: 'Kartu' };
const METHODS = Object.keys(METHOD_LABEL) as Method[];
const num = (n: number) => n.toLocaleString('id-ID');
const rp = (n: number) => 'Rp ' + num(n);
const field = 'h-11 w-full rounded-md border border-line bg-white px-3 text-base';

function cashSuggestions(total: number) {
  if (total <= 0) return [];
  const set = new Set<number>([total]);
  for (const d of [5000, 10000, 20000, 50000, 100000]) set.add(Math.ceil(total / d) * d);
  return [...set].sort((a, b) => a - b).slice(0, 4);
}

function Receipt({ r }: { r: any }) {
  return (
    <div className="w-full max-w-[72mm] font-mono text-xs leading-5">
      <div className="text-center font-bold">{r.branchName}</div>
      <div className="text-center">{new Date(r.sold_at).toLocaleString('id-ID')}</div>
      <div className="text-center">{r.receipt_no}</div>
      <hr className="my-2 border-dashed border-ink/40" />
      {r.items.map((i: any) => (
        <div key={i.product_id} className="mb-1">
          <div>{i.name}</div>
          <div className="flex justify-between">
            <span>{i.qty} x {num(i.price)}</span>
            <span>{num(i.subtotal)}</span>
          </div>
        </div>
      ))}
      <hr className="my-2 border-dashed border-ink/40" />
      <div className="flex justify-between"><span>Subtotal</span><span>{rp(r.subtotal)}</span></div>
      {r.discount > 0 && <div className="flex justify-between"><span>Diskon</span><span>-{rp(r.discount)}</span></div>}
      <div className="flex justify-between font-bold"><span>Total</span><span>{rp(r.total)}</span></div>
      <div className="flex justify-between"><span>Bayar ({METHOD_LABEL[r.method as Method]})</span><span>{rp(r.received)}</span></div>
      {r.received > r.total && <div className="flex justify-between"><span>Kembali</span><span>{rp(r.received - r.total)}</span></div>}
      <div className="mt-3 text-center">Terima kasih</div>
    </div>
  );
}

export default function Pos() {
  const online = useOnline();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<Line[]>([]);
  const [discount, setDiscount] = useState(0);
  const [showDisc, setShowDisc] = useState(false);
  const [method, setMethod] = useState<Method>('cash');
  const [received, setReceived] = useState(0);
  const [receipt, setReceipt] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);

  const products = useLiveQuery(() => db.products.toArray(), []);
  const stock = useLiveQuery(() => db.stock.toArray(), []);
  const branch = useLiveQuery(() => db.meta.get('branch'), []);

  const active = useMemo(() => (products ?? []).filter(p => p.is_active && !p.deleted_at), [products]);
  const categories = useMemo(() => [...new Set(active.map(p => p.category).filter(Boolean) as string[])].sort(), [active]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return active.filter(p =>
      (!cat || p.category === cat) &&
      (!s || p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s)));
  }, [active, q, cat]);

  const itemCount = cart.reduce((a, l) => a + l.qty, 0);
  const subtotal = cart.reduce((a, l) => a + l.p.price * l.qty, 0);
  const total = Math.max(0, subtotal - discount);
  const stockOf = (id: string) => stock?.find(s => s.product_id === id && s.branch_id === branch?.value.id)?.qty ?? 0;
  const qtyOf = (id: string) => cart.find(l => l.p.id === id)?.qty ?? 0;
  const shortBy = method === 'cash' && received > 0 && received < total ? total - received : 0;
  const canPay = cart.length > 0 && !busy && shortBy === 0;

  function add(p: Product) {
    setErr('');
    setCart(c => c.some(l => l.p.id === p.id)
      ? c.map(l => (l.p.id === p.id ? { ...l, qty: l.qty + 1 } : l))
      : [...c, { p, qty: 1 }]);
  }
  function change(id: string, d: number) {
    setCart(c => c.map(l => (l.p.id === id ? { ...l, qty: l.qty + d } : l)).filter(l => l.qty > 0));
  }
  function clearOrder() { setCart([]); setDiscount(0); setShowDisc(false); setReceived(0); setErr(''); }

  // Enter di kolom cari: cocok SKU persis (pemindai barcode) atau hasil tunggal -> langsung masuk pesanan
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const s = q.trim().toLowerCase();
    if (!s) return;
    const target = active.find(p => p.sku?.toLowerCase() === s) ?? (list.length === 1 ? list[0] : undefined);
    if (target) { add(target); setQ(''); }
  }

  async function bayar() {
    setErr('');
    if (!branch) return setErr('Cabang belum tersedia di perangkat ini. Buka Beranda saat online untuk mengambil data.');
    if (!canPay) return;
    setBusy(true);
    try {
      const b = branch.value;
      const sale = await createSale({
        branch_id: b.id,
        receipt_no: await nextReceiptNo(b.code),
        discount,
        items: cart.map(l => ({ product_id: l.p.id, name: l.p.name, qty: l.qty, price: l.p.price, cost: l.p.cost })),
        payments: [{ method, amount: total }],
      });
      setReceipt({ ...sale, branchName: b.name, method, received: method === 'cash' ? (received || total) : total });
      clearOrder();
      setSheet(false);
    } finally {
      setBusy(false);
    }
  }

  const order = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-semibold">
          Pesanan{itemCount > 0 && <span className="ml-2 font-normal text-muted">{itemCount} item</span>}
        </h2>
        {cart.length > 0 && (
          <button className="text-sm text-muted underline" onClick={clearOrder}>Kosongkan</button>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-4">
        {cart.map(l => (
          <li key={l.p.id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
            <div className="min-w-0">
              <div className="truncate font-medium">{l.p.name}</div>
              <div className="text-sm text-muted tabular-nums">{num(l.p.price)} x {l.qty} = {rp(l.p.price * l.qty)}</div>
            </div>
            <div className="flex shrink-0 items-center">
              <button aria-label={`Kurangi ${l.p.name}`} className="size-10 rounded-md border border-line text-lg leading-none"
                onClick={() => change(l.p.id, -1)}>−</button>
              <span className="w-8 text-center tabular-nums">{l.qty}</span>
              <button aria-label={`Tambah ${l.p.name}`} className="size-10 rounded-md border border-line text-lg leading-none"
                onClick={() => change(l.p.id, 1)}>+</button>
            </div>
          </li>
        ))}
        {!cart.length && <li className="py-8 text-sm text-muted">Ketuk produk untuk menambahkannya ke pesanan.</li>}
      </ul>

      <div className="space-y-3 border-t border-line p-4">
        <div className="flex justify-between text-sm text-muted">
          <span>Subtotal</span><span className="tabular-nums">{rp(subtotal)}</span>
        </div>

        {showDisc || discount > 0 ? (
          <label className="flex items-center justify-between gap-3 text-sm text-muted">
            Diskon (Rp)
            <input type="number" min={0} inputMode="numeric" className={field + ' !w-36 text-right text-ink'}
              value={discount || ''} onChange={e => setDiscount(Math.max(0, Number(e.target.value)))} />
          </label>
        ) : (
          cart.length > 0 && <button className="text-sm text-muted underline" onClick={() => setShowDisc(true)}>Tambah diskon</button>
        )}

        <div className="flex items-baseline justify-between">
          <span className="font-semibold">Total</span>
          <span className="text-3xl font-bold tabular-nums">{rp(total)}</span>
        </div>

        <div role="group" aria-label="Metode pembayaran" className="grid grid-cols-4 overflow-hidden rounded-md border border-line">
          {METHODS.map(m => (
            <button key={m} aria-pressed={method === m}
              onClick={() => { setMethod(m); if (m !== 'cash') setReceived(0); }}
              className={'border-l border-line py-2.5 text-sm first:border-l-0 ' +
                (method === m ? 'bg-ink font-medium text-white' : 'bg-white')}>
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>

        {method === 'cash' && total > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {cashSuggestions(total).map(v => (
                <button key={v} onClick={() => setReceived(v)}
                  className={'rounded-md border px-3 py-1.5 text-sm tabular-nums ' +
                    (received === v ? 'border-brand bg-brand-soft font-medium' : 'border-line bg-white')}>
                  {v === total ? 'Uang pas' : num(v)}
                </button>
              ))}
            </div>
            <label className="block text-sm text-muted">
              Uang diterima
              <input type="number" min={0} inputMode="numeric" className={field + ' mt-1 text-ink'}
                placeholder={num(total)} value={received || ''} onChange={e => setReceived(Math.max(0, Number(e.target.value)))} />
            </label>
            {received > total && (
              <div className="flex justify-between text-sm">
                <span className="text-muted">Kembalian</span>
                <span className="font-semibold text-brand tabular-nums">{rp(received - total)}</span>
              </div>
            )}
            {shortBy > 0 && <p className="text-sm text-danger">Uang diterima kurang {rp(shortBy)}.</p>}
          </div>
        )}

        {err && <p role="alert" className="text-sm text-danger">{err}</p>}

        <button onClick={bayar} disabled={!canPay}
          className="h-14 w-full rounded-md bg-brand text-lg font-semibold text-white">
          {cart.length ? `Bayar ${rp(total)}` : 'Bayar'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="flex h-dvh flex-col print:hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <Link href="/" className="text-sm text-muted underline">Beranda</Link>
          <span className="hidden font-semibold sm:inline">{branch?.value.name ?? 'Kasir'}</span>
          <input type="search" className={field + ' !h-10 max-w-md flex-1'} placeholder="Cari nama atau kode produk"
            aria-label="Cari produk" value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey} />
          <div className="ml-auto hidden sm:block"><StatusPill /></div>
        </header>
        <OfflineBanner />

        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto p-4">
            {categories.length > 0 && (
              <div className="mb-4 flex gap-2 overflow-x-auto">
                {['', ...categories].map(c => (
                  <button key={c || 'semua'} onClick={() => setCat(c)} aria-pressed={cat === c}
                    className={'shrink-0 rounded-md border px-3 py-1.5 text-sm ' +
                      (cat === c ? 'border-ink bg-ink text-white' : 'border-line bg-white')}>
                    {c || 'Semua'}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
              {list.map(p => {
                const s = stockOf(p.id);
                const inCart = qtyOf(p.id);
                return (
                  <button key={p.id} onClick={() => add(p)}
                    className={'relative flex min-h-24 flex-col justify-between rounded-md border bg-surface p-3 text-left active:bg-brand-soft ' +
                      (inCart ? 'border-brand' : 'border-line')}>
                    {inCart > 0 && (
                      <span className="absolute right-2 top-2 min-w-6 rounded bg-brand px-1.5 text-center text-xs font-semibold text-white tabular-nums">
                        {inCart}
                      </span>
                    )}
                    <span className="line-clamp-2 pr-6 font-medium leading-snug">{p.name}</span>
                    <span>
                      <span className="block font-semibold tabular-nums">{rp(p.price)}</span>
                      {p.track_stock && (
                        <span className={'block text-xs ' + (s <= 0 ? 'text-danger' : s <= 5 ? 'text-warn' : 'text-muted')}>
                          {s <= 0 ? 'Stok habis' : `Sisa ${num(s)}`}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {products && !list.length && (
              <p className="max-w-sm text-sm text-muted">
                {active.length
                  ? 'Tidak ada produk yang cocok dengan pencarian.'
                  : 'Belum ada produk di perangkat ini. Sambungkan ke internet, buka Beranda, lalu tunggu sinkronisasi selesai.'}
              </p>
            )}
          </main>

          <aside className="hidden w-96 shrink-0 flex-col border-l border-line bg-surface md:flex">{order}</aside>
        </div>

        {cart.length > 0 && (
          <div className="flex shrink-0 items-center gap-3 border-t border-line bg-surface p-3 md:hidden">
            <div className="flex-1">
              <div className="text-xs text-muted">{itemCount} item</div>
              <div className="text-lg font-bold tabular-nums">{rp(total)}</div>
            </div>
            <button onClick={() => setSheet(true)} className="h-12 rounded-md bg-brand px-6 font-semibold text-white">
              Lihat pesanan
            </button>
          </div>
        )}
      </div>

      {sheet && (
        <div className="fixed inset-0 z-20 flex items-end bg-ink/40 md:hidden print:hidden" onClick={() => setSheet(false)}>
          <div className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface" onClick={e => e.stopPropagation()}>
            <div className="flex justify-end px-4 pt-3">
              <button className="text-sm text-muted underline" onClick={() => setSheet(false)}>Tutup</button>
            </div>
            {order}
          </div>
        </div>
      )}

      {receipt && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/40 p-4 print:hidden">
          <div role="dialog" aria-label="Pembayaran berhasil" className="max-h-full w-full max-w-sm overflow-y-auto rounded-lg bg-surface p-5">
            <h2 className="font-semibold">Pembayaran berhasil</h2>
            {receipt.method === 'cash' && receipt.received > receipt.total ? (
              <div className="mt-3">
                <div className="text-sm text-muted">Kembalian</div>
                <div className="text-4xl font-bold text-brand tabular-nums">{rp(receipt.received - receipt.total)}</div>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted">{METHOD_LABEL[receipt.method as Method]} {rp(receipt.total)}</p>
            )}
            {!online && (
              <p className="mt-3 rounded-md border border-warn-line bg-warn-soft p-2 text-sm text-warn">
                Tersimpan di perangkat. Akan dikirim otomatis saat internet kembali.
              </p>
            )}
            <div className="my-4 flex justify-center border border-dashed border-line bg-white p-3">
              <Receipt r={receipt} />
            </div>
            <div className="flex gap-2">
              <button className="h-12 flex-1 rounded-md border border-line" onClick={() => window.print()}>Cetak struk</button>
              <button autoFocus className="h-12 flex-1 rounded-md bg-brand font-semibold text-white" onClick={() => setReceipt(null)}>
                Transaksi baru
              </button>
            </div>
          </div>
        </div>
      )}
      {receipt && <div className="hidden print:block"><Receipt r={receipt} /></div>}
    </>
  );
}
