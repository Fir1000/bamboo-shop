/* =====================================================================
   supabase.js — ตั้งค่า Supabase + ฟังก์ชันที่ใช้ร่วมกันทุกหน้า
   ===================================================================== */

// ▼▼▼ ใส่ค่าจาก Supabase Dashboard > Project Settings > API ▼▼▼
const SUPABASE_URL = 'https://guucywlofreotgzwmfmx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vTzfwFolUtMVNRmvA7w1xA_I3VBFMEu';
// ▲▲▲ ห้ามใส่ service_role key ในไฟล์นี้เด็ดขาด ▲▲▲

const SHOP = {
  name: 'วิสาหกิจชุมชนปลูกพืชพลังงานและแปรรูปไม้ไผ่',
  location: 'ต.ปุโรง อ.กรงปินัง จ.ยะลา',
  lineId: '141414dw',
  facebook: 'https://www.facebook.com/share/1C79rC3M53/'
};

// ค่าเริ่มต้น — ถูกแทนที่ด้วยข้อมูลจากตาราง categories เมื่อเรียก loadCategories()
let CATEGORIES = ['ไม้ไผ่', 'ผลิตภัณฑ์แปรรูป', 'พืชพลังงาน', 'สินค้าอื่น ๆ'];
const STORAGE_BUCKET = 'product-images';

const ORDER_STATUS = {
  pending:   { label: 'รอตรวจสอบ',        cls: 'st-pending' },
  confirmed: { label: 'ยืนยันคำสั่งซื้อ',   cls: 'st-confirmed' },
  preparing: { label: 'กำลังเตรียมสินค้า',  cls: 'st-preparing' },
  shipping:  { label: 'กำลังจัดส่ง',        cls: 'st-shipping' },
  completed: { label: 'สำเร็จ',             cls: 'st-completed' },
  cancelled: { label: 'ยกเลิก',             cls: 'st-cancelled' }
};

const LINE_URL = 'https://line.me/ti/p/~' + encodeURIComponent(SHOP.lineId);

function isConfigured() {
  return !SUPABASE_URL.includes('YOUR_PROJECT_ID') && !SUPABASE_ANON_KEY.includes('YOUR_');
}

if (!window.supabase || !window.supabase.createClient) {
  console.error('ไม่พบไลบรารี Supabase — ตรวจสอบ <script> CDN ในหน้า HTML');
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

/* ---------- Helpers ---------- */

async function loadCategories() {
  if (!isConfigured()) return CATEGORIES;
  const { data, error } = await sb.from('categories').select('name')
    .order('sort_order').order('name');
  if (error) console.warn('โหลดหมวดหมู่ไม่สำเร็จ ใช้ค่าเริ่มต้นแทน', error);
  else if (data.length) CATEGORIES = data.map(c => c.name);
  return CATEGORIES;
}

function formatPrice(n) {
  const num = Number(n || 0);
  return '฿' + num.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeImageUrl(url) {
  if (typeof url === 'string' && /^https:\/\//i.test(url)) return escapeHtml(url);
  return PLACEHOLDER_IMG;
}

const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
  '<rect width="400" height="300" fill="#eef4e6"/>' +
  '<g fill="none" stroke="#9cb98a" stroke-width="10" stroke-linecap="round">' +
  '<path d="M170 250V60M230 250V80"/><path d="M160 120h20M160 180h20M220 140h20M220 200h20" stroke-width="6"/>' +
  '<path d="M170 90c30-20 60-20 80-5M230 110c20-20 50-25 70-15" stroke-width="6"/></g></svg>'
);

function statusBadge(status) {
  const s = ORDER_STATUS[status] || { label: status, cls: '' };
  return `<span class="status-badge ${s.cls}">${escapeHtml(s.label)}</span>`;
}

function translateError(err) {
  const msg = (err && (err.message || err.error_description || String(err))) || 'เกิดข้อผิดพลาด';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  if (/Invalid login credentials/i.test(msg)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง — ถ้ายังไม่มีบัญชี กดแท็บ "สมัครสมาชิก" ด้านบนเพื่อสมัครก่อน';
  if (/already registered|already been registered/i.test(msg)) return 'อีเมลนี้สมัครสมาชิกไว้แล้ว กรุณาเข้าสู่ระบบ';
  if (/Password should be at least/i.test(msg)) return 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร';
  if (/Signups not allowed|signup.*disabled/i.test(msg)) return 'ระบบยังไม่เปิดให้สมัครสมาชิก กรุณาติดต่อร้าน';
  if (/rate limit|too many/i.test(msg)) return 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';
  if (/Unable to validate email|invalid.*email/i.test(msg)) return 'รูปแบบอีเมลไม่ถูกต้อง';
  if (/Email not confirmed/i.test(msg)) return 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล';
  if (/row-level security|permission denied|42501/i.test(msg)) return 'ไม่มีสิทธิ์ดำเนินการนี้';
  if (/JWT|expired/i.test(msg)) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  if (/stock_quantity_check/i.test(msg)) return 'จำนวนสต็อกต้องไม่ติดลบ';
  if (/categories_name_key/i.test(msg)) return 'มีหมวดหมู่ชื่อนี้อยู่แล้ว';
  if (/on table "categories" violates foreign key/i.test(msg)) return 'ยังมีสินค้าอยู่ในหมวดหมู่นี้ กรุณาย้ายสินค้าไปหมวดอื่นก่อนลบ';
  if (/products_category_fkey/i.test(msg)) return 'ไม่พบหมวดหมู่นี้ (อาจถูกลบไปแล้ว) กรุณาเลือกหมวดหมู่ใหม่';
  if (/invalid input syntax/i.test(msg)) return 'ข้อมูลไม่ถูกต้อง';
  return msg;
}

function showToast(message, type = 'info', ms = 3200) {
  let wrap = document.getElementById('toastWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toastWrap';
    wrap.className = 'toast-wrap';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function configNoticeHtml() {
  return `<div class="notice notice-warn">
    <strong>ยังไม่ได้เชื่อมต่อ Supabase</strong><br>
    กรุณาใส่ <code>SUPABASE_URL</code> และ <code>SUPABASE_ANON_KEY</code> ในไฟล์ <code>js/supabase.js</code>
  </div>`;
}

/* ---------- บัญชีผู้ใช้ (ลูกค้า + Admin ใช้หน้า login.html เดียวกัน) ---------- */

const Auth = {
  async session() {
    if (!isConfigured()) return null;
    const { data: { session } } = await sb.auth.getSession();
    return session;
  },

  async isAdmin() {
    const { data, error } = await sb.rpc('is_admin');
    return !error && data === true;
  },

  // ไปหน้า login แล้วกลับมาหน้าเดิมหลังเข้าสู่ระบบ
  loginUrl(next = location.pathname.split('/').pop() || 'index.html') {
    return 'login.html?next=' + encodeURIComponent(next);
  },

  // รับเฉพาะหน้าในเว็บนี้ (กัน open redirect)
  safeNext(next) {
    return typeof next === 'string' && /^[\w-]+(\/[\w-]+)?\.html$/.test(next) && next !== 'login.html' ? next : '';
  },

  async logout(to = 'index.html') {
    await sb.auth.signOut();
    location.replace(to);
  }
};

// ปุ่มบัญชีบน navbar: ยังไม่ล็อกอิน = "Log In" / ลูกค้า = "คำสั่งซื้อของฉัน" / Admin = "Log In" (ลิงก์ไปหลังร้าน)
async function initAccountLink() {
  const link = document.querySelector('[data-account-link]');
  if (!link) return;
  const label = link.querySelector('.account-label');
  const set = (href, text) => {
    link.href = href; label.textContent = text; link.setAttribute('aria-label', text);
    link.classList.toggle('is-short', text.length <= 8); // ข้อความสั้นแสดงบนมือถือได้
  };

  const session = await Auth.session().catch(() => null);
  if (!session) { set(Auth.loginUrl(), 'Log In'); return; }
  if (await Auth.isAdmin()) set('admin/dashboard.html', 'Log In');
  else set('my-orders.html', 'คำสั่งซื้อของฉัน');
}

/* ---------- UI ร่วมของหน้าลูกค้า ---------- */

function initCommonUI() {
  // ลิงก์ LINE ทุกจุด
  document.querySelectorAll('[data-line-link]').forEach(a => {
    a.href = LINE_URL;
    a.target = '_blank';
    a.rel = 'noopener';
  });
  document.querySelectorAll('[data-facebook-link]').forEach(a => {
    a.href = SHOP.facebook;
    a.target = '_blank';
    a.rel = 'noopener';
  });
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear() + 543; });
  initAccountLink();

  // เมนูมือถือ
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('navMenu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }
}

document.addEventListener('DOMContentLoaded', initCommonUI);
