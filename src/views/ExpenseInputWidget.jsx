import { useState, useEffect } from "react";
import { cs } from "../theme/cs.js";

// Widget input pengeluaran teknisi (Bensin/Parkir) di dashboard.
// Tiap foto = 1 expense. AI vision validasi tanggal+nominal → auto-approve / review manual.
const CATS = [
  { key: "Bensin Motor", icon: "⛽", max: 3, hint: "Foto struk SPBU" },
  { key: "Parkir", icon: "🅿️", max: 5, hint: "Foto karcis/struk parkir" },
];

// Kompres gambar → base64 (tanpa prefix data:). Max 1280px, JPEG q0.7.
function compressToBase64(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      // ── Watermark timestamp WIB (bukti kapan foto diproses/diupload) ──
      // Label "Difoto:" sengaja dipakai agar jelas beda dari tanggal yang tercetak di struk.
      const stamp = "Difoto: " + new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }) + " WIB";
      const fontSize = Math.max(13, Math.round(width * 0.030));
      const pad = Math.round(fontSize * 0.5);
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      ctx.textBaseline = "bottom";
      const textW = ctx.measureText(stamp).width;
      const boxH = fontSize + pad * 2;
      ctx.fillStyle = "rgba(0,0,0,0.55)";          // strip latar agar terbaca di struk terang
      ctx.fillRect(0, height - boxH, textW + pad * 2, boxH);
      ctx.fillStyle = "#fff";
      ctx.fillText(stamp, pad, height - pad);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve({ base64: dataUrl.split(",")[1], preview: dataUrl, mimeType: "image/jpeg" });
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ExpenseInputWidget({ currentUser, apiHeaders, supabase, showNotif, TODAY }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState("Bensin Motor");
  const [rows, setRows] = useState([]); // { id, base64, preview, mimeType, amount }
  const [submitting, setSubmitting] = useState(false);
  const [todayItems, setTodayItems] = useState([]);
  const myName = currentUser?.name || "";
  const today = TODAY || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  const catCfg = CATS.find(c => c.key === cat);

  const loadToday = async () => {
    if (!supabase || !myName) return;
    const { data } = await supabase.from("expenses")
      .select("id,subcategory,amount,validation_status,description,created_at")
      .eq("teknisi_name", myName).eq("date", today)
      .in("subcategory", ["Bensin Motor", "Parkir"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setTodayItems(data || []);
  };
  useEffect(() => { loadToday(); /* eslint-disable-line */ }, [myName, today]);

  const totalToday = todayItems.reduce((s, e) => s + Number(e.amount || 0), 0);
  const bensinToday = todayItems.filter(e => e.subcategory === "Bensin Motor").reduce((s, e) => s + Number(e.amount || 0), 0);
  const parkirToday = todayItems.filter(e => e.subcategory === "Parkir").reduce((s, e) => s + Number(e.amount || 0), 0);
  const fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

  const addPhotos = async (files) => {
    const arr = Array.from(files || []);
    const room = catCfg.max - rows.length;
    if (room <= 0) { showNotif?.(`⚠️ Maksimal ${catCfg.max} foto untuk ${cat}`); return; }
    const take = arr.slice(0, room);
    for (const f of take) {
      try {
        const c = await compressToBase64(f);
        setRows(prev => [...prev, { id: Date.now() + Math.random(), ...c, amount: "" }]);
      } catch { showNotif?.("❌ Gagal proses 1 foto"); }
    }
  };

  const submit = async () => {
    if (rows.length === 0) { showNotif?.("⚠️ Tambah minimal 1 foto"); return; }
    if (rows.some(r => !r.amount || parseInt(String(r.amount).replace(/\D/g, "")) < 1000)) { showNotif?.("⚠️ Isi nominal tiap foto (min Rp 1.000)"); return; }
    setSubmitting(true);
    try {
      const headers = await apiHeaders();
      const items = rows.map(r => ({ base64: r.base64, mimeType: r.mimeType, amount: parseInt(String(r.amount).replace(/\D/g, "")) }));
      const res = await fetch("/api/expense-submit", {
        method: "POST", headers,
        body: JSON.stringify({ category: cat, teknisi_name: myName, teknisi_phone: currentUser?.phone || null, items }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showNotif?.("❌ " + (j.error || "Gagal kirim")); return; }
      const s = j.summary || {};
      const parts = [];
      if (s.approved) parts.push(`${s.approved} auto-approve`);
      if (s.need_review) parts.push(`${s.need_review} perlu review`);
      if (s.duplicate) parts.push(`${s.duplicate} duplikat`);
      if (s.error) parts.push(`${s.error} gagal`);
      showNotif?.("✅ " + (parts.join(", ") || "Terkirim"));
      setRows([]); setOpen(false);
      loadToday();
    } catch (e) { showNotif?.("❌ " + e.message); }
    finally { setSubmitting(false); }
  };

  const statusPill = (st) => {
    const m = { APPROVED: [cs.green, "✅ Disetujui"], PENDING_AI: [cs.yellow, "⏳ Review"], PENDING_REVIEW: [cs.yellow, "⏳ Review"] }[st] || [cs.muted, st];
    return <span style={{ fontSize: 10, fontWeight: 700, color: m[0] }}>{m[1]}</span>;
  };

  return (
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: todayItems.length > 0 || open ? 12 : 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>🧾 Pengeluaran Hari Ini</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 1 }}>
            {totalToday > 0
              ? <>Total <b style={{ color: cs.text }}>{fmtRp(totalToday)}</b> · ⛽ {fmtRp(bensinToday)} · 🅿️ {fmtRp(parkirToday)}</>
              : "Input bensin & parkir — foto struk, auto-cek AI"}
          </div>
        </div>
        <button onClick={() => setOpen(o => !o)}
          style={{ background: open ? cs.surface : "linear-gradient(135deg,#16a34a,#15803d)", border: open ? "1px solid " + cs.border : "none", color: open ? cs.muted : "#fff", padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
          {open ? "Tutup" : "+ Input"}
        </button>
      </div>

      {/* Form input */}
      {open && (
        <div style={{ display: "grid", gap: 12, borderTop: "1px solid " + cs.border, paddingTop: 12, marginBottom: todayItems.length > 0 ? 12 : 0 }}>
          {/* Pilih kategori */}
          <div style={{ display: "flex", gap: 8 }}>
            {CATS.map(c => (
              <button key={c.key} onClick={() => { setCat(c.key); setRows([]); }}
                style={{ flex: 1, padding: "10px", borderRadius: 9, border: "1px solid " + (cat === c.key ? cs.accent : cs.border), background: cat === c.key ? cs.accent + "22" : cs.surface, color: cat === c.key ? cs.accent : cs.muted, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                {c.icon} {c.key === "Bensin Motor" ? "Bensin" : "Parkir"}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: -4 }}>{catCfg.hint} · maksimal {catCfg.max} foto · tiap foto = 1 pengeluaran</div>

          {/* Rows: foto + nominal */}
          {rows.map((r, i) => (
            <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", background: cs.surface, borderRadius: 8, padding: 8 }}>
              <img src={r.preview} alt={"foto " + (i + 1)} style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 6, border: "1px solid " + cs.border }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Nominal foto #{i + 1}</div>
                <input value={r.amount} inputMode="numeric"
                  onChange={e => { const v = e.target.value.replace(/\D/g, ""); setRows(prev => prev.map(x => x.id === r.id ? { ...x, amount: v ? Number(v).toLocaleString("id-ID") : "" } : x)); }}
                  placeholder="contoh: 20.000"
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 10px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
              </div>
              <button onClick={() => setRows(prev => prev.filter(x => x.id !== r.id))}
                style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, borderRadius: 6, width: 30, height: 30, cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
          ))}

          {/* Tambah foto — Kamera (foto langsung) atau Galeri (pilih file) */}
          {rows.length < catCfg.max && (
            <div>
              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ flex: 1, display: "block", border: "2px dashed " + cs.border, borderRadius: 9, padding: "12px", textAlign: "center", cursor: "pointer", color: cs.muted, fontSize: 13 }}>
                  📷 Kamera
                  <input type="file" accept="image/*" capture="environment" multiple onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
                </label>
                <label style={{ flex: 1, display: "block", border: "2px dashed " + cs.border, borderRadius: 9, padding: "12px", textAlign: "center", cursor: "pointer", color: cs.muted, fontSize: 13 }}>
                  🖼️ Galeri
                  <input type="file" accept="image/*" multiple onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
                </label>
              </div>
              <div style={{ fontSize: 10, color: cs.muted, textAlign: "center", marginTop: 4 }}>{rows.length}/{catCfg.max} foto</div>
            </div>
          )}

          <button onClick={submit} disabled={submitting || rows.length === 0}
            style={{ background: (submitting || rows.length === 0) ? cs.surface : "linear-gradient(135deg,#16a34a,#15803d)", border: "none", color: (submitting || rows.length === 0) ? cs.muted : "#fff", padding: "12px", borderRadius: 10, cursor: (submitting || rows.length === 0) ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 14 }}>
            {submitting ? "⏳ Memproses AI..." : `🧾 Kirim ${rows.length} Pengeluaran`}
          </button>
          <div style={{ fontSize: 10, color: cs.muted, textAlign: "center" }}>
            AI cek tanggal & nominal struk. Cocok = auto-disetujui, beda = review Admin.
          </div>
        </div>
      )}

      {/* Riwayat hari ini */}
      {todayItems.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {todayItems.map(e => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: cs.surface, borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: cs.text }}>{e.subcategory === "Bensin Motor" ? "⛽" : "🅿️"} {fmtRp(e.amount)}</div>
              </div>
              <div style={{ textAlign: "right" }}>{statusPill(e.validation_status)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
