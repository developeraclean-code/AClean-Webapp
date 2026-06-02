import { useState, useEffect } from "react";
import { cs } from "../theme/cs.js";

// Banner absen mandiri untuk Teknisi & Helper di Dashboard.
// Teknisi pilih status: MASUK, IJIN, atau SAKIT.
// Menulis record ke technician_availability (onConflict date,teknisi).
// IJIN/SAKIT → is_available=false → hilang dari pool tim di Planning Order.
// MASUK → is_available=true.
// Tampil sepanjang hari Senin–Sabtu (tanpa cutoff jam).
export default function AbsenBanner({ currentUser, supabase, TODAY, showNotif, apiHeaders }) {
  const role = currentUser?.role;
  const name = currentUser?.name;
  const isField = role === "Teknisi" || role === "Helper";

  // Hanya Senin–Sabtu
  const nowWIB = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  const isWeekday = nowWIB.getDay() >= 1 && nowWIB.getDay() <= 6;

  const [rec, setRec] = useState(null);         // { status, reason } bila sudah absen
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // "MASUK" | "IJIN" | "SAKIT" | null
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isField || !name || !isWeekday) { setLoading(false); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase.from("technician_availability")
        .select("status,reason,is_available")
        .eq("date", TODAY).eq("teknisi", name).maybeSingle();
      if (alive) {
        // status NULL + hadir = Masuk (sesuai desain: NULL = auto/hadir)
        let display = null;
        if (data) {
          if (data.status) display = data;                          // IJIN/SAKIT/STANDBY/ALPA
          else if (data.is_available) display = { ...data, status: "MASUK" };
        }
        setRec(display);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [name, TODAY, isField, isWeekday, supabase]);

  if (!isField || !isWeekday || loading) return null;

  async function submit(status) {
    if ((status === "IJIN" || status === "SAKIT") && !reason.trim()) {
      showNotif?.("Alasan wajib diisi untuk " + status); return;
    }
    setSaving(true);
    const is_available = status === "MASUK";
    // MASUK disimpan sebagai status NULL (desain: NULL = hadir/auto). Constraint DB
    // techavail_status_chk hanya izinkan NULL/STANDBY/IJIN/SAKIT/ALPA — "MASUK" ditolak.
    const dbStatus = status === "MASUK" ? null : status;
    const { error } = await supabase.from("technician_availability").upsert(
      { date: TODAY, teknisi: name, status: dbStatus, reason: (status === "MASUK") ? null : reason.trim(), is_available, updated_at: new Date().toISOString() },
      { onConflict: "date,teknisi" }
    );
    setSaving(false);
    if (error) { showNotif?.("Gagal menyimpan: " + error.message); return; }
    const reasonText = (status === "MASUK") ? "" : reason.trim();
    setRec({ status, reason: reasonText || null, is_available });
    setEditing(null); setReason("");
    const label = { MASUK: "✅ Absen tercatat: Masuk", IJIN: "✅ Absen tercatat: Ijin", SAKIT: "✅ Absen tercatat: Sakit" };
    showNotif?.(label[status] || "✅ Tersimpan");

    // Best-effort: info WA ke Owner saat absen (Ijin/Sakit) — tidak blokir UI
    if (status !== "MASUK" && apiHeaders) {
      try {
        const headers = await apiHeaders();
        fetch("/api/notify-absence", {
          method: "POST",
          headers,
          body: JSON.stringify({ teknisi: name, status, reason: reasonText, role, date: TODAY }),
        }).catch(() => {});
      } catch { /* notifikasi non-kritis — abaikan error */ }
    }
  }

  const META = {
    MASUK: { label: "Masuk",  emoji: "✅", color: "#22c55e" },
    IJIN:  { label: "Ijin",   emoji: "🟡", color: "#f59e0b" },
    SAKIT: { label: "Sakit",  emoji: "🟠", color: "#fb923c" },
  };

  // Sudah absen hari ini → tampilkan status + tombol ubah
  if (rec) {
    const m = META[rec.status] || { label: rec.status, emoji: "🔴", color: "#ef4444" };
    return (
      <div style={{ background: m.color + "18", border: "1px solid " + m.color + "55", borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>{m.emoji}</span>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Hari ini: {m.label}</div>
            {rec.reason && <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Alasan: {rec.reason}</div>}
          </div>
          <button onClick={() => { setEditing(rec.status); setReason(rec.reason || ""); }}
            style={{ background: cs.surface, color: cs.text, border: "1px solid " + cs.border, borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            Ubah Status
          </button>
        </div>
      </div>
    );
  }

  // Form alasan (untuk IJIN / SAKIT)
  if (editing && editing !== "MASUK") {
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

  // Default: pilih status absen
  return (
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 18 }}>📋</span>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Absen Hari Ini</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Pilih status kehadiran kamu hari ini.</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => submit("MASUK")} disabled={saving}
          style={{ background: META.MASUK.color + "22", color: META.MASUK.color, border: "1px solid " + META.MASUK.color + "66", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
          ✅ Masuk
        </button>
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
