import { useState, useEffect } from "react";
import { cs } from "../theme/cs.js";

// Banner absen mandiri untuk Teknisi & Helper di Dashboard.
// Model: default MASUK = tidak perlu aksi (abaikan). Hanya IJIN/SAKIT yang
// menulis record ke technician_availability (onConflict date,teknisi) →
// is_available=false → otomatis hilang dari pool tim di Planning Order.
// "Batalkan" menghapus status (is_available=true) → kembali tercatat MASUK.
export default function AbsenBanner({ currentUser, supabase, TODAY, showNotif }) {
  const role = currentUser?.role;
  const name = currentUser?.name;
  const isField = role === "Teknisi" || role === "Helper";

  // Banner hanya tampil Senin–Sabtu, pagi s/d jam 12:00 WIB (terlepas dari timezone device).
  const CUTOFF_HOUR = 12;
  const nowWIB = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  const inWindow = nowWIB.getDay() >= 1 && nowWIB.getDay() <= 6 && nowWIB.getHours() < CUTOFF_HOUR;

  const [rec, setRec] = useState(null);          // { status, reason } bila sudah lapor ijin/sakit
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);  // "IJIN" | "SAKIT" | null
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isField || !name || !inWindow) { setLoading(false); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase.from("technician_availability")
        .select("status,reason,is_available")
        .eq("date", TODAY).eq("teknisi", name).maybeSingle();
      if (alive) {
        setRec(data && data.status && data.is_available === false ? data : null);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [name, TODAY, isField, inWindow, supabase]);

  if (!isField || !inWindow || loading) return null;

  async function submit(status) {
    if ((status === "IJIN" || status === "SAKIT") && !reason.trim()) {
      showNotif?.("Alasan wajib diisi untuk " + status); return;
    }
    setSaving(true);
    const is_available = !["IJIN", "SAKIT", "ALPA"].includes(status);
    const { error } = await supabase.from("technician_availability").upsert(
      { date: TODAY, teknisi: name, status: status || null, reason: status ? reason.trim() : null, is_available, updated_at: new Date().toISOString() },
      { onConflict: "date,teknisi" }
    );
    setSaving(false);
    if (error) { showNotif?.("Gagal menyimpan: " + error.message); return; }
    setRec(status ? { status, reason: reason.trim(), is_available } : null);
    setEditing(null); setReason("");
    showNotif?.(status ? ("✅ Absen tercatat: " + status) : "✅ Status dibatalkan — Anda tercatat MASUK");
  }

  const META = {
    IJIN:  { label: "Ijin",  emoji: "🟡", color: "#f59e0b" },
    SAKIT: { label: "Sakit", emoji: "🟠", color: "#fb923c" },
  };

  // Sudah lapor ijin/sakit hari ini
  if (rec) {
    const m = META[rec.status] || { label: rec.status, emoji: "🔴", color: "#ef4444" };
    return (
      <div style={{ background: m.color + "18", border: "1px solid " + m.color + "55", borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>{m.emoji}</span>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Hari ini Anda tercatat: {m.label}</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Alasan: {rec.reason || "-"}</div>
          </div>
          <button onClick={() => submit(null)} disabled={saving}
            style={{ background: cs.surface, color: cs.text, border: "1px solid " + cs.border, borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            Batalkan (saya masuk)
          </button>
        </div>
      </div>
    );
  }

  // Form alasan
  if (editing) {
    const m = META[editing];
    return (
      <div style={{ background: m.color + "14", border: "1px solid " + m.color + "44", borderRadius: 14, padding: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: cs.text, marginBottom: 8 }}>{m.emoji} Lapor {m.label} — hari ini</div>
        <textarea value={reason} onChange={e => setReason(e.target.value)} autoFocus
          placeholder={"Tulis alasan " + m.label.toLowerCase() + " (wajib)..."}
          style={{ width: "100%", minHeight: 60, background: cs.surface, color: cs.text, border: "1px solid " + cs.border, borderRadius: 10, padding: 10, fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={() => submit(editing)} disabled={saving}
            style={{ background: m.color, color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
            {saving ? "Menyimpan..." : "Kirim Laporan"}
          </button>
          <button onClick={() => { setEditing(null); setReason(""); }} disabled={saving}
            style={{ background: cs.surface, color: cs.muted, border: "1px solid " + cs.border, borderRadius: 10, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            Batal
          </button>
        </div>
      </div>
    );
  }

  // Default: tawarkan lapor berhalangan
  return (
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 18 }}>📋</span>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Absen Hari Ini</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Masuk normal? Tidak perlu aksi. Berhalangan? Lapor di sini.</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => { setEditing("IJIN"); setReason(""); }}
          style={{ background: META.IJIN.color + "22", color: META.IJIN.color, border: "1px solid " + META.IJIN.color + "66", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
          🟡 Ijin
        </button>
        <button onClick={() => { setEditing("SAKIT"); setReason(""); }}
          style={{ background: META.SAKIT.color + "22", color: META.SAKIT.color, border: "1px solid " + META.SAKIT.color + "66", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
          🟠 Sakit
        </button>
      </div>
    </div>
  );
}
