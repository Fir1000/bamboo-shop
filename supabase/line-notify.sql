-- =====================================================================
--  แจ้งเตือนคำสั่งซื้อใหม่เข้า LINE ร้าน (ส่งรูปบิลอัตโนมัติ)
--  รันไฟล์นี้ใน Supabase Dashboard > SQL Editor หลังจากรัน customer-login.sql แล้ว (รันซ้ำได้)
--  แล้ว Deploy Edge Function: supabase/functions/notify-line (ดูขั้นตอนใน README)
-- =====================================================================

-- 1) บันทึกว่าแจ้ง LINE ไปแล้วหรือยัง (กันส่งซ้ำ)
alter table public.orders
  add column if not exists line_notified_at timestamptz;

-- 2) bucket เก็บรูปบิล (private: เปิดได้ผ่าน signed URL ที่ Edge Function สร้างเท่านั้น)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-bills', 'order-bills', false, 2097152, array['image/png'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ลูกค้าอัปโหลดรูปบิลได้เฉพาะในโฟลเดอร์ของตัวเอง: order-bills/<user_id>/<เลขคำสั่งซื้อ>.png
drop policy if exists "order_bills_owner_insert" on storage.objects;
create policy "order_bills_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'order-bills' and (storage.foldername(name))[1] = auth.uid()::text);

-- Admin เปิดดูรูปบิลได้ทั้งหมด
drop policy if exists "order_bills_admin_select" on storage.objects;
create policy "order_bills_admin_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'order-bills' and public.is_admin());
