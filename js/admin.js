/* =====================================================================
   admin.js — ระบบหลังร้าน: Dashboard, จัดการสินค้า, คำสั่งซื้อ
   หน้าไหนทำงานส่วนไหน ดูจาก <body data-page="...">
   ===================================================================== */

// หน้า login ใช้ร่วมกับลูกค้า (../login.html) — Admin เข้าแล้วถูกส่งมาที่หลังร้านอัตโนมัติ
const LOGIN_URL = '../login.html?next=' + encodeURIComponent('admin/' + (location.pathname.split('/').pop() || 'dashboard.html'));

const Admin = {
  session: null,
  redirecting: false,

  async requireAdmin() {
    const loading = document.getElementById('adminLoading');
    if (!isConfigured()) { loading.innerHTML = configNoticeHtml(); return false; }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) { this.go(LOGIN_URL); return false; }

    const { data: isAdmin, error } = await sb.rpc('is_admin');
    if (error || !isAdmin) {
      this.redirecting = true;
      await sb.auth.signOut();
      this.go('../login.html?error=notadmin');
      return false;
    }

    this.session = session;
    document.getElementById('adminEmail').textContent = session.user.email || '';
    loading.remove();
    document.getElementById('adminShell').hidden = false;
    return true;
  },

  go(url) { this.redirecting = true; location.replace(url); },

  async logout() {
    this.redirecting = true;
    await sb.auth.signOut();
    location.replace('../login.html');
  }
};

sb.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT' && !Admin.redirecting) {
    location.replace(LOGIN_URL);
  }
});

function initShell() {
  document.getElementById('logoutBtn')?.addEventListener('click', () => Admin.logout());
  const sidebar = document.getElementById('adminSidebar');
  const btn = document.getElementById('adminMenuBtn');
  const backdrop = document.getElementById('sidebarBackdrop');
  const close = () => { sidebar.classList.remove('open'); backdrop.hidden = true; };
  btn?.addEventListener('click', () => { sidebar.classList.add('open'); backdrop.hidden = false; });
  backdrop?.addEventListener('click', close);
}

function subscribeNewOrders(onNew) {
  sb.channel('admin-orders')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, payload => {
      showToast(`🛒 มีคำสั่งซื้อใหม่ ${payload.new?.order_number || ''}`, 'success', 5000);
      onNew();
    })
    .subscribe();
}

/* =====================================================================
   DASHBOARD
   ===================================================================== */

async function initDashboard() {
  async function loadStats() {
    const { data, error } = await sb.rpc('admin_dashboard_stats');
    if (error) { showToast(translateError(error), 'error'); return; }
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('statTotalProducts', data.total_products.toLocaleString('th-TH'));
    set('statInStock', data.in_stock.toLocaleString('th-TH'));
    set('statOutStock', data.out_of_stock.toLocaleString('th-TH'));
    set('statTotalOrders', data.total_orders.toLocaleString('th-TH'));
    set('statSales', formatPrice(data.total_sales));
    set('statPending', data.pending_orders.toLocaleString('th-TH'));
    set('statToday', formatPrice(data.today_sales));
    set('statCompleted', formatPrice(data.completed_sales));
  }

  async function loadRecent() {
    const tbody = document.getElementById('recentOrders');
    const { data, error } = await sb.from('orders')
      .select('id,order_number,customer_name,total_amount,status,created_at')
      .order('created_at', { ascending: false }).limit(6);
    if (error) { tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(translateError(error))}</td></tr>`; return; }
    tbody.innerHTML = data.length ? data.map(o => `
      <tr>
        <td data-label="เลข Order"><strong>${escapeHtml(o.order_number)}</strong></td>
        <td data-label="ลูกค้า">${escapeHtml(o.customer_name)}</td>
        <td data-label="ยอดรวม" class="num">${formatPrice(o.total_amount)}</td>
        <td data-label="วันที่">${formatDate(o.created_at)}</td>
        <td data-label="สถานะ">${statusBadge(o.status)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="muted center">ยังไม่มีคำสั่งซื้อ</td></tr>';
  }

  async function loadLowStock() {
    const list = document.getElementById('lowStock');
    const { data, error } = await sb.from('products')
      .select('id,name,stock_quantity,is_active')
      .lte('stock_quantity', 5).order('stock_quantity').limit(8);
    if (error) { list.innerHTML = `<li>${escapeHtml(translateError(error))}</li>`; return; }
    list.innerHTML = data.length ? data.map(p => `
      <li><span>${escapeHtml(p.name)}${p.is_active ? '' : ' <small class="muted">(ปิดขาย)</small>'}</span>
          <span class="stock-pill ${p.stock_quantity === 0 ? 'out' : 'low'}">${p.stock_quantity === 0 ? 'หมด' : `เหลือ ${p.stock_quantity}`}</span></li>`).join('')
      : '<li class="muted">สินค้าทุกรายการมีสต็อกเพียงพอ 👍</li>';
  }

  const reloadAll = () => Promise.all([loadStats(), loadRecent(), loadLowStock()]);
  await reloadAll();
  subscribeNewOrders(reloadAll);
}

/* =====================================================================
   PRODUCTS (จัดการสินค้า)
   ===================================================================== */

async function initProducts() {
  const tbody = document.getElementById('productTable');
  const search = document.getElementById('productSearch');
  const dialog = document.getElementById('productDialog');
  const form = document.getElementById('productForm');
  const preview = document.getElementById('imagePreview');
  const fileInput = form.image;
  const saveBtn = document.getElementById('saveProductBtn');
  let products = [];
  let editing = null;

  // หมวดหมู่ใน select
  await loadCategories();
  form.category.innerHTML = CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  async function load() {
    const { data, error } = await sb.from('products').select('*').order('created_at', { ascending: false });
    if (error) { tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(translateError(error))}</td></tr>`; return; }
    products = data || [];
    render();
  }

  function statusOf(p) {
    if (!p.is_active) return '<span class="status-badge st-cancelled">ปิดการขาย</span>';
    if (p.stock_quantity <= 0) return '<span class="status-badge st-out">สินค้าหมด</span>';
    return '<span class="status-badge st-completed">พร้อมขาย</span>';
  }

  function render() {
    const q = (search.value || '').trim().toLowerCase();
    const list = products.filter(p => !q || (p.name + ' ' + p.category).toLowerCase().includes(q));
    document.getElementById('productCount').textContent = `ทั้งหมด ${list.length} รายการ`;
    tbody.innerHTML = list.length ? list.map(p => `
      <tr data-id="${escapeHtml(p.id)}">
        <td data-label="สินค้า">
          <div class="prod-cell">
            <img src="${safeImageUrl(p.image_url)}" alt="" loading="lazy">
            <div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.category || '')}</small></div>
          </div>
        </td>
        <td data-label="ราคา" class="num">${formatPrice(p.price)}</td>
        <td data-label="Stock">
          <div class="stock-edit">
            <label class="sr-only" for="stk-${escapeHtml(p.id)}">จำนวนคงเหลือ</label>
            <input type="number" min="0" step="1" inputmode="numeric" id="stk-${escapeHtml(p.id)}"
                   value="${p.stock_quantity}" data-original="${p.stock_quantity}" aria-label="จำนวนคงเหลือ">
            <button type="button" class="btn btn-sm btn-secondary" data-act="stock">อัปเดต Stock</button>
          </div>
        </td>
        <td data-label="สถานะ">${statusOf(p)}</td>
        <td data-label="จัดการ">
          <div class="row-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-act="edit">✏️ แก้ไข</button>
            <button type="button" class="btn btn-sm btn-danger-ghost" data-act="delete">🗑️ ลบ</button>
          </div>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="5" class="muted center">ยังไม่มีสินค้า — กด “➕ เพิ่มสินค้า” เพื่อเริ่มต้น</td></tr>';
  }

  /* ----- อัปเดต Stock (กันเขียนทับกรณีมีลูกค้าสั่งซื้อระหว่างนั้น) ----- */
  async function updateStock(row, btn) {
    const id = row.dataset.id;
    const input = row.querySelector('.stock-edit input');
    const original = parseInt(input.dataset.original, 10);
    const value = parseInt(input.value, 10);
    if (!Number.isInteger(value) || value < 0) { showToast('จำนวนคงเหลือต้องเป็นจำนวนเต็ม 0 ขึ้นไป', 'warn'); return; }
    if (value === original) { showToast('จำนวนไม่เปลี่ยนแปลง'); return; }

    btn.disabled = true;
    const { data, error } = await sb.from('products')
      .update({ stock_quantity: value })
      .eq('id', id).eq('stock_quantity', original)
      .select();
    btn.disabled = false;

    if (error) { showToast(translateError(error), 'error'); return; }
    if (!data || !data.length) {
      showToast('สต็อกมีการเปลี่ยนแปลงระหว่างนี้ (อาจมีลูกค้าสั่งซื้อ) โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจสอบอีกครั้ง', 'warn', 5000);
      await load();
      return;
    }
    showToast(`อัปเดต Stock เป็น ${value} ชิ้นแล้ว`, 'success');
    await load();
  }

  /* ----- เพิ่ม / แก้ไข ----- */
  function openForm(p = null) {
    editing = p;
    form.reset();
    document.getElementById('dialogTitle').textContent = p ? '✏️ แก้ไขสินค้า' : '➕ เพิ่มสินค้า';
    document.getElementById('formError').hidden = true;
    if (p) {
      form.product_name.value = p.name;
      form.description.value = p.description || '';
      form.price.value = p.price;
      form.stock_quantity.value = p.stock_quantity;
      form.category.value = CATEGORIES.includes(p.category) ? p.category : CATEGORIES[CATEGORIES.length - 1];
      form.is_active.value = p.is_active ? 'true' : 'false';
    } else {
      form.stock_quantity.value = 0;
      form.is_active.value = 'true';
    }
    preview.src = safeImageUrl(p?.image_url);
    document.getElementById('removeImageWrap').hidden = !p?.image_url;
    dialog.showModal();
    form.product_name.focus();
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) { preview.src = safeImageUrl(editing?.image_url); return; }
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) {
      showToast('รองรับไฟล์ JPG, PNG, WEBP, GIF เท่านั้น', 'warn');
      fileInput.value = '';
      return;
    }
    preview.src = URL.createObjectURL(f);
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errBox = document.getElementById('formError');
    errBox.hidden = true;

    const name = form.product_name.value.trim();
    const price = Number(form.price.value);
    const stock = Number(form.stock_quantity.value);
    if (!name) return fail('กรุณากรอกชื่อสินค้า');
    if (!Number.isFinite(price) || price < 0) return fail('ราคาต้องเป็นตัวเลข 0 ขึ้นไป');
    if (!Number.isInteger(stock) || stock < 0) return fail('จำนวนสินค้าต้องเป็นจำนวนเต็ม 0 ขึ้นไป');

    saveBtn.disabled = true;
    saveBtn.textContent = 'กำลังบันทึก...';
    let uploadedPath = null;

    try {
      const payload = {
        name,
        description: form.description.value.trim(),
        price: Math.round(price * 100) / 100,
        category: form.category.value,
        is_active: form.is_active.value === 'true'
      };

      const file = fileInput.files[0];
      if (file) {
        const up = await uploadImage(file);
        uploadedPath = up.path;
        payload.image_url = up.url;
      } else if (editing && form.remove_image?.checked) {
        payload.image_url = null;
      }

      let result;
      if (editing) {
        let query = sb.from('products').update(
          stock !== editing.stock_quantity ? { ...payload, stock_quantity: stock } : payload
        ).eq('id', editing.id);
        // ถ้าแก้สต็อก ต้องแน่ใจว่าไม่มีคำสั่งซื้อตัดสต็อกไปก่อนหน้า
        if (stock !== editing.stock_quantity) query = query.eq('stock_quantity', editing.stock_quantity);
        result = await query.select();
        if (!result.error && (!result.data || !result.data.length)) {
          throw new Error('สต็อกของสินค้านี้เปลี่ยนแปลงระหว่างที่คุณแก้ไข (อาจมีลูกค้าสั่งซื้อ) กรุณาเปิดฟอร์มใหม่');
        }
      } else {
        result = await sb.from('products').insert({ ...payload, stock_quantity: stock }).select();
      }
      if (result.error) throw result.error;

      // ลบรูปเก่าเมื่อเปลี่ยน/ลบรูป
      if (editing && editing.image_url && 'image_url' in payload && payload.image_url !== editing.image_url) {
        removeImageByUrl(editing.image_url);
      }

      dialog.close();
      showToast(editing ? 'บันทึกการแก้ไขแล้ว — หน้าร้านอัปเดตทันที' : 'เพิ่มสินค้าเรียบร้อย', 'success');
      await load();
    } catch (err) {
      if (uploadedPath) sb.storage.from(STORAGE_BUCKET).remove([uploadedPath]);
      fail(translateError(err));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'บันทึกสินค้า';
    }

    function fail(m) { errBox.hidden = false; errBox.textContent = m; }
  });

  document.getElementById('cancelDialog').addEventListener('click', () => dialog.close());
  document.getElementById('addProductBtn').addEventListener('click', () => openForm());

  /* ----- ลบ ----- */
  async function deleteProduct(p) {
    if (!confirm(`ยืนยันการลบ "${p.name}" ?\n\n(ประวัติคำสั่งซื้อเดิมยังคงอยู่)\nหากแค่ต้องการหยุดขายชั่วคราว แนะนำให้ตั้งสถานะ "ปิดการขาย" แทน`)) return;
    const { error } = await sb.from('products').delete().eq('id', p.id);
    if (error) { showToast(translateError(error), 'error'); return; }
    if (p.image_url) removeImageByUrl(p.image_url);
    showToast('ลบสินค้าแล้ว', 'success');
    await load();
  }

  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('tr');
    const p = products.find(x => x.id === row.dataset.id);
    if (!p) return;
    if (btn.dataset.act === 'stock') updateStock(row, btn);
    if (btn.dataset.act === 'edit') openForm(p);
    if (btn.dataset.act === 'delete') deleteProduct(p);
  });
  tbody.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.stock-edit input')) {
      e.preventDefault();
      const row = e.target.closest('tr');
      updateStock(row, row.querySelector('[data-act="stock"]'));
    }
  });

  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 150); });

  await load();
}

/* ----- อัปโหลดรูป (ย่อขนาดอัตโนมัติ เพื่อให้โหลดเร็วบนมือถือ) ----- */

async function resizeImage(file, maxSize = 1200, quality = 0.85) {
  if (file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 800 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}

async function uploadImage(originalFile) {
  if (originalFile.size > 10 * 1024 * 1024) throw new Error('ไฟล์รูปใหญ่เกินไป (สูงสุด 10MB ก่อนย่อ)');
  const file = await resizeImage(originalFile);
  if (file.size > 5 * 1024 * 1024) throw new Error('ไฟล์รูปใหญ่เกิน 5MB');
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[file.type] || 'jpg';
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: '31536000', upsert: false, contentType: file.type
  });
  if (error) throw error;
  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

function removeImageByUrl(url) {
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const i = (url || '').indexOf(marker);
  if (i < 0) return;
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  sb.storage.from(STORAGE_BUCKET).remove([path]).then(({ error }) => {
    if (error) console.warn('ลบรูปเก่าไม่สำเร็จ', error);
  });
}

/* =====================================================================
   CATEGORIES (หมวดหมู่)
   ===================================================================== */

async function initCategories() {
  const tbody = document.getElementById('categoryTable');
  const form = document.getElementById('categoryForm');
  const input = form.category_name;
  let cats = [];

  async function load() {
    const [c, p] = await Promise.all([
      sb.from('categories').select('id,name,sort_order').order('sort_order').order('name'),
      sb.from('products').select('category')
    ]);
    const error = c.error || p.error;
    if (error) { tbody.innerHTML = `<tr><td colspan="3">${escapeHtml(translateError(error))}</td></tr>`; return; }
    const counts = {};
    p.data.forEach(x => { counts[x.category] = (counts[x.category] || 0) + 1; });
    cats = c.data.map(x => ({ ...x, count: counts[x.name] || 0 }));
    render();
  }

  function render() {
    document.getElementById('categoryCount').textContent = `ทั้งหมด ${cats.length} หมวดหมู่ — ลำดับนี้คือลำดับที่แสดงบนหน้าร้าน`;
    tbody.innerHTML = cats.length ? cats.map((c, i) => `
      <tr data-id="${escapeHtml(c.id)}">
        <td data-label="หมวดหมู่"><strong>${escapeHtml(c.name)}</strong></td>
        <td data-label="จำนวนสินค้า" class="num">${c.count.toLocaleString('th-TH')}</td>
        <td data-label="จัดการ">
          <div class="row-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-act="up" aria-label="เลื่อนขึ้น" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="btn btn-sm btn-ghost" data-act="down" aria-label="เลื่อนลง" ${i === cats.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="btn btn-sm btn-ghost" data-act="edit">✏️ แก้ไข</button>
            <button type="button" class="btn btn-sm btn-danger-ghost" data-act="delete">🗑️ ลบ</button>
          </div>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="3" class="muted center">ยังไม่มีหมวดหมู่</td></tr>';
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { showToast('กรุณากรอกชื่อหมวดหมู่', 'warn'); input.focus(); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const maxOrder = cats.reduce((m, c) => Math.max(m, c.sort_order), 0);
    const { error } = await sb.from('categories').insert({ name, sort_order: maxOrder + 1 });
    btn.disabled = false;
    if (error) { showToast(translateError(error), 'error'); return; }
    input.value = '';
    showToast(`เพิ่มหมวดหมู่ "${name}" แล้ว`, 'success');
    load();
  });

  async function rename(c) {
    const name = (prompt('ชื่อหมวดหมู่ใหม่', c.name) || '').trim();
    if (!name || name === c.name) return;
    const { error } = await sb.from('categories').update({ name }).eq('id', c.id);
    if (error) { showToast(translateError(error), 'error'); return; }
    showToast(`เปลี่ยนชื่อเป็น "${name}" แล้ว${c.count ? ` — สินค้า ${c.count} รายการย้ายตามให้อัตโนมัติ` : ''}`, 'success');
    load();
  }

  async function remove(c) {
    if (c.count) {
      showToast(`ยังมีสินค้า ${c.count} รายการในหมวด "${c.name}" กรุณาย้ายสินค้าไปหมวดอื่นก่อนลบ`, 'warn', 5000);
      return;
    }
    if (!confirm(`ยืนยันการลบหมวดหมู่ "${c.name}" ?`)) return;
    const { error } = await sb.from('categories').delete().eq('id', c.id);
    if (error) { showToast(translateError(error), 'error', 5000); load(); return; }
    showToast('ลบหมวดหมู่แล้ว', 'success');
    load();
  }

  // สลับลำดับกับแถวข้างเคียง (จัดเลขใหม่ทั้งหมดเพื่อกันค่า sort_order ซ้ำ)
  async function move(c, dir) {
    const i = cats.indexOf(c);
    const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    const changed = cats.map((x, k) => ({ ...x, next: k + 1 })).filter(x => x.sort_order !== x.next);
    render();
    const results = await Promise.all(changed.map(x =>
      sb.from('categories').update({ sort_order: x.next }).eq('id', x.id)));
    const failed = results.find(r => r.error);
    if (failed) showToast(translateError(failed.error), 'error');
    load();
  }

  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const c = cats.find(x => x.id === btn.closest('tr').dataset.id);
    if (!c) return;
    if (btn.dataset.act === 'up') move(c, -1);
    if (btn.dataset.act === 'down') move(c, 1);
    if (btn.dataset.act === 'edit') rename(c);
    if (btn.dataset.act === 'delete') remove(c);
  });

  await load();
}

/* =====================================================================
   ORDERS (คำสั่งซื้อ)
   ===================================================================== */

async function initOrders() {
  const tbody = document.getElementById('orderTable');
  const search = document.getElementById('orderSearch');
  const statusFilter = document.getElementById('statusFilter');
  const dialog = document.getElementById('orderDialog');
  const PAGE_SIZE = 50;
  let orders = [];
  let page = 0;
  let hasMore = false;

  statusFilter.innerHTML = '<option value="">ทุกสถานะ</option>' +
    Object.entries(ORDER_STATUS).map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join('');

  function statusSelect(o) {
    return `<select class="status-select ${ORDER_STATUS[o.status]?.cls || ''}" data-act="status" aria-label="สถานะคำสั่งซื้อ">
      ${Object.entries(ORDER_STATUS).map(([k, v]) =>
        `<option value="${k}" ${k === o.status ? 'selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}
    </select>`;
  }

  async function load(append = false) {
    if (!append) page = 0;
    let query = sb.from('orders')
      .select('id,order_number,customer_name,customer_email,phone,address,note,total_amount,status,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    const q = search.value.replace(/[,()%*\\"']/g, ' ').trim();
    if (q) query = query.or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%,phone.ilike.%${q.replace(/[^0-9+]/g, '') || q}%`);
    if (statusFilter.value) query = query.eq('status', statusFilter.value);

    const { data, error, count } = await query;
    if (error) { tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(translateError(error))}</td></tr>`; return; }

    orders = append ? orders.concat(data) : data;
    hasMore = orders.length < (count || 0);
    document.getElementById('orderCount').textContent = `พบ ${Number(count || 0).toLocaleString('th-TH')} รายการ`;
    document.getElementById('loadMore').hidden = !hasMore;
    render();
  }

  function render() {
    tbody.innerHTML = orders.length ? orders.map(o => `
      <tr data-id="${escapeHtml(o.id)}">
        <td data-label="เลข Order"><strong class="mono">${escapeHtml(o.order_number)}</strong></td>
        <td data-label="ชื่อลูกค้า">${escapeHtml(o.customer_name)}</td>
        <td data-label="เบอร์โทร"><a href="tel:${escapeHtml(o.phone)}">${escapeHtml(o.phone)}</a></td>
        <td data-label="ยอดรวม" class="num">${formatPrice(o.total_amount)}</td>
        <td data-label="วันที่สั่ง">${formatDate(o.created_at)}</td>
        <td data-label="สถานะ">${statusSelect(o)}</td>
        <td data-label="">
          <div class="row-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-act="view">ดูรายละเอียด</button>
            <button type="button" class="btn btn-sm btn-danger-ghost" data-act="delete">🗑️ ลบ</button>
          </div>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="7" class="muted center">ไม่พบคำสั่งซื้อ</td></tr>';
  }

  async function changeStatus(sel, order) {
    const next = sel.value;
    const prev = order.status;
    const label = ORDER_STATUS[next].label;
    let msg = `เปลี่ยนสถานะ ${order.order_number} เป็น "${label}" ?`;
    if (next === 'cancelled') msg += '\n\nระบบจะคืนสินค้าเข้าสต็อกอัตโนมัติ';
    if (prev === 'cancelled') msg += '\n\nระบบจะตัดสต็อกสินค้าอีกครั้ง';
    if (!confirm(msg)) { sel.value = prev; return; }

    sel.disabled = true;
    const { error } = await sb.rpc('admin_update_order_status', { p_order_id: order.id, p_status: next });
    sel.disabled = false;
    if (error) {
      sel.value = prev;
      showToast(translateError(error), 'error', 5000);
      return;
    }
    order.status = next;
    sel.className = `status-select ${ORDER_STATUS[next].cls}`;
    showToast(`อัปเดตสถานะเป็น "${label}" แล้ว`, 'success');
  }

  async function viewOrder(order) {
    const body = document.getElementById('orderDetail');
    document.getElementById('orderDialogTitle').textContent = order.order_number;
    body.innerHTML = '<p class="muted">กำลังโหลด...</p>';
    dialog.showModal();

    const { data: items, error } = await sb.from('order_items')
      .select('product_name,price,quantity,subtotal').eq('order_id', order.id);

    body.innerHTML = `
      <dl class="detail-list">
        <dt>ลูกค้า</dt><dd>${escapeHtml(order.customer_name)}</dd>
        <dt>อีเมลผู้สั่ง</dt><dd>${escapeHtml(order.customer_email || '-')}</dd>
        <dt>เบอร์โทร</dt><dd><a href="tel:${escapeHtml(order.phone)}">${escapeHtml(order.phone)}</a></dd>
        <dt>ที่อยู่</dt><dd class="pre">${escapeHtml(order.address)}</dd>
        <dt>รายละเอียดเพิ่มเติม</dt><dd class="pre">${escapeHtml(order.note || '-')}</dd>
        <dt>วันที่สั่ง</dt><dd>${formatDate(order.created_at)}</dd>
        <dt>สถานะ</dt><dd>${statusBadge(order.status)}</dd>
      </dl>
      ${error ? `<p class="notice notice-error">${escapeHtml(translateError(error))}</p>` : `
      <table class="summary-table">
        <thead><tr><th>สินค้า</th><th class="num">ราคา</th><th class="num">จำนวน</th><th class="num">รวม</th></tr></thead>
        <tbody>${items.map(i => `
          <tr><td>${escapeHtml(i.product_name)}</td><td class="num">${formatPrice(i.price)}</td>
              <td class="num">${i.quantity}</td><td class="num">${formatPrice(i.subtotal)}</td></tr>`).join('')}
        </tbody>
      </table>
      <div class="summary-total"><span>ยอดรวม</span><strong>${formatPrice(order.total_amount)}</strong></div>`}`;
  }

  tbody.addEventListener('change', e => {
    if (e.target.dataset.act !== 'status') return;
    const order = orders.find(o => o.id === e.target.closest('tr').dataset.id);
    if (order) changeStatus(e.target, order);
  });
  /* ----- ลบ ----- */
  async function deleteOrder(order, btn) {
    // ออเดอร์ที่ยังไม่ยกเลิก/ไม่สำเร็จ ต้องยกเลิกก่อนเพื่อคืนสต็อก
    const needRestock = order.status !== 'cancelled' && order.status !== 'completed';
    let msg = `ยืนยันการลบคำสั่งซื้อ ${order.order_number} ?\n\nลบแล้วกู้คืนไม่ได้`;
    if (needRestock) msg += '\nระบบจะคืนสินค้าเข้าสต็อกให้ก่อนลบ';
    if (!confirm(msg)) return;

    btn.disabled = true;
    if (needRestock) {
      const { error } = await sb.rpc('admin_update_order_status', { p_order_id: order.id, p_status: 'cancelled' });
      if (error) { btn.disabled = false; showToast(translateError(error), 'error', 5000); return; }
    }
    const { error } = await sb.from('orders').delete().eq('id', order.id);
    if (error) { btn.disabled = false; showToast(translateError(error), 'error', 5000); return load(); }
    showToast(`ลบคำสั่งซื้อ ${order.order_number} แล้ว`, 'success');
    load();
  }

  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName !== 'BUTTON') return;
    const order = orders.find(o => o.id === btn.closest('tr').dataset.id);
    if (!order) return;
    if (btn.dataset.act === 'view') viewOrder(order);
    if (btn.dataset.act === 'delete') deleteOrder(order, btn);
  });
  document.getElementById('closeOrderDialog').addEventListener('click', () => dialog.close());
  document.getElementById('loadMore').addEventListener('click', () => { page++; load(true); });

  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load(), 300); });
  statusFilter.addEventListener('change', () => load());

  await load();
  subscribeNewOrders(() => load());
}

/* =====================================================================
   BOOT
   ===================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;
  initShell();
  if (!(await Admin.requireAdmin())) return;

  try {
    if (page === 'dashboard') await initDashboard();
    if (page === 'products') await initProducts();
    if (page === 'orders') await initOrders();
    if (page === 'categories') await initCategories();
  } catch (err) {
    console.error(err);
    showToast(translateError(err), 'error', 5000);
  }
});
