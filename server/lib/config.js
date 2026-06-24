'use strict';
/**
 * Konfigurasi server Khusyuk Learn.
 * Memuat variabel dari file .env (loader kecil tanpa dependency) lalu
 * menyediakan default yang aman untuk mode pengembangan (dev).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- .env loader sederhana (tanpa paket eksternal) ---------------------------
function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  // Folder berisi file statis (root repo: index.html, /khusyuk-learn, /kalkulator-cemas)
  staticDir: process.env.STATIC_DIR || path.join(__dirname, '..', '..'),

  // Lokasi file database SQLite (persisten)
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'khusyuk.db'),

  // Google OAuth (Sign-In). Kosongkan jika belum disiapkan -> tombol Google nonaktif.
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',

  // Rahasia untuk menandatangani sesi (JWT) milik aplikasi sendiri.
  jwtSecret: process.env.JWT_SECRET || '',
  // Masa berlaku sesi (hari)
  sessionDays: parseInt(process.env.SESSION_DAYS || '30', 10),

  // Token admin untuk membuka /admin & endpoint /api/admin/*
  adminToken: process.env.ADMIN_TOKEN || 'admin-khusyuk-2026',

  // Secret untuk webhook pembelian (?secret=...)
  webhookSecret: process.env.WEBHOOK_SECRET || 'webhook-khusyuk-2026',

  // Mode dev: izinkan login lewat email tanpa Google (untuk testing)
  devLogin: bool(process.env.DEV_LOGIN, true),

  // Email yang otomatis diberi akses saat pertama kali DB dibuat (seed),
  // dipisah koma. Memudahkan testing langsung.
  seedEmails: (process.env.SEED_EMAILS || 'demo@khusyuk.test')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
};

// Jika tidak ada JWT secret, buat satu yang stabil per-instalasi dan simpan ke file
// agar sesi tetap valid setelah restart (penting di server produksi).
if (!config.jwtSecret) {
  const secretFile = path.join(__dirname, '..', 'data', '.jwt-secret');
  try {
    if (fs.existsSync(secretFile)) {
      config.jwtSecret = fs.readFileSync(secretFile, 'utf8').trim();
    } else {
      config.jwtSecret = crypto.randomBytes(48).toString('hex');
      fs.mkdirSync(path.dirname(secretFile), { recursive: true });
      fs.writeFileSync(secretFile, config.jwtSecret, { mode: 0o600 });
    }
  } catch (_) {
    config.jwtSecret = crypto.randomBytes(48).toString('hex');
  }
}

module.exports = config;
