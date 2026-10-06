/* =====================================================================
   checkout.js — กรอกข้อมูลและยืนยันคำสั่งซื้อ (เรียก RPC place_order)
   ===================================================================== */

(function () {
  const form = document.getElementById('checkoutForm');
  if (!form) return;

  const summaryEl = document.getElementById('orderSummary');
  const notesEl = document.getElementById('checkoutNotes');
  const errorEl = document.getElementById('checkoutError');
  const submitBtn = document.getElementById('submitOrder');
  const checkoutView = document.getElementById('checkoutView');
  const successView = document.getElementById('successView');
  let submitting = false;

  function renderSummary() {
    const items = Cart.get();
    if (!items.length) {
      checkoutView.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛒</div>
          <h2>ยังไม่มีสินค้าในตะกร้า</h2>
          <p>กรุณาเลือกสินค้าก่อนดำเนินการสั่งซื้อ</p>
          <a href="products.html" class="btn btn-primary">เลือกซื้อสินค้า</a>
        </div>`;
      return false;
    }
    summaryEl.innerHTML = `
      <h2>รายการสินค้า</h2>
      <table class="summary-table">
        <thead><tr><th>สินค้า</th><th class="num">จำนวน</th><th class="num">ราคา</th></tr></thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>${escapeHtml(it.name)}<small>${formatPrice(it.price)} / ชิ้น</small></td>
              <td class="num">${it.quantity}</td>
              <td class="num">${formatPrice(it.price * it.quantity)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="summary-total"><span>ยอดรวม</span><strong>${formatPrice(Cart.total())}</strong></div>
      <a href="cart.html" class="btn-link">← แก้ไขตะกร้า</a>`;
    return true;
  }

  function showNotes(notes) {
    notesEl.innerHTML = notes.length
      ? `<div class="notice notice-warn"><ul>${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>`
      : '';
  }

  function setFieldError(name, msg) {
    const field = form.elements[name];
    const holder = field.closest('.field');
    holder.classList.toggle('has-error', !!msg);
    holder.querySelector('.field-error').textContent = msg || '';
  }

  function validate() {
    const name = form.customer_name.value.trim();
    const phoneDigits = form.phone.value.replace(/[^0-9]/g, '');
    const address = form.address.value.trim();
    let ok = true;

    setFieldError('customer_name', name.length >= 2 ? '' : 'กรุณากรอกชื่อ-นามสกุล');
    if (name.length < 2) ok = false;

    const phoneOk = phoneDigits.length >= 9 && phoneDigits.length <= 10;
    setFieldError('phone', phoneOk ? '' : 'กรุณากรอกเบอร์โทรศัพท์ 9–10 หลัก');
    if (!phoneOk) ok = false;

    setFieldError('address', address.length >= 10 ? '' : 'กรุณากรอกที่อยู่สำหรับจัดส่งให้ครบถ้วน');
    if (address.length < 10) ok = false;

    return ok;
  }

  function showSuccess(result) {
    checkoutView.hidden = true;
    successView.hidden = false;
    document.getElementById('successOrderNo').textContent = result.order_number;
    document.getElementById('successTotal').textContent = formatPrice(result.total_amount);
    document.getElementById('successStatus').innerHTML = statusBadge(result.status || 'pending');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    document.getElementById('copyOrderNo').onclick = async () => {
      try {
        await navigator.clipboard.writeText(result.order_number);
        showToast('คัดลอกเลขคำสั่งซื้อแล้ว', 'success');
      } catch {
        showToast('คัดลอกไม่สำเร็จ กรุณาจดเลขคำสั่งซื้อไว้', 'warn');
      }
    };
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (submitting) return;
    errorEl.hidden = true;
    if (!validate()) return;
    if (!isConfigured()) { errorEl.hidden = false; errorEl.innerHTML = configNoticeHtml(); return; }

    const items = Cart.get();
    if (!items.length) { renderSummary(); return; }

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังส่งคำสั่งซื้อ...';

    try {
      const { data, error } = await sb.rpc('place_order', {
        p_customer_name: form.customer_name.value.trim(),
        p_phone: form.phone.value.trim(),
        p_address: form.address.value.trim(),
        p_note: form.note.value.trim(),
        p_items: items.map(i => ({ product_id: i.id, quantity: i.quantity }))
      });
      if (error) throw error;

      Cart.clear();
      showSuccess(data);
    } catch (err) {
      console.error(err);
      const msg = translateError(err);
      errorEl.hidden = false;
      errorEl.innerHTML = `<div class="notice notice-error"><strong>${
        /สินค้าเหลือไม่เพียงพอ/.test(msg) ? 'สินค้าเหลือไม่เพียงพอ' : 'สั่งซื้อไม่สำเร็จ'
      }</strong><br>${escapeHtml(msg)}</div>`;

      // สต็อกอาจเปลี่ยน -> ดึงข้อมูลล่าสุดมาปรับตะกร้า
      try {
        const notes = await Cart.refresh();
        showNotes(notes);
        renderSummary();
      } catch { /* ignore */ }

      errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'ยืนยันการสั่งซื้อ';
    }
  });

  form.querySelectorAll('input, textarea').forEach(el =>
    el.addEventListener('input', () => el.closest('.field')?.classList.remove('has-error')));

  // เติมชื่อ/เบอร์/ที่อยู่จากคำสั่งซื้อล่าสุด หรือข้อมูลตอนสมัครสมาชิก
  async function prefill(session) {
    const meta = session.user.user_metadata || {};
    const { data } = await sb.from('orders')
      .select('customer_name,phone,address')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1);
    const last = data?.[0] || {};
    const fill = (name, value) => { if (value && !form.elements[name].value) form.elements[name].value = value; };
    fill('customer_name', last.customer_name || meta.full_name);
    fill('phone', last.phone || meta.phone);
    fill('address', last.address);
  }

  (async function init() {
    if (isConfigured()) {
      const session = await Auth.session();
      if (!session) { location.replace(Auth.loginUrl('checkout.html')); return; }
      prefill(session).catch(err => console.warn(err));
    }
    if (!renderSummary()) return;
    try {
      const notes = await Cart.refresh();
      showNotes(notes);
      renderSummary();
    } catch (err) {
      console.error(err);
    }
  })();
})();
