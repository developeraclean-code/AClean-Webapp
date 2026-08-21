// Riwayat pekerjaan pribadi teknisi/helper — daftar job yang SUDAH dikerjakan
// (status selesai) milik user login. Dipakai dari 2 tempat: dashboard mobile
// (TechMobileView) & menu Jadwal (ScheduleView). Sumber data = ordersData yang
// sudah ada di device (fetchOrders 500 terbaru; RLS → hanya job miliknya), jadi
// tanpa fetch tambahan. Match nama di 6 slot (teknisi/helper 1-3), sama seperti
// filter dashboard, supaya helper pun kebagian riwayatnya.
import { useMemo, useState } from "react";
import { cs } from "../theme/cs.js";

// Status yang dihitung "sudah dikerjakan".
const DONE_SET = new Set(["COMPLETED", "PAID", "REPORT_SUBMITTED", "INVOICE_APPROVED", "INVOICE_PENDING", "DONE", "VERIFIED"]);
const STATUS_META = {
  COMPLETED:        { label: "Selesai",          color: "#10b981" },
  DONE:             { label: "Selesai",          color: "#10b981" },
  VERIFIED:         { label: "Terverifikasi",    color: "#10b981" },
  PAID:             { label: "Lunas",            color: "#22c55e" },
  REPORT_SUBMITTED: { label: "Laporan terkirim", color: "#60a5fa" },
  INVOICE_PENDING:  { label: "Menunggu invoice", color: "#a78bfa" },
  INVOICE_APPROVED: { label: "Invoice disetujui", color: "#a78bfa" },
};

const fmtTanggal = (d) => {
  if (!d) return "-";
  try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }
  catch { return d; }
};
const monthKey = (d) => (d || "").slice(0, 7); // YYYY-MM

export default function MyJobHistoryModal({ currentUser, ordersData, onClose, onOpenReport }) {
  const myName = (currentUser?.name || "").toLowerCase();
  const [q, setQ] = useState("");

  const mine = useMemo(() => {
    return (ordersData || [])
      .filter(o => {
        if (!DONE_SET.has(o.status)) return false;
        return [o.teknisi, o.helper, o.teknisi2, o.helper2, o.teknisi3, o.helper3]
          .some(n => (n || "").toLowerCase() === myName);
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.time || "").localeCompare(a.time || ""));
  }, [ordersData, myName]);

  const thisMonth = monthKey(new Date().toISOString().slice(0, 10));
  const countThisMonth = mine.filter(o => monthKey(o.date) === thisMonth).length;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return mine;
    return mine.filter(o => `${o.customer || ""} ${o.service || ""} ${o.address || ""} ${o.date || ""}`.toLowerCase().includes(s));
  }, [mine, q]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 1000, display: "flex", flexDirection: "column" }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: cs.bg || cs.surface, marginTop: "auto", borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "92vh", display: "flex", flexDirection: "column", borderTop: "1px solid " + cs.border }}>

        {/* Header */}
        <div style={{ padding: "16px 18px 10px", borderBottom: "1px solid " + cs.border }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>📜 Riwayat Pekerjaan Saya</div>
            <button onClick={onClose} style={{ background: "transparent", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <div style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: cs.green }}>{mine.length}</div>
              <div style={{ fontSize: 10, color: cs.muted }}>Total selesai</div>
            </div>
            <div style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: cs.accent }}>{countThisMonth}</div>
              <div style={{ fontSize: 10, color: cs.muted }}>Bulan ini</div>
            </div>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cari customer / layanan / alamat…"
            style={{ width: "100%", marginTop: 10, background: cs.card, border: "1px solid " + cs.border, borderRadius: 9, padding: "9px 11px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
        </div>

        {/* List */}
        <div style={{ padding: "12px 16px 20px", overflowY: "auto", display: "grid", gap: 10 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: cs.muted }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>🗂️</div>
              <div style={{ fontSize: 13 }}>{mine.length === 0 ? "Belum ada pekerjaan selesai" : `Tidak ada hasil untuk "${q}"`}</div>
            </div>
          ) : filtered.map(o => {
            const meta = STATUS_META[o.status] || { label: o.status, color: cs.muted };
            const helperNote = [o.helper, o.helper2, o.helper3].filter(Boolean).join(", ");
            return (
              <div key={o.id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: cs.accent, fontWeight: 700 }}>{fmtTanggal(o.date)}{o.time ? ` · ${o.time}` : ""}</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: cs.text, marginTop: 2, wordBreak: "break-word" }}>{o.customer}</div>
                    <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>🔧 {o.service}{o.units ? ` · ${o.units} unit` : ""}</div>
                    {o.address && <div style={{ fontSize: 11, color: cs.muted, marginTop: 3, wordBreak: "break-word" }}>📍 {o.address}</div>}
                    {helperNote && <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>🤝 {helperNote}</div>}
                  </div>
                  <span style={{ fontSize: 10, padding: "3px 9px", borderRadius: 99, fontWeight: 700, background: meta.color + "22", color: meta.color, whiteSpace: "nowrap" }}>
                    {meta.label}
                  </span>
                </div>
                {onOpenReport && (
                  <button onClick={() => onOpenReport(o)}
                    style={{ marginTop: 10, width: "100%", background: cs.surface, border: "1px solid " + cs.border, color: cs.accent, borderRadius: 9, padding: "8px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                    📄 Lihat Laporan
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
