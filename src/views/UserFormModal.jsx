import { useState, useEffect } from "react";
import { cs } from "../theme/cs.js";

const inp = (err) => ({
  width: "100%", background: cs.surface,
  border: "1px solid " + (err ? cs.red : cs.border),
  borderRadius: 8, padding: "9px 12px", color: cs.text,
  fontSize: 13, outline: "none", boxSizing: "border-box",
});
const lbl = { fontSize: 11, color: cs.muted, marginBottom: 4, display: "block", fontWeight: 600 };
const card = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" };
const secTitle = { fontSize: 10, fontWeight: 800, color: cs.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 };

const ROLE_CONFIG = {
  Owner:   { color: "#f59e0b", icon: "👑", desc: "Akses penuh semua menu & pengaturan",            autoPass: null },
  Admin:   { color: "#38bdf8", icon: "🛠️", desc: "Semua menu operasional kecuali Pengaturan",     autoPass: null },
  Finance: { color: "#10b981", icon: "💰", desc: "Finance, Invoice, Biaya & Statistik",            autoPass: null },
  Teknisi: { color: "#22c55e", icon: "👷", desc: "Hanya Jadwal & Laporan Saya",                   autoPass: "teknisi123" },
  Helper:  { color: "#a78bfa", icon: "🤝", desc: "Hanya Jadwal & Laporan Saya",                   autoPass: "helper123" },
};

const isUUID = (id) => id && /^[0-9a-f-]{36}$/.test(String(id).toLowerCase());

export default function UserFormModal({
  open, onClose,
  newUserForm, setNewUserForm,
  userAccounts, setUserAccounts,
  setTeknisiData,
  currentUser,
  showNotif, showConfirm, addAgentLog,
  _apiHeaders,
}) {
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showResetCard, setShowResetCard] = useState(false);
  const [resetPwd, setResetPwd] = useState({ newPwd: "", confirmPwd: "" });
  const [resetSaving, setResetSaving] = useState(false);

  const isEditMode = !!(newUserForm?.id && isUUID(newUserForm.id));
  const cfg = ROLE_CONFIG[newUserForm?.role] || ROLE_CONFIG.Admin;
  const isAutoPass = ["Teknisi", "Helper"].includes(newUserForm?.role);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaving(false);
    setShowResetCard(false);
    setResetPwd({ newPwd: "", confirmPwd: "" });
    setResetSaving(false);
  }, [open]);

  if (!open) return null;

  const set = (key, val) => {
    setNewUserForm(f => ({ ...f, [key]: val }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: "" }));
  };

  const auditName = () => currentUser?.name || currentUser?.email || currentUser?.id || "system";

  const callManageUser = async (body) => {
    const res = await fetch("/api/manage-user", {
      method: "POST",
      headers: await _apiHeaders(),
      body: JSON.stringify({ ...body, callerRole: currentUser?.role || "" }),
    });
    return res.json();
  };

  const validate = () => {
    const e = {};
    if (!newUserForm.name?.trim()) e.name = "Nama wajib diisi";
    if (!isEditMode && !newUserForm.email?.trim()) e.email = "Email wajib diisi";
    if (!isEditMode && !isAutoPass && !newUserForm.password?.trim()) e.password = "Password wajib diisi";
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      const avatar = newUserForm.name.charAt(0).toUpperCase();
      const color = cfg.color;

      if (isEditMode) {
        const result = await callManageUser({ action: "update", userId: newUserForm.id, name: newUserForm.name.trim(), role: newUserForm.role, phone: newUserForm.phone || "" });
        if (!result.ok) { showNotif("⚠️ " + (result.error || "Update gagal")); return; }
        setUserAccounts(prev => prev.map(u => u.id === newUserForm.id ? { ...u, name: newUserForm.name.trim(), role: newUserForm.role, phone: newUserForm.phone || "", avatar, color } : u));
        if (["Teknisi", "Helper"].includes(newUserForm.role)) {
          setTeknisiData(prev => {
            const exists = prev.find(t => t.id === newUserForm.id);
            if (exists) return prev.map(t => t.id === newUserForm.id ? { ...t, name: newUserForm.name.trim(), role: newUserForm.role, phone: newUserForm.phone || "", color } : t);
            return [...prev, { id: newUserForm.id, name: newUserForm.name.trim(), role: newUserForm.role, phone: newUserForm.phone || "", skills: [], jobs_today: 0, status: "active", color, avatar }];
          });
        } else {
          setTeknisiData(prev => prev.filter(t => t.id !== newUserForm.id));
        }
        addAgentLog("USER_UPDATED", "Akun " + newUserForm.name + " diupdate", "SUCCESS");
        showNotif("✅ Akun " + newUserForm.name.trim() + " berhasil diupdate");
      } else {
        const password = isAutoPass ? cfg.autoPass : newUserForm.password;
        const result = await callManageUser({ action: "create", email: newUserForm.email.trim(), password, name: newUserForm.name.trim(), role: newUserForm.role, phone: newUserForm.phone || "" });
        if (!result.ok) { showNotif("❌ " + (result.error || "Gagal buat akun")); return; }
        const uid = result.user?.id;
        const newAcc = { id: uid, name: newUserForm.name.trim(), email: newUserForm.email.trim(), role: newUserForm.role, phone: newUserForm.phone || "", avatar, color, active: true, lastLogin: "Belum login" };
        setUserAccounts(prev => [...prev, newAcc]);
        if (["Teknisi", "Helper"].includes(newUserForm.role)) {
          setTeknisiData(prev => prev.find(t => t.id === uid) ? prev : [...prev, { id: uid, name: newUserForm.name.trim(), role: newUserForm.role, phone: newUserForm.phone || "", skills: [], jobs_today: 0, status: "active", color, avatar }]);
        }
        addAgentLog("USER_CREATED", "Akun baru: " + newUserForm.name + " (" + newUserForm.role + ")", "SUCCESS");
        showNotif("✅ Akun " + newUserForm.name.trim() + " dibuat — password: " + password);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleSaveResetPwd = async () => {
    const p = resetPwd.newPwd.trim();
    const c = resetPwd.confirmPwd.trim();
    if (!p || p.length < 6) { showNotif("⚠️ Password minimal 6 karakter"); return; }
    if (p !== c) { showNotif("⚠️ Password tidak cocok"); return; }
    if (!isUUID(newUserForm.id)) { showNotif("⚠️ Akun ini tidak punya Supabase Auth — tidak bisa reset password"); return; }
    setResetSaving(true);
    try {
      const result = await callManageUser({ action: "reset-password", userId: newUserForm.id, password: p });
      if (!result.ok) { showNotif("❌ Gagal reset password: " + (result.error || "")); return; }
      addAgentLog("USER_RESET_PWD", "Password " + newUserForm.name + " direset oleh " + auditName(), "WARNING");
      showNotif("🔑 Password " + newUserForm.name + " berhasil direset");
      setShowResetCard(false);
      setResetPwd({ newPwd: "", confirmPwd: "" });
    } finally {
      setResetSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!isEditMode || newUserForm.role === "Owner") return;
    const isActive = newUserForm.active !== false;
    const label = isActive ? "Nonaktifkan" : "Aktifkan";
    if (!await showConfirm({ icon: isActive ? "🔒" : "🔓", title: label + " Akun?", danger: isActive, message: `${label} akun ${newUserForm.name}?\n${isActive ? "User tidak bisa login sampai diaktifkan kembali." : "User bisa login kembali."}`, confirmText: label })) return;
    const result = await callManageUser({ action: "toggle-active", userId: newUserForm.id, active: !isActive });
    if (!result.ok) { showNotif("⚠️ " + (result.error || "Gagal")); return; }
    setUserAccounts(prev => prev.map(u => u.id === newUserForm.id ? { ...u, active: !isActive } : u));
    addAgentLog(isActive ? "USER_DEACTIVATED" : "USER_ACTIVATED", "Akun " + newUserForm.name + " " + (isActive ? "dinonaktifkan" : "diaktifkan"), "WARNING");
    showNotif((isActive ? "🔒 Akun dinonaktifkan: " : "🔓 Akun diaktifkan: ") + newUserForm.name);
    onClose();
  };

  const handleDelete = async () => {
    if (!isEditMode || newUserForm.role === "Owner") return;
    if (!await showConfirm({ icon: "🗑️", title: "Hapus Permanen?", danger: true, message: `Hapus akun ${newUserForm.name} dari sistem?\n\nAkun dihapus dari Supabase Auth. Data order/laporan tetap ada.\n\nGunakan "Nonaktifkan" jika hanya ingin blokir login.`, confirmText: "Hapus Permanen" })) return;
    const result = await callManageUser({ action: "delete", userId: newUserForm.id });
    if (!result.ok) { showNotif("⚠️ " + (result.error || "Hapus gagal")); return; }
    setUserAccounts(prev => prev.filter(u => u.id !== newUserForm.id));
    addAgentLog("USER_DELETED", "Akun " + newUserForm.name + " dihapus permanen", "WARNING");
    showNotif("🗑️ Akun " + newUserForm.name + " dihapus permanen");
    onClose();
  };

  const pwdMismatch = resetPwd.newPwd && resetPwd.confirmPwd && resetPwd.newPwd !== resetPwd.confirmPwd;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ padding: "16px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid " + cs.border + "55", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>
              {isEditMode ? `✏️ Edit Pengguna — ${newUserForm.name}` : "👤 Tambah Anggota Tim"}
            </div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
              Hanya Owner yang dapat mengelola akun pengguna
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}>×</button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Card 1 — Role Selector */}
          <div style={card}>
            <div style={secTitle}>Role & Hak Akses</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
              {Object.entries(ROLE_CONFIG).map(([role, rcfg]) => (
                <div
                  key={role}
                  onClick={() => setNewUserForm(f => ({ ...f, role, password: rcfg.autoPass || "" }))}
                  style={{ background: newUserForm.role === role ? rcfg.color + "18" : cs.surface, border: "2px solid " + (newUserForm.role === role ? rcfg.color : cs.border), borderRadius: 10, padding: "10px 10px", cursor: "pointer", transition: "border-color .15s" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 15 }}>{rcfg.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: newUserForm.role === role ? rcfg.color : cs.text }}>{role}</span>
                  </div>
                  <div style={{ fontSize: 10, color: cs.muted, lineHeight: 1.4 }}>{rcfg.desc}</div>
                  {rcfg.autoPass && (
                    <div style={{ fontSize: 10, color: rcfg.color, marginTop: 4, fontWeight: 700 }}>🔑 {rcfg.autoPass}</div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, background: cfg.color + "10", border: "1px solid " + cfg.color + "22", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: cs.muted }}>
              {newUserForm.role === "Owner" && "👑 Akses penuh: semua menu, pengaturan, manajemen akun, dan data keuangan."}
              {newUserForm.role === "Admin" && "🛠️ Akses operasional: order, invoice, customer, inventory, laporan. Tidak bisa buka Pengaturan."}
              {newUserForm.role === "Finance" && "💰 Akses keuangan: Finance dashboard, Invoice, Biaya Operasional, dan Statistik. Tidak bisa akses data lapangan."}
              {newUserForm.role === "Teknisi" && "👷 Akses terbatas: Dashboard, Jadwal, dan Laporan Sendiri saja. Nominal transaksi disembunyikan."}
              {newUserForm.role === "Helper" && "🤝 Akses terbatas: Dashboard, Jadwal, dan Laporan Sendiri saja. Sama seperti Teknisi."}
            </div>
          </div>

          {/* Card 2 — Identitas */}
          <div style={card}>
            <div style={secTitle}>Identitas</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={lbl}>Nama Lengkap <span style={{ color: cs.red }}>*</span></label>
                <input value={newUserForm.name || ""} onChange={e => set("name", e.target.value)} placeholder="Nama lengkap anggota" style={inp(errors.name)} />
                {errors.name && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.name}</div>}
              </div>
              <div>
                <label style={lbl}>Email Login <span style={{ color: cs.red }}>*</span></label>
                <input type="email" value={newUserForm.email || ""} onChange={e => set("email", e.target.value)} placeholder="nama@aclean.id" disabled={isEditMode} style={{ ...inp(errors.email), opacity: isEditMode ? 0.6 : 1 }} />
                {errors.email && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.email}</div>}
                {isEditMode && <div style={{ fontSize: 10, color: cs.muted, marginTop: 3 }}>Email login tidak bisa diubah setelah akun dibuat</div>}
              </div>
              <div>
                <label style={lbl}>Nomor HP <span style={{ fontSize: 10, fontWeight: 400 }}>(opsional)</span></label>
                <input value={newUserForm.phone || ""} onChange={e => set("phone", e.target.value)} placeholder="628812xxx" style={inp(false)} />
              </div>
            </div>
          </div>

          {/* Card 3 — Password */}
          <div style={card}>
            <div style={secTitle}>Password</div>
            {isAutoPass ? (
              <div style={{ background: cfg.color + "15", border: "1px solid " + cfg.color + "44", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>🔑</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: cfg.color }}>{cfg.autoPass}</div>
                  <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>Password standar untuk semua {newUserForm.role}. Beritahu anggota password ini.</div>
                </div>
              </div>
            ) : isEditMode ? (
              <>
                {!showResetCard ? (
                  <button
                    onClick={() => setShowResetCard(true)}
                    style={{ background: "#f59e0b18", border: "1px solid #f59e0b44", color: "#f59e0b", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, width: "100%", textAlign: "left" }}
                  >
                    🔑 Reset Password Baru
                    <div style={{ fontSize: 10, fontWeight: 400, color: cs.muted, marginTop: 2 }}>Klik untuk input password baru</div>
                  </button>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <label style={lbl}>Password Baru <span style={{ color: cs.red }}>*</span></label>
                      <input
                        type="password"
                        value={resetPwd.newPwd}
                        onChange={e => setResetPwd(f => ({ ...f, newPwd: e.target.value }))}
                        placeholder="Minimal 6 karakter"
                        style={inp(false)}
                      />
                    </div>
                    <div>
                      <label style={lbl}>Konfirmasi Password <span style={{ color: cs.red }}>*</span></label>
                      <input
                        type="password"
                        value={resetPwd.confirmPwd}
                        onChange={e => setResetPwd(f => ({ ...f, confirmPwd: e.target.value }))}
                        placeholder="Ulangi password baru"
                        style={inp(pwdMismatch)}
                      />
                      {pwdMismatch && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ Password tidak cocok</div>}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => { setShowResetCard(false); setResetPwd({ newPwd: "", confirmPwd: "" }); }}
                        style={{ flex: 1, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "9px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                      >Batal</button>
                      <button
                        onClick={handleSaveResetPwd}
                        disabled={resetSaving || pwdMismatch}
                        style={{ flex: 2, background: resetSaving ? "#f59e0b88" : "linear-gradient(135deg,#f59e0b,#f97316)", border: "none", color: "#fff", padding: "9px", borderRadius: 8, cursor: resetSaving ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 12, opacity: (resetSaving || pwdMismatch) ? 0.7 : 1 }}
                      >
                        {resetSaving ? "Menyimpan..." : "💾 Simpan Password"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div>
                <label style={lbl}>Password <span style={{ color: cs.red }}>*</span></label>
                <input type="password" value={newUserForm.password || ""} onChange={e => set("password", e.target.value)} placeholder="min 8 karakter" style={inp(errors.password)} />
                {errors.password && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.password}</div>}
              </div>
            )}
          </div>

          {/* Card 4 — Kelola Akun (edit mode, non-Owner) */}
          {isEditMode && newUserForm.role !== "Owner" && (
            <div style={{ background: cs.red + "08", border: "1px solid " + cs.red + "33", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ ...secTitle, color: cs.red + "aa" }}>Kelola Akun</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  onClick={handleToggleActive}
                  style={{ background: newUserForm.active !== false ? cs.yellow + "18" : cs.green + "18", border: "1px solid " + (newUserForm.active !== false ? cs.yellow + "44" : cs.green + "44"), color: newUserForm.active !== false ? cs.yellow : cs.green, padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, textAlign: "left" }}
                >
                  {newUserForm.active !== false ? "🔒 Nonaktifkan Akun" : "🔓 Aktifkan Akun"}
                  <div style={{ fontSize: 10, fontWeight: 400, color: cs.muted, marginTop: 2 }}>
                    {newUserForm.active !== false ? "User tidak bisa login sampai diaktifkan kembali" : "User bisa login kembali"}
                  </div>
                </button>
                <button
                  onClick={handleDelete}
                  style={{ background: cs.red + "18", border: "1px solid " + cs.red + "44", color: cs.red, padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, textAlign: "left" }}
                >
                  🗑️ Hapus Permanen dari Supabase Auth
                  <div style={{ fontSize: 10, fontWeight: 400, color: cs.muted, marginTop: 2 }}>Data order & laporan tetap ada. Gunakan Nonaktifkan jika hanya ingin blokir login.</div>
                </button>
              </div>
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div style={{ borderTop: "1px solid " + cs.border + "55", padding: "12px 20px", display: "flex", gap: 10, flexShrink: 0 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ flex: 2, background: saving ? cfg.color + "88" : `linear-gradient(135deg,${cfg.color},${cfg.color}99)`, border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: saving ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 13, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Menyimpan..." : (isEditMode ? "✓ Simpan Perubahan" : `${cfg.icon} Buat Akun ${newUserForm.role}`)}
          </button>
        </div>
      </div>
    </div>
  );
}
