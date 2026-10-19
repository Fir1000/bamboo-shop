-- =====================================================================
--  ตั้งค่าร้าน (LINE, เพจ Facebook, ที่ตั้ง) + จัดการรายชื่อ Admin จากหน้า admin/settings.html
--  รันไฟล์นี้ใน Supabase Dashboard > SQL Editor หลังจากรัน schema.sql แล้ว (รันซ้ำได้)
-- =====================================================================

-- 1) ตารางตั้งค่าร้าน (มีแถวเดียว id = 1)
create table if not exists public.shop_settings (
  id             smallint primary key default 1 check (id = 1),
  line_id        text not null default '' check (char_length(line_id) <= 60),
  facebook_url   text not null default '' check (facebook_url  = '' or facebook_url  ~* '^https://'),
  messenger_url  text not null default '' check (messenger_url = '' or messenger_url ~* '^https://'),
  location_text  text not null default '' check (char_length(location_text) <= 200),
  map_url        text not null default '' check (map_url = '' or map_url ~* '^https://'),
  updated_at     timestamptz not null default now()
);

insert into public.shop_settings (id, line_id, facebook_url, messenger_url, location_text)
values (1, '141414dw', 'https://www.facebook.com/share/1DzgU4Dign/', 'https://m.me/61594881681695', 'ต.ปุโรง อ.กรงปินัง จ.ยะลา')
on conflict (id) do nothing;

drop trigger if exists trg_shop_settings_updated_at on public.shop_settings;
create trigger trg_shop_settings_updated_at
  before update on public.shop_settings
  for each row execute function public.set_updated_at();

alter table public.shop_settings enable row level security;

-- ทุกคนอ่านได้ (หน้าร้านใช้แสดงลิงก์ติดต่อ) / แก้ได้เฉพาะ Admin
drop policy if exists "shop_settings_select_public" on public.shop_settings;
create policy "shop_settings_select_public" on public.shop_settings
  for select to anon, authenticated
  using (true);

drop policy if exists "shop_settings_update_admin" on public.shop_settings;
create policy "shop_settings_update_admin" on public.shop_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 2) จัดการรายชื่อ Admin (ผู้ใช้ต้องสมัครสมาชิกที่หน้า login.html ก่อน)
create or replace function public.admin_list_admins()
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select a.user_id, u.email::text, a.created_at
    from public.admins a
    join auth.users u on u.id = a.user_id
    order by a.created_at;
end;
$$;

create or replace function public.admin_add_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select id into v_user_id from auth.users where lower(email) = lower(trim(p_email));
  if v_user_id is null then
    raise exception 'ADMIN_USER_NOT_FOUND';
  end if;
  insert into public.admins (user_id) values (v_user_id)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.admin_remove_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'ADMIN_REMOVE_SELF';
  end if;
  delete from public.admins where user_id = p_user_id;
end;
$$;

revoke all on function public.admin_list_admins()        from public, anon;
revoke all on function public.admin_add_admin(text)      from public, anon;
revoke all on function public.admin_remove_admin(uuid)   from public, anon;
grant execute on function public.admin_list_admins()      to authenticated;
grant execute on function public.admin_add_admin(text)    to authenticated;
grant execute on function public.admin_remove_admin(uuid) to authenticated;
