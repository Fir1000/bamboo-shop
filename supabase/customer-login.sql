-- =====================================================================
--  ระบบสมาชิกลูกค้า: ต้องเข้าสู่ระบบก่อนสั่งซื้อ + ลูกค้าดูสถานะคำสั่งซื้อของตัวเอง
--  รันไฟล์นี้ใน Supabase Dashboard > SQL Editor หลังจากรัน schema.sql แล้ว (รันซ้ำได้)
-- =====================================================================

-- 1) ผูกคำสั่งซื้อกับบัญชีผู้ใช้
alter table public.orders
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists customer_email text not null default '';

create index if not exists idx_orders_user on public.orders (user_id, created_at desc);

-- 2) place_order: บังคับเข้าสู่ระบบ และบันทึกผู้สั่ง
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
  v_uid          uuid := auth.uid();
  v_email        text := coalesce(auth.jwt() ->> 'email', '');
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
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนสั่งซื้อ' using errcode = '42501';
  end if;

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

  -- กันสแปม: บัญชีหรือเบอร์เดียวกันสั่งเกิน 5 ครั้งใน 10 นาที
  select count(*) into v_recent
  from public.orders
  where (user_id = v_uid or phone = v_phone) and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'มีการสั่งซื้อถี่เกินไป กรุณารอสักครู่ หรือติดต่อร้านผ่าน LINE';
  end if;

  -- เลขคำสั่งซื้อรายวัน (แถวนี้ถูกล็อกจนจบ transaction จึงไม่ซ้ำกัน)
  insert into public.order_counters as c (order_date, last_number)
  values (v_today, 1)
  on conflict (order_date) do update set last_number = c.last_number + 1
  returning last_number into v_seq;

  v_order_number := 'ORD-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0');

  insert into public.orders (order_number, user_id, customer_email, customer_name, phone, address, note, total_amount, status)
  values (v_order_number, v_uid, v_email, v_name, v_phone, v_address, v_note, 0, 'pending')
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

-- ผู้ที่ยังไม่เข้าสู่ระบบ (anon) สั่งซื้อไม่ได้อีกต่อไป
revoke all on function public.place_order(text, text, text, text, jsonb) from public, anon;
grant execute on function public.place_order(text, text, text, text, jsonb) to authenticated;

-- 3) RLS: ลูกค้าอ่านคำสั่งซื้อและรายการสินค้าของตัวเองได้ (แก้ไขไม่ได้)
drop policy if exists "orders_select_admin" on public.orders;
drop policy if exists "orders_select_own_or_admin" on public.orders;
create policy "orders_select_own_or_admin" on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "order_items_select_admin" on public.order_items;
drop policy if exists "order_items_select_own_or_admin" on public.order_items;
create policy "order_items_select_own_or_admin" on public.order_items
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

-- =====================================================================
--  อย่าลืม: Authentication > Sign In / Providers > เปิด "Allow new users to sign up"
--  เพื่อให้ลูกค้าสมัครสมาชิกเองได้ (Admin ยังต้องเพิ่มผ่าน create-admin.sql เท่านั้น)
-- =====================================================================
