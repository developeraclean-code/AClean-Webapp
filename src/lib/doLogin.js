// doLogin — autentikasi user (Supabase Auth) + set session state + lockout attempts.
// Diekstrak dari App.jsx (Fase 3, pola ctx).
export async function doLogin(email, pass, {
  _ls, _lsSave, addAgentLog, loginAttempts, requestPushPermission, setActiveMenu,
  setActiveRole, setCurrentUser, setIsLoggedIn, setLockoutUntil, setLoginAttempts,
  setLoginError, showNotif, supabase,
} = {}) {
    setLoginError("");

    // ── SEC-07: Cek lockout brute force ──
    const _now = Date.now();
    const _lockout = _ls("lockoutUntil", 0);
    if (_lockout > _now) {
      const sisa = Math.ceil((_lockout - _now) / 1000);
      setLoginError(`⛔ Terlalu banyak percobaan. Coba lagi dalam ${sisa} detik.`);
      return;
    }

    try {
      // ── Coba Supabase Auth dulu (untuk akun real dengan UUID) ──
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });

      if (!error && data?.user) {
        // Login Supabase Auth berhasil — load profil dari user_profiles
        const { data: profile, error: profileErr } = await supabase
          .from("user_profiles").select("*").eq("id", data.user.id).single();
        if (profileErr) {
          console.error("[LOGIN_PROFILE_LOAD_ERROR]", profileErr.message);
          setLoginError("Gagal load profil pengguna. Silakan coba lagi. (Err: " + profileErr.code + ")");
          await supabase.auth.signOut();
          return;
        }
        if (!profile || !profile.active) {
          setLoginError("Akun tidak aktif. Hubungi Owner.");
          await supabase.auth.signOut(); return;
        }
        // SEC-08: Tambah expiry 8 jam ke session
        // Strip kolom legacy `password` (terenkripsi, migrasi 079) — jangan pernah kirim ke client/localStorage
        const { password: _ignorePwd, ...profileSafe } = profile;
        const userObj = { ...data.user, ...profileSafe, _exp: Date.now() + 8 * 60 * 60 * 1000 };
        setCurrentUser(userObj);
        setIsLoggedIn(true);
        setActiveRole(profile.role.toLowerCase());
        const defaultMenu = profile.role === "Finance" ? "finance" : "dashboard";
        setActiveMenu(defaultMenu);
        try { localStorage.setItem("aclean_lastMenu", defaultMenu); } catch { /* localStorage opsional — abaikan */ }
        _lsSave("localSession", userObj);
        // SEC-07: Reset counter setelah login berhasil
        setLoginAttempts(0); setLockoutUntil(0);
        _lsSave("loginAttempts", 0); _lsSave("lockoutUntil", 0);
        showNotif("Selamat datang, " + profile.name + "!");
        addAgentLog("LOGIN", `${profile.name} (${profile.role}) login via Supabase Auth`, "SUCCESS");
        requestPushPermission();
        return;
      }

      // ── Fallback dihapus: semua login wajib via Supabase Auth ──
      // Tidak ada lagi login dengan password hardcode

      // SEC-07: increment attempt counter
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      _lsSave("loginAttempts", newAttempts);
      if (newAttempts >= 5) {
        const lockUntil = Date.now() + 5 * 60 * 1000; // 5 menit
        setLockoutUntil(lockUntil);
        _lsSave("lockoutUntil", lockUntil);
        setLoginError("⛔ 5 percobaan gagal. Akun dikunci 5 menit.");
      } else {
        setLoginError(`Email atau password salah. (${newAttempts}/5 percobaan)`);
      }
    } catch (err) {
      setLoginError("Terjadi kesalahan: " + err.message);
    }
}
