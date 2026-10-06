# ร้านค้าออนไลน์ — วิสาหกิจชุมชนปลูกพืชพลังงานและแปรรูปไม้ไผ่

ต.ปุโรง อ.กรงปินัง จ.ยะลา · LINE: 141414dw

เว็บไซต์ขายสินค้าออนไลน์ HTML5 / CSS3 / JavaScript (ไม่ใช้ React, ไม่ใช้ Bootstrap) เชื่อมต่อ Supabase Database, Storage และ Authentication

---

## โครงสร้างไฟล์

```
/
├── index.html            หน้าแรก (Hero, สินค้าแนะนำ, เกี่ยวกับเรา, ติดต่อ)
├── products.html         สินค้าทั้งหมด + ค้นหา + กรองหมวดหมู่
├── cart.html             ตะกร้าสินค้า
├── checkout.html         กรอกข้อมูล + ยืนยันการสั่งซื้อ + หน้าสั่งซื้อสำเร็จ (ต้องเข้าสู่ระบบ)
├── login.html            เข้าสู่ระบบ / สมัครสมาชิก (ลูกค้าและ Admin ใช้หน้าเดียวกัน)
├── my-orders.html        คำสั่งซื้อของฉัน + ติดตามสถานะ
├── admin.html            ทางลัดไปหน้า Login หลังร้าน
├── admin/
│   ├── login.html        ทางลัดไป login.html
│   ├── dashboard.html    ภาพรวม ยอดขาย สินค้าใกล้หมด
│   ├── products.html     เพิ่ม/แก้ไข/ลบสินค้า อัปเดต Stock อัปโหลดรูป
│   ├── categories.html   เพิ่ม/เปลี่ยนชื่อ/ลบ/เรียงลำดับหมวดหมู่
│   └── orders.html       ดู/ค้นหาคำสั่งซื้อ เปลี่ยนสถานะ
├── css/  style.css · product.css · admin.css
├── js/   supabase.js · products.js · cart.js · checkout.js · account.js · admin.js
├── assets/  logo.svg · bamboo-pattern.svg
└── supabase/
    ├── schema.sql        ตาราง + RLS + ฟังก์ชันตัด Stock + Storage (รันไฟล์เดียวจบ)
    ├── customer-login.sql ระบบสมาชิก: บังคับล็อกอินก่อนสั่ง + ลูกค้าดูคำสั่งซื้อตัวเอง
    ├── create-admin.sql  ตั้งผู้ใช้เป็น Admin
    └── seed.sql          สินค้าตัวอย่าง (ไม่บังคับ)
```

---

## ระบบตัด Stock ทำงานอย่างไร

ลูกค้า **ไม่ได้เขียนลงตาราง orders ตรง ๆ** หน้าเว็บเรียกฟังก์ชัน `place_order()` ในฐานข้อมูล ซึ่งทำทุกอย่างใน Transaction เดียว:

1. ล็อกแถวสินค้าด้วย `SELECT ... FOR UPDATE` — ถ้ามีลูกค้าสั่งพร้อมกัน คนถัดไปต้องรอให้คนแรกเสร็จก่อน
2. ตรวจ `stock_quantity >= จำนวนที่สั่ง` ถ้าไม่พอ → แจ้ง **"สินค้าเหลือไม่เพียงพอ"** และยกเลิกทั้งหมด (ไม่มี order ค้าง)
3. สร้าง `orders` + `order_items` และหัก stock
4. ใช้ **ราคาจากฐานข้อมูล** เสมอ (ลูกค้าแก้ราคาในเบราว์เซอร์ไม่ได้)
5. คอลัมน์ `stock_quantity` มี `CHECK (stock_quantity >= 0)` เป็นด่านสุดท้าย — ติดลบไม่ได้แม้แต่ Admin

ทดสอบแล้ว: ลูกค้า 40 คนสั่งพร้อมกันคนละ 1 ชิ้น จากสต็อก 20 → สำเร็จ 20 คนพอดี สต็อกเหลือ 0 เลขคำสั่งซื้อไม่ซ้ำ

**เพิ่มเติม**
- Admin เปลี่ยนสถานะเป็น "ยกเลิก" → คืนสินค้าเข้าสต็อกอัตโนมัติ (เปิดกลับมาใหม่ → ตัดสต็อกอีกครั้ง)
- Admin กด "อัปเดต Stock" ระบบเช็กว่าไม่มีลูกค้าสั่งซื้อแทรกระหว่างนั้น ถ้ามีจะแจ้งเตือนให้ดูตัวเลขล่าสุด
- กันสแปม: เบอร์โทรเดียวกันสั่งได้ไม่เกิน 5 ครั้งใน 10 นาที
- เลขคำสั่งซื้อรูปแบบ `ORD-YYYYMMDD-001` นับใหม่ทุกวันตามเวลาไทย

---

## ขั้นตอนติดตั้ง (ทีละขั้น)

### 1. สร้าง Supabase Project
1. ไปที่ https://supabase.com แล้วสมัคร/เข้าสู่ระบบ
2. กด **New project**
3. ตั้งชื่อ เช่น `bamboo-shop`, ตั้ง **Database Password** (จดเก็บไว้), เลือก Region **Southeast Asia (Singapore)** ใกล้ไทยที่สุด
4. กด **Create new project** รอประมาณ 1–2 นาที

### 2. สร้าง Database
Supabase สร้างฐานข้อมูล PostgreSQL ให้อัตโนมัติพร้อมกับโปรเจกต์แล้ว ไม่ต้องทำอะไรเพิ่ม ตารางทั้งหมดจะถูกสร้างในขั้นที่ 3

### 3. รัน SQL
1. เมนูซ้าย → **SQL Editor** → **New query**
2. เปิดไฟล์ `supabase/schema.sql` คัดลอกทั้งหมดไปวาง → กด **Run**
3. ต้องขึ้น `Success. No rows returned`
4. รัน `supabase/customer-login.sql` (New query → วาง → Run) เพื่อเปิดระบบสมาชิกลูกค้า
5. (ไม่บังคับ) รัน `supabase/seed.sql` เพื่อเพิ่มสินค้าตัวอย่าง 4 รายการ

ไฟล์นี้สร้าง: ตาราง `products`, `orders`, `order_items`, `admins`, `order_counters` · เปิด RLS ทุกตาราง · ฟังก์ชัน `place_order`, `admin_update_order_status`, `admin_dashboard_stats`, `is_admin` · Storage bucket · Realtime
(รันซ้ำได้ ไม่ทำให้ข้อมูลเดิมหาย)

### 4. สร้าง Storage
`schema.sql` สร้าง bucket **`product-images`** (Public, จำกัด 5MB, รับเฉพาะรูป) และ policy ให้เฉพาะ Admin อัปโหลด/ลบให้แล้ว
ตรวจสอบได้ที่ เมนู **Storage** → ต้องเห็น bucket `product-images` ที่มีป้าย Public

> ถ้าไม่เห็น bucket ให้กด **New bucket** → ชื่อ `product-images` → เปิด **Public bucket** → Save แล้วรัน `schema.sql` อีกรอบเพื่อใส่ policy

### 5. ตั้งค่า Authentication
1. เมนู **Authentication** → **Sign In / Providers** → ตรวจว่า **Email** เปิดอยู่
2. **เปิด "Allow new users to sign up"** — ให้ลูกค้าสมัครสมาชิกเองได้ (คนที่สมัครเองไม่มีสิทธิ์ Admin สิทธิ์ Admin ต้องเพิ่มผ่าน `create-admin.sql` เท่านั้น)
   - **Confirm email**: เปิดไว้ = ลูกค้าต้องกดลิงก์ในอีเมลก่อนล็อกอิน / ปิด = สมัครแล้วใช้งานได้ทันที (สะดวกกว่าสำหรับลูกค้าในชุมชน)
3. เมนู **Authentication** → **URL Configuration** → ใส่ **Site URL** เป็นโดเมนเว็บจริงหลัง Deploy (เช่น `https://bamboo-puro.netlify.app`)

### 6. ใส่ Supabase URL
1. เมนู **Project Settings** → **API** (หรือ **Data API**)
2. คัดลอก **Project URL** เช่น `https://abcdefgh.supabase.co`
3. เปิดไฟล์ `js/supabase.js` แก้บรรทัด:
```js
const SUPABASE_URL = 'https://abcdefgh.supabase.co';
```

### 7. ใส่ Publishable / Anon Key
1. หน้าเดียวกัน → **API Keys** คัดลอก **Publishable key** (`sb_publishable_...`) หรือ **anon public** key แบบเดิม
2. แก้ใน `js/supabase.js`:
```js
const SUPABASE_ANON_KEY = 'sb_publishable_xxxxxxxx';
```
> ⚠️ **ห้ามใช้ `service_role` / Secret key เด็ดขาด** — key นั้นข้าม RLS ได้ทั้งหมด ถ้าอยู่ในหน้าเว็บ ใครก็ลบข้อมูลร้านได้
> Publishable/anon key ใส่ในหน้าเว็บได้อย่างปลอดภัย เพราะสิทธิ์ถูกควบคุมด้วย RLS

### 8. เปิดเว็บไซต์
**ทดสอบในเครื่อง** (อย่าดับเบิลคลิกไฟล์ HTML ตรง ๆ ให้เปิดผ่าน local server):
```bash
# วิธีที่ 1: Python
cd โฟลเดอร์โปรเจกต์
python -m http.server 8000
# เปิด http://localhost:8000

# วิธีที่ 2: VS Code ติดตั้งส่วนขยาย "Live Server" แล้วคลิกขวา index.html → Open with Live Server
```

**Deploy จริง** (เว็บเป็นไฟล์ Static ใช้โฮสต์ฟรีได้):
- **Netlify**: เข้า https://app.netlify.com/drop แล้วลากทั้งโฟลเดอร์ไปวาง ได้ลิงก์ทันที
- **Vercel / Cloudflare Pages / GitHub Pages**: อัปโหลดโฟลเดอร์หรือเชื่อม GitHub repo (ไม่ต้องตั้ง build command)

หลัง Deploy อย่าลืมกลับไปใส่ Site URL ในขั้นที่ 5

### 9. สร้าง Admin
1. Supabase → **Authentication** → **Users** → **Add user** → **Create new user**
2. ใส่อีเมลและรหัสผ่าน (ยาว 8 ตัวขึ้นไป) → ติ๊ก **Auto Confirm User** → Create
3. เปิดไฟล์ `supabase/create-admin.sql` แก้ `admin@example.com` เป็นอีเมลที่เพิ่งสร้าง → วางใน SQL Editor → **Run**
4. ผลลัพธ์ต้องแสดงอีเมลนั้นในรายชื่อ Admin
5. กดปุ่ม **👤 เข้าสู่ระบบ** มุมขวาบนของหน้าร้าน (หรือเปิด `/admin.html`) ใส่อีเมล/รหัสผ่าน Admin → ระบบพาไปหลังร้านอัตโนมัติ

> ปุ่มเข้าสู่ระบบใช้ร่วมกัน: บัญชี Admin → ไปหลังร้าน · บัญชีลูกค้า → ไปหน้า "คำสั่งซื้อของฉัน"
> เปลี่ยนรหัสผ่าน Admin: Authentication → Users → เลือกผู้ใช้ → **Send password recovery** หรือลบแล้วสร้างใหม่

> ต้องการ Admin หลายคน: ทำข้อ 1–3 ซ้ำกับอีเมลอื่น

### 10. เพิ่มสินค้า
1. หลังร้าน → **📦 จัดการสินค้า** → **➕ เพิ่มสินค้า**
2. กรอก ชื่อสินค้า, รายละเอียด, ราคา, จำนวนสินค้า, หมวดหมู่, เลือกรูป, สถานะ "เปิดขาย"
3. กด **บันทึกสินค้า** — รูปถูกย่อขนาดอัตโนมัติแล้วอัปโหลดไป Supabase Storage URL เก็บใน `products.image_url`
4. เปิดหน้า `products.html` → สินค้าต้องขึ้นทันที
5. ลองแก้ราคา 50 → 55 แล้วบันทึก → หน้าร้านที่เปิดค้างไว้จะเปลี่ยนราคาเองภายใน 1–2 วินาที (Realtime)

### 11. ทดสอบการสั่งซื้อ
1. เปิดหน้าร้าน (แนะนำใช้มือถือหรือหน้าต่าง Incognito)
2. เลือกจำนวน → **เพิ่มลงตะกร้า** → กดไอคอน 🛒
3. ตรวจราคา × จำนวน และยอดรวม → **ดำเนินการสั่งซื้อ**
4. กรอก ชื่อ-นามสกุล / เบอร์โทร / ที่อยู่ → **ยืนยันการสั่งซื้อ**
5. ต้องเห็น **"สั่งซื้อสำเร็จ"** เลข `ORD-YYYYMMDD-001` ยอดรวม และสถานะ "รอตรวจสอบ" พร้อมปุ่ม **ติดต่อร้านผ่าน LINE**
6. หลังร้าน → **🛒 คำสั่งซื้อ** → เห็นออเดอร์ใหม่ (มีแจ้งเตือนเด้งขึ้นถ้าเปิดค้างไว้) → ลองเปลี่ยนสถานะ และค้นหาด้วยเลข Order / ชื่อ / เบอร์โทร

### 12. ทดสอบการตัด Stock
1. ตั้งสินค้า A ให้ Stock = **20**
2. สั่งซื้อสินค้า A **3 ชิ้น** → หน้าร้านต้องแสดง **"เหลือ 17 ชิ้น"** และหลังร้าน Stock = 17
3. **ทดสอบสินค้าไม่พอ**: ใส่สินค้า A 5 ชิ้นในตะกร้า → ที่หลังร้านแก้ Stock เป็น 2 → กลับไปกดยืนยันการสั่งซื้อ → ต้องขึ้น **"สินค้าเหลือไม่เพียงพอ"** ตะกร้าปรับเหลือ 2 ให้อัตโนมัติ และไม่มีออเดอร์เกิดขึ้น
4. **ทดสอบสินค้าหมด**: ตั้ง Stock = 0 → หน้าร้านแสดง **"สินค้าหมด"** และปุ่มเพิ่มลงตะกร้ากดไม่ได้
5. **ทดสอบยกเลิก**: เปลี่ยนสถานะออเดอร์เป็น "ยกเลิก" → Stock ต้องเพิ่มกลับตามจำนวนในออเดอร์
6. (ทางเลือก) ตรวจด้วย SQL:
```sql
select name, stock_quantity from products order by name;
select order_number, total_amount, status from orders order by created_at desc limit 10;
```

---

## ความปลอดภัย (สรุป RLS)

| ตาราง | ลูกค้า (anon) | Admin |
|---|---|---|
| products | อ่านได้เฉพาะที่เปิดขาย | อ่าน/เพิ่ม/แก้/ลบ |
| orders | ต้องล็อกอิน สร้างผ่าน `place_order()` เท่านั้น อ่านได้เฉพาะของตัวเอง | อ่าน/แก้สถานะ/ลบ |
| order_items | อ่านได้เฉพาะของคำสั่งซื้อตัวเอง | อ่าน |
| admins, order_counters | ไม่มีสิทธิ์ | อ่านเฉพาะแถวตัวเอง |
| Storage `product-images` | ดูรูปผ่าน public URL | อัปโหลด/แก้/ลบ |

ข้อมูลลูกค้า (ชื่อ เบอร์ ที่อยู่) อ่านได้เฉพาะ Admin และทุกจุดที่แสดงข้อความจากลูกค้าผ่านการ escape กัน XSS

## ปรับแต่ง
- ข้อมูลร้าน / LINE / Facebook / หมวดหมู่สินค้า → `js/supabase.js` (`SHOP`, `CATEGORIES`)
- ข้อความ "เกี่ยวกับเรา" → `index.html` ส่วน `id="about"`
- สีธีม → ตัวแปร `:root` ใน `css/style.css`

## ปัญหาที่พบบ่อย
| อาการ | วิธีแก้ |
|---|---|
| ขึ้น "ยังไม่ได้เชื่อมต่อ Supabase" | ใส่ URL/Key ใน `js/supabase.js` ให้ถูก |
| Login ได้แต่ขึ้น "ไม่มีสิทธิ์ผู้ดูแลระบบ" | ยังไม่ได้รัน `create-admin.sql` หรืออีเมลไม่ตรง |
| อัปโหลดรูปไม่ได้ | ตรวจว่ามี bucket `product-images` และรัน `schema.sql` ครบ |
| สินค้าไม่ขึ้นหน้าร้าน | สินค้าต้องมีสถานะ "เปิดขาย" |
| ราคาไม่อัปเดตทันที | ตรวจ Database → Publications → `supabase_realtime` มีตาราง products (หรือรีเฟรชหน้า) |
