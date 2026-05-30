import { useState, useEffect, useRef, useMemo } from "react";
import { cs } from "../theme/cs.js";

// Preset ruangan (sama dengan datalist di laporan)
const RUANGAN_PRESET = [
  "Ruang Tamu","Ruang Keluarga","Ruang Makan","Kamar Tidur Utama","Kamar Tidur Anak",
  "Kamar Mandi","Dapur","Garasi","Teras","Kamar Pembantu",
  "Kamar utama lt.1","Kamar utama lt.2","Kamar anak lt.1","Kamar anak lt.2",
  "Lantai 1 — Ruko","Lantai 2 — Ruko","Lantai 3 — Ruko","Lantai 4 — Ruko",
  "Ruang kantor","Ruang kantor mezanin","Ruang meeting","Ruang resepsionis",
  "Gudang","Pantry","Lobby",
];
const KAPASITAS_OPT = ["0.5 PK","0.75 PK","1 PK","1.5 PK","2 PK","2.5 PK","3 PK","3.5 PK","4 PK","5 PK"];
const BRAND_OPT = ["Daikin","Panasonic","Sharp","Samsung","LG","Mitsubishi","Gree","Haier","Midea","Hisense","Aux","Polytron"];

const REK_CHIPS = [
  { lbl: "+ Cuci rutin", txt: "Disarankan cuci rutin 3 bulan sekali." },
  { lbl: "+ Pipa ganti", txt: "Pipa lama perlu diganti." },
  { lbl: "+ Freon", txt: "Freon sudah ditambah & dicek normal." },
  { lbl: "+ Tambahan disetujui", txt: "Ada tambahan pekerjaan disetujui customer di lokasi." },
];

// Build BAP number BAP-YYYYMMDD-NNN (counter dari DB, reset per hari)
async function nextBapNumber(supabase, todayStr) {
  const prefix = `BAP-${todayStr.replace(/-/g, "")}-`;
  const { data, error } = await supabase
    .from("service_reports")
    .select("bap_number")
    .like("bap_number", `${prefix}%`)
    .order("bap_number", { ascending: false })
    .limit(1);
  if (error) return prefix + "001";
  const last = data && data[0]?.bap_number;
  const n = last ? parseInt(last.slice(prefix.length), 10) : 0;
  return prefix + String((n || 0) + 1).padStart(3, "0");
}

export default function BAPModal({ order, onClose, onSubmitted, supabase, showNotif, currentUser, apiHeaders, appSettings, getLocalDate, fotoSrc }) {
  if (!order) return null;
  const todayStr = getLocalDate?.() || new Date().toISOString().slice(0, 10);

  // Statement default dari appSettings, fallback hardcode
  const defaultStatement = appSettings?.bap_statement_default ||
    "Dengan ditandatanganinya Berita Acara ini, customer menyatakan bahwa pekerjaan AC di atas telah selesai dikerjakan dengan baik, unit berfungsi normal, dan area kerja telah dirapikan. Customer menerima hasil pekerjaan tanpa keberatan.";

  // Pre-fill unit rows dari order.units
  const unitCount = Math.max(1, Number(order.units) || 1);
  const [units, setUnits] = useState(() =>
    Array.from({ length: unitCount }, (_, i) => ({
      _id: i + "-" + Math.random(),
      no: i + 1, ruangan: "", brand: "", kapasitas: "",
    }))
  );

  const [rekomendasi, setRekomendasi] = useState("");
  const [statement, setStatement] = useState(defaultStatement);
  const [editStmt, setEditStmt] = useState(false);
  const [custName, setCustName] = useState(order.customer || "");
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [bapNumber, setBapNumber] = useState("");

  // Generate BAP number sekali saat modal dibuka
  useEffect(() => {
    nextBapNumber(supabase, todayStr).then(setBapNumber);
  }, []);

  // ─── Signature pad ───
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const [hasSig, setHasSig] = useState(false);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a";
    ctxRef.current = ctx;
  }, []);

  const posOf = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  const sigStart = (e) => { e.preventDefault(); setDrawing(true); const p = posOf(e); const ctx = ctxRef.current; ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const sigMove  = (e) => { if (!drawing) return; e.preventDefault(); const p = posOf(e); const ctx = ctxRef.current; ctx.lineTo(p.x, p.y); ctx.stroke(); if (!hasSig) setHasSig(true); };
  const sigEnd   = () => setDrawing(false);
  const sigClear = () => {
    const c = canvasRef.current; if (!c) return;
    const ctx = ctxRef.current;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasSig(false);
  };

  // ─── Upload TTD ke R2 ───
  const uploadTtd = async () => {
    const canvas = canvasRef.current;
    // Bikin PNG putih solid (tidak transparan) supaya enak ditempel di invoice/PDF nanti
    const out = document.createElement("canvas");
    out.width = canvas.width; out.height = canvas.height;
    const octx = out.getContext("2d");
    octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0);
    const dataUrl = out.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];
    const filename = `${bapNumber}_customer_${Date.now()}.png`;
    const res = await fetch("/api/upload-foto", {
      method: "POST",
      headers: await apiHeaders(),
      body: JSON.stringify({
        base64, filename,
        folder: `signatures/${order.id}`,
        mimeType: "image/png",
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success || !d.key) throw new Error(d.error || "Upload TTD gagal");
    return d.key; // simpan key, akses via /api/foto?key=...
  };

  // ─── Submit BAP ───
  const handleSubmit = async ({ skipped = false }) => {
    if (!skipped && (!hasSig || !custName.trim())) {
      showNotif?.("⚠ TTD customer & nama wajib diisi"); return;
    }
    if (skipped && !skipReason.trim()) {
      showNotif?.("⚠ Wajib isi alasan kenapa customer tidak TTD"); return;
    }
    // PK (kapasitas) WAJIB di tiap unit — pricing invoice bergantung di sini.
    // Brand & ruangan tetap opsional supaya cepat di lokasi.
    const missPK = units.findIndex(u => !u.kapasitas);
    if (missPK !== -1) {
      showNotif?.(`⚠ Unit ${missPK + 1}: PK (kapasitas) wajib diisi — invoice akan salah kalau dikosongkan`);
      return;
    }
    setSaving(true);
    try {
      // Upload TTD kalau tidak di-skip
      let ttdKey = null;
      if (!skipped) {
        ttdKey = await uploadTtd();
      }

      // Bangun units_json untuk laporan minimal — teknisi lengkapi material/foto nanti di kantor
      const unitsForReport = units.map((u, i) => ({
        no: i + 1,
        label: u.ruangan || `Unit ${i + 1}`,
        ruangan: u.ruangan || "",
        brand: u.brand || "",
        kapasitas: u.kapasitas || "",
        // Field detail lainnya dikosongkan — dilengkapi nanti
        kondisi_sebelum: "", kondisi_setelah: "",
        material_ids: [], freon_kg: 0, fotos: [],
      }));

      const reportId = "REP-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
      const payload = {
        id: reportId,
        job_id: order.id,
        teknisi: order.teknisi || currentUser?.name || "",
        helper: order.helper || null,
        customer: order.customer,
        service: order.service,
        type: order.type || "",
        date: order.date || todayStr,
        total_units: unitCount,
        units: unitsForReport,
        materials_used: [],
        foto_urls: [],
        rekomendasi: rekomendasi || null,
        catatan_global: null,
        status: "SUBMITTED",
        submitted_at: new Date().toISOString(),
        // ── Fields BAP ──
        bap_number:         bapNumber,
        bap_statement:      statement,
        bap_recommendation: rekomendasi || null,
        ttd_customer_url:   ttdKey || null,
        ttd_customer_name:  skipped ? null : custName.trim(),
        bap_skipped_reason: skipped ? skipReason.trim() : null,
        bap_signed_at:      new Date().toISOString(),
        last_changed_by:    currentUser?.name || "Teknisi",
      };

      const { error } = await supabase.from("service_reports").insert(payload);
      if (error) throw new Error(error.message);

      showNotif?.(`✅ BAP ${bapNumber} tersimpan — laporan SUBMITTED. Lengkapi detail di kantor.`);
      onSubmitted?.(payload);
      onClose?.();
    } catch (err) {
      showNotif?.("❌ " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  const updateUnit = (idx, field, val) =>
    setUnits(prev => prev.map((u, i) => i === idx ? { ...u, [field]: val } : u));
  const addUnit = () =>
    setUnits(prev => [...prev, { _id: prev.length + "-" + Math.random(), no: prev.length + 1, ruangan: "", brand: "", kapasitas: "" }]);
  const removeUnit = (idx) =>
    setUnits(prev => prev.filter((_, i) => i !== idx).map((u, i) => ({ ...u, no: i + 1 })));

  const appendRek = (txt) =>
    setRekomendasi(prev => (prev ? prev + "\n" : "") + txt);

  // Styles
  const card = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 14 };
  const inp  = { width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 9, padding: "9px 11px", color: cs.text, fontSize: 13, boxSizing: "border-box" };
  const lbl  = { fontSize: 11, color: cs.muted, marginBottom: 4, display: "block" };
  const ttl  = { fontSize: 11, fontWeight: 800, color: cs.accent, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 600, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }}>
      <div style={{ background: cs.bg, border: "1px solid " + cs.border, borderRadius: 18, width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", overflow: "hidden", marginTop: 8, marginBottom: 24 }}>

        {/* Header */}
        <div style={{ background: cs.surface, padding: "14px 18px", borderBottom: "1px solid " + cs.border, display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>‹</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>📋 Berita Acara Pengerjaan</div>
            <div style={{ fontSize: 11, color: cs.muted }}>{bapNumber || "BAP-..."} · TTD customer</div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Data Job */}
          <div style={card}>
            <div style={ttl}>Data Pekerjaan</div>
            {[
              ["Customer", order.customer],
              ["Lokasi", order.address || order.area || "—"],
              ["Tanggal", order.date || todayStr],
              ["Layanan", `${order.service || "—"} · ${unitCount} unit`],
              ["Teknisi", [order.teknisi, order.helper].filter(Boolean).join(" + ") || "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                <span style={{ color: cs.muted }}>{k}</span>
                <span style={{ color: cs.text, fontWeight: 600, textAlign: "right", maxWidth: "62%" }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Unit Dikerjakan */}
          <div style={card}>
            <div style={ttl}>Unit Dikerjakan</div>
            <datalist id="bap-ruangan-preset">
              {RUANGAN_PRESET.map(r => <option key={r} value={r} />)}
            </datalist>
            <div style={{ display: "grid", gap: 10 }}>
              {units.map((u, idx) => (
                <div key={u._id} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>Unit {u.no}</span>
                    {units.length > 1 && (
                      <button onClick={() => removeUnit(idx)} style={{ background: "none", border: "none", color: cs.red, cursor: "pointer", fontSize: 14 }}>✕</button>
                    )}
                  </div>
                  <input
                    list="bap-ruangan-preset"
                    placeholder="Ruangan (mis. Kamar utama lt.2)"
                    value={u.ruangan}
                    onChange={e => updateUnit(idx, "ruangan", e.target.value)}
                    style={{ ...inp, marginBottom: 6 }}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <select value={u.brand} onChange={e => updateUnit(idx, "brand", e.target.value)} style={inp}>
                      <option value="">Brand</option>
                      {BRAND_OPT.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <select value={u.kapasitas} onChange={e => updateUnit(idx, "kapasitas", e.target.value)}
                      style={{ ...inp, borderColor: u.kapasitas ? cs.border : cs.red, background: u.kapasitas ? cs.surface : cs.red + "10" }}>
                      <option value="">PK wajib *</option>
                      {KAPASITAS_OPT.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              <button onClick={addUnit} style={{ background: "transparent", border: "1px dashed " + cs.border, color: cs.muted, borderRadius: 9, padding: "9px 12px", cursor: "pointer", fontSize: 12 }}>
                + Tambah Unit
              </button>
            </div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 8 }}>📝 Material & foto bisa dilengkapi nanti dari kantor.</div>
          </div>

          {/* Rekomendasi / Catatan */}
          <div style={{ ...card, borderColor: cs.yellow + "55" }}>
            <div style={{ ...ttl, color: cs.yellow }}>📌 Rekomendasi / Catatan</div>
            <div style={{ fontSize: 11, color: cs.muted, marginBottom: 8 }}>
              Ringkasan yang customer baca sebelum TTD. TTD = bukti customer setuju atas hasil & tambahan.
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {REK_CHIPS.map(c => (
                <button key={c.lbl} onClick={() => appendRek(c.txt)}
                  style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer" }}>
                  {c.lbl}
                </button>
              ))}
            </div>
            <textarea value={rekomendasi} onChange={e => setRekomendasi(e.target.value)}
              placeholder="Tulis ringkasan & rekomendasi untuk customer..."
              rows={4} style={{ ...inp, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" }} />
          </div>

          {/* Pernyataan */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={ttl}>Pernyataan</div>
              <button onClick={() => setEditStmt(v => !v)} style={{ fontSize: 11, color: cs.accent, background: "transparent", border: "none", cursor: "pointer", fontWeight: 700 }}>
                {editStmt ? "✓ Selesai edit" : "✏ Edit"}
              </button>
            </div>
            {editStmt ? (
              <textarea value={statement} onChange={e => setStatement(e.target.value)}
                rows={5} style={{ ...inp, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" }} />
            ) : (
              <div style={{ fontSize: 12.5, color: "#cbd5e1", lineHeight: 1.6 }}>{statement}</div>
            )}
          </div>

          {/* TTD Customer */}
          <div style={card}>
            <div style={ttl}>Tanda Tangan Customer</div>
            <div style={{ position: "relative" }}>
              <canvas ref={canvasRef}
                style={{ width: "100%", height: 180, background: "#f8fafc", border: "2px dashed #94a3b8", borderRadius: 11, touchAction: "none", display: "block" }}
                onMouseDown={sigStart} onMouseMove={sigMove} onMouseUp={sigEnd} onMouseLeave={sigEnd}
                onTouchStart={sigStart} onTouchMove={sigMove} onTouchEnd={sigEnd} />
              {!hasSig && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13, pointerEvents: "none" }}>
                  ✍️ Tanda tangan customer di sini
                </div>
              )}
            </div>
            <button onClick={sigClear} disabled={!hasSig}
              style={{ marginTop: 8, width: "100%", padding: 9, borderRadius: 9, border: "1px solid " + cs.border, background: cs.surface, color: cs.muted, fontSize: 12, fontWeight: 600, cursor: hasSig ? "pointer" : "not-allowed", opacity: hasSig ? 1 : 0.5 }}>
              🗑 Hapus & Ulangi
            </button>
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>Nama Customer / Penerima</label>
              <input type="text" value={custName} onChange={e => setCustName(e.target.value)}
                placeholder="Nama yang menandatangani" style={inp} />
            </div>
          </div>

          {/* Submit utama */}
          <button onClick={() => handleSubmit({ skipped: false })}
            disabled={saving || !hasSig || !custName.trim()}
            style={{ padding: 14, borderRadius: 12, border: "none", background: cs.green, color: "#fff", fontWeight: 800, fontSize: 15, cursor: (saving || !hasSig || !custName.trim()) ? "not-allowed" : "pointer", opacity: (saving || !hasSig || !custName.trim()) ? 0.5 : 1 }}>
            {saving ? "Menyimpan..." : "✅ Submit BAP & Laporan Cepat"}
          </button>

          {/* Skip opsi */}
          <div style={{ textAlign: "center" }}>
            <button onClick={() => setSkipOpen(v => !v)}
              style={{ background: "transparent", border: "none", color: cs.yellow, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
              ⚠ Customer tidak di tempat / tidak bisa TTD?
            </button>
          </div>
          {skipOpen && (
            <div style={{ ...card, borderColor: cs.yellow + "55", background: cs.yellow + "08" }}>
              <div style={{ ...ttl, color: cs.yellow }}>Alasan Skip TTD Customer</div>
              <textarea value={skipReason} onChange={e => setSkipReason(e.target.value)}
                placeholder="Wajib: kenapa TTD customer tidak bisa diambil?"
                rows={3} style={{ ...inp, fontFamily: "inherit", resize: "vertical" }} />
              <button onClick={() => handleSubmit({ skipped: true })}
                disabled={saving || !skipReason.trim()}
                style={{ marginTop: 10, width: "100%", padding: 13, borderRadius: 11, border: "none", background: cs.yellow, color: "#fff", fontWeight: 800, fontSize: 14, cursor: (saving || !skipReason.trim()) ? "not-allowed" : "pointer", opacity: (saving || !skipReason.trim()) ? 0.5 : 1 }}>
                Submit BAP tanpa TTD Customer
              </button>
            </div>
          )}

          <div style={{ fontSize: 11, color: cs.muted, textAlign: "center", lineHeight: 1.5, marginBottom: 8 }}>
            Setelah submit, laporan masuk status <b>SUBMITTED</b>.<br />Detail lengkap (material, foto, harga) dilengkapi nanti dari kantor.
          </div>
        </div>
      </div>
    </div>
  );
}
