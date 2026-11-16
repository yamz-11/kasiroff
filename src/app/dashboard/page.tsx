'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, supabase, refreshProfile } from '@/lib/offline';
import { useOnline } from '@/lib/useOnline';
import { useDashboard } from '@/lib/dashboard';
import { jam } from '@/components/ConnectionStatus';

const num = (n: number) => Number(n).toLocaleString('id-ID');
const rp = (n: number) => 'Rp ' + num(Math.round(Number(n)));
const METHOD_LABEL: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', card: 'Kartu' };
const hariIniWIB = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const tanggal = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const waktu = (iso: string | null) => (iso ? jam(new Date(iso).getTime()) : 'Belum ada');

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-md px-6 py-20 text-sm text-muted">{children}</div>;
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-b border-line p-4 odd:border-l-0 even:border-l md:border-b-0 md:odd:border-l md:first:border-l-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
      {note && <dd className="mt-1 text-xs text-muted">{note}</dd>}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {aside && <span className="text-sm text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function HourlyChart({ rows }: { rows: { hour: number; total: number }[] }) {
  const byHour = new Map<number, number>();
  rows.forEach(r => byHour.set(r.hour, (byHour.get(r.hour) ?? 0) + Number(r.total)));
  if (!byHour.size) return <p className="text-sm text-muted">Belum ada penjualan pada tanggal ini.</p>;

  const hours = [...byHour.keys()];
  const from = Math.min(8, ...hours);
  const to = Math.max(20, ...hours);
  const max = Math.max(...byHour.values());
  const list = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const busiest = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div>
      <div className="flex h-40 items-end gap-1" role="img" aria-label="Grafik penjualan per jam">
        {list.map(h => {
          const v = byHour.get(h) ?? 0;
          return (
            <div key={h} className="flex h-full flex-1 flex-col justify-end" title={`${String(h).padStart(2, '0')}.00: ${rp(v)}`}>
              <div className={v ? 'bg-brand' : 'bg-line'} style={{ height: v ? `${Math.max(3, (v / max) * 100)}%` : '2px' }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-xs text-muted">
        {list.map(h => (
          <div key={h} className="flex-1 text-center tabular-nums">{h % 2 === 0 ? h : ''}</div>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">
        Paling ramai pukul {String(busiest[0]).padStart(2, '0')}.00 dengan penjualan {rp(busiest[1])}.
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const online = useOnline();
  const role = useLiveQuery(() => db.meta.get('role'), []);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('');

  const allowed = role?.value === 'owner' || role?.value === 'manager';
  const { data, error, live, fetchedAt } = useDashboard(day, allowed);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
    refreshProfile();
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const inScope = (id: string) => !branchId || id === branchId;
    const rows = data.branches.filter(b => inScope(b.branch_id));
    const sumOf = (k: 'sales_total' | 'sales_count' | 'cash_sales' | 'cash_in' | 'cash_out') =>
      rows.reduce((a, b) => a + Number(b[k]), 0);

    const total = sumOf('sales_total');
    const count = sumOf('sales_count');
    const cashSales = sumOf('cash_sales');
    const cashIn = sumOf('cash_in');
    const cashOut = sumOf('cash_out');

    const pay = new Map<string, number>();
    data.payments.filter(p => inScope(p.branch_id))
      .forEach(p => pay.set(p.method, (pay.get(p.method) ?? 0) + Number(p.amount)));

    const top = new Map<string, { qty: number; total: number }>();
    data.top_products.filter(p => inScope(p.branch_id)).forEach(p => {
      const cur = top.get(p.name) ?? { qty: 0, total: 0 };
      top.set(p.name, { qty: cur.qty + Number(p.qty), total: cur.total + Number(p.total) });
    });

    const lowByBranch = new Map<string, number>();
    data.low_stock.forEach(l => lowByBranch.set(l.branch_id, (lowByBranch.get(l.branch_id) ?? 0) + 1));

    return {
      rows, total, count, avg: count ? total / count : 0,
      cashSales, cashIn, cashOut, cashBalance: cashSales + cashIn - cashOut,
      payments: [...pay.entries()].sort((a, b) => b[1] - a[1]),
      hourly: data.hourly.filter(h => inScope(h.branch_id)),
      top: [...top.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty).slice(0, 5),
      low: data.low_stock.filter(l => inScope(l.branch_id)),
      recent: data.recent.filter(r => inScope(r.branch_id)).slice(0, 8),
      maxBranch: Math.max(1, ...data.branches.map(b => Number(b.sales_total))),
      lowByBranch,
    };
  }, [data, branchId]);

  if (hasSession === false) {
    return <Notice>Anda belum masuk. <Link href="/" className="underline">Masuk dulu</Link>.</Notice>;
  }
  if (role && !allowed) {
    return <Notice>Dashboard hanya untuk pemilik dan manajer. <Link href="/" className="underline">Kembali ke Beranda</Link>.</Notice>;
  }
  if (!role) {
    return <Notice>{online ? 'Memuat data akun…' : 'Data akun belum tersimpan di perangkat ini. Buka Beranda saat online terlebih dulu.'}</Notice>;
  }

  const today = hariIniWIB();
  const nameOf = (id: string) => data?.branches.find(b => b.branch_id === id)?.name ?? '';
  const liveText = !online ? 'Offline'
    : day ? 'Data tanggal lampau'
    : live === 'live' ? 'Langsung'
    : 'Realtime terputus, diperbarui tiap menit';
  const dot = !online ? 'bg-warn' : day ? 'bg-muted' : live === 'live' ? 'bg-brand' : 'bg-warn';
  const singleBranch = !!branchId;

  return (
    <div className="mx-auto min-h-dvh max-w-6xl border-x border-line bg-surface">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <Link href="/" className="text-sm text-muted underline">Beranda</Link>
        <div>
          <h1 className="text-xl font-bold leading-tight">Dashboard</h1>
          <p className="text-sm text-muted">{tanggal(data?.day ?? day ?? today)}</p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className={'size-2 rounded-full ' + dot} aria-hidden />
            <span className={online ? 'text-muted' : 'font-medium text-warn'}>
              {liveText}{fetchedAt ? `, diperbarui ${jam(fetchedAt)}` : ''}
            </span>
          </div>
          <select aria-label="Pilih cabang" value={branchId} onChange={e => setBranchId(e.target.value)}
            className="h-10 rounded-md border border-line bg-white px-2 text-sm">
            <option value="">Semua cabang</option>
            {data?.branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
          </select>
          <input type="date" aria-label="Pilih tanggal" max={today} value={day ?? today}
            onChange={e => setDay(!e.target.value || e.target.value === today ? null : e.target.value)}
            className="h-10 rounded-md border border-line bg-white px-2 text-sm" />
          {day && <button onClick={() => setDay(null)} className="text-sm underline">Hari ini</button>}
        </div>
      </header>

      {!online && (
        <div role="status" className="border-y border-warn-line bg-warn-soft px-4 py-2 text-sm text-warn">
          Anda sedang offline. Yang tampil adalah data terakhir yang tersimpan{fetchedAt ? ` (${jam(fetchedAt)})` : ''}. Dashboard butuh internet untuk data terbaru.
        </div>
      )}
      {error && (
        <div role="alert" className="border-y border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          Gagal memuat data: {error}
          {/dashboard_summary/i.test(error) && ' Jalankan supabase/dashboard.sql di SQL Editor Supabase.'}
        </div>
      )}

      {!view && !error && <p className="border-t border-line px-4 py-8 text-sm text-muted">Memuat data…</p>}

      {view && (
        <>
          <dl className="grid grid-cols-2 border-t border-line md:grid-cols-4">
            <Kpi label="Penjualan" value={rp(view.total)} />
            <Kpi label="Transaksi" value={num(view.count)} />
            <Kpi label="Rata-rata per transaksi" value={rp(view.avg)} />
            <Kpi label="Arus kas tunai" value={rp(view.cashBalance)}
              note={`Tunai dari penjualan ${rp(view.cashSales)}, kas masuk ${rp(view.cashIn)}, kas keluar ${rp(view.cashOut)}`} />
          </dl>

          <Section title="Per cabang" aside={singleBranch ? 'Ketuk Semua cabang untuk membandingkan' : undefined}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="py-2 pr-3 font-medium">Cabang</th>
                    <th className="px-3 py-2 text-right font-medium">Penjualan</th>
                    <th className="px-3 py-2 text-right font-medium">Transaksi</th>
                    <th className="px-3 py-2 text-right font-medium">Arus kas tunai</th>
                    <th className="px-3 py-2 text-right font-medium">Stok menipis</th>
                    <th className="py-2 pl-3 text-right font-medium">Penjualan terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map(b => {
                    const low = view.lowByBranch.get(b.branch_id) ?? 0;
                    return (
                      <tr key={b.branch_id} className="border-b border-line align-top">
                        <td className="py-3 pr-3">
                          <button className="font-medium hover:underline" onClick={() => setBranchId(b.branch_id)}>{b.name}</button>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {rp(b.sales_total)}
                          <div className="ml-auto mt-1 h-1 w-24 bg-line">
                            <div className="h-1 bg-brand" style={{ width: `${(Number(b.sales_total) / view.maxBranch) * 100}%` }} />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{num(b.sales_count)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{rp(Number(b.cash_sales) + Number(b.cash_in) - Number(b.cash_out))}</td>
                        <td className={'px-3 py-3 text-right tabular-nums ' + (low ? 'font-medium text-warn' : 'text-muted')}>{low ? `${low} produk` : 'Aman'}</td>
                        <td className="py-3 pl-3 text-right tabular-nums text-muted">{waktu(b.last_sale_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {singleBranch && (
              <button onClick={() => setBranchId('')} className="mt-3 text-sm underline">Semua cabang</button>
            )}
          </Section>

          <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-line">
            <Section title="Penjualan per jam" aside="WIB">
              <HourlyChart rows={view.hourly} />
            </Section>

            <div>
              <Section title="Metode pembayaran">
                {view.payments.length ? (
                  <ul className="space-y-3 text-sm">
                    {view.payments.map(([m, amt]) => {
                      const pct = view.total ? Math.round((amt / view.total) * 100) : 0;
                      return (
                        <li key={m}>
                          <div className="flex justify-between">
                            <span>{METHOD_LABEL[m] ?? m}</span>
                            <span className="tabular-nums">{rp(amt)} <span className="text-muted">({pct}%)</span></span>
                          </div>
                          <div className="mt-1 h-1 bg-line"><div className="h-1 bg-brand" style={{ width: `${pct}%` }} /></div>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-muted">Belum ada pembayaran.</p>}
              </Section>

              <Section title="Produk terlaris">
                {view.top.length ? (
                  <ol className="divide-y divide-line text-sm">
                    {view.top.map(p => (
                      <li key={p.name} className="flex justify-between gap-3 py-2">
                        <span className="min-w-0 truncate">{p.name}</span>
                        <span className="shrink-0 tabular-nums text-muted">{num(p.qty)} terjual, {rp(p.total)}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-muted">Belum ada produk terjual.</p>}
              </Section>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-line">
            <Section title="Stok menipis" aside={view.low.length ? `${view.low.length} produk` : undefined}>
              {view.low.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[22rem] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-muted">
                        <th className="py-2 pr-3 font-medium">Produk</th>
                        <th className="px-3 py-2 font-medium">Cabang</th>
                        <th className="py-2 pl-3 text-right font-medium">Sisa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.low.map(l => (
                        <tr key={l.branch_id + l.product_id} className="border-b border-line">
                          <td className="py-2 pr-3">{l.name}</td>
                          <td className="px-3 py-2 text-muted">{l.branch}</td>
                          <td className="py-2 pl-3 text-right tabular-nums">
                            {Number(l.qty) < 0
                              ? <span className="font-medium text-danger">Minus {num(-Number(l.qty))}</span>
                              : Number(l.qty) === 0
                                ? <span className="font-medium text-danger">Habis</span>
                                : <span className="font-medium text-warn">{num(l.qty)}</span>}
                            <span className="text-muted"> / batas {num(l.min_stock)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-muted">Semua stok masih di atas batas minimum.</p>}
            </Section>

            <Section title="Transaksi terbaru">
              {view.recent.length ? (
                <ul className="divide-y divide-line text-sm">
                  {view.recent.map(r => (
                    <li key={r.id} className="flex items-baseline justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <span className="tabular-nums">{jam(new Date(r.sold_at).getTime())}</span>
                        <span className="ml-3 text-muted">{r.receipt_no}</span>
                        {!singleBranch && <div className="truncate text-xs text-muted">{nameOf(r.branch_id)}</div>}
                      </div>
                      <span className="shrink-0 font-medium tabular-nums">{rp(r.total)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">Belum ada transaksi pada tanggal ini.</p>}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
