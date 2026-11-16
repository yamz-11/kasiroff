# Kasir UMKM

Aplikasi kasir (Point of Sale) berbasis web untuk usaha UMKM dengan banyak cabang. Dibangun dengan **Next.js** dan **Supabase**, dirancang **offline-first**: kasir tetap bisa berjualan tanpa internet, dan data otomatis tersinkronisasi saat koneksi kembali.

## Fitur saat ini

- Login dengan email dan password (Supabase Auth)
- Halaman kasir `/pos`: cari produk, keranjang, diskon, metode bayar (tunai, QRIS, transfer, kartu), uang kembali, cetak struk
- Mode offline: transaksi disimpan di IndexedDB (antrean/outbox) lalu dikirim otomatis saat online
- Sinkronisasi dua arah: produk dan stok ditarik dari server, transaksi dikirim ke server
- Stok berbasis ledger (`stock_movements`) sehingga aman saat banyak kasir/cabang sinkron bersamaan
- Nomor struk unik per perangkat, tetap aman dibuat saat offline
- PWA: bisa di-install ke layar utama dan dibuka tanpa internet (production build)
- Dashboard monitoring `/dashboard` (owner/manager): penjualan harian, arus kas tunai, stok menipis, metode bayar, produk terlaris, transaksi terbaru, per cabang atau gabungan, diperbarui langsung lewat Supabase Realtime
- Multi-cabang dengan peran `owner`, `manager`, `cashier` dan pembatasan data lewat Row Level Security

Belum ada UI untuk: manajemen produk, penyesuaian stok, buka/tutup shift, kas masuk/keluar (tabel dan fungsi dasarnya sudah ada), void/retur, dan transfer stok antar cabang. Lihat bagian Rencana pengembangan.

## Arsitektur

```
Kasir (Next.js PWA) -> IndexedDB (Dexie) -> Outbox --(online)--> Supabase (RPC + Postgres)
        ^                                                              |
        '------------- pull produk & stok (cursor updated_at) <--------'
```

Prinsip utama:

1. **ID dibuat di client (UUID).** Transaksi punya ID sebelum terkirim, sehingga pengiriman ulang tidak membuat data ganda. Fungsi `push_sale` di server bersifat idempotent.
2. **Stok sebagai ledger.** Setiap penjualan menambah baris `stock_movements` bernilai negatif, dan trigger memperbarui `branch_stock`. Perubahan saling menjumlah, bukan saling menimpa. Stok boleh sementara negatif.
3. **Outbox queue.** Semua tulis data masuk IndexedDB dulu, UI langsung jalan, sinkronisasi berjalan di belakang.
4. **Pull berbasis cursor `updated_at`** dengan soft delete (`deleted_at`) agar perubahan dan penghapusan produk sampai ke perangkat offline.
5. **RLS per peran.** Owner dan manager melihat semua cabang, kasir hanya cabangnya.

## Struktur proyek

```
.
├─ .env.local.example
├─ public/
│  ├─ sw.js                    service worker (cache halaman & aset)
│  └─ icon-192.png, icon-512.png
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx            layout, font, SyncProvider
│  │  ├─ globals.css           warna dan gaya dasar (Tailwind v4)
│  │  ├─ page.tsx              login + beranda
│  │  ├─ manifest.ts           manifest PWA
│  │  ├─ pos/page.tsx          halaman kasir
│  │  └─ dashboard/page.tsx    dashboard monitoring multi-cabang
│  ├─ components/
│  │  ├─ SyncProvider.tsx      daftar service worker + jalankan loop sinkronisasi
│  │  └─ ConnectionStatus.tsx  indikator online/offline dan antrean kirim
│  └─ lib/
│     ├─ offline.ts            IndexedDB (Dexie), outbox, sync, nomor struk
│     ├─ dashboard.ts          hook data dashboard + Realtime
│     └─ useOnline.ts          status koneksi
└─ supabase/
   ├─ schema.sql               tabel, trigger, RLS, fungsi push_sale
   ├─ seed.sql                 tenant, cabang, profil owner, produk contoh
   └─ dashboard.sql            fungsi dashboard_summary, min_stock, Realtime
```

## Prasyarat

- Node.js 20 LTS atau lebih baru
- Akun Supabase (supabase.com)

## Instalasi

### 1. Buat proyek Next.js dan pasang paket

```bash
npx create-next-app@latest kasir --ts --tailwind --eslint --app --src-dir --use-npm
cd kasir
npm i dexie dexie-react-hooks @supabase/supabase-js
```

### 2. Salin file proyek

Salin seluruh isi folder ini ke dalam proyek `kasir` yang baru dibuat. Timpa file yang sama (`src/app/layout.tsx` dan `src/app/page.tsx`).

Pastikan lokasi akhirnya benar: `package.json` dan `src/` berada di folder yang sama. Kesalahan umum adalah file berakhir di folder bersarang (misalnya `kasir/kasir/src`).

### 3. Siapkan Supabase

1. Buat proyek baru di dashboard Supabase dan tunggu sampai siap.
2. Buka **SQL Editor**, jalankan seluruh isi `supabase/schema.sql`.
3. Buka **Authentication > Users > Add user > Create new user**, isi email dan password, centang **Auto Confirm User**, lalu salin **User UID**.
4. Buka `supabase/seed.sql`, ganti `UUID-USER-DI-SINI` dengan User UID tadi, lalu jalankan di SQL Editor.
5. Jalankan `supabase/dashboard.sql` (fungsi ringkasan dashboard, kolom batas stok, dan Realtime). File ini aman dijalankan ulang.

### 4. Isi environment

Salin `.env.local.example` menjadi `.env.local` di root proyek (sejajar `package.json`):

```
NEXT_PUBLIC_SUPABASE_URL=https://ISI-PROJECT-ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

- URL harus diawali `https://` dan berbentuk `https://<project-id>.supabase.co`.
- Isi key dengan **publishable key** (`sb_publishable_...`) atau anon key.
- **Jangan pernah** memakai key `sb_secret_...` atau `service_role` di variabel `NEXT_PUBLIC_*`. Variabel itu terkirim ke browser dan key tersebut melewati semua aturan RLS. Jika key secret pernah terlihat atau terkirim ke orang lain, buat ulang (rotate) di dashboard Supabase.
- Pastikan `.env.local` tidak masuk ke Git (sudah diabaikan oleh `.gitignore` bawaan Next.js).

### 5. Jalankan

```bash
npm run dev
```

Buka http://localhost:3000, login dengan user tadi, lalu klik **Buka Kasir**. Produk "Kopi Susu" dengan stok 100 seharusnya muncul.

Setiap mengubah `.env.local`, hentikan server (Ctrl+C) dan jalankan lagi.

## Menguji mode offline

Service worker hanya aktif di **production build**, bukan di `npm run dev`.

```bash
npm run build
npm start
```

1. Buka http://localhost:3000 saat online, login, buka `/pos`, tunggu produk muncul, lalu refresh sekali.
2. Buka DevTools > **Application > Service Workers**. Harus ada `sw.js` berstatus *activated and is running*.
3. Di tab **Network**, pastikan **Disable cache** tidak dicentang, pilih **Offline**, lalu refresh `/pos`. Halaman harus tetap terbuka (kolom Size menampilkan `(ServiceWorker)`).
4. Lakukan beberapa penjualan. Stok berkurang dan angka "Antrean" naik.
5. Kembalikan ke **No throttling**. Antrean kembali ke 0, dan data muncul di Supabase (tabel `sales`, `sale_items`, `payments`, `stock_movements`, `branch_stock`).

## Deploy

Deploy ke Vercel (atau hosting lain yang menyediakan HTTPS):

1. Push proyek ke repositori Git.
2. Import di Vercel, isi dua environment variable `NEXT_PUBLIC_SUPABASE_*`.
3. Deploy, lalu buka alamat HTTPS dari HP dan pilih "Tambahkan ke layar utama".

PWA dan service worker memerlukan HTTPS (kecuali `localhost`). Alamat seperti `http://192.168.x.x` tidak bisa mendaftarkan service worker.

**Setiap deploy versi baru, naikkan nilai `V` di `public/sw.js`** (misalnya `'v1'` menjadi `'v2'`) agar cache disiapkan ulang dan perangkat tidak menampilkan versi lama.

## Dashboard

Buka `/dashboard` (tombol "Dashboard cabang" di Beranda, hanya tampil untuk owner dan manager).

- Angka "hari ini" memakai zona waktu WIB (Asia/Jakarta) dan waktu transaksi di perangkat kasir.
- **Arus kas tunai** = tunai dari penjualan + kas masuk lain - kas keluar, pada hari yang dipilih. Ini arus kas harian, belum termasuk modal awal laci; saldo laci akan lengkap setelah fitur buka/tutup shift dibuat.
- **Stok menipis**: stok cabang kurang dari atau sama dengan `products.min_stock` (bawaan 5). Ubah per produk lewat Table Editor Supabase.
- Perubahan pada tabel `sales`, `cash_entries`, dan `branch_stock` memicu pembaruan otomatis. Jika Realtime terputus, halaman memuat ulang tiap 1 menit dan saat tab kembali aktif.
- Saat offline, yang tampil adalah data terakhir yang tersimpan di perangkat.

## Catatan keamanan

- Perlindungan data ada di RLS (lihat `schema.sql`), bukan di key. Key publishable/anon memang boleh terlihat di browser.
- Peran: `owner` dan `manager` mengakses semua cabang; `cashier` hanya cabang pada profilnya. Untuk membatasi kasir ke satu cabang, isi kolom `branch_id` di tabel `profiles`.
- Pada `seed.sql`, owner dibuat dengan `branch_id` kosong (akses semua cabang).
- Sesi login tersimpan di browser. Jika sesi habis saat offline, transaksi tetap aman di antrean dan terkirim setelah login ulang.

## Pemecahan masalah

| Gejala | Penyebab dan solusi |
|---|---|
| `Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL` | `NEXT_PUBLIC_SUPABASE_URL` salah atau belum terbaca. Pastikan berformat `https://<id>.supabase.co`, file bernama persis `.env.local` di root proyek, lalu restart server. |
| Halaman `/pos` kosong: "Cabang belum tersedia" / "Belum ada produk" | Data belum tersinkron. Login dulu saat online. Cek tabel `profiles` punya baris dengan `user_id` sama dengan UID user login; jika tidak, RLS memblokir semua data tanpa error. Pastikan `seed.sql` sudah dijalankan. |
| `npm start` error `ENOENT ... package.json` | Terminal berada di folder yang salah. Pindah ke folder yang berisi `package.json` (`cd` ke folder proyek). |
| Offline muncul halaman dino | Service worker belum aktif. Jalankan `npm run build` lalu `npm start` (bukan `npm run dev`), buka `/pos` saat online, refresh sekali, cek Application > Service Workers. |
| Login gagal "Email not confirmed" | Saat membuat user, centang **Auto Confirm User**, atau konfirmasi email user tersebut. |
| Antrean sync tidak turun | Cek tab Console untuk error. Item dengan error validasi tetap berada di outbox (field `lastError` di IndexedDB > `kasir-umkm` > `outbox`). |
| Dashboard: `Could not find the function ... dashboard_summary` | Jalankan `supabase/dashboard.sql` di SQL Editor. |
| Dashboard tidak berubah otomatis (status "Realtime terputus") | Pastikan `dashboard.sql` sudah dijalankan (menambah tabel ke publikasi Realtime) dan Realtime aktif di proyek Supabase. Tanpa Realtime, data tetap diperbarui tiap 1 menit. |
| Tampilan versi lama setelah deploy | Naikkan `V` di `public/sw.js`, atau Unregister service worker dan Clear site data. |

## Rencana pengembangan

- Dashboard monitoring multi-cabang (penjualan harian, kas, stok menipis) dengan Supabase Realtime
- Manajemen produk dan penyesuaian stok
- Buka/tutup shift dan kas masuk/keluar
- Void/retur transaksi
- Transfer stok antar cabang
- Laporan dan ekspor

## Teknologi

Next.js (App Router), React, TypeScript, Tailwind CSS, Supabase (Auth, Postgres, RLS, Realtime), Dexie (IndexedDB).
