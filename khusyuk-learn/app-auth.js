/* =====================================================================
   Khusyuk Learn — lapisan autentikasi & sinkronisasi backend.
   Dimuat SETELAH script utama aplikasi. Mengambil alih alur login:
   - Login Google (Sign-In) + verifikasi akses (entitlement) di server
   - Mode dev (email) bila diaktifkan
   - Progres belajar disimpan & dimuat dari server (bukan cuma localStorage)
   ===================================================================== */
(function () {
  'use strict';

  var KL = (window.KL = {
    token: localStorage.getItem('kl_token') || null,
    user: null,
    entitled: false,
    config: { googleClientId: null, devLogin: true },
    booted: false,
  });

  var API = ''; // same-origin

  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    headers['Content-Type'] = 'application/json';
    if (KL.token) headers['Authorization'] = 'Bearer ' + KL.token;
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; })
        .catch(function () { return { status: r.status, body: {} }; });
    });
  }

  // -------------------------------------------------------------------
  // Ambil snapshot progres dari state aplikasi yang sudah ada
  // -------------------------------------------------------------------
  function snapshot() {
    var s = window.state || {};
    return {
      name: s.name, email: s.email, category: s.category, catName: s.catName,
      xp: s.xp, streak: s.streak, gem: s.gem, hearts: s.hearts,
      doneUnits: s.doneUnits || [],
    };
  }

  function applyProgress(p) {
    if (!p) return;
    if (typeof window.applyUser === 'function') {
      window.applyUser({
        name: p.name || (KL.user && KL.user.name) || '',
        email: p.email || (KL.user && KL.user.email) || '',
        category: p.category || null, catName: p.catName || '',
        xp: p.xp, streak: p.streak, gem: p.gem, hearts: p.hearts,
        doneUnits: p.doneUnits || [],
      });
    }
  }

  // -------------------------------------------------------------------
  // Sinkronisasi progres ke server (debounce)
  // -------------------------------------------------------------------
  var syncTimer = null;
  function syncProgress() {
    if (!KL.token || !KL.entitled) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      api('/api/progress', { method: 'PUT', body: { progress: snapshot() } })
        .catch(function () {/* offline: tetap tersimpan di localStorage */});
    }, 700);
  }

  // Bungkus saveUser milik aplikasi agar setiap progres tersimpan juga ke server
  var _saveUser = window.saveUser;
  window.saveUser = function () {
    try { if (_saveUser) _saveUser.apply(this, arguments); } catch (e) {}
    syncProgress();
  };

  // Bungkus logout agar token server ikut dihapus
  var _logout = window.logout;
  window.logout = function () {
    localStorage.removeItem('kl_token');
    KL.token = null; KL.user = null; KL.entitled = false;
    if (_logout) { try { _logout(); return; } catch (e) {} }
    location.reload();
  };

  // -------------------------------------------------------------------
  // Masuk ke aplikasi setelah sesi tervalidasi & berhak akses
  // -------------------------------------------------------------------
  function enterWithSession(resp) {
    KL.token = resp.token || KL.token;
    KL.user = resp.user || KL.user;
    KL.entitled = !!resp.entitled;
    if (resp.token) localStorage.setItem('kl_token', resp.token);

    if (!KL.entitled) { showDenied(KL.user); return; }

    var p = resp.progress;
    if (window.state) {
      window.state.email = (KL.user && KL.user.email) || window.state.email;
      if (KL.user && KL.user.name && !window.state.name) window.state.name = KL.user.name;
    }
    if (p && (p.category || (p.doneUnits && p.doneUnits.length) || p.xp)) {
      applyProgress(p);
      if (typeof window.enterApp === 'function') window.enterApp();
    } else {
      // user baru / belum onboarding
      if (window.state) {
        window.state.name = (KL.user && KL.user.name) || window.state.name || '';
        window.state.email = (KL.user && KL.user.email) || window.state.email || '';
      }
      if (typeof window.startOnboard === 'function') window.startOnboard();
      else if (typeof window.enterApp === 'function') window.enterApp();
    }
    syncProgress();
  }

  // -------------------------------------------------------------------
  // Tampilan: login, akses ditolak, loading
  // -------------------------------------------------------------------
  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('on'); });
    var el = document.getElementById(id);
    if (el) el.classList.add('on');
  }
  function hideNav() {
    var n = document.getElementById('appnav');
    if (n) n.style.display = 'none';
  }

  function buildLoginUI() {
    var auth = document.getElementById('scAuth');
    if (!auth) return;
    var inner = auth.querySelector('.inner');
    if (!inner || inner.querySelector('#klGoogleWrap')) return;

    var nameField = document.getElementById('nameField');
    var emailField = document.getElementById('emailField');
    var submitBtn = inner.querySelector('button.fullbtn');
    var note = inner.querySelector('.authnote');

    // Container tombol Google
    var gwrap = document.createElement('div');
    gwrap.id = 'klGoogleWrap';
    gwrap.style.cssText = 'margin:18px 0 6px;display:flex;flex-direction:column;align-items:center;gap:10px';
    gwrap.innerHTML =
      '<div id="klGoogleBtn" style="min-height:44px;display:flex;justify-content:center"></div>' +
      '<div id="klGoogleMsg" style="font-size:13px;color:#9b8f76;text-align:center"></div>';

    // Sisipkan tombol Google sebelum field nama
    var anchor = nameField || submitBtn;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(gwrap, anchor);

    // Pembatas "atau"
    if (KL.config.devLogin) {
      var sep = document.createElement('div');
      sep.id = 'klSep';
      sep.style.cssText = 'display:flex;align-items:center;gap:10px;color:#b8ab8e;font-size:12px;margin:6px 0 2px';
      sep.innerHTML = '<span style="flex:1;height:1px;background:#e7ddc6"></span>atau masuk dengan email<span style="flex:1;height:1px;background:#e7ddc6"></span>';
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sep, nameField || submitBtn);
    } else {
      // Tanpa dev login: sembunyikan field email manual
      if (nameField) nameField.style.display = 'none';
      if (emailField) emailField.style.display = 'none';
      if (submitBtn) submitBtn.style.display = 'none';
      if (note) note.textContent = 'Masuk dengan akun Google yang kamu pakai saat membeli.';
    }

    renderGoogleButton();
  }

  function renderGoogleButton() {
    var msg = document.getElementById('klGoogleMsg');
    var btn = document.getElementById('klGoogleBtn');
    if (!KL.config.googleClientId) {
      if (btn) btn.style.display = 'none';
      if (msg) msg.textContent = KL.config.devLogin
        ? '(Login Google belum dikonfigurasi — pakai email di bawah untuk testing)'
        : 'Login Google belum dikonfigurasi oleh admin.';
      return;
    }
    function init() {
      if (!(window.google && google.accounts && google.accounts.id)) return setTimeout(init, 300);
      try {
        google.accounts.id.initialize({
          client_id: KL.config.googleClientId,
          callback: onGoogleCredential,
        });
        google.accounts.id.renderButton(btn, {
          theme: 'filled_blue', size: 'large', shape: 'pill',
          text: 'continue_with', width: 280,
        });
      } catch (e) {
        if (msg) msg.textContent = 'Gagal memuat tombol Google.';
      }
    }
    init();
  }

  function onGoogleCredential(resp) {
    var msg = document.getElementById('klGoogleMsg');
    if (msg) msg.textContent = 'Memverifikasi...';
    api('/api/auth/google', { method: 'POST', body: { credential: resp.credential } })
      .then(function (r) {
        if (r.status === 200 && r.body.ok) { enterWithSession(r.body); }
        else { if (msg) msg.textContent = (r.body && r.body.error) || 'Login gagal.'; }
      })
      .catch(function () { if (msg) msg.textContent = 'Tidak bisa terhubung ke server.'; });
  }

  // Override submitEmail (alur dev/email) agar lewat backend + cek akses
  window.submitEmail = function () {
    var nf = document.getElementById('nameField');
    var nm = (document.getElementById('nameInput') || {}).value || '';
    var f = document.getElementById('emailField');
    var v = (document.getElementById('emailInput') || {}).value || '';
    nm = nm.trim(); v = v.trim();
    var ok = true;
    if (nm.length < 1) { if (nf) nf.classList.add('bad'); ok = false; } else if (nf) nf.classList.remove('bad');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { if (f) f.classList.add('bad'); ok = false; } else if (f) f.classList.remove('bad');
    if (!ok) return;

    api('/api/auth/dev', { method: 'POST', body: { email: v, name: nm } })
      .then(function (r) {
        if (r.status === 200 && r.body.ok) {
          if (window.state) window.state.name = nm.charAt(0).toUpperCase() + nm.slice(1);
          enterWithSession(r.body);
        } else if (r.status === 403) {
          alert('Mode email dinonaktifkan. Silakan masuk dengan Google.');
        } else {
          if (f) f.classList.add('bad');
        }
      })
      .catch(function () { alert('Tidak bisa terhubung ke server.'); });
  };

  // -------------------------------------------------------------------
  // Layar "akses ditolak" (belum membeli)
  // -------------------------------------------------------------------
  function showDenied(user) {
    hideNav();
    var auth = document.getElementById('scAuth');
    var inner = auth && auth.querySelector('.inner');
    if (!inner) { alert('Akun ini belum punya akses.'); return; }
    var email = (user && user.email) || '';
    inner.innerHTML =
      '<div style="text-align:center;padding:8px 4px">' +
      '<div style="font-size:54px;margin-bottom:8px">🔒</div>' +
      '<h1 class="round" style="font-size:26px;margin-bottom:6px">Akses Terkunci</h1>' +
      '<p class="tag" style="margin-bottom:14px">Akun <b>' + escapeHtml(email) + '</b> belum terdaftar sebagai pembeli.</p>' +
      '<div style="background:#fff7e6;border:1px solid #f0dca8;border-radius:14px;padding:14px;text-align:left;font-size:14px;line-height:1.6;color:#6b5d40;margin-bottom:16px">' +
      'Akses Khusyuk Learn didapat setelah membeli produk. Jika kamu <b>sudah membeli</b>, pastikan masuk memakai email/Gmail yang <b>sama persis</b> seperti saat checkout.' +
      '</div>' +
      '<button class="fullbtn" onclick="KL.recheck()">🔄 Saya sudah membeli, cek lagi</button>' +
      '<button class="fullbtn" style="background:#eee;color:#555;margin-top:10px" onclick="KL.switchAccount()">Ganti akun</button>' +
      '</div>';
    show('scAuth');
  }

  KL.recheck = function () {
    api('/api/me').then(function (r) {
      if (r.status === 200 && r.body.ok && r.body.entitled) {
        enterWithSession({ token: KL.token, user: r.body.user, entitled: true, progress: r.body.progress });
      } else {
        var msg = document.querySelector('#scAuth .inner .tag');
        if (msg) msg.insertAdjacentHTML('afterend',
          '<p style="color:#c0392b;font-size:13px;margin-top:4px">Masih belum terdaftar. Coba beberapa saat lagi atau hubungi admin.</p>');
      }
    });
  };
  KL.switchAccount = function () {
    localStorage.removeItem('kl_token');
    KL.token = null; KL.user = null; KL.entitled = false;
    location.reload();
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------
  function boot() {
    hideNav();
    show('scAuth');
    api('/api/config').then(function (r) {
      if (r.body) KL.config = Object.assign(KL.config, r.body);
      buildLoginUI();
      if (KL.token) {
        api('/api/me').then(function (m) {
          if (m.status === 200 && m.body.ok) {
            KL.user = m.body.user;
            enterWithSession({ token: KL.token, user: m.body.user, entitled: m.body.entitled, progress: m.body.progress });
          } else {
            localStorage.removeItem('kl_token'); KL.token = null;
            show('scAuth');
          }
        });
      }
    }).catch(function () {
      // Server tidak tersedia: tetap tampilkan login, dev tetap bisa dicoba
      buildLoginUI();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
