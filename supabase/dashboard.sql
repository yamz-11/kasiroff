-- =====================================================================
-- Dashboard monitoring multi-cabang. Jalankan SETELAH schema.sql.
-- Aman dijalankan berulang kali.
-- =====================================================================

-- Batas stok menipis per produk (ubah lewat Table Editor bila perlu)
alter table products add column if not exists min_stock numeric(14,3) not null default 5;

create index if not exists sales_tenant_sold_at_idx on sales (tenant_id, sold_at);

-- Pastikan tabel yang dipantau ikut di publikasi Realtime
do $$
declare t text;
begin
  foreach t in array array['sales','cash_entries','branch_stock'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Ringkasan satu hari (zona waktu default WIB). RLS tetap berlaku:
-- owner/manager melihat semua cabang, kasir hanya cabangnya.
create or replace function dashboard_summary(p_day date default null, p_tz text default 'Asia/Jakarta')
returns jsonb
language sql stable
set search_path = public
as $$
  with params as (
    select coalesce(p_day, (now() at time zone p_tz)::date) as d
  ), rng as (
    select d,
           (d::timestamp) at time zone p_tz as t0,
           ((d + 1)::timestamp) at time zone p_tz as t1
    from params
  ), br as (
    select id, code, name from branches where is_active
  ), s as (
    select sa.* from sales sa, rng
    where sa.status = 'completed' and sa.sold_at >= rng.t0 and sa.sold_at < rng.t1
  ), pay as (
    select s.branch_id, p.method::text as method, sum(p.amount) as amount
    from payments p join s on s.id = p.sale_id
    group by s.branch_id, p.method
  ), ce as (
    select c.branch_id,
           coalesce(sum(c.amount) filter (where c.type = 'in'), 0)  as cash_in,
           coalesce(sum(c.amount) filter (where c.type = 'out'), 0) as cash_out
    from cash_entries c, rng
    where c.occurred_at >= rng.t0 and c.occurred_at < rng.t1
    group by c.branch_id
  ), sum_b as (
    select br.id as branch_id, br.code, br.name,
           coalesce(sum(s.total), 0)    as sales_total,
           count(s.id)                  as sales_count,
           coalesce(sum(s.discount), 0) as discount_total,
           max(s.sold_at)               as last_sale_at
    from br left join s on s.branch_id = br.id
    group by br.id, br.code, br.name
  )
  select jsonb_build_object(
    'day', (select d from rng),
    'generated_at', now(),

    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'branch_id', x.branch_id, 'code', x.code, 'name', x.name,
        'sales_total', x.sales_total, 'sales_count', x.sales_count,
        'discount_total', x.discount_total, 'last_sale_at', x.last_sale_at,
        'cash_sales', coalesce((select pay.amount from pay where pay.branch_id = x.branch_id and pay.method = 'cash'), 0),
        'cash_in',    coalesce((select ce.cash_in  from ce where ce.branch_id = x.branch_id), 0),
        'cash_out',   coalesce((select ce.cash_out from ce where ce.branch_id = x.branch_id), 0)
      ) order by x.name)
      from sum_b x), '[]'::jsonb),

    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('branch_id', pay.branch_id, 'method', pay.method, 'amount', pay.amount))
      from pay), '[]'::jsonb),

    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('branch_id', q.branch_id, 'hour', q.h, 'total', q.t))
      from (
        select s.branch_id, extract(hour from (s.sold_at at time zone p_tz))::int as h, sum(s.total) as t
        from s group by 1, 2
      ) q), '[]'::jsonb),

    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object('branch_id', q.branch_id, 'name', q.name, 'qty', q.qty, 'total', q.total))
      from (
        select s.branch_id, i.product_name as name, sum(i.qty) as qty, sum(i.subtotal) as total
        from sale_items i join s on s.id = i.sale_id
        group by 1, 2
      ) q), '[]'::jsonb),

    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object(
        'branch_id', bs.branch_id, 'branch', br.name, 'product_id', p.id,
        'name', p.name, 'qty', bs.qty, 'min_stock', p.min_stock
      ) order by bs.qty)
      from branch_stock bs
      join br on br.id = bs.branch_id
      join products p on p.id = bs.product_id
      where p.track_stock and p.is_active and p.deleted_at is null and bs.qty <= p.min_stock
    ), '[]'::jsonb),

    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'branch_id', r.branch_id, 'receipt_no', r.receipt_no, 'total', r.total, 'sold_at', r.sold_at
      ) order by r.sold_at desc)
      from (select id, branch_id, receipt_no, total, sold_at from s order by sold_at desc limit 20) r
    ), '[]'::jsonb)
  );
$$;

revoke execute on function dashboard_summary(date, text) from public, anon;
grant  execute on function dashboard_summary(date, text) to authenticated;
