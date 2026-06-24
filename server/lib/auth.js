'use strict';
/**
 * Autentikasi: token sesi aplikasi (JWT HS256, tanpa dependency) +
 * verifikasi Google ID token.
 */
const crypto = require('crypto');
const config = require('./config');

// ---------- JWT (HS256) -------------------------------------------------------
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64urlJson = (obj) => b64url(JSON.stringify(obj));
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function signSession(payload, days = config.sessionDays) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat, exp: iat + days * 86400 };
  const data = `${b64urlJson(header)}.${b64urlJson(body)}`;
  const sig = b64url(crypto.createHmac('sha256', config.jwtSecret).update(data).digest());
  return `${data}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = b64url(crypto.createHmac('sha256', config.jwtSecret).update(data).digest());
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try { body = JSON.parse(fromB64url(parts[1]).toString('utf8')); } catch (_) { return null; }
  if (body.exp && Math.floor(Date.now() / 1000) > body.exp) return null;
  return body;
}

// ---------- Google ID token ---------------------------------------------------
// Verifikasi memakai endpoint resmi tokeninfo Google. Mengembalikan profil
// { email, name, picture, sub } bila valid & audience cocok dengan GOOGLE_CLIENT_ID.
async function verifyGoogleIdToken(idToken) {
  if (!idToken) throw new Error('id token kosong');
  if (!config.googleClientId) throw new Error('GOOGLE_CLIENT_ID belum diset di server');

  const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error('gagal menghubungi Google: ' + e.message);
  }
  if (!res.ok) throw new Error('token Google tidak valid');
  const info = await res.json();

  // Audience harus cocok dengan client id kita
  if (info.aud !== config.googleClientId) throw new Error('audience token tidak cocok');
  // Issuer harus Google
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) {
    throw new Error('issuer tidak valid');
  }
  if (info.email_verified !== 'true' && info.email_verified !== true) {
    throw new Error('email Google belum terverifikasi');
  }
  return {
    email: String(info.email || '').toLowerCase(),
    name: info.name || info.given_name || '',
    picture: info.picture || '',
    sub: info.sub || '',
  };
}

module.exports = { signSession, verifySession, verifyGoogleIdToken };
