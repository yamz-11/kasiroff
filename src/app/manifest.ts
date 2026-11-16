import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kasir UMKM',
    short_name: 'Kasir',
    description: 'Aplikasi kasir multi-cabang yang bisa dipakai offline',
    start_url: '/pos',
    display: 'standalone',
    background_color: '#eef0ee',
    theme_color: '#0a6b4b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
