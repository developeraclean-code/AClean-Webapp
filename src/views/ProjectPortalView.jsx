import { useEffect, useState } from "react";

// Portal customer modul Project (clean view). Dibuka via /p/<token> atau /status/ptk_<...>.
// Data dari /api/project-portal — hanya laporan harian VERIFIED (approval Owner/Admin).
// TIDAK menampilkan data finansial (nilai/RAB/harga) — backend sudah strip.

const API = "/api";
function fmtDate(d) { if (!d) return "—"; try { return new Date(d).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); } catch { return d; } }
function fmtDateShort(d) { if (!d) return "—"; try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" }); } catch { return d; } }

const PSTATUS = {
  BERJALAN: ["#2563eb", "Sedang Berjalan"],
  HOLD: ["#d97706", "Ditunda"],
  SELESAI: ["#16a34a", "Selesai"],
};

export default function ProjectPortalView({ token }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`${API}/project-portal?token=${encodeURIComponent(token)}`);
        const j = await r.json().catch(() => ({}));
        if (cancel) return;
        if (!r.ok) setState({ loading: false, error: j.code || "ERROR", msg: j.error });
        else setState({ loading: false, ...j });
      } catch { if (!cancel) setState({ loading: false, error: "NETWORK", msg: "Gagal terhubung" }); }
    })();
    return () => { cancel = true; };
  }, [token]);

  if (state.loading) return <Screen icon="🏗️" title="Memuat…" />;
  if (state.error === "TOKEN_DISABLED") return <Screen icon="🔒" title="Akses Dinonaktifkan" sub="Portal ini sedang tidak aktif. Hubungi AClean untuk mengaktifkan kembali." />;
  if (state.error === "NOT_FOUND") return <Screen icon="⚠️" title="Tidak Ditemukan" sub="Link portal tidak valid." />;
  if (state.error) return <Screen icon="⚠️" title="Terjadi Kesalahan" sub={state.msg || "Coba muat ulang halaman."} />;

  const { project = {}, harian = [], usage = [] } = state;
  const [stColor, stLabel] = PSTATUS[project.status] || ["#64748b", project.status || "—"];

  // Ringkasan total pemakaian material (jumlahkan qty per nama material)
  const usageSummary = (() => {
    const m = {};
    usage.forEach(u => {
      const key = (u.material || "—").trim();
      if (!m[key]) m[key] = 0;
      m[key] += Number(u.qty) || 0;
    });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  })();

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "system-ui,-apple-system,sans-serif", color: "#0f172a" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1e3a8a,#2563eb)", color: "#fff", padding: "28px 20px 60px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ fontSize: 12, opacity: .85, fontWeight: 600, letterSpacing: .5 }}>AClean · Progres Proyek</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "6px 0 4px" }}>{project.nama || "Proyek"}</h1>
          <div style={{ fontSize: 13, opacity: .9 }}>📍 {project.lokasi || "—"}{project.kategori ? ` · ${project.kategori}` : ""}</div>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: "-44px auto 0", padding: "0 16px 40px" }}>
        {/* Kartu ringkasan */}
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 8px 24px rgba(0,0,0,.08)", padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: stColor, padding: "4px 12px", borderRadius: 20 }}>{stLabel}</span>
            <span style={{ fontSize: 13, color: "#475569" }}>
              {project.mulai ? `Mulai ${fmtDateShort(project.mulai)}` : ""}{project.target ? ` · Target ${fmtDateShort(project.target)}` : ""}
            </span>
          </div>
          {/* Progress bar */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            <span style={{ color: "#475569" }}>Progres Pengerjaan</span>
            <span style={{ color: stColor }}>{project.progress || 0}%</span>
          </div>
          <div style={{ height: 12, background: "#e2e8f0", borderRadius: 20, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, project.progress || 0)}%`, height: "100%", background: `linear-gradient(90deg,${stColor},${stColor}cc)`, borderRadius: 20, transition: "width .4s" }} />
          </div>
        </div>

        {/* Total pemakaian material */}
        {usageSummary.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.06)", padding: 18, marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: "0 0 12px" }}>📦 Pemakaian Material</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {usageSummary.map(([nama, qty]) => (
                <div key={nama} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 12px", background: "#f8fafc", borderRadius: 10 }}>
                  <span>{nama}</span>
                  <b style={{ color: "#2563eb" }}>{qty}</b>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline laporan harian */}
        <h2 style={{ fontSize: 15, fontWeight: 800, margin: "20px 4px 12px" }}>🗓️ Laporan Harian ({harian.length})</h2>
        {harian.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, textAlign: "center", color: "#64748b", fontSize: 14 }}>
            Belum ada laporan harian yang dipublikasikan.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {harian.map(h => <DayCard key={h.id} h={h} />)}
          </div>
        )}

        <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, marginTop: 28 }}>
          Diperbarui otomatis · AClean Service
        </div>
      </div>
    </div>
  );
}

function DayCard({ h }) {
  const allFotos = [...(h.pagi?.fotos || []), ...(h.sore?.fotos || [])];
  const materials = [h.pagi?.material, h.sore?.material].filter(m => m && m !== "-");
  return (
    <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.06)", padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 800 }}>{fmtDate(h.tanggal)}</span>
        {h.oleh ? <span style={{ fontSize: 12, color: "#64748b" }}>👷 {h.oleh}</span> : null}
      </div>

      {h.sore?.progress ? (
        <div style={{ fontSize: 14, lineHeight: 1.5, background: "#eff6ff", border: "1px solid #dbeafe", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
          <b style={{ color: "#1e40af" }}>Progres hari ini:</b> {h.sore.progress}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "#475569", marginBottom: allFotos.length ? 12 : 0 }}>
        {h.pagi?.jam ? <span>🌅 Mulai {h.pagi.jam}</span> : null}
        {h.sore?.jam ? <span>🌇 Selesai {h.sore.jam}</span> : null}
      </div>

      {materials.length > 0 && (
        <div style={{ fontSize: 12.5, color: "#475569", marginBottom: allFotos.length ? 12 : 0 }}>
          <b>Material:</b> {materials.join(" · ")}
        </div>
      )}

      {allFotos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 8 }}>
          {allFotos.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noreferrer" style={{ aspectRatio: 1, borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0", display: "block" }}>
              <img alt={`foto ${i + 1}`} src={url} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Screen({ icon, title, sub }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9", fontFamily: "system-ui,-apple-system,sans-serif", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
        <div style={{ fontWeight: 800, fontSize: 18, color: "#0f172a" }}>{title}</div>
        {sub ? <div style={{ fontSize: 14, color: "#64748b", marginTop: 8, lineHeight: 1.5 }}>{sub}</div> : null}
      </div>
    </div>
  );
}
