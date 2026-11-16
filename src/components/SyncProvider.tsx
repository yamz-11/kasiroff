'use client';
import { useEffect } from 'react';
import { startSyncLoop } from '@/lib/offline';

export default function SyncProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    }
    navigator.storage?.persist?.();          // cegah browser menghapus IndexedDB saat storage penuh
    return startSyncLoop();
  }, []);
  return <>{children}</>;
}
