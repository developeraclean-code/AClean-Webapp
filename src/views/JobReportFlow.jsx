import { useEffect, useState } from "react";
import { cs } from "../theme/cs.js";
import { hasFieldReportDraft } from "../lib/fieldReportWorkflow.js";

// JobReportFlow — SATU PINTU laporan & material per job (Fase 2 rencana satu-pintu).
// Bukan modal berat baru: ini hub ringan yang menampilkan langkah + status, lalu membuka
// komponen existing (MaterialBringModal & LaporanTeknisiModal) lewat callback. Reuse penuh.
//
// Langkah:
//   1. Material dibawa  -> onOpenBring(job)      (job_materials_brought)
//   2. Laporan pekerjaan-> onOpenLaporan(job)    (service_reports)
//   3. Sisa = dibawa - terpakai (ringkasan, direkonsiliasi di Material Harian)
//
// Props:
// - open, onClose
// - job: order row { id, customer, date, status, units }
// - currentUser
// - supabase
// - materialsBroughtMap: { [orderId]: count }
// - laporanReports: list service_reports (untuk deteksi sudah ada laporan)
// - onOpenBring: (job) => void
// - onOpenLaporan: (job) => void
export default function JobReportFlow({
  open, onClose, job, currentUser, supabase, materialsBroughtMap, laporanReports, onOpenBring, onOpenLaporan,
}) {
  const [usage, setUsage] = useState(null); // { broughtUnits, usedQty } ringkas
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // Hitung ringkasan material dibawa vs terpakai (untuk tampilan sisa)
  useEffect(() => {
    if (!open || !job?.id) return;
    let cancelled = false;
    setUsage(null);
    setUsageError("");
    setUsageLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.from("job_materials_brought")
          .select("material_type, qty_estimate, status")
          .eq("job_id", job.id)
          .neq("status", "CANCELLED");
        if (error) throw error;
        if (cancelled) return;
        const rows = data || [];
        setUsage({
          broughtUnits: rows.length,
          broughtQty: rows.reduce((s, r) => s + (Number(r.qty_estimate) || 0), 0),
        });
      } catch (_) {
        if (!cancelled) { setUsage(null); setUsageError("Status material gagal dimuat"); }
      } finally {
        if (!cancelled) setUsageLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, job?.id, supabase, reloadKey]);

  if (!open || !job) return null;

  const broughtCount = (materialsBroughtMap || {})[job.id] || (usage?.broughtUnits ?? 0);
  const hasLaporan = (laporanReports || []).some(r =>
    (r.order_id === job.id || r.job_id === job.id) && r.status && !["PENDING", "REJECTED"].includes(r.status)
  );
  const hasDraft = !hasLaporan && hasFieldReportDraft(job.id);

  const steps = [
    {
      key: "bawa",
      icon: "📦",
      title: "Material dibawa",
      desc: usageLoading ? "Memuat status material…" : usageError ? usageError : broughtCount > 0 ? `${broughtCount} unit dipilih dari stok kantor` : "Opsional — lewati bila tidak membawa material",
      done: broughtCount > 0,
      action: "Atur Material",
      onClick: () => { onClose?.(); onOpenBring?.(job); },
    },
    {
      key: "laporan",
      icon: "📝",
      title: "Laporan pekerjaan",
      desc: hasLaporan ? "Laporan sudah dibuat" : hasDraft ? "Draft di perangkat siap dilanjutkan" : "Isi hasil pekerjaan + material terpakai + foto",
      done: hasLaporan,
      action: hasLaporan ? "Buka Laporan" : hasDraft ? "Lanjutkan Draft" : "Isi Laporan",
      onClick: () => { onClose?.(); onOpenLaporan?.(job); },
    },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 16, maxWidth: 460, width: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}>
        {/* Header */}
        <div style={{ padding: "16px 18px", borderBottom: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: cs.text }}>📝 Laporan & Material</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>{job.id} · {job.customer}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer", padding: 2, lineHeight: 1 }}>×</button>
        </div>

        {/* Steps */}
        <div style={{ padding: 16, display: "grid", gap: 12, overflowY: "auto" }}>
          {steps.map((s, i) => (
            <div key={s.key} style={{ border: "1px solid " + (s.done ? cs.green + "55" : cs.border), background: s.done ? cs.green + "0d" : cs.card, borderRadius: 12, padding: "13px 14px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, background: s.done ? cs.green + "22" : cs.surface, border: "1px solid " + (s.done ? cs.green + "55" : cs.border) }}>
                {s.done ? "✅" : s.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{i + 1}. {s.title}</div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{s.desc}</div>
              </div>
              <button onClick={s.onClick} style={{ flexShrink: 0, background: cs.accent + "22", border: "1px solid " + cs.accent + "55", color: cs.accent, borderRadius: 9, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {s.action} →
              </button>
            </div>
          ))}

          {usageError && (
            <button onClick={() => setReloadKey(v => v + 1)} style={{ background: "#f59e0b18", border: "1px solid #f59e0b55", color: "#f59e0b", borderRadius: 9, padding: "8px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              ↻ Muat ulang status material
            </button>
          )}

          {/* Sisa info — direkonsiliasi di Material Harian (read-only di sini) */}
          <div style={{ fontSize: 11, color: cs.muted, background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 12px", lineHeight: 1.5 }}>
            ℹ️ <b>Sisa material</b> (dibawa − terpakai) dihitung otomatis dari laporan & dicocokkan
            Owner/Admin di menu <b>Material Harian</b>. Tidak perlu input sisa manual di sini.
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid " + cs.border, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid " + cs.border, color: cs.muted, borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Tutup</button>
        </div>
      </div>
    </div>
  );
}
