'use strict';
/**
 * Lapisan database Khusyuk Learn — memakai node:sqlite bawaan Node.js
 * (tanpa dependency native). Menyimpan:
 *   - entitlements : email yang berhak akses (dari pembelian / admin / webhook)
 *   - users        : data akun yang login (Google / dev)
 *   - progress     : progres belajar per user (JSON)
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS entitlements (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  product    TEXT,
  source     TEXT,            -- 'seed' | 'admin' | 'webhook'
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  picture    TEXT,
  google_sub TEXT,
  provider   TEXT,            -- 'google' | 'dev'
  created_at TEXT NOT NULL,
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS progress (
  email      TEXT PRIMARY KEY,
  data       TEXT NOT NULL,   -- JSON snapshot { xp, streak, gem, hearts, doneUnits, category, ... }
  updated_at TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();
const norm = (e) => String(e || '').trim().toLowerCase();

// ---------- ENTITLEMENTS ------------------------------------------------------
const stmt = {
  getEnt: db.prepare('SELECT * FROM entitlements WHERE email = ?'),
  upsertEnt: db.prepare(`
    INSERT INTO entitlements (email, name, product, source, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name=COALESCE(excluded.name, entitlements.name),
      product=COALESCE(excluded.product, entitlements.product),
      source=excluded.source,
      active=1,
      updated_at=excluded.updated_at
  `),
  setEntActive: db.prepare('UPDATE entitlements SET active=?, updated_at=? WHERE email=?'),
  listEnt: db.prepare('SELECT * FROM entitlements ORDER BY created_at DESC'),
  delEnt: db.prepare('DELETE FROM entitlements WHERE email=?'),

  getUser: db.prepare('SELECT * FROM users WHERE email = ?'),
  upsertUser: db.prepare(`
    INSERT INTO users (email, name, picture, google_sub, provider, created_at, last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name=COALESCE(excluded.name, users.name),
      picture=COALESCE(excluded.picture, users.picture),
      google_sub=COALESCE(excluded.google_sub, users.google_sub),
      provider=excluded.provider,
      last_login=excluded.last_login
  `),
  listUsers: db.prepare('SELECT * FROM users ORDER BY last_login DESC'),

  getProgress: db.prepare('SELECT * FROM progress WHERE email = ?'),
  upsertProgress: db.prepare(`
    INSERT INTO progress (email, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
  `),
};

const api = {
  norm,

  isEntitled(email) {
    const row = stmt.getEnt.get(norm(email));
    return !!(row && row.active);
  },
  getEntitlement(email) {
    return stmt.getEnt.get(norm(email)) || null;
  },
  addEntitlement(email, { name = null, product = null, source = 'admin' } = {}) {
    const e = norm(email);
    if (!e) throw new Error('email kosong');
    const t = now();
    stmt.upsertEnt.run(e, name, product, source, t, t);
    return stmt.getEnt.get(e);
  },
  setEntitlementActive(email, active) {
    stmt.setEntActive.run(active ? 1 : 0, now(), norm(email));
    return stmt.getEnt.get(norm(email));
  },
  removeEntitlement(email) {
    stmt.delEnt.run(norm(email));
  },
  listEntitlements() {
    return stmt.listEnt.all();
  },

  upsertUser(u) {
    const t = now();
    const e = norm(u.email);
    const existing = stmt.getUser.get(e);
    stmt.upsertUser.run(
      e, u.name || null, u.picture || null, u.google_sub || null,
      u.provider || 'dev', existing ? existing.created_at : t, t
    );
    return stmt.getUser.get(e);
  },
  getUser(email) {
    return stmt.getUser.get(norm(email)) || null;
  },
  listUsers() {
    return stmt.listUsers.all();
  },

  getProgress(email) {
    const row = stmt.getProgress.get(norm(email));
    if (!row) return null;
    try { return JSON.parse(row.data); } catch (_) { return null; }
  },
  saveProgress(email, data) {
    stmt.upsertProgress.run(norm(email), JSON.stringify(data || {}), now());
  },

  countEntitlements() { return stmt.listEnt.all().length; },
};

// ---------- SEED --------------------------------------------------------------
// Beri akses otomatis ke email seed bila belum ada (memudahkan testing awal).
for (const email of config.seedEmails) {
  if (!stmt.getEnt.get(email)) {
    const t = now();
    stmt.upsertEnt.run(email, null, 'Seed (testing)', 'seed', t, t);
  }
}

module.exports = api;
