// ============================================================
// Khusyuk Learn — Webhook Scalev -> allowlist pembeli
// ------------------------------------------------------------
// Tujuan: tiap ada order PAID di Scalev, email pembeli otomatis masuk ke
// tabel `allowed_emails` di Supabase -> mereka langsung bisa daftar akun.
//
// CARA PASANG DI SCALEV:
//   1. Deploy repo ini ke Vercel -> dapat domain, mis. https://app-kamu.vercel.app
//   2. Di Vercel, set Environment Variables (Project -> Settings -> Environment Variables):
//        SUPABASE_URL               = https://xxxxx.supabase.co   (bare, TANPA /rest/v1)
//        SUPABASE_SERVICE_ROLE_KEY  = <service_role key dari Supabase Settings -> API>
//        SCALEV_WEBHOOK_SECRET      = <string acak panjang bikinan kamu, mis. 40+ char>
//        CORE_PRODUCT_MATCH         = (opsional) nama/ID produk core; kosongkan = terima semua
//   3. URL FINAL yang di-paste ke Scalev (Settings -> Developers -> Webhook URL):
//        https://app-kamu.vercel.app/api/scalev-webhook?token=SCALEV_WEBHOOK_SECRET
//      (ganti `app-kamu.vercel.app` dgn domain kamu, dan token dgn nilai SCALEV_WEBHOOK_SECRET)
//   4. CENTANG event yang menandakan SUDAH BAYAR (Paid / Payment confirmed / Settlement),
//      BUKAN sekadar "order dibuat" (order created/pending) — biar cuma pembeli yang masuk.
//   5. Save & aktifkan. Lalu test 1 order, cek Vercel -> Logs untuk lihat payload aslinya.
//      Kalau email belum kebaca, sesuaikan daftar field di extractEmail() di bawah.
//
// KEAMANAN: file ini pakai SERVICE_ROLE_KEY (rahasia). Hanya jalan di server Vercel,
// TIDAK pernah dikirim ke browser. Jangan pernah taruh service_role key di file HTML.
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// Ambil email pembeli secara defensif dari berbagai kemungkinan bentuk payload Scalev.
function extractEmail(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.customer && body.customer.email,
    body.email,
    body.buyer_email,
    body.data && body.data.customer && body.data.customer.email,
    body.order && body.order.customer && body.order.customer.email,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string' && c.indexOf('@') > -1) {
      return c.trim().toLowerCase();
    }
  }
  return null;
}

// Ambil nama produk / id produk secara defensif (buat filter & disimpan ke kolom product).
function extractProduct(body) {
  if (!body || typeof body !== 'object') return '';
  const parts = [
    body.product_name, body.product, body.product_id,
    body.data && body.data.product_name,
    body.order && body.order.product_name,
    body.items && JSON.stringify(body.items),
    body.order && body.order.items && JSON.stringify(body.order.items),
  ];
  return parts.filter(Boolean).map(String).join(' | ');
}

function extractOrderId(body) {
  if (!body || typeof body !== 'object') return null;
  const c = [
    body.order_id, body.id,
    body.order && (body.order.id || body.order.order_id),
    body.data && (body.data.order_id || body.data.id),
  ];
  for (const v of c) { if (v != null) return String(v); }
  return null;
}

module.exports = async function handler(req, res) {
  // 1) Method: POST aja.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // 2) Auth via token di query (Scalev gak kirim custom header).
  const secret = process.env.SCALEV_WEBHOOK_SECRET;
  if (!secret || req.query.token !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // 3) Log payload mentah biar kelihatan bentuk aslinya di Vercel Logs saat test.
  try { console.log('SCALEV_WEBHOOK_BODY', JSON.stringify(req.body)); } catch (e) {}

  const body = req.body || {};

  // 4) (Opsional) filter produk core.
  const match = (process.env.CORE_PRODUCT_MATCH || '').trim();
  const product = extractProduct(body);
  if (match) {
    if (product.toLowerCase().indexOf(match.toLowerCase()) === -1) {
      console.log('SCALEV_WEBHOOK_SKIP product tidak cocok filter:', match);
      return res.status(200).json({ ok: true, skipped: 'product_mismatch' });
    }
  }

  // 5) Ekstrak email.
  const email = extractEmail(body);
  if (!email) {
    console.warn('SCALEV_WEBHOOK_NO_EMAIL: email tidak ketemu di payload');
    // tetap 200 biar Scalev gak retry-spam; cek log untuk perbaiki parser.
    return res.status(200).json({ ok: true, skipped: 'no_email' });
  }

  // 6) Upsert ke allowed_emails pakai service role (bypass RLS).
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('SCALEV_WEBHOOK_ENV_MISSING: SUPABASE_URL / SERVICE_ROLE_KEY belum di-set');
    return res.status(200).json({ ok: true, skipped: 'env_missing' });
  }

  try {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { error } = await supabase
      .from('allowed_emails')
      .upsert(
        { email, product: product || null, order_id: extractOrderId(body), source: 'scalev' },
        { onConflict: 'email' }
      );
    if (error) {
      console.error('SCALEV_WEBHOOK_UPSERT_ERROR', error.message);
      return res.status(200).json({ ok: true, warning: 'upsert_failed' });
    }
    console.log('SCALEV_WEBHOOK_OK email di-allow:', email);
    return res.status(200).json({ ok: true, email });
  } catch (e) {
    console.error('SCALEV_WEBHOOK_EXCEPTION', e && e.message);
    return res.status(200).json({ ok: true, warning: 'exception' });
  }
};
