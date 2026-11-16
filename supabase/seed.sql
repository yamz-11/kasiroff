-- Jalankan di Supabase SQL Editor SETELAH schema.sql.
-- Ganti UUID-USER-DI-SINI dengan User UID dari Authentication > Users.
with t as (
  insert into tenants(name) values ('Usaha Saya') returning id
), b as (
  insert into branches(tenant_id, code, name)
  select id, 'PST', 'Cabang Pusat' from t returning id, tenant_id
)
insert into profiles(user_id, tenant_id, branch_id, role, full_name)
select 'UUID-USER-DI-SINI', tenant_id, null, 'owner', 'Owner' from b;

insert into products(tenant_id, sku, name, price, cost)
select tenant_id, 'KOPI-01', 'Kopi Susu', 18000, 9000
from profiles where role = 'owner' limit 1;

insert into stock_movements(tenant_id, branch_id, product_id, type, qty_delta, note)
select p.tenant_id, b.id, p.id, 'purchase', 100, 'stok awal'
from products p join branches b on b.tenant_id = p.tenant_id
where p.sku = 'KOPI-01';
