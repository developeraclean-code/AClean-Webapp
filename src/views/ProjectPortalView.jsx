import { useEffect, useState } from "react";

// Portal customer modul Project (clean view). Dibuka via /p/<token> atau /status/ptk_<...>.
// Data dari /api/project-portal — hanya laporan harian VERIFIED (approval Owner/Admin).
// TIDAK menampilkan data finansial (nilai/RAB/harga) — backend sudah strip.

const API = "/api";
function fmtDate(d) { if (!d) return "—"; try { return new Date(d).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); } catch { return d; } }
function fmtDateShort(d) { if (!d) return "—"; try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" }); } catch { return d; } }

// Foto R2 private — extract key dari full URL, serve via /api/foto proxy
function fotoSrc(url) {
  if (!url) return "";
  if (url.startsWith("/api/foto")) return url;
  if (url.includes(".r2.dev/")) {
    const m = url.match(/\.r2\.dev\/(.+)$/);
    if (m) return `${API}/foto?key=${encodeURIComponent(m[1])}`;
  }
  if (url.includes(".r2.cloudflarestorage.com/")) {
    const m = url.match(/cloudflarestorage\.com\/[^/]+\/(.+)$/);
    if (m) return `${API}/foto?key=${encodeURIComponent(m[1])}`;
  }
  if (!url.startsWith("http")) return `${API}/foto?key=${encodeURIComponent(url)}`;
  return url;
}

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

  const { project = {}, usage = [], beritaAcara = [], documents = [] } = state;
  const [stColor, stLabel] = PSTATUS[project.status] || ["#64748b", project.status || "—"];

  // Ringkasan total pemakaian material (jumlahkan qty per nama+satuan)
  const usageSummary = (() => {
    const m = {}; // key "nama|satuan" → { nama, satuan, qty }
    usage.forEach(u => {
      const nama = (u.material || "—").trim();
      const satuan = (u.satuan || "").trim();
      const key = nama + "|" + satuan;
      if (!m[key]) m[key] = { nama, satuan, qty: 0 };
      m[key].qty += Number(u.qty) || 0;
    });
    return Object.values(m).sort((a, b) => a.nama.localeCompare(b.nama));
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

        {/* Berita Acara Harian */}
        {beritaAcara.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: "20px 4px 12px" }}>📋 Berita Acara Harian ({beritaAcara.length})</h2>
            <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
              {beritaAcara.map(ba => <BeritaAcaraCard key={ba.id} ba={ba} />)}
            </div>
          </>
        )}

        {/* Total pemakaian material */}
        {usageSummary.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.06)", padding: 18, marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: "0 0 12px" }}>📦 Pemakaian Material</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {usageSummary.map((u) => (
                <div key={u.nama + "|" + u.satuan} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 12px", background: "#f8fafc", borderRadius: 10 }}>
                  <span>{u.nama}</span>
                  <b style={{ color: "#2563eb" }}>{u.qty}{u.satuan ? ` ${u.satuan}` : ""}</b>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dokumen Serah Terima / BAST */}
        {documents.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.06)", padding: 18, marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: "0 0 12px" }}>📑 Dokumen Serah Terima</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {documents.map((d) => (
                <div key={d.id} style={{ padding: "10px 14px", background: "#f8fafc", borderRadius: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{d.jenis}</span>
                    <span style={{ fontSize: 12, color: "#64748b" }}>{fmtDateShort(d.tanggal)}{d.nomor ? ` · ${d.nomor}` : ""}</span>
                  </div>
                  {d.uraian ? <div style={{ fontSize: 12.5, color: "#475569", marginTop: 4 }}>{d.uraian}</div> : null}
                  <div style={{ fontSize: 11.5, marginTop: 6, color: d.ttd_customer ? "#16a34a" : "#b45309" }}>
                    {d.ttd_customer ? `✅ Ditandatangani: ${d.ttd_customer}` : "⏳ Menunggu tanda tangan"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {beritaAcara.length === 0 && documents.length === 0 && (
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, textAlign: "center", color: "#64748b", fontSize: 14 }}>
            Belum ada laporan harian yang dipublikasikan.
          </div>
        )}

        <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, marginTop: 28 }}>
          Diperbarui otomatis · AClean Service
        </div>
      </div>
    </div>
  );
}

function BeritaAcaraCard({ ba }) {
  const [lightbox, setLightbox] = useState(null);
  const fotos = Array.isArray(ba.foto_urls) ? ba.foto_urls : [];
  const helpers = Array.isArray(ba.helper_names) ? ba.helper_names.filter(Boolean) : [];
  const tim = [ba.teknisi_name, ...helpers].filter(Boolean).join(", ");

  return (
    <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.06)", padding: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{fmtDate(ba.tanggal)}</span>
          {tim ? <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>👷 {tim}</div> : null}
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", background: "#dcfce7", padding: "3px 10px", borderRadius: 20 }}>✓ Diverifikasi</span>
      </div>

      {/* Pekerjaan */}
      <div style={{ fontSize: 14, lineHeight: 1.6, background: "#eff6ff", border: "1px solid #dbeafe", borderRadius: 10, padding: "10px 12px", marginBottom: ba.kendala ? 10 : 0, color: "#1e3a8a" }}>
        {ba.pekerjaan}
      </div>

      {/* Kendala */}
      {ba.kendala && (
        <div style={{ fontSize: 13, lineHeight: 1.5, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px", marginBottom: fotos.length ? 12 : 0, color: "#92400e" }}>
          <b>⚠️ Kendala:</b> {ba.kendala}
        </div>
      )}

      {/* Foto thumbnail */}
      {fotos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(80px,1fr))", gap: 8, marginTop: ba.kendala ? 0 : 10 }}>
          {fotos.map((url, i) => (
            <button
              key={i}
              onClick={() => setLightbox(url)}
              style={{ aspectRatio: 1, borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0", display: "block", padding: 0, cursor: "zoom-in", background: "#f8fafc" }}>
              <img
                alt={`foto ${i + 1}`}
                src={fotoSrc(url)}
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, cursor: "zoom-out" }}>
          <img src={fotoSrc(lightbox)} alt="foto besar" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 12, objectFit: "contain", boxShadow: "0 24px 80px rgba(0,0,0,.6)" }} />
          <button onClick={() => setLightbox(null)} style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,.15)", border: "none", color: "#fff", fontSize: 22, width: 40, height: 40, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
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
