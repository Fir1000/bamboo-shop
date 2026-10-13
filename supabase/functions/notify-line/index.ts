// =====================================================================
//  notify-line — ส่งรูปบิลคำสั่งซื้อใหม่เข้า LINE ร้าน (LINE Messaging API)
//  เรียกจากหน้า checkout หลังสั่งซื้อสำเร็จ: body = { order_number }
//
//  Secrets ที่ต้องตั้ง (Dashboard > Edge Functions > Secrets):
//    LINE_CHANNEL_ACCESS_TOKEN  Channel access token (long-lived) ของ LINE Official Account
//    LINE_TO                    User ID (U...) หรือ Group ID (C...) ที่จะรับแจ้งเตือน
//  SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY มีให้อัตโนมัติ
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const baht = (n: number) => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  const to = Deno.env.get('LINE_TO');
  if (!token || !to) return json({ error: 'LINE ยังไม่ได้ตั้งค่า' }, 500);

  // ตรวจว่าเป็นผู้ใช้ที่ล็อกอินจริง
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { order_number } = await req.json().catch(() => ({}));
  if (typeof order_number !== 'string' || !/^ORD-\d{8}-\d{3,}$/.test(order_number)) {
    return json({ error: 'invalid order_number' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ต้องเป็นคำสั่งซื้อของผู้ใช้คนนี้ สั่งไม่เกิน 30 นาที และยังไม่เคยแจ้ง
  const { data: order } = await admin.from('orders')
    .select('id, order_number, customer_name, phone, total_amount, created_at, line_notified_at, user_id')
    .eq('order_number', order_number)
    .maybeSingle();
  if (!order || order.user_id !== user.id) return json({ error: 'not found' }, 404);
  if (order.line_notified_at) return json({ ok: true, skipped: 'already notified' });
  if (Date.now() - new Date(order.created_at).getTime() > 30 * 60 * 1000) return json({ error: 'too old' }, 400);

  // จองสิทธิ์แจ้งก่อนส่ง กันกดซ้ำพร้อมกัน
  const { data: claimed } = await admin.from('orders')
    .update({ line_notified_at: new Date().toISOString() })
    .eq('id', order.id).is('line_notified_at', null)
    .select('id');
  if (!claimed?.length) return json({ ok: true, skipped: 'already notified' });

  const messages: unknown[] = [{
    type: 'text',
    text: `🛒 คำสั่งซื้อใหม่ ${order.order_number}\n👤 ${order.customer_name} (${order.phone})\n💰 ยอดรวม ${baht(order.total_amount)}`,
  }];

  // แนบรูปบิล (ถ้าลูกค้าอัปโหลดสำเร็จ) ผ่าน signed URL อายุ 7 วัน
  const { data: signed } = await admin.storage.from('order-bills')
    .createSignedUrl(`${user.id}/${order.order_number}.png`, 60 * 60 * 24 * 7);
  if (signed?.signedUrl) {
    messages.push({ type: 'image', originalContentUrl: signed.signedUrl, previewImageUrl: signed.signedUrl });
  }

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages }),
  });

  if (!res.ok) {
    // ส่งไม่สำเร็จ -> ปลดสถานะ ให้ลองใหม่ได้
    await admin.from('orders').update({ line_notified_at: null }).eq('id', order.id);
    return json({ error: 'LINE push failed', detail: await res.text() }, 502);
  }
  return json({ ok: true, image: !!signed?.signedUrl });
});
