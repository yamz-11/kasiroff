'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, supabase, createSale, syncNow } from '@/lib/offline';

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [online, setOnline] = useState(true);
  const [msg, setMsg] = useState('');

  const products = useLiveQuery(() => db.products.toArray(), []);
  const stock = useLiveQuery(() => db.stock.toArray(), []);
  const pending = useLiveQuery(() => db.outbox.count(), []);
  const branch = useLiveQuery(() => db.meta.get('branch'), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Simpan cabang aktif ke lokal agar tetap tersedia saat offline
  useEffect(() => {
    if (!session || !navigator.onLine) return;
    supabase.from('branches').select('id,name,code').limit(1).then(async ({ data }) => {
      if (data?.[0]) await db.meta.put({ key: 'branch', value: data[0] });
      syncNow();
    });
  }, [session]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : '');
  }

  async function jual(p: any) {
    if (!branch) return setMsg('Cabang belum tersedia, login saat online dulu.');
    await createSale({
      branch_id: branch.value.id,
      receipt_no: `TEST-${Date.now()}`,
      items: [{ product_id: p.id, name: p.name, qty: 1, price: p.price, cost: p.cost }],
      payments: [{ method: 'cash', amount: p.price }],
    });
  }

  if (!session) {
    return (
      <form onSubmit={login} className="mx-auto mt-20 flex max-w-xs flex-col gap-2 p-4">
        <h1 className="text-xl font-bold">Login Kasir</h1>
        <input className="border p-2" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className="border p-2" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        <button className="bg-black p-2 text-white">Masuk</button>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </form>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-4">
      <div className="mb-4 flex items-center justify-between text-sm">
        <span>{online ? '🟢 Online' : '🔴 Offline'} · Antrean sync: {pending ?? 0}</span>
        <span className="flex gap-3"><Link href="/pos" className="font-semibold underline">Buka Kasir</Link><button className="underline" onClick={() => supabase.auth.signOut()}>Keluar</button></span>
      </div>
      <h1 className="mb-2 text-xl font-bold">Produk {branch ? `· ${branch.value.name}` : ''}</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <ul className="divide-y border">
        {products?.filter(p => !p.deleted_at).map(p => {
          const s = stock?.find(x => x.product_id === p.id && x.branch_id === branch?.value.id);
          return (
            <li key={p.id} className="flex items-center justify-between p-3">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-gray-500">Rp {p.price.toLocaleString('id-ID')} · stok {s?.qty ?? 0}</div>
              </div>
              <button className="bg-black px-3 py-1 text-white" onClick={() => jual(p)}>Jual 1</button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
