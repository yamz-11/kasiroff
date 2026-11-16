-- =====================================================================
-- Skema POS UMKM multi-cabang (Supabase / PostgreSQL)
-- Prinsip: ID dibuat di client (uuid) -> aman offline & idempotent.
-- Stok = ledger (stock_movements) -> delta saling-tambah, tidak bentrok saat sync.
-- =====================================================================
create extension if not exists pgcrypto;

create type user_role as enum ('owner', 'manager', 'cashier');
create type movement_type as enum ('sale','purchase','adjustment','transfer_in','transfer_out','return');
create type payment_method as enum ('cash','qris','transfer','card');
create type cash_entry_type as enum ('in','out');

-- ---------- Master ----------
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null,
  name text not null,
  address text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid references branches(id),          -- null = akses semua cabang (owner/manager)
  role user_role not null default 'cashier',
  full_name text
);

create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sku text,
  name text not null,
  category text,
  price numeric(14,2) not null default 0,
  cost numeric(14,2) not null default 0,
  track_stock boolean not null default true,
  is_active boolean not null default true,
  deleted_at timestamptz,                           -- soft delete agar bisa di-pull ke offline
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku)
);

-- ---------- Stok ----------
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id),
  product_id uuid not null references products(id),
  type movement_type not null,
  qty_delta numeric(14,3) not null,                 -- negatif = keluar
  ref_id uuid,                                      -- mis. sale id
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on stock_movements (branch_id, product_id, created_at);

create table branch_stock (
  branch_id uuid not null references branches(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  qty numeric(14,3) not null default 0,             -- boleh negatif (penjualan offline > stok tercatat)
  updated_at timestamptz not null default now(),
  primary key (branch_id, product_id)
);

-- ---------- Transaksi ----------
create table sales (
  id uuid primary key,                              -- dari client
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id),
  receipt_no text not null,
  cashier_id uuid references auth.users(id),
  subtotal numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  status text not null default 'completed' check (status in ('completed','void')),
  sold_at timestamptz not null,                     -- waktu di perangkat (bisa offline)
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, receipt_no)
);
create index on sales (branch_id, sold_at);

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  tenant_id uuid not null,
  product_id uuid not null references products(id),
  product_name text not null,                       -- snapshot
  qty numeric(14,3) not null,
  price numeric(14,2) not null,
  cost numeric(14,2) not null default 0,
  subtotal numeric(14,2) not null
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  tenant_id uuid not null,
  method payment_method not null,
  amount numeric(14,2) not null
);

-- ---------- Arus kas ----------
create table cash_shifts (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id),
  cashier_id uuid references auth.users(id),
  opened_at timestamptz not null,
  opening_cash numeric(14,2) not null default 0,
  closed_at timestamptz,
  closing_cash numeric(14,2),
  updated_at timestamptz not null default now()
);

create table cash_entries (                         -- pemasukan/pengeluaran di luar penjualan
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id),
  shift_id uuid references cash_shifts(id),
  type cash_entry_type not null,
  category text,                                    -- mis. listrik, bahan baku, setoran
  amount numeric(14,2) not null check (amount > 0),
  note text,
  occurred_at timestamptz not null,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create index on cash_entries (branch_id, occurred_at);

-- ---------- Helper & trigger ----------
create or replace function auth_tenant() returns uuid language sql stable security definer set search_path = public
as $$ select tenant_id from profiles where user_id = auth.uid() $$;

create or replace function auth_branch() returns uuid language sql stable security definer set search_path = public
as $$ select branch_id from profiles where user_id = auth.uid() $$;

create or replace function auth_role() returns user_role language sql stable security definer set search_path = public
as $$ select role from profiles where user_id = auth.uid() $$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['branches','products','sales','cash_shifts','cash_entries'] loop
    execute format('create trigger trg_touch before update on %I for each row execute function touch_updated_at()', t);
  end loop;
end $$;

-- Setiap movement otomatis memperbarui branch_stock
create or replace function apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into branch_stock (branch_id, product_id, tenant_id, qty)
  values (new.branch_id, new.product_id, new.tenant_id, new.qty_delta)
  on conflict (branch_id, product_id)
  do update set qty = branch_stock.qty + excluded.qty, updated_at = now();
  return new;
end $$;

create trigger trg_apply_stock after insert on stock_movements
for each row execute function apply_stock_movement();

-- ---------- RPC idempotent: push penjualan dari outbox offline ----------
create or replace function push_sale(p jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_tenant uuid := auth_tenant();
  v_branch uuid := (p->>'branch_id')::uuid;
  it jsonb; pay jsonb;
begin
  if exists (select 1 from sales where id = v_id) then return; end if;   -- sudah pernah masuk

  insert into sales (id, tenant_id, branch_id, receipt_no, cashier_id, subtotal, discount, tax, total, sold_at)
  values (v_id, v_tenant, v_branch, p->>'receipt_no', auth.uid(),
          (p->>'subtotal')::numeric, coalesce((p->>'discount')::numeric,0),
          coalesce((p->>'tax')::numeric,0), (p->>'total')::numeric, (p->>'sold_at')::timestamptz);

  for it in select * from jsonb_array_elements(p->'items') loop
    insert into sale_items (sale_id, tenant_id, product_id, product_name, qty, price, cost, subtotal)
    values (v_id, v_tenant, (it->>'product_id')::uuid, it->>'name', (it->>'qty')::numeric,
            (it->>'price')::numeric, coalesce((it->>'cost')::numeric,0), (it->>'subtotal')::numeric);

    if coalesce((select track_stock from products where id = (it->>'product_id')::uuid), false) then
      insert into stock_movements (tenant_id, branch_id, product_id, type, qty_delta, ref_id, created_by)
      values (v_tenant, v_branch, (it->>'product_id')::uuid, 'sale', -(it->>'qty')::numeric, v_id, auth.uid());
    end if;
  end loop;

  for pay in select * from jsonb_array_elements(p->'payments') loop
    insert into payments (sale_id, tenant_id, method, amount)
    values (v_id, v_tenant, (pay->>'method')::payment_method, (pay->>'amount')::numeric);
  end loop;
end $$;

-- ---------- Row Level Security ----------
alter table tenants enable row level security;
alter table branches enable row level security;
alter table profiles enable row level security;
alter table products enable row level security;
alter table stock_movements enable row level security;
alter table branch_stock enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table payments enable row level security;
alter table cash_shifts enable row level security;
alter table cash_entries enable row level security;

create policy p_tenants on tenants for select using (id = auth_tenant());
create policy p_profiles_self on profiles for select using (user_id = auth.uid() or (tenant_id = auth_tenant() and auth_role() in ('owner','manager')));
create policy p_branches_read on branches for select using (tenant_id = auth_tenant());
create policy p_branches_write on branches for all using (tenant_id = auth_tenant() and auth_role() = 'owner')
  with check (tenant_id = auth_tenant() and auth_role() = 'owner');

create policy p_products_read on products for select using (tenant_id = auth_tenant());
create policy p_products_write on products for all using (tenant_id = auth_tenant() and auth_role() in ('owner','manager'))
  with check (tenant_id = auth_tenant() and auth_role() in ('owner','manager'));

-- Data per cabang: owner/manager semua cabang, kasir hanya cabangnya
do $$ declare t text; begin
  foreach t in array array['stock_movements','branch_stock','sales','cash_shifts','cash_entries'] loop
    execute format($f$
      create policy p_%1$s_read on %1$I for select using (
        tenant_id = auth_tenant() and (auth_role() in ('owner','manager') or branch_id = auth_branch()))
    $f$, t);
    execute format($f$
      create policy p_%1$s_write on %1$I for insert with check (
        tenant_id = auth_tenant() and (auth_role() in ('owner','manager') or branch_id = auth_branch()))
    $f$, t);
  end loop;
end $$;

create policy p_sale_items_read on sale_items for select using (exists (select 1 from sales s where s.id = sale_id));
create policy p_sale_items_write on sale_items for insert with check (tenant_id = auth_tenant());
create policy p_payments_read on payments for select using (exists (select 1 from sales s where s.id = sale_id));
create policy p_payments_write on payments for insert with check (tenant_id = auth_tenant());

-- Realtime untuk dashboard monitoring
alter publication supabase_realtime add table sales, cash_entries, branch_stock;
