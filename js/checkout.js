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

  /* ---------- รูปบิล (วาดด้วย canvas) ---------- */
  function wrapText(ctx, text, maxWidth) {
    const parts = window.Intl?.Segmenter
      ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map(s => s.segment)
      : [...text];
    const lines = [];
    let line = '';
    for (const part of parts) {
      if (line && ctx.measureText(line + part).width > maxWidth) { lines.push(line.trimEnd()); line = part.trimStart(); }
      else line += part;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  async function drawBill(order) {
    try { await document.fonts.ready; } catch { /* ignore */ }
    const W = 1080, P = 72, inner = W - P * 2;
    const font = (w, size) => `${w} ${size}px Sarabun, Prompt, sans-serif`;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // วาด 2 รอบ: รอบแรกวัดความสูงของบิล รอบสองวาดจริง
    const render = draw => {
      let y = 0;
      const text = (str, x, size, opt = {}) => {
        ctx.font = font(opt.weight || 400, size);
        ctx.textAlign = opt.align || 'left';
        ctx.fillStyle = opt.color || '#1f2a22';
        if (draw) ctx.fillText(str, x, y);
      };
      const rule = (color = '#e3dccb', dash = []) => {
        if (!draw) return;
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash);
        ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke(); ctx.setLineDash([]);
      };
      const para = (str, size, color) => {
        ctx.font = font(400, size);
        for (const l of wrapText(ctx, str, inner)) { y += size + 14; text(l, P, size, { color }); }
      };

      // หัวบิล
      if (draw) { ctx.fillStyle = '#1c3a26'; ctx.fillRect(0, 0, W, 210); }
      y = 92;  text(SHOP.name, W / 2, 34, { weight: 700, align: 'center', color: '#fff' });
      y = 140; text(SHOP.location, W / 2, 26, { align: 'center', color: '#cfe3d2' });
      y = 182; text('ใบสั่งซื้อ', W / 2, 26, { weight: 600, align: 'center', color: '#f1e3c4' });

      y = 280; text('เลขคำสั่งซื้อ', P, 26, { color: '#6b7568' });
      text(order.order_number, W - P, 34, { weight: 700, align: 'right' });
      y += 48; text('วันที่สั่ง', P, 26, { color: '#6b7568' });
      text(formatDate(order.created_at), W - P, 26, { align: 'right' });

      y += 36; rule();
      y += 54; text('ผู้สั่งซื้อ', P, 26, { weight: 700 });
      y += 44; text(`${order.customer_name}  ·  ${order.phone}`, P, 26);
      para(order.address, 24, '#4a5548');
      if (order.note) para('หมายเหตุ: ' + order.note, 24, '#8a6d2f');

      y += 36; rule();
      y += 50; text('รายการ', P, 24, { weight: 700, color: '#6b7568' });
      text('จำนวน', W - P - 220, 24, { weight: 700, align: 'right', color: '#6b7568' });
      text('ราคา', W - P, 24, { weight: 700, align: 'right', color: '#6b7568' });
      for (const it of order.items) {
        ctx.font = font(400, 26);
        const nameLines = wrapText(ctx, it.name, inner - 340);
        y += 50;
        text(nameLines[0], P, 26);
        text('× ' + it.quantity, W - P - 220, 26, { align: 'right' });
        text(formatPrice(it.price * it.quantity), W - P, 26, { align: 'right' });
        for (const l of nameLines.slice(1)) { y += 36; text(l, P, 26); }
        y += 34; text(`${formatPrice(it.price)} / ชิ้น`, P, 22, { color: '#8a948a' });
      }

      y += 36; rule('#1c3a26', [10, 8]);
      y += 66; text('ยอดรวม', P, 32, { weight: 700 });
      text(formatPrice(order.total_amount), W - P, 44, { weight: 700, align: 'right', color: '#2f6b3f' });
      y += 50; text('สถานะ: ' + (ORDER_STATUS[order.status]?.label || 'รอตรวจสอบ'), P, 24, { color: '#6b7568' });

      y += 70; text('ขอบคุณที่สนับสนุนสินค้าชุมชน', W / 2, 26, { weight: 600, align: 'center', color: '#2f6b3f' });
      y += 40; text(`LINE: ${SHOP.lineId}`, W / 2, 22, { align: 'center', color: '#8a948a' });
      return y + 60;
    };

    canvas.width = W;
    canvas.height = render(false);
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, W, canvas.height);
    render(true);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ส่งรูปบิลเข้า LINE ร้านอัตโนมัติ: อัปโหลดรูป -> Edge Function notify-line ส่งต่อให้ LINE
  async function notifyShop(order, blob) {
    const session = await Auth.session();
    if (!session) return;
    if (blob) {
      const path = `${session.user.id}/${order.order_number}.png`;
      const { error: upErr } = await sb.storage.from('order-bills')
        .upload(path, blob, { contentType: 'image/png', upsert: false });
      if (upErr) console.warn('อัปโหลดรูปบิลไม่สำเร็จ (จะส่งเฉพาะข้อความ)', upErr);
    }
    const { error } = await sb.functions.invoke('notify-line', { body: { order_number: order.order_number } });
    if (error) throw error;
  }

  async function setupBill(order) {
    const sendBtn = document.getElementById('sendBill');
    const saveBtn = document.getElementById('saveBill');
    const img = document.getElementById('billImage');
    const filename = `bill-${order.order_number}.png`;
    const pageUrl = SHOP.messenger || SHOP.facebook;

    let blob;
    try {
      blob = await drawBill(order);
      img.src = URL.createObjectURL(blob);
      img.hidden = false;
    } catch (err) {
      console.error(err);
      sendBtn.hidden = saveBtn.hidden = true;
      notifyShop(order, null).catch(e => console.warn('แจ้ง LINE ร้านไม่สำเร็จ', e));
      return;
    }
    const file = new File([blob], filename, { type: 'image/png' });

    notifyShop(order, blob).catch(err => console.warn('แจ้ง LINE ร้านไม่สำเร็จ', err));

    saveBtn.onclick = () => downloadBlob(blob, filename);

    sendBtn.onclick = async () => {
      // มือถือ: เปิดเมนูแชร์ -> เลือก Messenger -> เลือกแชทของเพจ
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: `คำสั่งซื้อ ${order.order_number} ยอดรวม ${formatPrice(order.total_amount)}` });
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }
      // คอมพิวเตอร์ / แชร์ไฟล์ไม่ได้: บันทึกรูป แล้วเปิดเพจให้แนบรูปในแชท
      downloadBlob(blob, filename);
      showToast('บันทึกรูปบิลแล้ว กด "ส่งข้อความ" ในเพจ แล้วแนบรูปนี้ได้เลย', 'success', 6000);
      setTimeout(() => window.open(pageUrl, '_blank', 'noopener'), 600);
    };
  }

  function showSuccess(result, order) {
    checkoutView.hidden = true;
    successView.hidden = false;
    document.getElementById('successOrderNo').textContent = result.order_number;
    document.getElementById('successTotal').textContent = formatPrice(result.total_amount);
    document.getElementById('successStatus').innerHTML = statusBadge(result.status || 'pending');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setupBill({ ...order, ...result, created_at: result.created_at || new Date().toISOString() });

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

      const order = {
        customer_name: form.customer_name.value.trim(),
        phone: form.phone.value.trim(),
        address: form.address.value.trim(),
        note: form.note.value.trim(),
        items: items.map(i => ({ name: i.name, price: i.price, quantity: i.quantity }))
      };
      Cart.clear();
      showSuccess(data, order);
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
