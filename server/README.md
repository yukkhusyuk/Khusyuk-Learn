# Khusyuk Learn — Backend & Sistem Login

Backend lengkap untuk web app **Khusyuk Learn**: login Google, gerbang akses
(hanya pembeli produk upselling yang bisa masuk), dan penyimpanan progres
belajar per user. Dibuat **tanpa dependency eksternal** — cukup Node.js
(memakai modul bawaan `node:http` dan `node:sqlite`).

```
server/
├── server.js          # HTTP server: static + API
├── lib/
│   ├── config.js      # konfigurasi (.env)
│   ├── db.js          # database SQLite (entitlements, users, progress)
│   └── auth.js        # JWT sesi + verifikasi Google ID token
├── .env.example       # contoh konfigurasi
└── data/              # database SQLite (dibuat otomatis, tidak di-commit)
```

---

## 1. Menjalankan (lokal)

Butuh **Node.js ≥ 22.5** (untuk `node:sqlite`).

```bash
cd server
cp .env.example .env      # opsional — ada default aman untuk dev
node server.js
```

Buka:

| URL | Keterangan |
|-----|------------|
| `http://localhost:3000/` | Beranda (pilih app) |
| `http://localhost:3000/khusyuk-learn/` | Web app Khusyuk Learn |
| `http://localhost:3000/admin` | Panel admin (token: `ADMIN_TOKEN`) |

> Default mode **dev**: kamu bisa langsung login pakai email tanpa setup Google.
> Email `demo@khusyuk.test` sudah otomatis diberi akses untuk testing.

---

## 2. Cara kerja akses (entitlement)

Akses web app = **benefit dari pembelian produk upselling**. Alurnya:

```
Pembeli checkout & isi email  →  email didaftarkan sebagai "entitlement"
       (via Admin Panel ATAU Webhook otomatis)
                         │
User buka app  →  Login Google / email  →  server cek email ada di entitlement?
                         │
            ┌────────────┴─────────────┐
          YA → masuk app,            TIDAK → layar "Akses Terkunci"
          progres tersimpan                 (suruh pakai email pembelian)
```

Ada **2 cara** mendaftarkan email pembeli:

### a) Panel Admin (manual)
Buka `/admin`, masukkan `ADMIN_TOKEN`, lalu tambah email pembeli. Bisa juga
menonaktifkan/menghapus akses dan melihat daftar user yang sudah login.

### b) Webhook (otomatis dari payment gateway)
Arahkan webhook "pembayaran sukses" dari payment gateway (Mayar, Lynk.id,
Xendit, dll) ke:

```
POST https://DOMAIN-KAMU/api/webhook/purchase?secret=WEBHOOK_SECRET
Content-Type: application/json
```

Server otomatis mencari email pembeli di payload (mendukung banyak format umum,
mis. `email`, `customer_email`, `customer.email`, `buyer.email`, `data.customer.email`).
Contoh:

```bash
curl -X POST "http://localhost:3000/api/webhook/purchase?secret=webhook-khusyuk-2026" \
  -H 'Content-Type: application/json' \
  -d '{"customer":{"email":"pembeli@gmail.com","name":"Andi"},"product":"Upselling"}'
```

Setelah ini, `pembeli@gmail.com` langsung bisa login & masuk app.

---

## 3. Setup Login Google (produksi)

1. Buka **Google Cloud Console → APIs & Services → Credentials**
   (<https://console.cloud.google.com/apis/credentials>).
2. **Create Credentials → OAuth client ID → Web application**.
3. Di **Authorized JavaScript origins** tambahkan domain kamu, misal:
   - `http://localhost:3000` (untuk testing lokal)
   - `https://app.domainkamu.com` (produksi)
4. Salin **Client ID**, isi ke `server/.env`:
   ```
   GOOGLE_CLIENT_ID=1234567890-abcdef.apps.googleusercontent.com
   DEV_LOGIN=false          # matikan login email manual di produksi
   ```
5. Restart server. Tombol **"Continue with Google"** otomatis muncul di app.

Verifikasi token Google dilakukan di server (audience dicek harus sama dengan
`GOOGLE_CLIENT_ID`), jadi tidak bisa dipalsukan dari sisi browser.

---

## 4. Konfigurasi (.env)

| Variabel | Default | Keterangan |
|----------|---------|------------|
| `PORT` | `3000` | Port server |
| `GOOGLE_CLIENT_ID` | _(kosong)_ | OAuth Client ID. Kosong = tombol Google nonaktif |
| `JWT_SECRET` | _(auto)_ | Rahasia sesi. Auto-generate & disimpan jika kosong |
| `SESSION_DAYS` | `30` | Lama sesi login |
| `DEV_LOGIN` | `true` | Izinkan login email tanpa Google. **Set `false` di produksi** |
| `SEED_EMAILS` | `demo@khusyuk.test` | Email yang otomatis diberi akses saat DB dibuat |
| `ADMIN_TOKEN` | `admin-khusyuk-2026` | Token panel admin. **Ganti di produksi** |
| `WEBHOOK_SECRET` | `webhook-khusyuk-2026` | Secret webhook. **Ganti di produksi** |
| `DB_FILE` | `server/data/khusyuk.db` | Lokasi database |
| `STATIC_DIR` | _(root repo)_ | Folder file statis yang disajikan |

---

## 5. API singkat

| Endpoint | Method | Auth | Fungsi |
|----------|--------|------|--------|
| `/api/config` | GET | — | Config publik (client id, dev login) |
| `/api/auth/google` | POST | — | Login dengan Google credential |
| `/api/auth/dev` | POST | — | Login email (mode dev) |
| `/api/me` | GET | Bearer | Profil + status akses + progres |
| `/api/progress` | PUT | Bearer | Simpan progres (wajib punya akses) |
| `/api/progress` | GET | Bearer | Ambil progres |
| `/api/webhook/purchase` | POST | secret | Daftarkan pembeli (otomatis) |
| `/api/admin/entitlements` | GET/POST/DELETE | X-Admin-Token | Kelola akses |
| `/api/admin/entitlements/toggle` | POST | X-Admin-Token | Aktif/nonaktifkan akses |
| `/api/admin/users` | GET | X-Admin-Token | Daftar user |
| `/api/admin/stats` | GET | X-Admin-Token | Statistik |

---

## 6. Deploy

Server ini satu proses Node tanpa build step. Bisa deploy ke VPS, Railway,
Render, Fly.io, dll:

1. Pastikan Node ≥ 22.5 tersedia.
2. Set environment variable (lihat tabel di atas) — minimal `GOOGLE_CLIENT_ID`,
   `ADMIN_TOKEN`, `WEBHOOK_SECRET`, dan `DEV_LOGIN=false`.
3. Jalankan `node server.js` (atau `npm start`), arahkan domain ke port-nya.
4. Pastikan folder `server/data/` bisa ditulis & **persisten** (di situ DB
   SQLite disimpan). Backup file `khusyuk.db` secara berkala.

> Untuk skala besar / multi-instance, database bisa dipindah ke Postgres dengan
> mengganti implementasi di `lib/db.js` (antarmukanya sudah dipisah rapi).
