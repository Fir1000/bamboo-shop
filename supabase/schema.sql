-- =====================================================================
--  วิสาหกิจชุมชนปลูกพืชพลังงานและแปรรูปไม้ไผ่ — Supabase Schema
--  รันไฟล์นี้ทั้งไฟล์ใน Supabase Dashboard > SQL Editor (รันซ้ำได้)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1) TABLES
-- ---------------------------------------------------------------------

create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(trim(name)) between 1 and 200),
  description     text not null default '',
  price           numeric(10,2) not null default 0 check (price >= 0),
  stock_quantity  integer not null default 0 check (stock_quantity >= 0),  -- กันติดลบระดับฐานข้อมูล
  image_url       text,
  category        text not null default 'สินค้าอื่น ๆ',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text not null unique,
  customer_name   text not null,
  phone           text not null,
  address         text not null,
  note            text not null default '',
  total_amount    numeric(12,2) not null default 0 check (total_amount >= 0),
  status          text not null default 'pending'
                  check (status in ('pending','confirmed','preparing','shipping','completed','cancelled')),
  created_at      timestamptz not null default now()
);

create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  product_name    text not null,
  price           numeric(10,2) not null,
  quantity        integer not null check (quantity > 0),
  subtotal        numeric(12,2) not null
);

-- รายชื่อผู้ดูแลระบบ (ผูกกับ Supabase Auth)
create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ตัวนับเลขคำสั่งซื้อรายวัน (ORD-YYYYMMDD-001)
create table if not exists public.order_counters (
  order_date   date primary key,
  last_number  integer not null default 0
);

create index if not exists idx_products_active   on public.products (is_active, created_at desc);
create index if not exists idx_orders_created    on public.orders (created_at desc);
create index if not exists idx_orders_status     on public.orders (status);
create index if not exists idx_orders_phone      on public.orders (phone, created_at desc);
create index if not exists idx_order_items_order on public.order_items (order_id);
create index if not exists idx_order_items_prod  on public.order_items (product_id);

-- หมวดหมู่สินค้า (Admin จัดการได้จากหน้า admin/categories.html)
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(trim(name)) between 1 and 60),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.categories (name, sort_order) values
  ('ไม้ไผ่', 1), ('ผลิตภัณฑ์แปรรูป', 2), ('พืชพลังงาน', 3), ('สินค้าอื่น ๆ', 4)
on conflict (name) do nothing;

-- หมวดหมู่ที่สินค้าเดิมใช้อยู่แต่ยังไม่มีในตาราง
insert into public.categories (name, sort_order)
select distinct category, 100 from public.products
on conflict (name) do nothing;

-- เปลี่ยนชื่อหมวดหมู่ -> สินค้าเปลี่ยนตามอัตโนมัติ / ลบหมวดที่ยังมีสินค้าใช้อยู่ไม่ได้
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_category_fkey') then
    alter table public.products
      add constraint products_category_fkey foreign key (category)
      references public.categories (name) on update cascade on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) HELPERS
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3) PLACE ORDER — สร้างคำสั่งซื้อ + ตัด Stock ใน Transaction เดียว
--    - ล็อกแถวสินค้าด้วย SELECT ... FOR UPDATE (กันลูกค้าหลายคนสั่งพร้อมกัน)
--    - ใช้ราคาจากฐานข้อมูลเสมอ (ไม่เชื่อราคาที่ส่งมาจากหน้าเว็บ)
--    - ถ้าสินค้าไม่พอ -> RAISE -> ทุกอย่าง rollback อัตโนมัติ
-- ---------------------------------------------------------------------

create or replace function public.place_order(
  p_customer_name text,
  p_phone         text,
  p_address       text,
  p_note          text,
  p_items         jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name         text := trim(coalesce(p_customer_name, ''));
  v_phone        text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_address      text := trim(coalesce(p_address, ''));
  v_note         text := left(trim(coalesce(p_note, '')), 1000);
  v_today        date := (now() at time zone 'Asia/Bangkok')::date;
  v_seq          integer;
  v_order_id     uuid;
  v_order_number text;
  v_total        numeric(12,2) := 0;
  v_item         record;
  v_product      public.products%rowtype;
  v_recent       integer;
begin
  -- ตรวจข้อมูลลูกค้า
  if char_length(v_name) < 2 or char_length(v_name) > 150 then
    raise exception 'กรุณากรอกชื่อ-นามสกุลให้ถูกต้อง';
  end if;
  if char_length(v_phone) < 9 or char_length(v_phone) > 15 then
    raise exception 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง';
  end if;
  if char_length(v_address) < 10 or char_length(v_address) > 1000 then
    raise exception 'กรุณากรอกที่อยู่สำหรับจัดส่งให้ครบถ้วน';
  end if;

  -- ตรวจรายการสินค้า
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ตะกร้าสินค้าว่าง';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'จำนวนรายการสินค้ามากเกินไป';
  end if;

  -- กันสแปม: เบอร์เดียวกันสั่งเกิน 5 ครั้งใน 10 นาที
  select count(*) into v_recent
  from public.orders
  where phone = v_phone and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'มีการสั่งซื้อถี่เกินไป กรุณารอสักครู่ หรือติดต่อร้านผ่าน LINE';
  end if;

  -- เลขคำสั่งซื้อรายวัน (แถวนี้ถูกล็อกจนจบ transaction จึงไม่ซ้ำกัน)
  insert into public.order_counters as c (order_date, last_number)
  values (v_today, 1)
  on conflict (order_date) do update set last_number = c.last_number + 1
  returning last_number into v_seq;

  v_order_number := 'ORD-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0');

  insert into public.orders (order_number, customer_name, phone, address, note, total_amount, status)
  values (v_order_number, v_name, v_phone, v_address, v_note, 0, 'pending')
  returning id into v_order_id;

  -- รวมสินค้าที่ซ้ำกัน และล็อกตามลำดับ id (ป้องกัน deadlock)
  for v_item in
    select (e->>'product_id')::uuid as product_id,
           sum((e->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as e
    group by 1
    order by 1
  loop
    if v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity > 1000 then
      raise exception 'จำนวนสินค้าไม่ถูกต้อง';
    end if;

    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;

    if not found or not v_product.is_active then
      raise exception 'มีสินค้าบางรายการปิดการขายแล้ว กรุณาตรวจสอบตะกร้าอีกครั้ง';
    end if;

    if v_product.stock_quantity < v_item.quantity then
      raise exception 'สินค้าเหลือไม่เพียงพอ: % (เหลือ % ชิ้น)', v_product.name, v_product.stock_quantity
        using hint = 'INSUFFICIENT_STOCK';
    end if;

    update public.products
       set stock_quantity = stock_quantity - v_item.quantity
     where id = v_product.id;

    insert into public.order_items (order_id, product_id, product_name, price, quantity, subtotal)
    values (v_order_id, v_product.id, v_product.name, v_product.price, v_item.quantity,
            v_product.price * v_item.quantity);

    v_total := v_total + (v_product.price * v_item.quantity);
  end loop;

  update public.orders set total_amount = v_total where id = v_order_id;

  return json_build_object(
    'order_number', v_order_number,
    'total_amount', v_total,
    'status',       'pending',
    'created_at',   now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 4) ADMIN: เปลี่ยนสถานะคำสั่งซื้อ (ยกเลิก = คืน Stock อัตโนมัติ)
-- ---------------------------------------------------------------------

create or replace function public.admin_update_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old  text;
  v_item record;
begin
  if not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ดำเนินการ' using errcode = '42501';
  end if;

  if p_status not in ('pending','confirmed','preparing','shipping','completed','cancelled') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;

  select status into v_old from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ไม่พบคำสั่งซื้อ';
  end if;

  if v_old = p_status then
    return;
  end if;

  if p_status = 'cancelled' then
    -- ยกเลิก: คืนสินค้าเข้าสต็อก
    for v_item in
      select product_id, sum(quantity)::integer as qty
      from public.order_items
      where order_id = p_order_id and product_id is not null
      group by product_id
      order by product_id
    loop
      update public.products
         set stock_quantity = stock_quantity + v_item.qty
       where id = v_item.product_id;
    end loop;

  elsif v_old = 'cancelled' then
    -- เปิดคำสั่งซื้อที่ยกเลิกแล้วกลับมาใหม่: ตัดสต็อกอีกครั้ง (ต้องมีพอ)
    for v_item in
      select product_id, min(product_name) as product_name, sum(quantity)::integer as qty
      from public.order_items
      where order_id = p_order_id and product_id is not null
      group by product_id
      order by product_id
    loop
      update public.products
         set stock_quantity = stock_quantity - v_item.qty
       where id = v_item.product_id
         and stock_quantity >= v_item.qty;
      if not found then
        raise exception 'สินค้าเหลือไม่เพียงพอสำหรับเปิดคำสั่งซื้อนี้อีกครั้ง: %', v_item.product_name;
      end if;
    end loop;
  end if;

  update public.orders set status = p_status where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) ADMIN: สถิติ Dashboard
-- ---------------------------------------------------------------------

create or replace function public.admin_dashboard_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
begin
  if not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ดำเนินการ' using errcode = '42501';
  end if;

  return json_build_object(
    'total_products',  (select count(*) from public.products),
    'in_stock',        (select count(*) from public.products where stock_quantity > 0),
    'out_of_stock',    (select count(*) from public.products where stock_quantity = 0),
    'total_orders',    (select count(*) from public.orders),
    'pending_orders',  (select count(*) from public.orders where status = 'pending'),
    'total_sales',     (select coalesce(sum(total_amount), 0) from public.orders where status <> 'cancelled'),
    'completed_sales', (select coalesce(sum(total_amount), 0) from public.orders where status = 'completed'),
    'today_sales',     (select coalesce(sum(total_amount), 0) from public.orders
                         where status <> 'cancelled' and created_at >= v_today_start)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 6) FUNCTION PERMISSIONS
-- ---------------------------------------------------------------------

revoke all on function public.place_order(text, text, text, text, jsonb) from public;
revoke all on function public.admin_update_order_status(uuid, text)    from public, anon;
revoke all on function public.admin_dashboard_stats()                  from public, anon;

grant execute on function public.is_admin()                                   to anon, authenticated;
grant execute on function public.place_order(text, text, text, text, jsonb)   to anon, authenticated;
grant execute on function public.admin_update_order_status(uuid, text)       to authenticated;
grant execute on function public.admin_dashboard_stats()                     to authenticated;

-- ---------------------------------------------------------------------
-- 7) ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.products       enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.admins         enable row level security;
alter table public.order_counters enable row level security;  -- ไม่มี policy = เข้าถึงตรงไม่ได้
alter table public.categories     enable row level security;

-- categories: ทุกคนอ่านได้ / Admin เพิ่ม แก้ ลบได้
drop policy if exists "categories_select_public" on public.categories;
create policy "categories_select_public" on public.categories
  for select to anon, authenticated
  using (true);

drop policy if exists "categories_insert_admin" on public.categories;
create policy "categories_insert_admin" on public.categories
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "categories_update_admin" on public.categories;
create policy "categories_update_admin" on public.categories
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "categories_delete_admin" on public.categories;
create policy "categories_delete_admin" on public.categories
  for delete to authenticated
  using (public.is_admin());

-- products: ทุกคนอ่านสินค้าที่เปิดขาย / Admin อ่านและแก้ไขได้ทั้งหมด
drop policy if exists "products_select_public" on public.products;
create policy "products_select_public" on public.products
  for select to anon, authenticated
  using (is_active = true or public.is_admin());

drop policy if exists "products_insert_admin" on public.products;
create policy "products_insert_admin" on public.products
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "products_update_admin" on public.products;
create policy "products_update_admin" on public.products
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "products_delete_admin" on public.products;
create policy "products_delete_admin" on public.products
  for delete to authenticated
  using (public.is_admin());

-- orders: ลูกค้าสร้างได้ผ่านฟังก์ชัน place_order เท่านั้น / Admin ดู แก้ ลบได้
drop policy if exists "orders_select_admin" on public.orders;
create policy "orders_select_admin" on public.orders
  for select to authenticated
  using (public.is_admin());

drop policy if exists "orders_update_admin" on public.orders;
create policy "orders_update_admin" on public.orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "orders_delete_admin" on public.orders;
create policy "orders_delete_admin" on public.orders
  for delete to authenticated
  using (public.is_admin());

-- order_items: Admin อ่านได้ (ลูกค้าสร้างผ่าน place_order)
drop policy if exists "order_items_select_admin" on public.order_items;
create policy "order_items_select_admin" on public.order_items
  for select to authenticated
  using (public.is_admin());

-- admins: ผู้ใช้ดูได้เฉพาะแถวของตัวเอง
drop policy if exists "admins_select_self" on public.admins;
create policy "admins_select_self" on public.admins
  for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 8) STORAGE: bucket รูปสินค้า
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- bucket เป็น public: ทุกคนเปิดรูปผ่าน public URL ได้
-- เฉพาะ Admin เท่านั้นที่ upload / แก้ / ลบ ได้
drop policy if exists "product_images_admin_select" on storage.objects;
create policy "product_images_admin_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product_images_admin_insert" on storage.objects;
create policy "product_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product_images_admin_update" on storage.objects;
create policy "product_images_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product_images_admin_delete" on storage.objects;
create policy "product_images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- ---------------------------------------------------------------------
-- 9) REALTIME: ราคา/สต็อกอัปเดตบนหน้าเว็บทันที, Admin เห็นออเดอร์ใหม่ทันที
-- ---------------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.products;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null;
  end;
end $$;

-- =====================================================================
--  เสร็จแล้ว! ขั้นต่อไป: สร้างผู้ใช้ Admin ใน Authentication แล้วรัน
--  supabase/create-admin.sql (แก้อีเมลก่อน)
-- =====================================================================
