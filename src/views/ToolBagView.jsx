import { memo, useState, useEffect, useCallback, Fragment } from "react";
import { cs } from "../theme/cs.js";

const TECHNICIANS = ["Mulyadi","Boim","Yadi","Aji","Agung","Putra","Usaeri","Alat Proyek"];

const STATUS_COLOR = {
  OK: cs.green,
  WARNING: cs.yellow,
  CRITICAL: cs.red,
  ERROR: cs.muted
};
const STATUS_ICON = { OK: "✅", WARNING: "⚠️", CRITICAL: "🚨", ERROR: "❌" };

function ToolBagView({ supabase, currentUser, showNotif }) {
  const [selectedTech, setSelectedTech] = useState("Semua");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0,10));
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);

  const loadChecks = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("tool_bag_checks")
      .select("*")
      .gte("checked_at", selectedDate + "T00:00:00")
      .lte("checked_at", selectedDate + "T23:59:59.999")
      .order("checked_at", { ascending: false });
    if (selectedTech !== "Semua") query = query.eq("technician", selectedTech);
    const { data, error } = await query.limit(100);
    if (!error) setChecks(data || []);
    else if (showNotif) showNotif("Gagal load data: " + error.message);
    setLoading(false);
  }, [supabase, selectedDate, selectedTech, showNotif]);

  useEffect(() => { loadChecks(); }, [loadChecks]);

  // Summary per teknisi untuk tanggal terpilih
  const summary = TECHNICIANS.map(tech => {
    const pagi = checks.find(c => c.technician === tech && c.session_type === "pagi");
    const pulang = checks.find(c => c.technician === tech && c.session_type === "pulang");
    return { tech, pagi, pulang };
  });

  // Hitung statistik
  const totalChecks = checks.length;
  const criticalCount = checks.filter(c => c.status === "CRITICAL").length;
  const warningCount = checks.filter(c => c.status === "WARNING").length;
  const okCount = checks.filter(c => c.status === "OK").length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 22, color: cs.text }}>🎒 Tas Teknisi</div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>
            Teknisi kirim foto ke nomor WA AClean dengan caption: <b>"Pagi [Nama]"</b> atau <b>"Pulang [Nama]"</b>
          </div>
        </div>
        <button onClick={loadChecks}
          style={{ padding: "8px 14px", background: cs.accent, color: "#000", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
          🔄 Refresh
        </button>
      </div>

      {/* Statistik */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {[
          { label: "Total Check", value: totalChecks, color: cs.accent },
          { label: "✅ OK", value: okCount, color: cs.green },
          { label: "⚠️ Warning", value: warningCount, color: cs.yellow },
          { label: "🚨 Critical", value: criticalCount, color: cs.red }
        ].map((s, i) => (
          <div key={i} style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: cs.muted }}>Filter:</div>
        <input type="date" value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 8, padding: "6px 12px", color: cs.text, fontSize: 13 }} />
        <select value={selectedTech} onChange={e => setSelectedTech(e.target.value)}
          style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 8, padding: "6px 12px", color: cs.text, fontSize: 13 }}>
          <option value="Semua">Semua Teknisi</option>
          {TECHNICIANS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Summary Grid per Teknisi */}
      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: cs.text, marginBottom: 10 }}>Status Per Teknisi — {new Date(selectedDate).toLocaleDateString("id-ID", { weekday:"long", day:"numeric", month:"long" })}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
          {summary.map(({ tech, pagi, pulang }) => (
            <div key={tech} style={{ background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, marginBottom: 8 }}>{tech}</div>
              <div style={{ display: "grid", gap: 4, fontSize: 11 }}>
                <SessionBadge label="Pagi" check={pagi} />
                <SessionBadge label="Pulang" check={pulang} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* History Table */}
      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${cs.border}`, fontSize: 13, fontWeight: 700, color: cs.text }}>
          History Check ({checks.length})
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
            <thead>
              <tr style={{ background: cs.surface }}>
                {["Waktu","Teknisi","Sesi","Status","Alat Kurang","Foto",""].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: cs.muted, fontSize: 13 }}>Loading...</td></tr>
              ) : checks.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: cs.muted, fontSize: 13 }}>Belum ada check pada tanggal ini</td></tr>
              ) : checks.map((c, i) => {
                const missing = Array.isArray(c.tools_missing) ? c.tools_missing : [];
                const priorityMissing = missing.filter(t => t.is_priority);
                const isExpanded = expandedRow === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr style={{ borderTop: `1px solid ${cs.border}`, background: i%2 === 0 ? "transparent" : cs.surface + "80" }}>
                      <td style={{ padding: "9px 12px", fontSize: 12, color: cs.muted }}>
                        {new Date(c.checked_at).toLocaleTimeString("id-ID", { hour:"2-digit", minute:"2-digit" })}
                      </td>
                      <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600, color: cs.text }}>{c.technician}</td>
                      <td style={{ padding: "9px 12px" }}>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6,
                          background: (c.session_type === "pagi" ? cs.accent : cs.yellow) + "22",
                          color: c.session_type === "pagi" ? cs.accent : cs.yellow }}>
                          {c.session_type === "pagi" ? "🌅 Pagi" : "🌇 Pulang"}
                        </span>
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6,
                          background: STATUS_COLOR[c.status] + "22", color: STATUS_COLOR[c.status],
                          border: `1px solid ${STATUS_COLOR[c.status]}44`, fontWeight: 700 }}>
                          {STATUS_ICON[c.status]} {c.status}
                        </span>
                      </td>
                      <td style={{ padding: "9px 12px", fontSize: 12 }}>
                        {missing.length === 0 ? (
                          <span style={{ color: cs.green }}>Lengkap</span>
                        ) : (
                          <span>
                            {priorityMissing.length > 0 && (
                              <span style={{ color: cs.red, fontWeight: 600 }}>🔴 {priorityMissing.length} wajib</span>
                            )}
                            {priorityMissing.length > 0 && missing.length > priorityMissing.length && <span style={{ color: cs.muted }}> · </span>}
                            {missing.length - priorityMissing.length > 0 && (
                              <span style={{ color: cs.yellow }}>🟡 {missing.length - priorityMissing.length} lain</span>
                            )}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        {c.photo_url ? (
                          <a href={c.photo_url} target="_blank" rel="noreferrer"
                            style={{ fontSize: 11, color: cs.accent, textDecoration: "none" }}>📷 Lihat</a>
                        ) : <span style={{ color: cs.muted, fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        <button onClick={() => setExpandedRow(isExpanded ? null : c.id)}
                          style={{ fontSize: 11, color: cs.accent, background: "none", border: "none", cursor: "pointer", padding: "2px 8px" }}>
                          {isExpanded ? "▲" : "▼"} Detail
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, background: cs.surface }}>
                          <DetailPanel check={c} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SessionBadge({ label, check }) {
  if (!check) {
    return (
      <span style={{ padding: "2px 8px", borderRadius: 6, background: cs.muted + "22", color: cs.muted, border: `1px solid ${cs.muted}44` }}>
        — {label}
      </span>
    );
  }
  const color = STATUS_COLOR[check.status];
  return (
    <span style={{ padding: "2px 8px", borderRadius: 6, background: color + "22", color, border: `1px solid ${color}44`, fontWeight: 600 }}>
      {STATUS_ICON[check.status]} {label}
    </span>
  );
}

function DetailPanel({ check }) {
  const found = Array.isArray(check.tools_found) ? check.tools_found : [];
  const missing = Array.isArray(check.tools_missing) ? check.tools_missing : [];
  return (
    <div style={{ padding: 16, borderTop: `1px solid ${cs.border}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: cs.green, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>
            ✅ ALAT TERDETEKSI ({found.length})
          </div>
          {found.length === 0 ? (
            <div style={{ fontSize: 12, color: cs.muted, fontStyle: "italic" }}>Tidak ada alat yang terdeteksi</div>
          ) : found.map((t, i) => (
            <div key={i} style={{ fontSize: 12, color: cs.text, padding: "3px 0" }}>
              • {t.name} {t.qty > 1 && <span style={{ color: cs.muted }}>×{t.qty}</span>}
              {t.confidence && <span style={{ fontSize: 10, color: cs.muted, marginLeft: 4 }}>({t.confidence})</span>}
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 11, color: cs.red, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>
            ❌ ALAT TIDAK TERDETEKSI ({missing.length})
          </div>
          {missing.length === 0 ? (
            <div style={{ fontSize: 12, color: cs.green, fontStyle: "italic" }}>Semua lengkap</div>
          ) : missing.map((t, i) => (
            <div key={i} style={{ fontSize: 12, color: t.is_priority ? cs.red : cs.yellow, padding: "3px 0", fontWeight: t.is_priority ? 600 : 400 }}>
              {t.is_priority ? "🔴" : "🟡"} {t.name} {t.is_priority && <span style={{ fontSize: 10 }}>(WAJIB)</span>}
            </div>
          ))}
        </div>
      </div>
      {check.notes && (
        <div style={{ fontSize: 11, color: cs.muted, marginTop: 12, padding: 8, background: cs.card, borderRadius: 6, border: `1px solid ${cs.border}` }}>
          <b>Catatan AI:</b> {check.notes}
        </div>
      )}
      {check.sender_phone && (
        <div style={{ fontSize: 10, color: cs.muted, marginTop: 8 }}>
          Dikirim dari: {check.sender_phone} · {new Date(check.checked_at).toLocaleString("id-ID")}
        </div>
      )}
    </div>
  );
}

export default memo(ToolBagView);
