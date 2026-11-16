import type { Metadata, Viewport } from 'next';
import './globals.css';
import SyncProvider from '@/components/SyncProvider';

export const metadata: Metadata = {
  title: 'Kasir UMKM',
  description: 'Aplikasi kasir multi-cabang yang bisa dipakai offline',
};
export const viewport: Viewport = { themeColor: '#000000' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <SyncProvider>{children}</SyncProvider>
      </body>
    </html>
  );
}
