import { useState, useEffect } from "react";
import { cs } from "../theme/cs.js";

const inp = {
  width: "100%", background: cs.card, border: "1px solid " + cs.border,
  borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13,
  outline: "none", boxSizing: "border-box",
};

export default function EditPasswordModal({ open, target, onClose, currentUser, showNotif, addAgentLog, _apiHeaders }) {
  const [form, setForm] = useState({ newPwd: "", confirmPwd: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setForm({ newPwd: "", confirmPwd: "" }); setSaving(false); }
  }, [open]);

  if (!open || !target) return null;

  const mismatch = form.newPwd && form.confirmPwd && form.newPwd !== form.confirmPwd;

  const handleSave = async () => {
    const p = form.newPwd.trim();
    const c = form.confirmPwd.trim();
    if (!p || p.length < 8) { showNotif("⚠️ Password minimal 8 karakter"); return; }
    if (p !== c) { showNotif("⚠️ Password tidak cocok"); return; }
    const isUUID = /^[0-9a-f-]{36}$/.test(String(target.id || "").toLowerCase());
    if (!isUUID) { showNotif("⚠️ User ini tidak punya akun Supabase Auth — password tidak bisa diubah"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/manage-user", {
        method: "POST",
        headers: await _apiHeaders(),
        body: JSON.stringify({ action: "reset-password", userId: target.id, password: p, callerRole: currentUser?.role || "" }),
      });
      const result = await res.json();
      if (!res.ok || result.error) { showNotif("❌ Gagal ubah password: " + (result.error || res.status)); return; }
      addAgentLog("PWD_CHANGED", `Password ${target.name} diubah oleh Owner`, "SUCCESS");
      showNotif("✅ Password " + target.name + " berhasil diubah");
      onClose();
    } catch (err) {
      showNotif("❌ Gagal ubah password: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000d", zIndex: 500,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: cs.surface, border: "1px solid " + cs.border,
        borderRadius: 16, width: "100%", maxWidth: 380, padding: 24,
      }} onClick={e => e.stopPropagation()}>

        <div style={{ fontWeight: 800, fontSize: 15, color: cs.text, marginBottom: 4 }}>🔑 Ganti Password</div>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 20 }}>
          Akun: <strong style={{ color: cs.accent }}>{target.name}</strong>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Password Baru</div>
            <input type="password" value={form.newPwd} onChange={e => setForm(f => ({ ...f, newPwd: e.target.value }))}
              placeholder="Minimal 8 karakter" autoFocus style={inp} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Konfirmasi Password</div>
            <input type="password" value={form.confirmPwd} onChange={e => setForm(f => ({ ...f, confirmPwd: e.target.value }))}
              placeholder="Ulangi password baru"
              style={{ ...inp, border: "1px solid " + (mismatch ? cs.red : cs.border) }}
              onKeyDown={e => e.key === "Enter" && handleSave()} />
          </div>
          {mismatch && <div style={{ fontSize: 11, color: cs.red }}>⚠️ Password tidak cocok</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 4 }}>
            <button onClick={onClose}
              style={{ padding: "10px", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, color: cs.text, cursor: "pointer", fontWeight: 600 }}>
              Batal
            </button>
            <button onClick={handleSave} disabled={saving || !!mismatch}
              style={{
                padding: "10px", background: saving ? cs.border : "linear-gradient(135deg,#f59e0b,#f97316)",
                border: "none", borderRadius: 10, color: saving ? cs.muted : "#fff",
                cursor: saving || mismatch ? "not-allowed" : "pointer", fontWeight: 700,
                opacity: mismatch ? 0.5 : 1,
              }}>
              {saving ? "Menyimpan..." : "💾 Simpan Password"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
