import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";
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

const isUUID = (id) => id && /^[0-9a-f-]{36}$/.test(String(id).toLowerCase());

export default function TeknisiFormModal({
  open, onClose,
  editTeknisi,
  newTeknisiForm, setNewTeknisiForm,
  teknisiData, setTeknisiData,
  setUserAccounts,
  currentUser,
  showNotif, showConfirm, addAgentLog,
  _apiHeaders,
}) {
  const isEdit = !!editTeknisi;
  const isOwner = currentUser?.role === "Owner";

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaving(false);
  }, [open]);

  if (!open) return null;

  const set = (key, val) => {
    setNewTeknisiForm(f => ({ ...f, [key]: val }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: "" }));
  };

  const autoPass = newTeknisiForm.role === "Helper" ? "helper123" : "teknisi123";

  const validate = () => {
    const e = {};
    if (!newTeknisiForm.name?.trim()) e.name = "Nama wajib diisi";
    if (!newTeknisiForm.phone?.trim()) e.phone = "Nomor WA wajib diisi";
    if (!isEdit && !newTeknisiForm.email?.trim()) e.email = "Email login wajib diisi";
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      if (isEdit) {
        const pinVal = (newTeknisiForm.commission_pin || "").trim() || null;
        const upd = {
          name: newTeknisiForm.name.trim(),
          phone: newTeknisiForm.phone.trim(),
          role: newTeknisiForm.role,
          skills: newTeknisiForm.skills || [],
          commission_pin: pinVal,
        };
        const bankUpd = isOwner ? {
          bank_name: (newTeknisiForm.bank_name || "").trim() || null,
          bank_account_no: (newTeknisiForm.bank_account_no || "").trim() || null,
          bank_holder: (newTeknisiForm.bank_holder || "").trim() || null,
          work_start_date: newTeknisiForm.work_start_date || null,
        } : {};
        Object.assign(upd, bankUpd);

        if (isUUID(editTeknisi.id)) {
          const res = await fetch("/api/manage-user", {
            method: "POST", headers: await _apiHeaders(),
            body: JSON.stringify({ action: "update", userId: editTeknisi.id, name: upd.name, role: upd.role, phone: upd.phone, commission_pin: pinVal, ...bankUpd, callerRole: currentUser?.role }),
          });
          const result = await res.json();
          if (!result.ok) { showNotif("⚠️ " + (result.error || "Update gagal")); return; }
        } else {
          await supabase.from("user_profiles").update(upd).eq("id", editTeknisi.id);
        }
        setTeknisiData(prev => prev.map(t => t.id === editTeknisi.id ? { ...t, ...upd } : t));
        addAgentLog("TEKNISI_UPDATED", "Data " + upd.name + " diupdate", "SUCCESS");
        showNotif("✅ " + upd.name + " berhasil diupdate");
      } else {
        const res = await fetch("/api/manage-user", {
          method: "POST", headers: await _apiHeaders(),
          body: JSON.stringify({ action: "create", email: newTeknisiForm.email.trim(), password: autoPass, name: newTeknisiForm.name.trim(), role: newTeknisiForm.role, phone: newTeknisiForm.phone.trim(), callerRole: currentUser?.role }),
        });
        const result = await res.json();
        if (!result.ok) { showNotif("❌ " + (result.error || "Gagal buat akun")); return; }
        const uid = result.user?.id;
        const colorMap = { Teknisi: "#22c55e", Helper: "#a78bfa", Supervisor: "#38bdf8" };
        const newTek = { id: uid, name: newTeknisiForm.name.trim(), role: newTeknisiForm.role, phone: newTeknisiForm.phone.trim(), email: newTeknisiForm.email.trim(), skills: [], jobs_today: 0, status: "active", active: true, color: colorMap[newTeknisiForm.role] || "#22c55e", avatar: newTeknisiForm.name.charAt(0).toUpperCase() };
        setTeknisiData(prev => [...prev, newTek]);
        setUserAccounts(prev => prev.find(u => u.id === uid) ? prev : [...prev, { ...newTek, lastLogin: "Belum login" }]);
        addAgentLog("TEKNISI_ADDED", "Anggota baru: " + newTeknisiForm.name + " (" + newTeknisiForm.role + ") + akun login", "SUCCESS");
        showNotif("✅ " + newTeknisiForm.name + " ditambahkan — password: " + autoPass);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!await showConfirm({
      icon: "🗑️", title: "Hapus dari Tim & Database?", danger: true,
      message: `Hapus ${editTeknisi.name} dari tim dan database?\n\nPerhatian: Tindakan ini tidak bisa dibatalkan.\nOrder yang sudah ada tidak terpengaruh.`,
      confirmText: "Hapus Permanen",
    })) return;
    if (isUUID(editTeknisi.id)) {
      const res = await fetch("/api/manage-user", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({ action: "delete", userId: editTeknisi.id, callerRole: currentUser?.role }),
      });
      const result = await res.json();
      if (!result.ok) { showNotif("⚠️ " + (result.error || "Hapus gagal")); return; }
    } else {
      await supabase.from("user_profiles").delete().eq("id", editTeknisi.id);
    }
    setTeknisiData(prev => prev.filter(t => t.id !== editTeknisi.id));
    setUserAccounts(prev => prev.filter(u => u.id !== editTeknisi.id));
    addAgentLog("TEKNISI_DELETED", "Anggota " + editTeknisi.name + " dihapus dari tim", "WARNING");
    showNotif("✅ " + editTeknisi.name + " berhasil dihapus dari tim & database");
    onClose();
  };

  const handleToggleActive = async (activate) => {
    if (isUUID(editTeknisi.id)) {
      const res = await fetch("/api/manage-user", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({ action: "toggle-active", userId: editTeknisi.id, active: activate, callerRole: currentUser?.role }),
      });
      const result = await res.json();
      if (!result.ok) { showNotif("⚠️ " + (result.error || "Gagal ubah status")); return; }
    } else {
      await supabase.from("user_profiles").update({ active: activate, status: activate ? "active" : "standby" }).eq("id", editTeknisi.id);
    }
    setTeknisiData(prev => prev.map(t => t.id === editTeknisi.id ? { ...t, status: activate ? "active" : "standby", active: activate } : t));
    showNotif(editTeknisi.name + (activate ? " diaktifkan kembali ✅" : " dinonaktifkan (standby). Data tetap tersimpan."));
    onClose();
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 440, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ padding: "16px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid " + cs.border + "55", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>
              {isEdit ? `✏️ Edit Anggota — ${editTeknisi.name}` : "👷 Tambah Anggota Tim"}
            </div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
              {isEdit
                ? "Perubahan data langsung tersinkronisasi ke semua jadwal"
                : "Akun login otomatis dibuat dengan password default"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}>×</button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Card 1 — Data Diri */}
          <div style={card}>
            <div style={secTitle}>Data Diri</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={lbl}>Nama Lengkap <span style={{ color: cs.red }}>*</span></label>
                <input
                  value={newTeknisiForm.name || ""}
                  onChange={e => set("name", e.target.value)}
                  placeholder="Nama anggota tim"
                  style={inp(errors.name)}
                />
                {errors.name && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.name}</div>}
              </div>
              <div>
                <label style={lbl}>Nomor WA <span style={{ color: cs.red }}>*</span></label>
                <input
                  value={newTeknisiForm.phone || ""}
                  onChange={e => set("phone", e.target.value)}
                  placeholder="628xxx"
                  style={inp(errors.phone)}
                />
                {errors.phone && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.phone}</div>}
              </div>
              <div>
                <label style={lbl}>Role</label>
                <select
                  value={newTeknisiForm.role || "Teknisi"}
                  onChange={e => set("role", e.target.value)}
                  style={inp(false)}
                >
                  {["Teknisi", "Helper", "Supervisor"].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Card 2 — Akun Login (tambah mode only) */}
          {!isEdit && (
            <div style={card}>
              <div style={secTitle}>Akun Login</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={lbl}>Email Login <span style={{ color: cs.red }}>*</span></label>
                  <input
                    type="email"
                    value={newTeknisiForm.email || ""}
                    onChange={e => set("email", e.target.value)}
                    placeholder="contoh: ari@aclean.id"
                    style={inp(errors.email)}
                  />
                  {errors.email && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.email}</div>}
                </div>
                <div style={{ background: cs.accent + "10", border: "1px solid " + cs.accent + "33", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: cs.muted }}>
                  🔑 Password otomatis: <b style={{ color: cs.accent }}>{autoPass}</b> — langsung aktif tanpa konfirmasi email
                </div>
              </div>
            </div>
          )}

          {/* Card 3 — Rekening Payroll (Owner + edit only) */}
          {isEdit && isOwner && (
            <div style={card}>
              <div style={secTitle}>Rekening Payroll</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                  <div>
                    <label style={lbl}>Bank</label>
                    <input
                      list="tek-bank-options"
                      placeholder="BCA"
                      value={newTeknisiForm.bank_name || ""}
                      onChange={e => set("bank_name", e.target.value)}
                      style={inp(false)}
                    />
                    <datalist id="tek-bank-options">
                      {["BCA", "DANA", "Mandiri", "BRI", "BNI", "OVO", "GoPay"].map(b => <option key={b} value={b} />)}
                    </datalist>
                  </div>
                  <div>
                    <label style={lbl}>No. Rekening / e-wallet</label>
                    <input
                      inputMode="numeric"
                      placeholder="6044307591"
                      value={newTeknisiForm.bank_account_no || ""}
                      onChange={e => set("bank_account_no", e.target.value.replace(/[^0-9]/g, ""))}
                      style={{ ...inp(false), fontVariantNumeric: "tabular-nums" }}
                    />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Atas Nama</label>
                  <input
                    placeholder="Nama pemilik rekening"
                    value={newTeknisiForm.bank_holder || ""}
                    onChange={e => set("bank_holder", e.target.value)}
                    style={inp(false)}
                  />
                </div>
                <div>
                  <label style={lbl}>Tanggal Mulai Kerja</label>
                  <input
                    type="date"
                    value={newTeknisiForm.work_start_date || ""}
                    onChange={e => set("work_start_date", e.target.value)}
                    style={inp(false)}
                  />
                </div>
                <div>
                  <label style={lbl}>🔐 Commission PIN <span style={{ fontSize: 10, fontWeight: 400 }}>(opsional, 4–6 digit)</span></label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="4–6 digit atau kosongkan untuk hapus"
                      maxLength={6}
                      value={newTeknisiForm.commission_pin || ""}
                      onChange={e => set("commission_pin", e.target.value.replace(/[^0-9]/g, ""))}
                      style={{ ...inp(false), flex: 1 }}
                    />
                    <button
                      onClick={() => set("commission_pin", "")}
                      style={{ padding: "8px 10px", borderRadius: 8, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 12, flexShrink: 0 }}
                    >🗑</button>
                  </div>
                  <div style={{ fontSize: 10, color: cs.muted, marginTop: 3, fontStyle: "italic" }}>
                    Diperlukan untuk mengakses menu Komisi Saya
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Card 4 — Zona Bahaya (Owner + edit only) */}
          {isEdit && isOwner && (
            <div style={{ background: cs.red + "08", border: "1px solid " + cs.red + "33", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ ...secTitle, color: cs.red + "aa" }}>Zona Bahaya</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {editTeknisi?.status === "standby" ? (
                  <button
                    onClick={() => handleToggleActive(true)}
                    style={{ background: cs.green + "18", border: "1px solid " + cs.green + "44", color: cs.green, padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, textAlign: "left" }}
                  >
                    ▶ Aktifkan Kembali
                    <div style={{ fontSize: 10, fontWeight: 400, color: cs.muted, marginTop: 2 }}>Anggota dapat menerima jadwal baru</div>
                  </button>
                ) : (
                  <button
                    onClick={() => handleToggleActive(false)}
                    style={{ background: cs.yellow + "18", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, textAlign: "left" }}
                  >
                    ⏸ Nonaktifkan (Standby)
                    <div style={{ fontSize: 10, fontWeight: 400, color: cs.muted, marginTop: 2 }}>Data & riwayat tetap tersimpan</div>
                  </button>
                )}
                <button
                  onClick={handleDelete}
                  style={{ background: cs.red + "18", border: "1px solid " + cs.red + "44", color: cs.red, padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, textAlign: "left" }}
                >
                  🗑️ Hapus dari Tim & Database
                  <div style={{ fontSize: 10, fontWeight: 400, color: cs.muted, marginTop: 2 }}>Permanen — tidak bisa dibatalkan</div>
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
            style={{ flex: 2, background: saving ? cs.green + "88" : "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: saving ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 13, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Menyimpan..." : (isEdit ? "✓ Simpan Perubahan" : "✓ Tambah Anggota")}
          </button>
        </div>
      </div>
    </div>
  );
}
