// Modal tren pengukuran satu unit AC — ampere & tekanan freon (psi) dari riwayat
// maintenance_logs (measurements terstruktur + fallback parse log lama).
// Kaidah dataviz: ampere vs psi BEDA SKALA → dua chart terpisah satu-sumbu
// (bukan dual-axis), satu seri per chart (tanpa legend, judul = nama seri),
// garis 2px, marker ≥8px, grid recessive, teks pakai warna ink (bukan warna seri).
import { cs } from "../theme/cs.js";
import { unitMeasurementSeries } from "../lib/maintenanceHealth.js";

const fmtD = (d) => {
  if (!d) return "";
  const [y, m, dd] = String(d).slice(0, 10).split("-");
  return `${dd}/${m}/${String(y).slice(2)}`;
};

// Satu mini line-chart SVG: satu seri, satu sumbu-y. points = [{date, v}] ASC.
function MiniLine({ title, unit, points, color, freonDates }) {
  const W = 480, H = 150, PAD_L = 44, PAD_R = 16, PAD_T = 14, PAD_B = 26;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;

  if (points.length === 0) {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 4 }}>{title}</div>
        <div style={{ color: cs.muted, fontSize: 12, padding: "14px 0" }}>Belum ada data pengukuran — mulai terekam saat teknisi mengisi kolom ini di laporan.</div>
      </div>
    );
  }

  // Skala waktu (jujur terhadap jarak antar servis) + skala nilai dgn head-room.
  // Domain waktu MENCAKUP tanggal event freon — tanpa ini, marker freon di luar
  // rentang titik ukur terpotong dan hitungan di caption tak cocok dgn yang tampak.
  const ts = points.map(p => new Date(p.date + "T00:00:00").getTime());
  const fts = (freonDates || []).map(fd => new Date(fd + "T00:00:00").getTime()).filter(t => !isNaN(t));
  const t0 = Math.min(...ts, ...fts), t1 = Math.max(...ts, ...fts);
  const vMin0 = Math.min(...points.map(p => p.v)), vMax0 = Math.max(...points.map(p => p.v));
  const span = (vMax0 - vMin0) || Math.abs(vMax0) * 0.2 || 1;
  const vMin = Math.max(0, vMin0 - span * 0.15), vMax = vMax0 + span * 0.15;
  const x = (t) => t1 === t0 ? PAD_L + plotW / 2 : PAD_L + ((t - t0) / (t1 - t0)) * plotW;
  const y = (v) => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * plotH;

  const xy = points.map((p, i) => ({ ...p, cx: x(ts[i]), cy: y(p.v) }));
  const path = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(" ");
  const gridVals = [vMin + (vMax - vMin) * 0.25, vMin + (vMax - vMin) * 0.75];
  const last = xy[xy.length - 1];

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 2 }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={title}>
        {/* grid recessive + label nilai (ink muted, bukan warna seri) */}
        {gridVals.map((gv, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(gv)} y2={y(gv)} stroke={cs.border} strokeWidth="1" opacity="0.5" />
            <text x={PAD_L - 6} y={y(gv) + 3} textAnchor="end" fontSize="9" fill={cs.muted}>{gv >= 100 ? Math.round(gv) : gv.toFixed(1)}</text>
          </g>
        ))}
        {/* penanda tambah freon (event, bukan seri) */}
        {(freonDates || []).map((fd, i) => {
          const ft = new Date(fd + "T00:00:00").getTime();
          if (ft < t0 || ft > t1) return null;
          return <line key={i} x1={x(ft)} x2={x(ft)} y1={PAD_T} y2={H - PAD_B} stroke={cs.yellow || "#eab308"} strokeWidth="1" strokeDasharray="3 3" opacity="0.6">
            <title>Tambah freon {fmtD(fd)}</title>
          </line>;
        })}
        {/* seri */}
        {xy.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {xy.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r="4" fill={color} stroke={cs.surface} strokeWidth="2">
            <title>{fmtD(p.date)}: {p.v} {unit}</title>
          </circle>
        ))}
        {/* label nilai terakhir (ink, selektif — bukan semua titik) */}
        <text x={Math.min(last.cx + 8, W - PAD_R)} y={last.cy - 8} fontSize="10" fontWeight="700" fill={cs.text}
          textAnchor={last.cx > W - 70 ? "end" : "start"}>{last.v} {unit}</text>
        {/* sumbu waktu: tanggal awal & akhir */}
        <text x={PAD_L} y={H - 8} fontSize="9" fill={cs.muted}>{fmtD(points[0].date)}</text>
        {points.length > 1 && <text x={W - PAD_R} y={H - 8} fontSize="9" fill={cs.muted} textAnchor="end">{fmtD(last.date)}</text>}
      </svg>
    </div>
  );
}

export default function UnitTrendModal({ unit, logs, onClose }) {
  const series = unitMeasurementSeries(unit, logs);
  const ampPts = series.filter(p => p.ampere != null).map(p => ({ date: p.date, v: p.ampere }));
  const psiPts = series.filter(p => p.psi != null).map(p => ({ date: p.date, v: p.psi }));
  const freonDates = series.filter(p => p.freon_added).map(p => p.date);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14, padding: 20, width: 560, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>📈 Tren Pengukuran — {unit.unit_code}</div>
            <div style={{ fontSize: 11, color: cs.muted }}>{unit.location || ""} {unit.brand ? "· " + unit.brand : ""} {unit.capacity_pk ? "· " + unit.capacity_pk + "PK" : ""}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: cs.muted, marginBottom: 12 }}>
          {freonDates.length > 0 ? `Garis putus kuning = servis dengan penambahan freon (${freonDates.length}×).` : "Dari riwayat servis yang mencatat pengukuran."}
        </div>
        <MiniLine title="Ampere Akhir (A)" unit="A" points={ampPts} color={cs.accent} freonDates={freonDates} />
        <MiniLine title="Tekanan Freon (psi)" unit="psi" points={psiPts} color={cs.ara} freonDates={freonDates} />
        <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>
          💡 Ampere naik dari waktu ke waktu = kompresor makin berat. Tekanan turun + sering tambah freon = indikasi bocor.
        </div>
      </div>
    </div>
  );
}
