import { useEffect, useState } from "react";

// Portal customer korporat (clean view). Dibuka via /m/<token>.
// Data dari /api/m-portal — gate akses & strip cost sudah di backend.

const API = "/api";
function fmtRp(n) { return n == null ? "" : "Rp " + Number(n).toLocaleString("id-ID"); }
function fmtDate(d) { if (!d) return "—"; try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } }

const STATUS = {
  active:          ["#16a34a", "Aktif"],
  baru:            ["#0369a1", "AC Baru"],
  perlu_perbaikan: ["#dc2626", "Perlu Perbaikan"],
  dalam_perbaikan: ["#b45309", "Sedang Diperbaiki"],
  nonaktif:        ["#64748b", "Nonaktif"],
  rusak:           ["#dc2626", "Rusak"],
  retired:         ["#64748b", "Retired"],
};
const ISSUE_LABEL = { kapasitor_rusak: "Kapasitor Rusak", bocor_freon: "Bocor Freon", kompresor_lemah: "Kompresor Lemah", drain_tersumbat: "Drain Tersumbat", pcb_rusak: "PCB Rusak", filter_buntu: "Filter Buntu", fan_motor_lemah: "Motor Kipas", lainnya: "Lainnya" };
const PRIORITY_COLOR = { critical: "#dc2626", high: "#ea580c", normal: "#ca8a04", low: "#16a34a" };

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

export default function MaintenancePortalView({ token }) {
  const [state, setState] = useState({ loading: true });
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");

  // Highlight unit dari QR code: /m/<token>?unit=AC-01
  const highlightUnit = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("unit") || null
    : null;

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`${API}/m-portal?token=${encodeURIComponent(token)}`);
        const j = await r.json().catch(() => ({}));
        if (cancel) return;
        if (!r.ok) setState({ loading: false, error: j.code || "ERROR", msg: j.error });
        else setState({ loading: false, ...j });
      } catch { if (!cancel) setState({ loading: false, error: "NETWORK", msg: "Gagal terhubung" }); }
    })();
    return () => { cancel = true; };
  }, [token]);

  // Auto-buka unit yang di-highlight dari QR
  useEffect(() => {
    if (highlightUnit && !state.loading && !state.error) {
      const u = (state.units || []).find(u => u.unit_code === highlightUnit);
      if (u) setOpen(u.id);
    }
  }, [highlightUnit, state.loading, state.error]);

  if (state.loading) return <Screen icon="❄️" title="Memuat…" />;
  if (state.error === "TOKEN_DISABLED") return <Screen icon="🔒" title="Akses Dinonaktifkan" sub="Portal ini sudah tidak aktif. Hubungi Aclean untuk mengaktifkan kembali." />;
  if (state.error === "TOKEN_EXPIRED") return <Screen icon="⏳" title="Link Kedaluwarsa" sub="Masa berlaku portal sudah berakhir. Minta link baru ke Aclean." />;
  if (state.error) return <Screen icon="⚠️" title="Tidak Ditemukan" sub={state.msg || "Link portal tidak valid."} />;

  const { client, units = [], logs = [], followups = [], contract = null, summary = {} } = state;
  const active = units.filter(u => u.status === "active").length;
  const logsOf = (uid) => logs.filter(l => l.unit_id === uid);
  const followupsOf = (uid) => followups.filter(f => f.unit_id === uid);
  const shown = units.filter(u =>
    (u.unit_code + (u.location || "") + (u.brand || "")).toLowerCase().includes(q.toLowerCase()));

  // Hitung ringkasan PM
  const today = new Date().toISOString().slice(0, 10);
  const overdueCount = summary.overdue ?? units.filter(u => u.next_service_date && u.next_service_date < today && u.status === "active").length;
  const dueSoonCount = summary.due_soon ?? units.filter(u => {
    if (!u.next_service_date) return false;
    const d = daysUntil(u.next_service_date);
    return d !== null && d >= 0 && d <= 14;
  }).length;
  const [portalTab, setPortalTab] = useState("dashboard");

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "system-ui,-apple-system,sans-serif" }}>
      <div style={{ maxWidth: 540, margin: "0 auto", background: "#fff", minHeight: "100vh", boxShadow: "0 0 40px rgba(0,0,0,.08)" }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg,#0369a1,#0c4a6e)", color: "#fff", padding: "22px 20px" }}>
          <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: .5, opacity: .9 }}>AClean Service - Profesional Maintenance Company</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{client.name}</div>
          <div style={{ fontSize: 12, opacity: .85 }}>Laporan Maintenance Aset AC</div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <Stat n={units.length} l="Unit" />
            <Stat n={active} l="Aktif" />
            <Stat n={summary.perlu_perbaikan ?? units.filter(u => u.status === "perlu_perbaikan").length} l="Perlu Perbaikan" warn={summary.perlu_perbaikan > 0} />
            {overdueCount > 0 && <Stat n={overdueCount} l="PM Terlambat" warn />}
            {(summary.open_issues ?? 0) > 0 && <Stat n={summary.open_issues} l="Temuan" soon />}
          </div>
        </div>

        {/* Tab nav */}
        <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", background: "#fff" }}>
          {[["dashboard","📊 Ringkasan"],["units","📋 Unit"],["issues","🔧 Temuan"]].map(([k,l]) => (
            <button key={k} onClick={() => setPortalTab(k)}
              style={{ flex:1, padding:"12px 6px", fontSize:12, fontWeight:700, background:"none", border:"none", borderBottom: portalTab===k ? "2px solid #0369a1" : "2px solid transparent", color: portalTab===k ? "#0369a1" : "#64748b", cursor:"pointer" }}>
              {l}
            </button>
          ))}
        </div>

        <div style={{ padding: 16 }}>

          {/* ── DASHBOARD TAB ── */}
          {portalTab === "dashboard" && (
            <div>
              {/* Alert PM overdue */}
              {overdueCount > 0 && (
                <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
                  <b style={{ color: "#dc2626" }}>⚠️ {overdueCount} unit PM sudah terlewat</b>
                  <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>Hubungi tim AClean untuk menjadwalkan perawatan segera.</div>
                </div>
              )}
              {(summary.critical_issues ?? 0) > 0 && (
                <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
                  <b style={{ color: "#ea580c" }}>🔧 {summary.critical_issues} temuan prioritas tinggi perlu tindak lanjut</b>
                </div>
              )}

              {/* Status breakdown */}
              <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 14, marginBottom: 10 }}>Status Aset</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
                {[
                  ["Aktif", summary.active ?? active, "#16a34a"],
                  ["AC Baru", summary.baru ?? units.filter(u=>u.status==="baru").length, "#0369a1"],
                  ["Perlu Perbaikan", summary.perlu_perbaikan ?? units.filter(u=>u.status==="perlu_perbaikan").length, "#dc2626"],
                  ["Sedang Diperbaiki", units.filter(u=>u.status==="dalam_perbaikan").length, "#b45309"],
                  ["PM Terlambat", overdueCount, "#dc2626"],
                  ["Due 30 Hari", summary.due_soon ?? dueSoonCount, "#ca8a04"],
                ].map(([l,n,c]) => (
                  <div key={l} style={{ background: c+"0f", border:"1px solid "+c+"33", borderRadius:10, padding:"12px 10px", textAlign:"center" }}>
                    <div style={{ fontSize:22, fontWeight:800, color:c }}>{n}</div>
                    <div style={{ fontSize:10, color:"#64748b", marginTop:2, lineHeight:1.3 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Kontrak */}
              {contract && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 14, marginBottom: 8 }}>📝 Kontrak Aktif</div>
                  <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 14px", fontSize: 13 }}>
                    <div style={{ fontWeight: 700, color: "#0369a1" }}>{contract.title || contract.contract_number}</div>
                    <div style={{ color: "#64748b", marginTop: 4 }}>
                      Berlaku: {fmtDate(contract.start_date)} — {fmtDate(contract.end_date)}
                      {(() => { const d = daysUntil(contract.end_date); return d !== null && d <= 60 ? <span style={{ color:"#dc2626", fontWeight:700, marginLeft:6 }}>({d < 0 ? "Expired" : d+"h lagi"})</span> : null; })()}
                    </div>
                    <div style={{ marginTop:4, color:"#64748b" }}>{contract.visits_per_year}x kunjungan/tahun · Layanan: {(contract.services_included||[]).join(", ")}</div>
                  </div>
                </div>
              )}

              {/* PM Timeline — unit sorted by next_service_date */}
              <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 14, marginBottom: 8 }}>📅 Jadwal PM Berikutnya</div>
              {units.filter(u => u.next_service_date && u.status === "active").sort((a,b) => a.next_service_date.localeCompare(b.next_service_date)).slice(0,8).map(u => {
                const d = daysUntil(u.next_service_date);
                const overdue = d !== null && d < 0;
                const soon = d !== null && d >= 0 && d <= 30;
                return (
                  <div key={u.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #f1f5f9" }}>
                    <div>
                      <span style={{ fontWeight:600, color:"#0f172a", fontSize:13 }}>{u.unit_code}</span>
                      <span style={{ color:"#94a3b8", fontSize:12, marginLeft:6 }}>{u.location}</span>
                    </div>
                    <span style={{ fontSize:12, fontWeight:700, color: overdue?"#dc2626":soon?"#b45309":"#64748b", background: overdue?"#fef2f2":soon?"#fef3c7":"#f1f5f9", padding:"2px 8px", borderRadius:99 }}>
                      {overdue ? "Terlambat" : d===0 ? "Hari ini" : `${d}h lagi`} · {fmtDate(u.next_service_date)}
                    </span>
                  </div>
                );
              })}
              {summary.last_service && <div style={{ color:"#94a3b8", fontSize:12, marginTop:12, textAlign:"right" }}>Servis terakhir: {fmtDate(summary.last_service)}</div>}
            </div>
          )}

          {/* ── UNITS TAB ── */}
          {portalTab === "units" && (<>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cari unit / lokasi / brand…"
            style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 14, marginBottom: 14, boxSizing: "border-box" }} />

          {shown.length === 0 ? <div style={{ textAlign: "center", color: "#94a3b8", padding: 30 }}>Tidak ada unit ditemukan.</div> :
            shown.map(u => {
              const ul = logsOf(u.id);
              const isOpen = open === u.id;
              const [sc, sl] = STATUS[u.status] || ["#64748b", u.status];
              const dueDays = daysUntil(u.next_service_date);
              const isOverdue = dueDays !== null && dueDays < 0;
              const isDueSoon = dueDays !== null && dueDays >= 0 && dueDays <= 14;
              const isHighlighted = highlightUnit === u.unit_code;
              return (
                <div key={u.id} style={{ border: "1px solid " + (isHighlighted ? "#0369a1" : "#e2e8f0"), borderRadius: 12, marginBottom: 10, overflow: "hidden", boxShadow: isHighlighted ? "0 0 0 3px #0369a133" : "none" }}>
                  <div onClick={() => setOpen(isOpen ? null : u.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", cursor: "pointer" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>
                        {u.unit_code}
                        <span style={{ fontSize: 11, fontWeight: 700, color: sc, background: sc + "1a", padding: "1px 8px", borderRadius: 999, marginLeft: 6 }}>{sl}</span>
                        {isOverdue && <span style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", background: "#fef2f2", padding: "1px 7px", borderRadius: 999, marginLeft: 4 }}>PM Terlambat</span>}
                        {isDueSoon && !isOverdue && <span style={{ fontSize: 10, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "1px 7px", borderRadius: 999, marginLeft: 4 }}>Due {dueDays}h</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{u.location || "—"}</div>
                    </div>
                    <div style={{ marginLeft: "auto", textAlign: "right", fontSize: 12, color: "#64748b" }}>
                      {u.brand || "—"}<br />{u.capacity_pk ? u.capacity_pk + "PK" : ""} {u.refrigerant ? "· " + u.refrigerant : ""}
                    </div>
                    <span style={{ color: "#94a3b8", transform: isOpen ? "rotate(90deg)" : "none", transition: ".2s" }}>▶</span>
                  </div>
                  {isOpen && (
                    <div style={{ borderTop: "1px solid #e2e8f0", padding: 14, background: "#f8fafc" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 14px", marginBottom: 12, fontSize: 13 }}>
                        <div><span style={{ color: "#94a3b8" }}>Jenis</span><br />{{ split: "Split Wall", cassette: "Cassette", standing: "Floor Standing", floor: "Split Duct" }[u.ac_type] || u.ac_type || "—"}</div>
                        <div><span style={{ color: "#94a3b8" }}>Servis terakhir</span><br />{fmtDate(u.last_service_date)}</div>
                        {u.next_service_date && (
                          <div style={{ gridColumn: "1/-1" }}>
                            <span style={{ color: "#94a3b8" }}>PM berikutnya</span><br />
                            <span style={{ fontWeight: 700, color: isOverdue ? "#dc2626" : isDueSoon ? "#b45309" : "#0f172a" }}>
                              {fmtDate(u.next_service_date)}
                              {isOverdue && " — Sudah terlewat"}
                              {isDueSoon && !isOverdue && ` — ${dueDays} hari lagi`}
                            </span>
                          </div>
                        )}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginBottom: 8 }}>Riwayat Servis</div>
                      {ul.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Belum ada riwayat.</div> :
                        <div style={{ borderLeft: "2px solid #cbd5e1", paddingLeft: 12 }}>
                          {ul.map(l => {
                            const mats = Array.isArray(l.materials) ? l.materials.filter(m => m.nama) : [];
                            const photos = Array.isArray(l.photos) ? l.photos.filter(Boolean) : [];
                            return (
                              <div key={l.id} style={{ marginBottom: 14 }}>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <b style={{ color: "#0f172a", fontSize: 13 }}>{l.service_type || "Servis"}</b>
                                  <span style={{ color: "#64748b", fontSize: 12 }}>{fmtDate(l.service_date)}</span>
                                  {l.cost > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "1px 8px", borderRadius: 999 }}>{fmtRp(l.cost)}</span>}
                                </div>
                                {l.description && <div style={{ fontSize: 13, color: "#334155", margin: "3px 0" }}>{l.description}</div>}
                                {l.technician && <div style={{ fontSize: 12, color: "#94a3b8" }}>👷 {l.technician}</div>}
                                {mats.length > 0 && (
                                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5 }}>
                                    {mats.map((m, i) => (
                                      <span key={i} style={{ background: "#e0f2fe", color: "#0369a1", padding: "1px 8px", borderRadius: 6, fontSize: 11 }}>
                                        {m.nama} {m.qty}{m.satuan || ""}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {photos.length > 0 && (
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                    {photos.map((p, i) => (
                                      <a key={i} href={`${API}/foto?key=${encodeURIComponent(p)}`} target="_blank" rel="noreferrer"
                                        style={{ width: 64, height: 48, borderRadius: 7, overflow: "hidden", display: "block", border: "1px solid #e2e8f0" }}>
                                        <img alt="foto" src={`${API}/foto?key=${encodeURIComponent(p)}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>}
                    </div>
                  )}
                </div>
              );
            })}
          <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, padding: "10px 0 4px" }}>
            Data dikelola & diperbarui oleh tim Aclean
          </div>
          </>)}

          {/* ── ISSUES TAB ── */}
          {portalTab === "issues" && (
            <div>
              {followups.length === 0 ? (
                <div style={{ textAlign:"center", padding:40, color:"#94a3b8" }}>
                  <div style={{ fontSize:36 }}>✅</div>
                  <div style={{ marginTop:8 }}>Tidak ada temuan aktif saat ini</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {followups.map(f => {
                    const unit = units.find(u => u.id === f.unit_id);
                    const pc = PRIORITY_COLOR[f.priority] || "#64748b";
                    return (
                      <div key={f.id} style={{ border:"1px solid #e2e8f0", borderLeft:`3px solid ${pc}`, borderRadius:10, padding:"12px 14px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                          <div>
                            <div style={{ fontWeight:700, color:"#0f172a", fontSize:13 }}>{ISSUE_LABEL[f.issue_type] || f.issue_type}</div>
                            {unit && <div style={{ color:"#64748b", fontSize:12 }}>{unit.unit_code} · {unit.location}</div>}
                          </div>
                          <span style={{ background:pc+"15", color:pc, padding:"2px 8px", borderRadius:99, fontSize:11, fontWeight:700 }}>
                            {f.priority === "critical" ? "Kritis" : f.priority === "high" ? "Tinggi" : f.priority === "normal" ? "Normal" : "Rendah"}
                          </span>
                        </div>
                        {f.description && <div style={{ fontSize:12, color:"#475569", marginTop:6 }}>{f.description}</div>}
                        <div style={{ fontSize:11, color:"#94a3b8", marginTop:4 }}>Ditemukan: {fmtDate(f.found_date)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, padding: "14px 0 4px" }}>
            Data dikelola & diperbarui oleh tim Aclean
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, l, warn, soon }) {
  const bg = warn ? "rgba(220,38,38,.25)" : soon ? "rgba(180,83,9,.2)" : "rgba(255,255,255,.12)";
  return (
    <div style={{ flex: 1, background: bg, borderRadius: 10, padding: "10px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{n}</div>
      <div style={{ fontSize: 10, opacity: .9, textTransform: "uppercase", letterSpacing: .5 }}>{l}</div>
    </div>
  );
}

function Screen({ icon, title, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f1f5f9", fontFamily: "system-ui,sans-serif" }}>
      <div style={{ textAlign: "center", padding: 24, maxWidth: 360 }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>{icon}</div>
        <div style={{ fontWeight: 800, fontSize: 18, color: "#0f172a" }}>{title}</div>
        {sub && <div style={{ fontSize: 14, color: "#64748b", marginTop: 8 }}>{sub}</div>}
      </div>
    </div>
  );
}
