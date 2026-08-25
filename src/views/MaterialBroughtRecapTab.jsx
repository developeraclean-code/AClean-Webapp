import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { shiftDateStr, getLocalDate } from "../lib/dateTime.js";

// Rekap Material Dibawa (job_materials_brought) — lintas job, untuk Owner/Admin.
//
// Sebelum ini material yang di-link dari tab "Pending AI Material" hanya bisa
// dilihat satu per satu lewat modal "Material Dibawa" di dalam job masing-masing,
// jadi terasa hilang begitu di-link. Tab ini kumpulan semuanya.
//
// PENTING soal status RETURNED: cron taskAutoReturnBrought menandai baris yang
// masih BROUGHT lebih dari 24 jam menjadi RETURNED ("auto-returned"). Jadi baris
// yang tidak pernah masuk laporan teknisi akan berpindah status sendiri — bukan
// terhapus. Karena itu tab ini menampilkan SEMUA status secara bawaan.

const STATUS_META = {
  BROUGHT:  { label: "Dibawa",       warna: "#38bdf8" },
  USED:     { label: "Terpakai",     warna: "#22c55e" },
  RETURNED: { label: "Dikembalikan", warna: "#a78bfa" },
  CANCELLED:{ label: "Dibatalkan",   warna: "#ef4444" },
};

const ikon = (t) => {
  const s = String(t || "").toLowerCase();
  if (s === "freon") return "🛢";
  if (s === "pipa") return "🔧";
  if (s === "kabel") return "⚡";
  return "📦";
};

function MaterialBroughtRecapTab({ supabase, showNotif }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hari, setHari] = useState(30);
  const [filterStatus, setFilterStatus] = useState("SEMUA");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dari = shiftDateStr(getLocalDate(), -Number(hari)) + "T00:00:00Z";
      const { data, error } = await supabase.from("job_materials_brought")
        .select("id,job_id,material_type,inventory_name,unit_label,qty_estimate,brought_by,brought_at,status,notes,orders:job_id(customer,date,teknisi,helper)")
        .gte("brought_at", dari)
        .order("brought_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows(data || []);
    } catch (e) { showNotif?.("Gagal muat rekap: " + (e?.message || e)); }
    finally { setLoading(false); }
  }, [supabase, hari, showNotif]);
  useEffect(() => { load(); }, [load]);

  const terpakai = filterStatus === "SEMUA" ? rows : rows.filter((r) => r.status === filterStatus);

  // Kelompokkan per tanggal dibawa, lalu per job.
  const perTanggal = {};
  for (const r of terpakai) {
    const tgl = String(r.brought_at || "").slice(0, 10);
    (perTanggal[tgl] = perTanggal[tgl] || []).push(r);
  }
  const tanggalUrut = Object.keys(perTanggal).sort((a, b) => b.localeCompare(a));

  const hitung = (st) => rows.filter((r) => r.status === st).length;
  const chip = (id, teks, jml, warna) => (
    <button key={id} onClick={() => setFilterStatus(id)}
      style={{ padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
        border: "1px solid " + (filterStatus === id ? warna : cs.border),
        background: filterStatus === id ? warna + "22" : "transparent",
        color: filterStatus === id ? warna : cs.muted }}>
      {teks} ({jml})
    </button>
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ background: cs.accent + "14", border: "1px solid " + cs.accent + "44", borderRadius: 10, padding: 12, fontSize: 12.5, color: cs.text }}>
        📥 Semua material yang tercatat <b>dibawa ke job</b> — baik dari tab Pending AI Material,
        maupun yang diinput teknisi lewat tombol &quot;Bawa Material&quot; di job.
        Status <b>Dikembalikan</b> bisa muncul otomatis: baris yang lebih dari 24 jam belum masuk
        laporan teknisi ditandai kembali oleh sistem — datanya tidak hilang, hanya berpindah status.
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {chip("SEMUA", "Semua", rows.length, cs.accent)}
          {Object.entries(STATUS_META).map(([k, m]) => chip(k, m.label, hitung(k), m.warna))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: cs.muted }}>
            Rentang
            <select value={hari} onChange={(e) => setHari(Number(e.target.value))}
              style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "5px 8px", color: cs.text, fontSize: 12, cursor: "pointer" }}>
              <option value={7}>7 hari</option>
              <option value={30}>30 hari</option>
              <option value={90}>90 hari</option>
            </select>
          </label>
          <button onClick={load} disabled={loading}
            style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
            {loading ? "…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {loading ? <div style={{ color: cs.muted, fontSize: 13, padding: 16 }}>Memuat…</div>
        : terpakai.length === 0 ? (
          <div style={{ padding: 24, background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, textAlign: "center", color: cs.muted, fontSize: 13 }}>
            Belum ada material dibawa pada rentang & status ini.
          </div>
        ) : tanggalUrut.map((tgl) => (
          <div key={tgl} style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: cs.muted }}>{tgl} · {perTanggal[tgl].length} baris</div>
            {perTanggal[tgl].map((r) => {
              const m = STATUS_META[r.status] || { label: r.status, warna: cs.muted };
              const dariAI = String(r.notes || "").includes("AI vision approved");
              return (
                <div key={r.id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: 12, display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>
                      {ikon(r.material_type)} {r.inventory_name || r.unit_label || r.material_type}
                      <span style={{ color: cs.accent, marginLeft: 6 }}>{r.qty_estimate}</span>
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: m.warna, background: m.warna + "22", padding: "2px 9px", borderRadius: 999 }}>{m.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: cs.muted }}>
                    📋 {r.orders?.customer || r.job_id}
                    {r.orders?.date ? " · job " + r.orders.date : ""}
                    {" · dibawa "}<b style={{ color: cs.text }}>{r.brought_by || "?"}</b>
                    {dariAI && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: cs.accent }}>🤖 dari foto WA</span>}
                  </div>
                  {String(r.notes || "").includes("auto-returned") && (
                    <div style={{ fontSize: 11.5, color: cs.yellow }}>
                      ⚠️ Ditandai kembali otomatis — belum pernah masuk laporan teknisi dalam 24 jam.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}

export default MaterialBroughtRecapTab;
