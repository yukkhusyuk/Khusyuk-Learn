# Deploy Khusyuk Learn ke Railway

Panduan klik-demi-klik supaya app online dengan alamat permanen.
Repo ini sudah berisi config Railway (`railway.json`, `nixpacks.toml`,
`package.json`) — Railway tinggal jalan, **tanpa setup build apa pun**.

---

## Langkah 1 — Buat project di Railway

1. Daftar / login di <https://railway.com> (bisa pakai akun GitHub).
2. **New Project → Deploy from GitHub repo** → pilih repo `Khusyuk-Learn`.
3. Railway otomatis mendeteksi Node.js (Nixpacks) dan menjalankan
   `node server/server.js`. Tunggu deploy pertama selesai.

> Railway otomatis menyetel `PORT` — server sudah membaca env ini.

---

## Langkah 2 — Tambah Volume (WAJIB, biar data tidak hilang)

Database SQLite disimpan di file. Tanpa volume, data **hilang setiap redeploy**.

1. Di service, buka tab **Variables / Settings → Volumes → New Volume**.
2. **Mount path**: `/app/server/data`
3. Simpan. Sekarang `khusyuk.db` (entitlements, users, progres) persisten.

---

## Langkah 3 — Set Environment Variables

Buka tab **Variables**, tambahkan:

| Variable | Nilai | Wajib? |
|----------|-------|--------|
| `JWT_SECRET` | string acak panjang (mis. hasil `openssl rand -hex 48`) | ✅ ya |
| `ADMIN_TOKEN` | token rahasia kamu untuk buka `/admin` | ✅ ya |
| `WEBHOOK_SECRET` | secret rahasia untuk webhook pembelian | ✅ ya |
| `DEV_LOGIN` | `false` | ✅ ya (matikan login email manual) |
| `GOOGLE_CLIENT_ID` | Client ID dari Langkah 4 | ✅ ya |
| `SEED_EMAILS` | email-mu sendiri (biar bisa tes login) | opsional |

Setelah disimpan, Railway redeploy otomatis.

---

## Langkah 4 — Setup Login Google

1. Setelah deploy, Railway memberi domain, mis:
   `https://khusyuk-learn-production.up.railway.app`
   (lihat di **Settings → Networking → Public Domain**; bisa juga pasang
   domain sendiri seperti `app.khusyuklearn.com`).
2. Buka **Google Cloud Console → APIs & Services → Credentials**
   (<https://console.cloud.google.com/apis/credentials>).
3. **Create Credentials → OAuth client ID → Web application**.
4. Di **Authorized JavaScript origins**, masukkan domain Railway kamu
   (TANPA garis miring di akhir), mis:
   `https://khusyuk-learn-production.up.railway.app`
5. Salin **Client ID**, tempel ke variable `GOOGLE_CLIENT_ID` di Railway.

Selesai — tombol **"Continue with Google"** otomatis muncul di app.

---

## Langkah 5 — Sambungkan pembelian (otomatis)

Di dashboard payment gateway-mu (Mayar / Lynk.id / Xendit / dll), arahkan
**webhook "pembayaran sukses"** ke:

```
https://DOMAIN-KAMU/api/webhook/purchase?secret=WEBHOOK_SECRET
```

Begitu ada pembelian, email pembeli otomatis didaftarkan & langsung bisa login.

Atau tambah manual lewat panel admin: `https://DOMAIN-KAMU/admin`.

---

## Selesai ✅

| Halaman | URL |
|---------|-----|
| Web app | `https://DOMAIN-KAMU/khusyuk-learn/` |
| Beranda | `https://DOMAIN-KAMU/` |
| Admin | `https://DOMAIN-KAMU/admin` |

### Checklist produksi
- [ ] Volume terpasang di `/app/server/data`
- [ ] `DEV_LOGIN=false`
- [ ] `JWT_SECRET`, `ADMIN_TOKEN`, `WEBHOOK_SECRET` sudah diganti (bukan default)
- [ ] `GOOGLE_CLIENT_ID` terisi & domain terdaftar di Google Console
- [ ] Webhook payment gateway sudah diarahkan

> Mau ganti hosting? Repo ini juga jalan di Render, Fly.io, atau VPS mana pun
> yang punya Node ≥ 22.5 — cukup `node server/server.js`. Detail di
> `server/README.md`.
