-- =====================================================================
--  ตั้งผู้ใช้เป็น Admin
--  1) สร้างผู้ใช้ก่อนที่ Authentication > Users > Add user (Auto Confirm)
--  2) แก้อีเมลด้านล่างให้ตรงกับผู้ใช้นั้น แล้วกด Run
-- =====================================================================

insert into public.admins (user_id)
select id from auth.users
where email = 'admin@example.com'   -- <<< แก้เป็นอีเมล Admin ของคุณ
on conflict (user_id) do nothing;

-- ตรวจสอบรายชื่อ Admin
select a.user_id, u.email, a.created_at
from public.admins a
join auth.users u on u.id = a.user_id;

-- ยกเลิกสิทธิ์ Admin (ถ้าต้องการ)
-- delete from public.admins
-- where user_id = (select id from auth.users where email = 'admin@example.com');
