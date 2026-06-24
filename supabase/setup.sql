-- ============================================================
-- Khusyuk Learn — Setup Database Supabase (VERSI FINAL)
-- Jalankan SEKALI di: Dashboard Supabase -> SQL Editor -> New query -> Run
-- Berisi: tabel progress + RLS, allowlist pembeli, tabel admin,
--         gate signup (cuma email pembeli yang boleh daftar), policy admin.
-- ============================================================

-- ========== 1. PROGRES (per user) ==========
create table if not exists public.progress (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text, email text, category text, cat_name text,
  xp integer not null default 0, streak integer not null default 1,
  gem integer not null default 5, hearts integer not null default 5,
  done_units  jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.progress enable row level security;

drop policy if exists progress_select_own on public.progress;
create policy progress_select_own on public.progress for select using (auth.uid() = user_id);
drop policy if exists progress_insert_own on public.progress;
create policy progress_insert_own on public.progress for insert with check (auth.uid() = user_id);
drop policy if exists progress_update_own on public.progress;
create policy progress_update_own on public.progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ========== 2. ALLOWLIST PEMBELI ==========
create table if not exists public.allowed_emails (
  email      text primary key,
  product    text,
  order_id   text,
  source     text default 'manual',
  created_at timestamptz default now()
);
alter table public.allowed_emails enable row level security;
-- catatan: webhook pakai service_role (bypass RLS). Admin diatur di policy bawah.

-- ========== 3. ADMIN ==========
create table if not exists public.admins (
  email text primary key, created_at timestamptz default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(auth.jwt()->>'email'));
$$;

-- admin boleh baca SEMUA progres
drop policy if exists progress_admin_read_all on public.progress;
create policy progress_admin_read_all on public.progress for select using (public.is_admin());

-- admin boleh kelola allowlist dari dashboard
drop policy if exists allowed_admin_all on public.allowed_emails;
create policy allowed_admin_all on public.allowed_emails for all using (public.is_admin()) with check (public.is_admin());
-- admin boleh lihat daftar admin (opsional, biar UI gak error)
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select using (public.is_admin());

-- ========== 4. GATE SIGNUP: cuma email yang ada di allowlist yang boleh daftar ==========
create or replace function public.enforce_allowed_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_emails where lower(email) = lower(new.email)) then
    raise exception 'EMAIL_NOT_ALLOWED' using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists trg_enforce_allowed_email on auth.users;
create trigger trg_enforce_allowed_email
  before insert on auth.users for each row execute function public.enforce_allowed_email();

-- ============================================================
-- SETELAH RUN: daftarkan email admin lo SEKALI (ganti dgn email admin kamu).
-- Ini juga harus ada di allowed_emails kalau admin mau punya akun login biasa,
-- tapi untuk sekadar jadi admin cukup baris di bawah:
--
--   insert into public.admins(email) values ('GANTI-EMAIL-ADMIN@gmail.com');
--
-- (opsional) supaya admin bisa BUAT akun & login di admin.html, allow juga emailnya:
--   insert into public.allowed_emails(email, source) values ('GANTI-EMAIL-ADMIN@gmail.com','manual')
--   on conflict (email) do nothing;
-- ============================================================
