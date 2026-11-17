-- =====================================================================
-- Kelola produk dari aplikasi (halaman /produk). Jalankan SETELAH schema.sql.
-- Aman dijalankan berulang kali.
-- =====================================================================
alter table products add column if not exists min_stock numeric(14,3) not null default 5;

-- Isi otomatis tenant dan pembuat data dari akun yang sedang login,
-- sehingga aplikasi tidak perlu mengirim tenant_id.
alter table products        alter column tenant_id  set default auth_tenant();
alter table stock_movements alter column tenant_id  set default auth_tenant();
alter table stock_movements alter column created_by set default auth.uid();
