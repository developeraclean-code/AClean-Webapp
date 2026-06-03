import { useEffect, useState } from "react";

// Portal customer korporat (clean view). Dibuka via /m/<token>.
// Data dari /api/m-portal — gate akses & strip cost sudah di backend.

const API = "/api";
function fmtRp(n) { return n == null ? "" : "Rp " + Number(n).toLocaleString("id-ID"); }
function fmtDate(d) { if (!d) return "—"; try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } }

const STATUS = { active: ["#16a34a", "Aktif"], rusak: ["#dc2626", "Rusak"], retired: ["#64748b", "Retired"] };

export default function MaintenancePortalView({ token }) {
  const [state, setState] = useState({ loading: true });
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");

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

  if (state.loading) return <Screen icon="❄️" title="Memuat…" />;
  if (state.error === "TOKEN_DISABLED") return <Screen icon="🔒" title="Akses Dinonaktifkan" sub="Portal ini sudah tidak aktif. Hubungi Aclean untuk mengaktifkan kembali." />;
  if (state.error === "TOKEN_EXPIRED") return <Screen icon="⏳" title="Link Kedaluwarsa" sub="Masa berlaku portal sudah berakhir. Minta link baru ke Aclean." />;
  if (state.error) return <Screen icon="⚠️" title="Tidak Ditemukan" sub={state.msg || "Link portal tidak valid."} />;

  const { client, units = [], logs = [] } = state;
  const active = units.filter(u => u.status === "active").length;
  const logsOf = (uid) => logs.filter(l => l.unit_id === uid);
  const shown = units.filter(u => (u.unit_code + (u.location || "") + (u.brand || "")).toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "system-ui,-apple-system,sans-serif" }}>
      <div style={{ maxWidth: 540, margin: "0 auto", background: "#fff", minHeight: "100vh", boxShadow: "0 0 40px rgba(0,0,0,.08)" }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg,#0369a1,#0c4a6e)", color: "#fff", padding: "22px 20px" }}>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: .5 }}>Aclean<span style={{ color: "#7dd3fc" }}>.</span></div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{client.name}</div>
          <div style={{ fontSize: 12, opacity: .85 }}>Laporan Maintenance Aset AC</div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <Stat n={units.length} l="Unit" />
            <Stat n={active} l="Aktif" />
            <Stat n={logs.length} l="Servis" />
          </div>
        </div>

        <div style={{ padding: 16 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cari unit / lokasi / brand…"
            style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 14, marginBottom: 14, boxSizing: "border-box" }} />

          {shown.length === 0 ? <div style={{ textAlign: "center", color: "#94a3b8", padding: 30 }}>Tidak ada unit.</div> :
            shown.map(u => {
              const ul = logsOf(u.id);
              const isOpen = open === u.id;
              const [sc, sl] = STATUS[u.status] || ["#64748b", u.status];
              return (
                <div key={u.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, marginBottom: 10, overflow: "hidden" }}>
                  <div onClick={() => setOpen(isOpen ? null : u.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", cursor: "pointer" }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>
                        {u.unit_code} <span style={{ fontSize: 11, fontWeight: 700, color: sc, background: sc + "1a", padding: "1px 8px", borderRadius: 999, marginLeft: 4 }}>{sl}</span>
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
                        <div><span style={{ color: "#94a3b8" }}>Jenis</span><br />{u.ac_type || "—"}</div>
                        <div><span style={{ color: "#94a3b8" }}>Servis terakhir</span><br />{fmtDate(u.last_service_date)}</div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginBottom: 8 }}>Riwayat Servis</div>
                      {ul.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Belum ada riwayat.</div> :
                        <div style={{ borderLeft: "2px solid #cbd5e1", paddingLeft: 12 }}>
                          {ul.map(l => (
                            <div key={l.id} style={{ marginBottom: 14 }}>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <b style={{ color: "#0f172a", fontSize: 13 }}>{l.service_type || "Servis"}</b>
                                <span style={{ color: "#64748b", fontSize: 12 }}>{fmtDate(l.service_date)}</span>
                                {l.cost > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "1px 8px", borderRadius: 999 }}>{fmtRp(l.cost)}</span>}
                              </div>
                              {l.description && <div style={{ fontSize: 13, color: "#334155", margin: "3px 0" }}>{l.description}</div>}
                              {l.technician && <div style={{ fontSize: 12, color: "#94a3b8" }}>👷 {l.technician}</div>}
                              {Array.isArray(l.photos) && l.photos.length > 0 && (
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                  {l.photos.map((p, i) => (
                                    <a key={i} href={`${API}/foto?key=${encodeURIComponent(p)}`} target="_blank" rel="noreferrer"
                                      style={{ width: 60, height: 46, borderRadius: 6, overflow: "hidden", display: "block", border: "1px solid #e2e8f0" }}>
                                      <img alt="foto" src={`${API}/foto?key=${encodeURIComponent(p)}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>}
                    </div>
                  )}
                </div>
              );
            })}
          <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, padding: "18px 0" }}>
            Data dikelola & diperbarui oleh tim Aclean
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, l }) {
  return (
    <div style={{ flex: 1, background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "10px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{n}</div>
      <div style={{ fontSize: 10, opacity: .85, textTransform: "uppercase", letterSpacing: .5 }}>{l}</div>
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
