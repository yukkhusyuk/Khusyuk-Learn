'use strict';
/**
 * Khusyuk Learn — server (zero-dependency, Node.js built-in).
 *
 * Menyediakan:
 *   - File statis web app (index.html, /khusyuk-learn, /kalkulator-cemas, /admin)
 *   - API autentikasi (Google Sign-In + mode dev) dengan gerbang akses (entitlement)
 *   - Sinkronisasi progres belajar per user
 *   - Panel admin & webhook pembelian untuk mendaftarkan email pembeli
 *
 * Jalankan:  node server/server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./lib/config');
const db = require('./lib/db');
const { signSession, verifySession, verifyGoogleIdToken } = require('./lib/auth');

// ---------------------------------------------------------------------------
// Util HTTP
// ---------------------------------------------------------------------------
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    ...headers,
  });
  res.end(data);
}
const json = (res, status, obj) => send(res, status, obj, { 'Content-Type': 'application/json; charset=utf-8' });

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve) => {
    let buf = '';
    let over = false;
    req.on('data', (c) => {
      buf += c;
      if (buf.length > limit) { over = true; req.destroy(); }
    });
    req.on('end', () => {
      if (over) return resolve(null);
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); }
      catch (_) { resolve({ __raw: buf }); }
    });
    req.on('error', () => resolve(null));
  });
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Kembalikan user terverifikasi dari token sesi, atau null.
function currentUser(req) {
  const tok = bearer(req);
  const payload = verifySession(tok);
  if (!payload || !payload.email) return null;
  return payload; // { email, name, ... }
}

function isValidEmail(e) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ''));
}

function publicUser(email) {
  const u = db.getUser(email);
  return u ? { email: u.email, name: u.name, picture: u.picture } : { email };
}

// Bangun respons sesi lengkap untuk frontend.
function sessionResponse(email) {
  const entitled = db.isEntitled(email);
  const token = signSession({ email });
  return {
    ok: true,
    token,
    user: publicUser(email),
    entitled,
    entitlement: entitled ? db.getEntitlement(email) : null,
    progress: entitled ? db.getProgress(email) : null,
  };
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') return send(res, 204, '');

  // ---- Konfigurasi publik untuk frontend --------------------------------
  if (p === '/api/config' && method === 'GET') {
    return json(res, 200, {
      googleClientId: config.googleClientId || null,
      devLogin: config.devLogin,
      appName: 'Khusyuk Learn',
    });
  }

  // ---- Login via Google -------------------------------------------------
  if (p === '/api/auth/google' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.credential) return json(res, 400, { ok: false, error: 'credential wajib diisi' });
    let profile;
    try {
      profile = await verifyGoogleIdToken(body.credential);
    } catch (e) {
      return json(res, 401, { ok: false, error: e.message });
    }
    if (!profile.email) return json(res, 401, { ok: false, error: 'email tidak ditemukan di token' });
    db.upsertUser({ ...profile, google_sub: profile.sub, provider: 'google' });
    return json(res, 200, sessionResponse(profile.email));
  }

  // ---- Login mode dev (tanpa Google) ------------------------------------
  if (p === '/api/auth/dev' && method === 'POST') {
    if (!config.devLogin) return json(res, 403, { ok: false, error: 'dev login dinonaktifkan' });
    const body = await readBody(req);
    const email = db.norm(body && body.email);
    const name = (body && body.name) || '';
    if (!isValidEmail(email)) return json(res, 400, { ok: false, error: 'email tidak valid' });
    db.upsertUser({ email, name, provider: 'dev' });
    return json(res, 200, sessionResponse(email));
  }

  // ---- Profil sesi saat ini ---------------------------------------------
  if (p === '/api/me' && method === 'GET') {
    const u = currentUser(req);
    if (!u) return json(res, 401, { ok: false, error: 'sesi tidak valid' });
    const entitled = db.isEntitled(u.email);
    return json(res, 200, {
      ok: true,
      user: publicUser(u.email),
      entitled,
      entitlement: entitled ? db.getEntitlement(u.email) : null,
      progress: entitled ? db.getProgress(u.email) : null,
    });
  }

  // ---- Simpan progres belajar -------------------------------------------
  if (p === '/api/progress' && method === 'PUT') {
    const u = currentUser(req);
    if (!u) return json(res, 401, { ok: false, error: 'sesi tidak valid' });
    if (!db.isEntitled(u.email)) return json(res, 403, { ok: false, error: 'akun belum punya akses' });
    const body = await readBody(req);
    if (!body || typeof body !== 'object') return json(res, 400, { ok: false, error: 'data tidak valid' });
    const data = body.progress && typeof body.progress === 'object' ? body.progress : body;
    db.saveProgress(u.email, data);
    return json(res, 200, { ok: true, updated: true });
  }
  if (p === '/api/progress' && method === 'GET') {
    const u = currentUser(req);
    if (!u) return json(res, 401, { ok: false, error: 'sesi tidak valid' });
    return json(res, 200, { ok: true, progress: db.getProgress(u.email) });
  }

  // ---- Webhook pembelian (otomatis dari payment gateway) ----------------
  // POST /api/webhook/purchase?secret=XXX  body fleksibel: cari email pembeli.
  if (p === '/api/webhook/purchase' && method === 'POST') {
    const secret = url.searchParams.get('secret') || req.headers['x-webhook-secret'];
    if (secret !== config.webhookSecret) return json(res, 401, { ok: false, error: 'secret salah' });
    const body = await readBody(req) || {};
    const email = extractEmail(body);
    if (!email || !isValidEmail(email)) {
      return json(res, 400, { ok: false, error: 'email pembeli tidak ditemukan di payload' });
    }
    const name = extractName(body);
    const product = extractProduct(body);
    const ent = db.addEntitlement(email, { name, product, source: 'webhook' });
    return json(res, 200, { ok: true, entitled: email, entitlement: ent });
  }

  // ---- Admin: butuh ADMIN_TOKEN -----------------------------------------
  if (p.startsWith('/api/admin/')) {
    const tok = req.headers['x-admin-token'] || url.searchParams.get('token');
    if (tok !== config.adminToken) return json(res, 401, { ok: false, error: 'admin token salah' });

    if (p === '/api/admin/entitlements' && method === 'GET') {
      return json(res, 200, { ok: true, entitlements: db.listEntitlements() });
    }
    if (p === '/api/admin/entitlements' && method === 'POST') {
      const body = await readBody(req) || {};
      const email = db.norm(body.email);
      if (!isValidEmail(email)) return json(res, 400, { ok: false, error: 'email tidak valid' });
      const ent = db.addEntitlement(email, {
        name: body.name || null, product: body.product || null, source: 'admin',
      });
      return json(res, 200, { ok: true, entitlement: ent });
    }
    if (p === '/api/admin/entitlements' && method === 'DELETE') {
      const email = db.norm(url.searchParams.get('email'));
      if (!email) return json(res, 400, { ok: false, error: 'email wajib' });
      db.removeEntitlement(email);
      return json(res, 200, { ok: true, removed: email });
    }
    if (p === '/api/admin/entitlements/toggle' && method === 'POST') {
      const body = await readBody(req) || {};
      const ent = db.setEntitlementActive(body.email, !!body.active);
      return json(res, 200, { ok: true, entitlement: ent });
    }
    if (p === '/api/admin/users' && method === 'GET') {
      return json(res, 200, { ok: true, users: db.listUsers() });
    }
    if (p === '/api/admin/stats' && method === 'GET') {
      return json(res, 200, {
        ok: true,
        entitlements: db.listEntitlements().length,
        users: db.listUsers().length,
      });
    }
    return json(res, 404, { ok: false, error: 'endpoint admin tidak ada' });
  }

  return json(res, 404, { ok: false, error: 'endpoint tidak ditemukan' });
}

// Ekstraksi email/nama/produk dari payload webhook yang beragam formatnya.
function extractEmail(body) {
  const cands = [
    body.email, body.customer_email, body.buyer_email, body.payer_email,
    body.customerEmail, body.buyerEmail,
    body.customer && body.customer.email,
    body.buyer && body.buyer.email,
    body.data && body.data.customer && body.data.customer.email,
    body.data && body.data.email,
    body.payment && body.payment.customer_email,
  ];
  for (const c of cands) if (c) return db.norm(c);
  return null;
}
function extractName(body) {
  return body.name || body.customer_name || body.buyer_name ||
    (body.customer && body.customer.name) || (body.buyer && body.buyer.name) ||
    (body.data && body.data.customer && body.data.customer.name) || null;
}
function extractProduct(body) {
  return body.product || body.product_name || body.item ||
    (body.data && body.data.product) || 'Upselling — Khusyuk Learn';
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const target = path.normalize(path.join(root, decoded));
  if (!target.startsWith(path.normalize(root))) return null; // cegah path traversal
  return target;
}

function serveStatic(req, res, url) {
  let pathname = url.pathname;

  // Alias /admin -> admin.html
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';

  let filePath = safeJoin(config.staticDir, pathname);
  if (!filePath) return send(res, 403, 'Forbidden');

  try {
    let stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (stat && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = fs.statSync(filePath, { throwIfNoEntry: false });
    }
    if (!stat || !stat.isFile()) {
      // fallback ke index.html root untuk path tak dikenal
      return send(res, 404, 'Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' };
    // Aset statis berukuran besar (app) boleh di-cache sebentar; HTML jangan.
    headers['Cache-Control'] = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    send(res, 500, 'Server error');
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch (_) { return send(res, 400, 'Bad request'); }

  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('Unhandled error:', e);
    if (!res.headersSent) json(res, 500, { ok: false, error: 'kesalahan server' });
  }
});

server.listen(config.port, config.host, () => {
  const base = `http://localhost:${config.port}`;
  console.log('────────────────────────────────────────────────');
  console.log('  Khusyuk Learn — server berjalan');
  console.log('────────────────────────────────────────────────');
  console.log(`  Web app   : ${base}/khusyuk-learn/`);
  console.log(`  Beranda    : ${base}/`);
  console.log(`  Admin      : ${base}/admin   (token: ${config.adminToken})`);
  console.log(`  Database   : ${config.dbFile}`);
  console.log(`  Google     : ${config.googleClientId ? 'aktif' : 'BELUM diset (pakai mode dev)'}`);
  console.log(`  Dev login  : ${config.devLogin ? 'aktif' : 'nonaktif'}`);
  console.log(`  Akses awal : ${config.seedEmails.join(', ') || '(kosong)'}`);
  console.log('────────────────────────────────────────────────');
});

module.exports = server;
