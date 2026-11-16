import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import SyncProvider from '@/components/SyncProvider';

// Font di-host sendiri oleh Next.js saat build, jadi tetap tampil saat offline.
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Kasir UMKM',
  description: 'Aplikasi kasir multi-cabang yang bisa dipakai offline',
};
export const viewport: Viewport = { themeColor: '#0a6b4b' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={jakarta.className}>
      <body>
        <SyncProvider>{children}</SyncProvider>
      </body>
    </html>
  );
}
