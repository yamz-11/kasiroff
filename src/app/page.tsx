'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, supabase, syncNow, refreshProfile } from '@/lib/offline';
import { useOnline } from '@/lib/useOnline';
import { OfflineBanner, StatusPill, jam } from '@/components/ConnectionStatus';

const field = 'h-11 w-full rounded-md border border-line bg-white px-3 text-base';

export default function Home() {
  const online = useOnline();
  const [session, setSession] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');

  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  const last = useLiveQuery(() => db.meta.get('lastSync'), []);
  const branch = useLiveQuery(() => db.meta.get('branch'), []);
  const role = useLiveQuery(() => db.meta.get('role'), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Simpan cabang aktif dan peran ke perangkat agar tetap tersedia saat offline
  useEffect(() => {
    if (!session || !navigator.onLine) return;
    refreshProfile().then(() => syncNow());
  }, [session]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    if (!navigator.onLine) return setMsg('Tidak ada koneksi internet. Masuk membutuhkan internet.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg(/invalid login/i.test(error.message) ? 'Email atau kata sandi salah.' : error.message);
  }

  async function keluar() {
    if (pending > 0 && !confirm(`Masih ada ${pending} transaksi yang belum terkirim. Tetap keluar?`)) return;
    await supabase.auth.signOut();
  }

  if (!ready) return null;

  if (!session) {
    return (
      <form onSubmit={login} className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6">
        <div>
          <h1 className="text-2xl font-bold">Masuk ke kasir</h1>
          <p className="mt-1 text-sm text-muted">Gunakan akun yang dibuat oleh pemilik usaha.</p>
        </div>
        <label className="block text-sm font-medium">
          Email
          <input className={field + ' mt-1 font-normal'} type="email" autoComplete="username" required
            value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          Kata sandi
          <input className={field + ' mt-1 font-normal'} type="password" autoComplete="current-password" required
            value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
        <button className="h-12 rounded-md bg-brand font-semibold text-white">Masuk</button>
        {!online && (
          <p className="text-sm text-warn">
            Anda sedang offline. Jika sebelumnya sudah masuk di perangkat ini, sesi tetap tersimpan dan kasir bisa dibuka.
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-surface">
      <header className="flex h-14 items-center justify-between border-b border-line px-4">
        <span className="font-semibold">{branch?.value.name ?? 'Kasir UMKM'}</span>
        <StatusPill />
      </header>
      <OfflineBanner />
      <main className="flex-1 px-4 py-6">
        <Link href="/pos" className="block rounded-md bg-brand py-4 text-center text-lg font-semibold text-white">
          Buka kasir
        </Link>
        {(role?.value === 'owner' || role?.value === 'manager') && (
          <Link href="/dashboard" className="mt-3 block rounded-md border border-line py-3 text-center font-medium">
            Dashboard cabang
          </Link>
        )}

        <dl className="mt-8 text-sm">
          <div className="flex justify-between border-b border-line py-3">
            <dt className="text-muted">Transaksi menunggu dikirim</dt>
            <dd className="tabular-nums">{pending}</dd>
          </div>
          <div className="flex justify-between border-b border-line py-3">
            <dt className="text-muted">Terakhir sinkron</dt>
            <dd>{last ? jam(last.value) : 'Belum pernah'}</dd>
          </div>
          <div className="flex justify-between border-b border-line py-3">
            <dt className="text-muted">Akun</dt>
            <dd className="truncate pl-4">{session.user.email}</dd>
          </div>
        </dl>

        <div className="mt-6 flex items-center gap-4">
          <button onClick={() => syncNow()} disabled={!online}
            className="rounded-md border border-line px-4 py-2 text-sm">Sinkronkan sekarang</button>
          <button onClick={keluar} className="text-sm text-muted underline">Keluar</button>
        </div>
      </main>
    </div>
  );
}
