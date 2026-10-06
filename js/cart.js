/* =====================================================================
   cart.js — ตะกร้าสินค้า (เก็บใน localStorage) + หน้า cart.html
   ===================================================================== */

const CART_KEY = 'bamboo_shop_cart_v1';

const Cart = {
  get() {
    try {
      const data = JSON.parse(localStorage.getItem(CART_KEY));
      return Array.isArray(data) ? data.filter(i => i && i.id && i.quantity > 0) : [];
    } catch { return []; }
  },

  save(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* storage ไม่พร้อม */ }
    updateCartUI();
  },

  count() { return this.get().reduce((s, i) => s + i.quantity, 0); },
  total() { return this.get().reduce((s, i) => s + Number(i.price) * i.quantity, 0); },
  qtyOf(id) { const it = this.get().find(i => i.id === id); return it ? it.quantity : 0; },

  add(product, qty = 1) {
    qty = parseInt(qty, 10) || 1;
    const items = this.get();
    const existing = items.find(i => i.id === product.id);
    const current = existing ? existing.quantity : 0;
    const stock = Number(product.stock_quantity);

    if (stock <= 0) return { ok: false, msg: 'สินค้าหมด' };
    if (current + qty > stock) {
      const left = stock - current;
      return { ok: false, msg: left > 0 ? `เพิ่มได้อีกไม่เกิน ${left} ชิ้น` : `มีในตะกร้าครบจำนวนคงเหลือแล้ว (${stock} ชิ้น)` };
    }

    const data = {
      id: product.id,
      name: product.name,
      price: Number(product.price),
      image_url: product.image_url || '',
      stock,
      quantity: current + qty
    };
    if (existing) Object.assign(existing, data); else items.push(data);
    this.save(items);
    return { ok: true };
  },

  setQty(id, qty) {
    const items = this.get();
    const it = items.find(i => i.id === id);
    if (!it) return;
    qty = parseInt(qty, 10) || 0;
    if (qty <= 0) return this.remove(id);
    it.quantity = Math.min(qty, it.stock || qty);
    this.save(items);
  },

  remove(id) { this.save(this.get().filter(i => i.id !== id)); },
  clear() { this.save([]); },

  // อัปเดตราคา/สต็อกในตะกร้าจากรายการสินค้าที่โหลดมาแล้ว (ไม่ลบรายการ)
  syncFromList(products) {
    const map = new Map(products.map(p => [p.id, p]));
    const items = this.get();
    let changed = false;
    items.forEach(it => {
      const p = map.get(it.id);
      if (!p) return;
      if (it.price !== Number(p.price) || it.stock !== p.stock_quantity || it.name !== p.name) {
        it.price = Number(p.price); it.stock = p.stock_quantity; it.name = p.name; it.image_url = p.image_url || '';
        changed = true;
      }
    });
    if (changed) this.save(items);
  },

  // ดึงข้อมูลล่าสุดจากฐานข้อมูล: ปรับราคา/จำนวน และลบสินค้าที่หมด/ปิดขาย
  async refresh() {
    const items = this.get();
    if (!items.length || !isConfigured()) return [];
    const { data, error } = await sb
      .from('products')
      .select('id,name,price,stock_quantity,image_url,is_active')
      .in('id', items.map(i => i.id));
    if (error) throw error;

    const map = new Map((data || []).map(p => [p.id, p]));
    const notes = [];
    const next = [];
    for (const it of items) {
      const p = map.get(it.id);
      if (!p || !p.is_active) { notes.push(`"${it.name}" ปิดการขายแล้ว จึงถูกนำออกจากตะกร้า`); continue; }
      if (p.stock_quantity <= 0) { notes.push(`"${p.name}" สินค้าหมด จึงถูกนำออกจากตะกร้า`); continue; }
      let q = it.quantity;
      if (q > p.stock_quantity) {
        q = p.stock_quantity;
        notes.push(`"${p.name}" เหลือ ${p.stock_quantity} ชิ้น ปรับจำนวนในตะกร้าให้แล้ว`);
      }
      if (Number(p.price) !== Number(it.price)) notes.push(`ราคา "${p.name}" เปลี่ยนเป็น ${formatPrice(p.price)}`);
      next.push({ id: p.id, name: p.name, price: Number(p.price), image_url: p.image_url || '', stock: p.stock_quantity, quantity: q });
    }
    this.save(next);
    return notes;
  }
};

/* ---------- Badge + แถบตะกร้าลอย ---------- */

function updateCartUI() {
  const count = Cart.count();
  document.querySelectorAll('[data-cart-count]').forEach(el => {
    el.textContent = count > 99 ? '99+' : String(count);
    el.hidden = count === 0;
  });

  const sticky = document.getElementById('stickyCart');
  if (sticky) {
    sticky.hidden = count === 0;
    document.body.classList.toggle('has-sticky-cart', count > 0);
    const c = sticky.querySelector('[data-sticky-count]');
    const t = sticky.querySelector('[data-sticky-total]');
    if (c) c.textContent = `${count} ชิ้น`;
    if (t) t.textContent = formatPrice(Cart.total());
  }
}

window.addEventListener('storage', e => {
  if (e.key === CART_KEY) {
    updateCartUI();
    if (document.getElementById('cartPage')) renderCartPage();
  }
});

/* ---------- หน้า cart.html ---------- */

function renderCartPage(notes = []) {
  const itemsEl = document.getElementById('cartItems');
  const summaryEl = document.getElementById('cartSummary');
  const notesEl = document.getElementById('cartNotes');
  if (!itemsEl) return;

  notesEl.innerHTML = notes.length
    ? `<div class="notice notice-warn"><ul>${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>`
    : '';

  const items = Cart.get();
  if (!items.length) {
    itemsEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🛒</div>
        <h2>ตะกร้าของคุณยังว่าง</h2>
        <p>เลือกสินค้าจากชุมชนของเราได้เลย</p>
        <a href="products.html" class="btn btn-primary">เลือกซื้อสินค้า</a>
      </div>`;
    summaryEl.hidden = true;
    return;
  }

  itemsEl.innerHTML = items.map(it => `
    <article class="cart-item" data-id="${escapeHtml(it.id)}">
      <img src="${safeImageUrl(it.image_url)}" alt="${escapeHtml(it.name)}" loading="lazy">
      <div class="cart-item-body">
        <h3>${escapeHtml(it.name)}</h3>
        <p class="cart-item-calc">${formatPrice(it.price)} × ${it.quantity}</p>
        <p class="cart-item-stock">คงเหลือ ${it.stock} ชิ้น</p>
        <div class="cart-item-actions">
          <div class="qty-stepper" role="group" aria-label="จำนวน">
            <button type="button" data-act="dec" aria-label="ลดจำนวน">−</button>
            <input type="number" inputmode="numeric" min="1" max="${it.stock}" value="${it.quantity}" data-act="qty" aria-label="จำนวน">
            <button type="button" data-act="inc" aria-label="เพิ่มจำนวน" ${it.quantity >= it.stock ? 'disabled' : ''}>+</button>
          </div>
          <button type="button" class="btn-link danger" data-act="remove">ลบ</button>
        </div>
      </div>
      <div class="cart-item-subtotal">= ${formatPrice(it.price * it.quantity)}</div>
    </article>`).join('');

  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <h2>สรุปคำสั่งซื้อ</h2>
    <ul class="summary-lines">
      ${items.map(it => `
        <li><span>${escapeHtml(it.name)}<small>${formatPrice(it.price)} × ${it.quantity}</small></span>
            <strong>${formatPrice(it.price * it.quantity)}</strong></li>`).join('')}
    </ul>
    <div class="summary-total"><span>รวมทั้งหมด</span><strong>${formatPrice(Cart.total())}</strong></div>
    <a href="checkout.html" class="btn btn-primary btn-block btn-lg">ดำเนินการสั่งซื้อ</a>
    <a href="products.html" class="btn btn-ghost btn-block">เลือกซื้อสินค้าต่อ</a>`;
}

async function initCartPage() {
  const page = document.getElementById('cartPage');
  if (!page) return;

  renderCartPage();
  try {
    const notes = await Cart.refresh();
    renderCartPage(notes);
  } catch (err) {
    console.error(err);
  }

  const itemsEl = document.getElementById('cartItems');
  itemsEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT') return;
    const id = btn.closest('.cart-item').dataset.id;
    const qty = Cart.qtyOf(id);
    if (btn.dataset.act === 'inc') Cart.setQty(id, qty + 1);
    if (btn.dataset.act === 'dec') Cart.setQty(id, qty - 1);
    if (btn.dataset.act === 'remove') { Cart.remove(id); showToast('ลบสินค้าออกจากตะกร้าแล้ว'); }
    renderCartPage();
  });
  itemsEl.addEventListener('change', e => {
    if (e.target.dataset.act !== 'qty') return;
    const id = e.target.closest('.cart-item').dataset.id;
    const it = Cart.get().find(i => i.id === id);
    let v = parseInt(e.target.value, 10) || 1;
    if (it && v > it.stock) { v = it.stock; showToast(`สินค้าเหลือ ${it.stock} ชิ้น`, 'warn'); }
    Cart.setQty(id, Math.max(1, v));
    renderCartPage();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateCartUI();
  initCartPage();
});
