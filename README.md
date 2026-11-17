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
- Kelola produk `/produk` (owner/manager): tambah, ubah, sembunyikan produk, barang masuk, koreksi stok
- Dashboard monitoring `/dashboard` (owner/manager): penjualan harian, arus kas tunai, stok menipis, metode bayar, produk terlaris, transaksi terbaru, per cabang atau gabungan, diperbarui langsung lewat Supabase Realtime
- Multi-cabang dengan peran `owner`, `manager`, `cashier` dan pembatasan data lewat Row Level Security

Belum ada UI untuk: buka/tutup shift, kas masuk/keluar (tabel dan fungsi dasarnya sudah ada), void/retur, dan transfer stok antar cabang. Lihat bagian Rencana pengembangan.

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
6. Jalankan `supabase/produk.sql` (agar halaman Produk bisa menyimpan data atas nama akun yang login). Aman dijalankan ulang.

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

## Menambah produk

Buka `/produk` (tombol "Produk" di Beranda, hanya untuk owner dan manager). Perlu internet.

- **Tambah produk**: nama, harga jual, harga modal, kode/barcode (opsional), kategori, batas stok menipis, dan stok awal. Produk langsung muncul di kasir semua perangkat setelah sinkronisasi (maksimal sekitar 30 detik).
- **Ubah**: harga, nama, kategori, batas stok, atau sembunyikan produk dari kasir. Produk yang sudah pernah terjual tidak dihapus, hanya disembunyikan, agar riwayat penjualan tetap utuh.
- **Stok**: *Barang masuk* menambah stok, *Koreksi stok* menambah atau mengurangi (misalnya barang rusak). Semua perubahan tercatat sebagai riwayat di tabel `stock_movements`.
- Mengubah harga tidak mengubah transaksi yang sudah tercatat.

Untuk memasukkan banyak produk sekaligus, pakai Supabase Table Editor > tabel `products` > Insert > Import data from CSV. Karena dijalankan dari dashboard Supabase (bukan akun aplikasi), CSV harus menyertakan kolom `tenant_id` (salin dari tabel `tenants`).

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

## Rencana pengembangan

- Dashboard monitoring multi-cabang (penjualan harian, kas, stok menipis) dengan Supabase Realtime
- Manajemen produk dan penyesuaian stok
- Buka/tutup shift dan kas masuk/keluar
- Void/retur transaksi
- Transfer stok antar cabang
- Laporan dan ekspor

## Teknologi

Next.js (App Router), React, TypeScript, Tailwind CSS, Supabase (Auth, Postgres, RLS, Realtime), Dexie (IndexedDB).
