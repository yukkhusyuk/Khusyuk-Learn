# Khusyuk Learn — by Yuk Khusyuk

Web app belajar makna sholat (gaya Duolingo). Akses **hanya untuk pembeli produk core**
(via funnel Scalev). Auth + progres pakai **Supabase**, hosting statis + serverless di **Vercel**,
auto-deploy dari **GitHub**.

> Repo ini berisi beberapa app dalam satu situs:
> - `/` — landing page (`index.html`)
> - `/kalkulator-cemas/` — app lain
> - `/khusyuk-learn/` — **app belajar sholat** (yang dibahas di sini)
> - `/khusyuk-learn/admin.html` — **dashboard admin**

## Struktur

```
.
├─ index.html                      ← landing page (link ke semua app)
├─ kalkulator-cemas/               ← app lain (tidak diubah)
├─ khusyuk-learn/
│  ├─ index.html                   ← app belajar (Supabase auth + progress)
│  └─ admin.html                   ← dashboard admin (progres semua user + kelola akses)
├─ api/
│  └─ scalev-webhook.js            ← serverless: order Scalev PAID → masuk allowlist
├─ supabase/
│  └─ setup.sql                    ← SQL final (tabel + RLS + trigger gate + policy admin)
├─ .github/workflows/keep-alive.yml← ping Supabase tiap ~5 hari (anti-pause free tier)
├─ package.json                    ← dependency webhook (@supabase/supabase-js)
└─ README.md
```

### Pemisahan akses (penting)
- **Frontend** (`index.html`, `admin.html`) → hanya `SUPABASE_URL` + **ANON KEY** (public, aman).
- **Serverless webhook** (`api/`) → pakai **SERVICE_ROLE_KEY** (rahasia). HANYA di Vercel env.
  **Jangan pernah** taruh service_role key di file HTML / commit ke repo.

---

## Yang perlu disiapkan
- Dari Supabase → **Settings → API**: `Project URL`, `anon public key`, `service_role key`.
- **Email admin** (yang boleh lihat semua progres).
- (opsional) Nama/identifier produk core di Scalev → buat `CORE_PRODUCT_MATCH`.
- Domain final (boleh pakai `xxxx.vercel.app` dulu).

---

## URUTAN DEPLOY (checklist)

### 1. Supabase
- [ ] Buat project di https://supabase.com.
- [ ] **SQL Editor → New query** → tempel seluruh isi `supabase/setup.sql` → **Run**.
- [ ] Daftarkan email admin (ganti dengan email kamu):
      ```sql
      insert into public.admins(email) values ('GANTI-EMAIL-ADMIN@gmail.com');
      -- biar admin juga bisa BUAT akun & login di app/admin:
      insert into public.allowed_emails(email, source) values ('GANTI-EMAIL-ADMIN@gmail.com','manual')
        on conflict (email) do nothing;
      ```
- [ ] **Authentication → Providers → Email**: **matikan "Confirm email"** (biar pembeli langsung
      bisa login tanpa klik link verifikasi). Kalau dibiarkan nyala, app tetap jalan tapi pembeli
      harus konfirmasi email dulu sebelum bisa login.

### 2. Isi config Supabase di frontend
Edit **dua file** ini, isi baris `window.SUPABASE_URL` & `window.SUPABASE_ANON_KEY`:
- [ ] `khusyuk-learn/index.html`
- [ ] `khusyuk-learn/admin.html`
```js
window.SUPABASE_URL      = 'https://xxxxx.supabase.co';   // BARE, tanpa /rest/v1
window.SUPABASE_ANON_KEY = 'eyJ...anon-public-key...';
```
> ⚠️ `SUPABASE_URL` harus bare (`https://xxxxx.supabase.co`). Menambah `/rest/v1` bikin error 500.

### 3. GitHub
- [ ] Commit semua perubahan & push ke branch repo kamu.
- [ ] (Untuk keep-alive) **Settings → Secrets and variables → Actions** → tambah secret:
      - `SUPABASE_URL` = `https://xxxxx.supabase.co`
      - `SUPABASE_ANON_KEY` = anon key

### 4. Vercel
- [ ] **Import** repo dari GitHub. Framework preset = **Other** (situs statis).
- [ ] **Environment Variables** (Project → Settings → Environment Variables):
      | Key | Value |
      |---|---|
      | `SUPABASE_URL` | `https://xxxxx.supabase.co` (bare) |
      | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (RAHASIA) |
      | `SCALEV_WEBHOOK_SECRET` | string acak panjang bikinan sendiri (≥40 char) |
      | `CORE_PRODUCT_MATCH` | *(opsional)* nama/ID produk core; kosong = terima semua |
- [ ] **Deploy** → dapat domain `https://xxxx.vercel.app`.
> ⚠️ Jangan bikin `vercel.json` dengan `"public": false` (Vercel baru menolak). Untuk situs
> statis + folder `/api`, paling aman **tanpa `vercel.json` sama sekali** — sudah diatur begitu di repo ini.

URL hasil:
- App belajar: `https://xxxx.vercel.app/khusyuk-learn/`
- Dashboard admin: `https://xxxx.vercel.app/khusyuk-learn/admin.html`
- Webhook: `https://xxxx.vercel.app/api/scalev-webhook?token=SCALEV_WEBHOOK_SECRET`

### 5. Scalev (webhook order → allowlist)
- [ ] **Settings → Developers → Webhook URL** = `https://DOMAIN/api/scalev-webhook?token=SECRET`
      (ganti `DOMAIN` & `SECRET` dengan nilai asli `SCALEV_WEBHOOK_SECRET`).
- [ ] **Centang event yang menandakan SUDAH BAYAR** (Paid / Payment confirmed / Settlement),
      BUKAN sekadar "order dibuat".
- [ ] Save & aktifkan. **Test 1 order** → buka **Vercel → Logs**, lihat baris `SCALEV_WEBHOOK_BODY`
      untuk payload aslinya. Kalau email belum kebaca, sesuaikan `extractEmail()` di
      `api/scalev-webhook.js`.

### 6. Email ke pembeli (Scalev / Birdsend)
Isi email after-sale: link app `https://DOMAIN/khusyuk-learn/` + instruksi:
> "Daftar pakai **email yang sama** dengan saat kamu beli, buat password, lalu mulai belajar."

### 7. Admin
- [ ] Buka `https://DOMAIN/khusyuk-learn/admin.html`, login pakai email admin, cek progres user masuk.

---

## Cara kerja akses
1. Pembeli bayar di Scalev → webhook menambah email ke `allowed_emails`.
2. Pembeli buka app → **Daftar** pakai email itu → trigger DB mengizinkan (email ada di allowlist).
3. Email yang tidak ada di allowlist → signup ditolak dengan pesan ramah
   *"Email ini belum terdaftar sebagai pembeli…"*.
4. Progres tersimpan per akun (`progress`, RLS `auth.uid() = user_id`) → bisa lanjut dari perangkat mana pun.
5. Admin (`is_admin()`) bisa baca semua baris `progress` + kelola `allowed_emails` dari dashboard.

### Fallback kalau webhook belum kepasang
Buka admin → panel **Kelola Akses** → tambah email satu-satu atau paste banyak sekaligus
(satu email per baris, cocok untuk export pembeli dari Scalev).

---

## Acceptance test
1. Email belum di `allowed_emails` → Daftar → ditolak ("belum terdaftar sebagai pembeli"). ✅
2. Tambah email itu (admin panel / SQL) → Daftar lagi → berhasil, masuk onboarding. ✅
3. Selesaikan 1 level → logout → login lagi → progres masih ada. ✅
4. Login admin → baris user tadi terlihat dengan Progress %-nya. ✅
5. User A tidak bisa lihat data user B (RLS). ✅
6. `POST /api/scalev-webhook?token=SECRET` dgn body contoh → email masuk allowlist; tanpa token → 401. ✅

Contoh test webhook (ganti DOMAIN & SECRET):
```bash
curl -X POST "https://DOMAIN/api/scalev-webhook?token=SECRET" \
  -H "Content-Type: application/json" \
  -d '{"customer":{"email":"Test.Buyer@Gmail.com"},"product_name":"Core Product","order_id":"DUMMY-1"}'
# -> {"ok":true,"email":"test.buyer@gmail.com"}  dan muncul di allowed_emails

curl -X POST "https://DOMAIN/api/scalev-webhook" -d '{}'   # tanpa token -> 401
```
