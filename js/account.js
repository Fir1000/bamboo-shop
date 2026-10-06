/* =====================================================================
   account.js — เข้าสู่ระบบ / สมัครสมาชิก (login.html) และคำสั่งซื้อของฉัน (my-orders.html)
   ลูกค้าและ Admin ใช้หน้า login เดียวกัน: Admin ไปหลังร้าน ลูกค้ากลับไปหน้าเดิม
   ===================================================================== */

/* =====================================================================
   LOGIN / SIGNUP
   ===================================================================== */

async function initLoginPage() {
  const loginForm = document.getElementById('loginForm');
  if (!loginForm) return;

  const signupForm = document.getElementById('signupForm');
  const msg = document.getElementById('authMsg');
  const title = document.getElementById('authTitle');
  const tabs = { login: document.getElementById('tabLogin'), signup: document.getElementById('tabSignup') };
  const params = new URLSearchParams(location.search);
  const next = Auth.safeNext(params.get('next'));

  const show = (text, type = 'error') => {
    msg.hidden = false;
    msg.className = `notice notice-${type}`;
    msg.textContent = text;
  };

  function switchTab(name) {
    const isLogin = name === 'login';
    tabs.login.setAttribute('aria-selected', String(isLogin));
    tabs.signup.setAttribute('aria-selected', String(!isLogin));
    loginForm.hidden = !isLogin;
    signupForm.hidden = isLogin;
    title.textContent = isLogin ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก';
    msg.hidden = true;
  }
  tabs.login.addEventListener('click', () => switchTab('login'));
  tabs.signup.addEventListener('click', () => switchTab('signup'));
  if (params.get('tab') === 'signup') switchTab('signup');

  async function goAfterLogin() {
    if (await Auth.isAdmin()) { location.replace(next.startsWith('admin/') ? next : 'admin/dashboard.html'); return; }
    location.replace(next && !next.startsWith('admin/') ? next : 'my-orders.html');
  }

  if (params.get('error') === 'notadmin') show('บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ');
  else if (next === 'checkout.html') show('กรุณาเข้าสู่ระบบหรือสมัครสมาชิกก่อนสั่งซื้อสินค้า', 'info');

  if (!isConfigured()) { msg.hidden = false; msg.className = ''; msg.innerHTML = configNoticeHtml(); return; }

  // เข้าสู่ระบบอยู่แล้ว -> ไปต่อเลย (ยกเว้นเพิ่งถูกเด้งออกจากหลังร้าน)
  if (params.get('error') !== 'notadmin' && await Auth.session()) { await goAfterLogin(); return; }

  async function withBusy(form, busyText, fn) {
    const btn = form.querySelector('button[type="submit"]');
    const label = btn.textContent;
    msg.hidden = true;
    btn.disabled = true;
    btn.textContent = busyText;
    try { await fn(); }
    catch (err) { show(translateError(err)); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    if (!email || !password) { show('กรุณากรอกอีเมลและรหัสผ่าน'); return; }

    withBusy(loginForm, 'กำลังเข้าสู่ระบบ...', async () => {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await goAfterLogin();
    });
  });

  signupForm.addEventListener('submit', e => {
    e.preventDefault();
    const fullName = signupForm.full_name.value.trim();
    const phone = signupForm.phone.value.trim();
    const phoneDigits = phone.replace(/[^0-9]/g, '');
    const email = signupForm.email.value.trim();
    const password = signupForm.password.value;

    if (fullName.length < 2) { show('กรุณากรอกชื่อ-นามสกุล'); return; }
    if (phoneDigits.length < 9 || phoneDigits.length > 10) { show('กรุณากรอกเบอร์โทรศัพท์ 9–10 หลัก'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { show('รูปแบบอีเมลไม่ถูกต้อง'); return; }
    if (password.length < 6) { show('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร'); return; }

    withBusy(signupForm, 'กำลังสมัครสมาชิก...', async () => {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, phone },
          emailRedirectTo: new URL('login.html' + (next ? '?next=' + encodeURIComponent(next) : ''), location.href).href
        }
      });
      if (error) throw error;

      if (data.session) { await goAfterLogin(); return; }

      // โปรเจกต์เปิด "Confirm email" ไว้ -> ต้องกดลิงก์ในอีเมลก่อน
      switchTab('login');
      loginForm.email.value = email;
      show('สมัครสมาชิกสำเร็จ กรุณากดลิงก์ยืนยันในอีเมลของคุณ แล้วกลับมาเข้าสู่ระบบ', 'success');
    });
  });
}

/* =====================================================================
   MY ORDERS
   ===================================================================== */

const ORDER_STEPS = ['pending', 'confirmed', 'preparing', 'shipping', 'completed'];

function orderStepsHtml(status) {
  if (status === 'cancelled') {
    return '<div class="notice notice-warn">คำสั่งซื้อนี้ถูกยกเลิก หากมีข้อสงสัยกรุณาติดต่อร้านทาง LINE</div>';
  }
  const at = ORDER_STEPS.indexOf(status);
  return `<ol class="order-steps">${ORDER_STEPS.map((s, i) => `
    <li class="${i <= at ? 'done' : ''} ${i === at ? 'current' : ''}" ${i === at ? 'aria-current="step"' : ''}>
      ${escapeHtml(ORDER_STATUS[s].label)}</li>`).join('')}
  </ol>`;
}

function orderCardHtml(o) {
  const items = o.order_items || [];
  return `
    <article class="panel order-card">
      <div class="order-head">
        <h2 class="mono">${escapeHtml(o.order_number)}</h2>
        ${statusBadge(o.status)}
      </div>
      <p class="order-date">สั่งเมื่อ ${formatDate(o.created_at)}</p>
      ${orderStepsHtml(o.status)}
      <ul class="order-items">
        ${items.map(i => `
          <li><span>${escapeHtml(i.product_name)}<small>× ${i.quantity}</small></span>
              <strong>${formatPrice(i.subtotal)}</strong></li>`).join('')}
      </ul>
      <div class="summary-total"><span>ยอดรวม</span><strong>${formatPrice(o.total_amount)}</strong></div>
    </article>`;
}

async function initMyOrdersPage() {
  const listEl = document.getElementById('orderList');
  if (!listEl) return;
  if (!isConfigured()) { listEl.innerHTML = configNoticeHtml(); return; }

  const session = await Auth.session();
  if (!session) { location.replace(Auth.loginUrl('my-orders.html')); return; }

  document.getElementById('accountEmail').textContent = session.user.email || '';
  document.getElementById('accountBar').hidden = false;
  document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());

  async function load() {
    const { data, error } = await sb.from('orders')
      .select('id,order_number,total_amount,status,created_at,order_items(product_name,quantity,subtotal)')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      listEl.innerHTML = `<div class="notice notice-error">${escapeHtml(translateError(error))}</div>`;
      return;
    }
    listEl.innerHTML = data.length ? data.map(orderCardHtml).join('') : `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <h2>ยังไม่มีคำสั่งซื้อ</h2>
        <p>เลือกสินค้าจากชุมชนของเราแล้วสั่งซื้อได้เลย</p>
        <a href="products.html" class="btn btn-primary">เลือกซื้อสินค้า</a>
      </div>`;
  }

  await load();

  // ร้านเปลี่ยนสถานะ -> หน้านี้อัปเดตเอง (RLS ส่งเฉพาะคำสั่งซื้อของผู้ใช้คนนี้)
  sb.channel('my-orders')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${session.user.id}` },
      payload => {
        showToast(`คำสั่งซื้อ ${payload.new?.order_number || ''} อัปเดตสถานะเป็น "${ORDER_STATUS[payload.new?.status]?.label || ''}"`, 'success', 5000);
        load();
      })
    .subscribe();
}

document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
  initMyOrdersPage();
});
