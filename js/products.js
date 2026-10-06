/* =====================================================================
   products.js — แสดงสินค้า, ค้นหา, กรองหมวดหมู่, เพิ่มลงตะกร้า
   ใช้ในหน้า index.html (สินค้าแนะนำ) และ products.html (สินค้าทั้งหมด)
   ===================================================================== */

(function () {
  const grid = document.getElementById('productGrid');        // products.html
  const featured = document.getElementById('featuredGrid');   // index.html
  if (!grid && !featured) return;

  const state = {
    products: [],
    category: new URLSearchParams(location.search).get('category') || 'all',
    q: ''
  };

  const searchInput = document.getElementById('productSearch');
  const chipsEl = document.getElementById('categoryChips');
  const countEl = document.getElementById('resultCount');

  /* ---------- Load ---------- */

  async function load() {
    const target = grid || featured;
    if (!isConfigured()) { target.innerHTML = configNoticeHtml(); return; }

    const { data, error } = await sb
      .from('products')
      .select('id,name,description,price,stock_quantity,image_url,category,is_active,created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      target.innerHTML = `<div class="notice notice-error">โหลดสินค้าไม่สำเร็จ: ${escapeHtml(translateError(error))}
        <br><button class="btn btn-ghost btn-sm" type="button" id="retryLoad">ลองใหม่</button></div>`;
      document.getElementById('retryLoad')?.addEventListener('click', load);
      return;
    }
    state.products = data || [];
    Cart.syncFromList(state.products);
    render();
  }

  /* ---------- Render ---------- */

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return state.products.filter(p => {
      if (state.category !== 'all' && p.category !== state.category) return false;
      if (!q) return true;
      return (p.name + ' ' + (p.description || '') + ' ' + (p.category || '')).toLowerCase().includes(q);
    });
  }

  function cardHtml(p) {
    const stock = Number(p.stock_quantity);
    const out = stock <= 0;
    const inCart = Cart.qtyOf(p.id);
    const canAdd = Math.max(0, stock - inCart);
    const low = !out && stock <= 5;

    return `
      <article class="product-card ${out ? 'is-out' : ''}" data-id="${escapeHtml(p.id)}">
        <div class="product-media">
          <img src="${safeImageUrl(p.image_url)}" alt="${escapeHtml(p.name)}" loading="lazy">
          ${p.category ? `<span class="product-cat">${escapeHtml(p.category)}</span>` : ''}
          ${out ? '<span class="soldout-ribbon">สินค้าหมด</span>' : ''}
        </div>
        <div class="product-body">
          <h3 class="product-name">${escapeHtml(p.name)}</h3>
          ${p.description ? `<p class="product-desc">${escapeHtml(p.description)}</p>` : ''}
          <div class="product-meta">
            <span class="product-price">${formatPrice(p.price)}</span>
            <span class="stock-tag ${out ? 'stock-out' : low ? 'stock-low' : 'stock-ok'}">
              ${out ? 'สินค้าหมด' : `เหลือ ${stock} ชิ้น`}
            </span>
          </div>
          ${inCart ? `<p class="in-cart-note">✓ อยู่ในตะกร้า ${inCart} ชิ้น</p>` : ''}
          <div class="product-actions">
            <div class="qty-stepper" role="group" aria-label="เลือกจำนวน">
              <button type="button" data-act="dec" aria-label="ลดจำนวน" ${out || canAdd === 0 ? 'disabled' : ''}>−</button>
              <input type="number" inputmode="numeric" min="1" max="${Math.max(1, canAdd)}" value="1"
                     data-act="qty" aria-label="จำนวน" ${out || canAdd === 0 ? 'disabled' : ''}>
              <button type="button" data-act="inc" aria-label="เพิ่มจำนวน" ${out || canAdd <= 1 ? 'disabled' : ''}>+</button>
            </div>
            <button type="button" class="btn btn-primary btn-add" data-act="add" ${out || canAdd === 0 ? 'disabled' : ''}>
              ${out ? 'สินค้าหมด' : canAdd === 0 ? 'ครบจำนวนแล้ว' : '🛒 เพิ่มลงตะกร้า'}
            </button>
          </div>
        </div>
      </article>`;
  }

  function render() {
    if (grid) {
      const list = filtered();
      if (countEl) countEl.textContent = `พบสินค้า ${list.length} รายการ`;
      grid.innerHTML = list.length
        ? list.map(cardHtml).join('')
        : `<div class="empty-state"><div class="empty-icon">🎋</div>
             <h2>${state.products.length ? 'ไม่พบสินค้าที่ค้นหา' : 'ยังไม่มีสินค้าในร้าน'}</h2>
             <p>${state.products.length ? 'ลองเปลี่ยนคำค้นหาหรือหมวดหมู่' : 'กรุณากลับมาใหม่เร็ว ๆ นี้'}</p></div>`;
    }
    if (featured) {
      const list = state.products.slice(0, 4);
      featured.innerHTML = list.length
        ? list.map(cardHtml).join('')
        : '<p class="muted center">ยังไม่มีสินค้า</p>';
    }
  }

  function renderChips() {
    if (!chipsEl) return;
    const cats = [['all', 'ทั้งหมด'], ...CATEGORIES.map(c => [c, c])];
    chipsEl.innerHTML = cats.map(([val, label]) =>
      `<button type="button" class="chip ${state.category === val ? 'active' : ''}" data-cat="${escapeHtml(val)}"
         aria-pressed="${state.category === val}">${escapeHtml(label)}</button>`).join('');
  }

  /* ---------- Events ---------- */

  function onGridClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT') return;
    const card = btn.closest('.product-card');
    const product = state.products.find(p => p.id === card.dataset.id);
    if (!product) return;
    const input = card.querySelector('input[data-act="qty"]');
    const max = parseInt(input.max, 10) || 1;
    let v = parseInt(input.value, 10) || 1;

    if (btn.dataset.act === 'inc') v = Math.min(max, v + 1);
    if (btn.dataset.act === 'dec') v = Math.max(1, v - 1);
    if (btn.dataset.act === 'inc' || btn.dataset.act === 'dec') {
      input.value = v;
      card.querySelector('[data-act="dec"]').disabled = v <= 1;
      card.querySelector('[data-act="inc"]').disabled = v >= max;
      return;
    }

    if (btn.dataset.act === 'add') {
      const res = Cart.add(product, v);
      if (res.ok) {
        showToast(`เพิ่ม "${product.name}" ${v} ชิ้นลงตะกร้าแล้ว`, 'success');
        render();
      } else {
        showToast(res.msg, 'warn');
      }
    }
  }

  function onGridChange(e) {
    if (e.target.dataset.act !== 'qty') return;
    const input = e.target;
    const max = parseInt(input.max, 10) || 1;
    let v = parseInt(input.value, 10) || 1;
    if (v > max) { v = max; showToast(`เลือกได้สูงสุด ${max} ชิ้น`, 'warn'); }
    input.value = Math.max(1, v);
  }

  [grid, featured].filter(Boolean).forEach(el => {
    el.addEventListener('click', onGridClick);
    el.addEventListener('change', onGridChange);
  });

  if (chipsEl) {
    chipsEl.addEventListener('click', e => {
      const chip = e.target.closest('[data-cat]');
      if (!chip) return;
      state.category = chip.dataset.cat;
      const url = new URL(location.href);
      if (state.category === 'all') url.searchParams.delete('category'); else url.searchParams.set('category', state.category);
      history.replaceState(null, '', url);
      renderChips();
      render();
    });
  }

  if (searchInput) {
    let t;
    searchInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { state.q = searchInput.value; render(); }, 150);
    });
  }

  /* ---------- Realtime: ราคา/สต็อกเปลี่ยน -> อัปเดตหน้าเว็บทันที ---------- */

  function subscribeRealtime() {
    if (!isConfigured()) return;
    let timer;
    sb.channel('public-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        clearTimeout(timer);
        timer = setTimeout(load, 400);
      })
      .subscribe();
  }

  // โหลดใหม่เมื่อกลับมาที่แท็บ (กรณี realtime หลุด)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });

  loadCategories().then(() => {
    if (state.category !== 'all' && !CATEGORIES.includes(state.category)) state.category = 'all';
    renderChips();
    load();
  });
  subscribeRealtime();
})();
