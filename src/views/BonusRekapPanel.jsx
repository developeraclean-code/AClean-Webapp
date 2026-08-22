// Panel "Rekap & Cetak" bonus karyawan — preview persis isi file yang diunduh/dicetak.
// Owner/Admin bisa cek manual: job mana yang TERMASUK bonus (Freon/Kapasitor/lain) dan
// job mana yang TIDAK, lengkap dengan alasannya. Data dibangun oleh lib/bonusRekap.js.
import { useState } from "react";
import { cs } from "../theme/cs.js";
import {
  downloadBonusRekapCSV, downloadBonusExcludedCSV, printBonusRekap, EXCLUDE_LABELS,
} from "../lib/bonusRekap.js";

const KATEGORI_COLOR = {
  DISMISSED:   "#6b7280",
  BELUM_INPUT: "#f59e0b",
  NO_CRITERIA: "#475569",
  VOID:        "#ef4444",
};

function fmtRp(n) { return "Rp " + Number(n || 0).toLocaleString("id-ID"); }
function fmtDateShort(d) {
  if (!d) return "-";
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

const th = { padding: "7px 8px", fontSize: 11, fontWeight: 700, color: cs.muted, textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid " + cs.border, background: cs.surface, position: "sticky", top: 0 };
const td = { padding: "6px 8px", fontSize: 11.5, color: cs.text, borderBottom: "1px solid " + cs.border, verticalAlign: "top" };
const tdR = { ...td, textAlign: "right", whiteSpace: "nowrap" };

function Card({ label, value, color }) {
  return (
    <div style={{ background: cs.card, border: "1px solid " + (color || cs.border), borderRadius: 9, padding: "9px 12px", minWidth: 120 }}>
      <div style={{ fontSize: 10, color: cs.muted, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || cs.text }}>{value}</div>
    </div>
  );
}

export default function BonusRekapPanel({
  rekap, bonusMonth, setBonusMonth, addMonths, todayYearMonth,
  loading, onReload, showNotif, addAgentLog, currentUser,
}) {
  const [lastAction, setLastAction] = useState(null); // { label, at }
  const [showExcluded, setShowExcluded] = useState(true);
  // Saring seksi B per kategori. Bulan sibuk bisa 388 job tanpa bonus, padahal yang
  // perlu ditindak cuma yang "layak bonus tapi belum di-input" (mis. 48) — tanpa
  // saringan, daftar kerja itu tenggelam.
  const [excFilter, setExcFilter] = useState(null); // null = semua kategori
  const s = rekap.summary;

  const excludedRows = excFilter
    ? rekap.excluded.filter(r => r.kategori === excFilter)
    : rekap.excluded;

  const handleExcludedCSV = () => {
    const fileName = downloadBonusExcludedCSV(rekap, excFilter);
    setLastAction({ label: "📥 CSV " + fileName, at: new Date() });
    addAgentLog?.("EXPORT_BONUS", `Daftar ${EXCLUDE_LABELS[excFilter] || "tanpa bonus"} ${rekap.monthLabel} (${excludedRows.length} job) diunduh oleh ${currentUser?.name || "-"}`, "SUCCESS");
    showNotif?.(`✅ ${fileName} berhasil diunduh (${excludedRows.length} job)`);
  };

  const handleCSV = () => {
    const fileName = downloadBonusRekapCSV(rekap);
    setLastAction({ label: "📥 CSV " + fileName, at: new Date() });
    addAgentLog?.("EXPORT_BONUS", `Rekap bonus ${rekap.monthLabel} (CSV) diunduh oleh ${currentUser?.name || "-"}`, "SUCCESS");
    showNotif?.(`✅ ${fileName} berhasil diunduh`);
  };

  const handlePrint = () => {
    const opened = printBonusRekap(rekap);
    setLastAction({ label: opened ? "🖨️ Dikirim ke print preview" : "📄 Disimpan sebagai HTML (popup diblokir)", at: new Date() });
    addAgentLog?.("PRINT_BONUS", `Rekap bonus ${rekap.monthLabel} dicetak oleh ${currentUser?.name || "-"}`, "SUCCESS");
    if (!opened) showNotif?.("Popup diblokir — file HTML diunduh, buka lalu Ctrl+P untuk cetak");
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Info */}
      <div style={{ background: "#1e3a5f", borderRadius: 10, padding: 12, fontSize: 12, color: "#93c5fd" }}>
        ℹ️ Rekap bulanan untuk <strong>cek manual & arsip cetak</strong>. Isi tabel di bawah = isi file yang diunduh/dicetak, termasuk daftar job yang <strong>tidak</strong> dapat bonus beserta alasannya.
      </div>

      {/* Periode + aksi */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => setBonusMonth(addMonths(bonusMonth, -1))} style={btn()}>← Bulan Lalu</button>
        <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>📅 {rekap.monthLabel}</div>
        <button onClick={() => setBonusMonth(addMonths(bonusMonth, 1))} style={btn()}>Bulan Depan →</button>
        <button onClick={() => setBonusMonth(todayYearMonth())} style={{ ...btn(), color: cs.accent }}>Bulan Ini</button>
        <button onClick={onReload} style={btn()}>🔄 Refresh</button>
        <div style={{ flex: 1 }} />
        <button onClick={handleCSV} disabled={loading} style={{ ...btn(), background: cs.accent, border: "none", color: "#fff", fontWeight: 700, opacity: loading ? 0.5 : 1 }}>
          📥 Download CSV / Excel
        </button>
        <button onClick={handlePrint} disabled={loading} style={{ ...btn(), background: cs.green, border: "none", color: "#fff", fontWeight: 700, opacity: loading ? 0.5 : 1 }}>
          🖨️ Cetak / PDF
        </button>
      </div>

      {/* Status terdownload */}
      {lastAction && (
        <div style={{ background: "#14532d", border: "1px solid " + cs.green, borderRadius: 9, padding: "8px 12px", fontSize: 12, color: "#86efac", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>✅ Terdownload</span>
          <span>{lastAction.label}</span>
          <span style={{ color: cs.muted }}>· {lastAction.at.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
          <button onClick={() => setLastAction(null)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: cs.muted, cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: cs.muted, fontSize: 13, padding: 20, textAlign: "center" }}>Memuat data rekap...</div>
      ) : (
        <>
          {/* Ringkasan */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Card label="Job Selesai" value={s.totalJobSelesai} />
            <Card label="Dapat Bonus" value={s.totalJobBonus} color={cs.green} />
            <Card label="Tanpa Bonus" value={s.excludedCount} color={cs.yellow} />
            <Card label="Nilai Transaksi" value={fmtRp(s.totalNilaiTrx)} />
            <Card label="Freon" value={fmtRp(s.totalFreon)} />
            <Card label="Kapasitor" value={fmtRp(s.totalKapasitor)} />
            <Card label="Bonus Lain" value={fmtRp(s.totalLain)} />
            <Card label="Total Bonus" value={fmtRp(s.totalBonus)} color={cs.accent} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, color: cs.muted }}>
            <span>💰 Sudah dibayar: <strong style={{ color: cs.green }}>{fmtRp(s.totalDibayar)}</strong></span>
            <span>✅ Siap cair: <strong style={{ color: "#3b82f6" }}>{fmtRp(s.totalSiapCair)}</strong></span>
            <span>⏳ Dalam warranty: <strong style={{ color: cs.yellow }}>{fmtRp(s.totalWarranty)}</strong></span>
          </div>

          {/* A. Termasuk bonus */}
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: cs.green, marginBottom: 8 }}>
              A. ✅ Termasuk Bonus ({rekap.included.length} job)
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
                <thead>
                  <tr>
                    <th style={th}>Tgl</th><th style={th}>Job ID</th><th style={th}>Nama Job</th>
                    <th style={th}>Layanan</th><th style={th}>Teknisi</th><th style={th}>Helper</th>
                    <th style={{ ...th, textAlign: "right" }}>Nilai Transaksi</th>
                    <th style={{ ...th, textAlign: "right" }}>Freon</th>
                    <th style={{ ...th, textAlign: "right" }}>Kapasitor</th>
                    <th style={{ ...th, textAlign: "right" }}>Lain</th>
                    <th style={{ ...th, textAlign: "right" }}>Jml Bonus</th>
                    <th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rekap.included.length === 0 ? (
                    <tr><td style={{ ...td, textAlign: "center", color: cs.muted }} colSpan={12}>Belum ada job berbonus di bulan ini.</td></tr>
                  ) : rekap.included.map((r, i) => (
                    <tr key={r.orderId + "-" + i}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDateShort(r.date)}</td>
                      <td style={{ ...td, fontFamily: "monospace" }}>{r.orderId}</td>
                      <td style={td}>{r.customer}{r.units !== "-" && <span style={{ color: cs.muted }}> · {r.units} unit</span>}</td>
                      <td style={td}>{r.service}</td>
                      <td style={td}>{r.teknisi}</td>
                      <td style={td}>{r.helper}</td>
                      <td style={tdR}>{fmtRp(r.nilai)}</td>
                      <td style={{ ...tdR, color: r.freon ? "#93c5fd" : cs.muted }}>{r.freon ? fmtRp(r.freon) : "-"}</td>
                      <td style={{ ...tdR, color: r.kapasitor ? "#93c5fd" : cs.muted }}>{r.kapasitor ? fmtRp(r.kapasitor) : "-"}</td>
                      <td style={tdR}>
                        {r.lain ? fmtRp(r.lain) : "-"}
                        {r.lainDetail && <div style={{ fontSize: 10, color: cs.muted }}>{r.lainDetail}</div>}
                      </td>
                      <td style={{ ...tdR, fontWeight: 800, color: cs.accent }}>
                        {fmtRp(r.totalBonus)}
                        {r.memberCount > 1 && <div style={{ fontSize: 10, color: cs.muted, fontWeight: 400 }}>÷{r.memberCount} = {fmtRp(Math.round(r.perOrang))}</div>}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap", fontSize: 10.5 }}>{r.statusLabel}</td>
                    </tr>
                  ))}
                </tbody>
                {rekap.included.length > 0 && (
                  <tfoot>
                    <tr>
                      <td style={{ ...td, fontWeight: 800 }} colSpan={6}>TOTAL</td>
                      <td style={{ ...tdR, fontWeight: 800 }}>{fmtRp(s.totalNilaiTrx)}</td>
                      <td style={{ ...tdR, fontWeight: 800 }}>{fmtRp(s.totalFreon)}</td>
                      <td style={{ ...tdR, fontWeight: 800 }}>{fmtRp(s.totalKapasitor)}</td>
                      <td style={{ ...tdR, fontWeight: 800 }}>{fmtRp(s.totalLain)}</td>
                      <td style={{ ...tdR, fontWeight: 800, color: cs.accent }}>{fmtRp(s.totalBonus)}</td>
                      <td style={td} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* B. Tidak termasuk */}
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: cs.yellow }}>
                B. 🚫 Tidak Termasuk Bonus ({excludedRows.length}{excFilter ? ` dari ${rekap.excluded.length}` : ""} job)
              </div>
              {/* Badge kategori = tombol saring. Klik lagi untuk kembali ke semua. */}
              {Object.entries(s.excludedByKategori).map(([k, n]) => {
                const on = excFilter === k;
                const color = KATEGORI_COLOR[k] || cs.muted;
                return (
                  <button key={k} onClick={() => setExcFilter(on ? null : k)}
                    title={on ? "Klik untuk tampilkan semua kategori" : "Klik untuk tampilkan kategori ini saja"}
                    style={{
                      fontSize: 10, fontWeight: 700, borderRadius: 5, padding: "3px 8px", cursor: "pointer",
                      background: on ? color : color + "33",
                      color: on ? "#0a0f1e" : color,
                      border: "1px solid " + (on ? color : "transparent"),
                    }}>
                    {on ? "✓ " : ""}{EXCLUDE_LABELS[k] || k}: {n}
                  </button>
                );
              })}
              {excFilter && (
                <button onClick={() => setExcFilter(null)} style={{ ...btn(), fontSize: 10, padding: "3px 9px" }}>
                  ✕ Semua kategori
                </button>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {excludedRows.length > 0 && (
                  <button onClick={handleExcludedCSV}
                    title={excFilter ? "Unduh hanya kategori yang sedang disaring" : "Unduh seluruh daftar job tanpa bonus"}
                    style={{ ...btn(), fontSize: 11, padding: "4px 10px", background: cs.accent, border: "none", color: "#fff", fontWeight: 700 }}>
                    📥 Download {excFilter ? "Kategori Ini" : "Daftar Ini"} ({excludedRows.length})
                  </button>
                )}
                <button onClick={() => setShowExcluded(v => !v)} style={{ ...btn(), fontSize: 11, padding: "4px 10px" }}>
                  {showExcluded ? "▲ Sembunyikan" : "▼ Tampilkan"}
                </button>
              </div>
            </div>
            {showExcluded && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={th}>Tgl</th><th style={th}>Job ID</th><th style={th}>Nama Job</th>
                      <th style={th}>Layanan</th><th style={th}>Teknisi</th><th style={th}>Helper</th>
                      <th style={{ ...th, textAlign: "right" }}>Nilai Transaksi</th>
                      <th style={th}>Kategori</th><th style={th}>Alasan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excludedRows.length === 0 ? (
                      <tr><td style={{ ...td, textAlign: "center", color: cs.muted }} colSpan={9}>
                        {excFilter ? "Tidak ada job di kategori ini." : "Semua job bulan ini dapat bonus."}
                      </td></tr>
                    ) : excludedRows.map((r, i) => (
                      <tr key={r.orderId + "-" + r.kategori + "-" + i}>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDateShort(r.date)}</td>
                        <td style={{ ...td, fontFamily: "monospace" }}>{r.orderId}</td>
                        <td style={td}>{r.customer}</td>
                        <td style={td}>{r.service}</td>
                        <td style={td}>{r.teknisi}</td>
                        <td style={td}>{r.helper}</td>
                        <td style={tdR}>{fmtRp(r.nilai)}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 5, padding: "2px 7px", background: (KATEGORI_COLOR[r.kategori] || cs.border) + "33", color: KATEGORI_COLOR[r.kategori] || cs.muted }}>
                            {EXCLUDE_LABELS[r.kategori] || r.kategori}
                          </span>
                        </td>
                        <td style={{ ...td, color: cs.muted }}>{r.alasan}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* C. Per orang */}
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, marginBottom: 8 }}>
              C. 👷 Rekap Per Orang ({rekap.perPerson.length} karyawan)
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead>
                  <tr>
                    <th style={th}>Nama</th>
                    <th style={{ ...th, textAlign: "center" }}>Jml Job</th>
                    <th style={{ ...th, textAlign: "right" }}>Total Bagian</th>
                    <th style={{ ...th, textAlign: "right" }}>Sudah Dibayar</th>
                    <th style={{ ...th, textAlign: "right" }}>Siap Cair</th>
                    <th style={{ ...th, textAlign: "right" }}>Warranty</th>
                  </tr>
                </thead>
                <tbody>
                  {rekap.perPerson.length === 0 ? (
                    <tr><td style={{ ...td, textAlign: "center", color: cs.muted }} colSpan={6}>Belum ada pembagian bonus.</td></tr>
                  ) : rekap.perPerson.map(p => (
                    <tr key={p.nama}>
                      <td style={{ ...td, fontWeight: 700 }}>{p.nama}</td>
                      <td style={{ ...td, textAlign: "center" }}>{p.jobCount}</td>
                      <td style={{ ...tdR, fontWeight: 800, color: cs.accent }}>{fmtRp(Math.round(p.total))}</td>
                      <td style={{ ...tdR, color: cs.green }}>{fmtRp(Math.round(p.paid))}</td>
                      <td style={{ ...tdR, color: "#3b82f6" }}>{fmtRp(Math.round(p.eligible))}</td>
                      <td style={{ ...tdR, color: cs.yellow }}>{fmtRp(Math.round(p.pending))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* D. Per kategori */}
          {s.byCategory.length > 0 && (
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, marginBottom: 8 }}>D. 🏷️ Rekap Per Kategori Bonus</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 8 }}>
                {s.byCategory.map(c => (
                  <div key={c.id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 11px" }}>
                    <div style={{ fontSize: 11, color: cs.muted }}>{c.label} · {c.count}×</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: cs.text }}>{fmtRp(c.amount)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function btn() {
  return { padding: "6px 12px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, cursor: "pointer", fontSize: 13 };
}
