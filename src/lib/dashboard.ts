'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { db, supabase } from '@/lib/offline';

export type BranchRow = {
  branch_id: string; code: string; name: string;
  sales_total: number; sales_count: number; discount_total: number; last_sale_at: string | null;
  cash_sales: number; cash_in: number; cash_out: number;
};
export type Dashboard = {
  day: string; generated_at: string;
  branches: BranchRow[];
  payments: { branch_id: string; method: string; amount: number }[];
  hourly: { branch_id: string; hour: number; total: number }[];
  top_products: { branch_id: string; name: string; qty: number; total: number }[];
  low_stock: { branch_id: string; branch: string; product_id: string; name: string; qty: number; min_stock: number }[];
  recent: { id: string; branch_id: string; receipt_no: string; total: number; sold_at: string }[];
};

// day = null -> hari ini (ditentukan server, WIB). Realtime hanya aktif untuk hari ini.
export function useDashboard(day: string | null, enabled: boolean) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState<'connecting' | 'live' | 'off'>('connecting');
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !navigator.onLine) return;
    const { data: res, error: err } = await supabase.rpc('dashboard_summary', { p_day: day });
    if (err) { setError(err.message); return; }
    setError('');
    setData(res as Dashboard);
    setFetchedAt(Date.now());
    if (!day) await db.meta.put({ key: 'dashboard:last', value: { at: Date.now(), data: res } });
  }, [day, enabled]);

  // Muat awal: tampilkan data terakhir yang tersimpan dulu (berguna saat offline), lalu ambil yang baru
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      if (!day) {
        const cached = await db.meta.get('dashboard:last');
        if (cached && !cancelled) { setData(cached.value.data); setFetchedAt(cached.value.at); }
      } else {
        setData(null);
      }
      load();
    })();
    return () => { cancelled = true; };
  }, [day, enabled, load]);

  // Realtime: setiap ada perubahan penjualan, kas, atau stok -> ambil ulang ringkasan (ditunda 0,6 detik)
  useEffect(() => {
    if (!enabled) return;
    if (day) { setLive('off'); return; }

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 600);
    };
    const channel = supabase.channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_entries' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branch_stock' }, schedule)
      .subscribe(status => setLive(status === 'SUBSCRIBED' ? 'live' : 'off'));

    const poll = setInterval(load, 60_000);                       // cadangan bila Realtime terputus
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', load);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', load);
    };
  }, [day, enabled, load]);

  return { data, error, live, fetchedAt };
}
