'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/offline';
import { useOnline } from '@/lib/useOnline';

export const jam = (t?: number) =>
  t ? new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';

export function StatusPill() {
  const online = useOnline();
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  const last = useLiveQuery(() => db.meta.get('lastSync'), []);

  let text = 'Online';
  if (!online) text = 'Offline';
  else if (pending > 0) text = `Mengirim ${pending} transaksi`;
  else if (last) text = `Tersinkron ${jam(last.value)}`;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={'size-2 rounded-full ' + (online ? 'bg-brand' : 'bg-warn')} aria-hidden />
      <span className={online ? 'text-muted' : 'font-medium text-warn'}>{text}</span>
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  if (online) return null;
  return (
    <div role="status" className="border-b border-warn-line bg-warn-soft px-4 py-2 text-sm text-warn">
      Anda sedang offline. Penjualan tetap bisa dicatat dan akan dikirim otomatis saat internet kembali.
      {pending > 0 && ` Menunggu dikirim: ${pending} transaksi.`}
    </div>
  );
}
