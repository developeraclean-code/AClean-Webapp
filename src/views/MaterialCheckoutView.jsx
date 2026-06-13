import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { reconcileDay, sumReportedUsage, reconStatus, RECON_TOLERANCE } from "../lib/materialRecon.js";

// Kompres gambar → base64 (tanpa prefix). Max 1280px, JPEG q0.7. (mirror ExpenseInputWidget)
function compressToBase64(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
        else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], preview: dataUrl });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const todayJkt = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const slug = (s) => String(s || "tek").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "tek";

const emptySession = () => ({ pipa: "", kabel: "", freon: {}, lain: [], photoUrl: "", photoPreview: "", notes: "" });

// items[] dari state sesi → bentuk standar utk DB + recon
function buildItems(sess, catalog) {
  const items = [];
  const codeFor = (type, label) => (catalog.find(c => c.material_type === type && (!label || c.label === label)) || {}).inventory_code || null;
  if (parseFloat(sess.pipa) > 0) items.push({ material_type: "pipa", inventory_code: codeFor("pipa"), label: "Pipa AC", qty: parseFloat(sess.pipa), satuan: "meter" });
  if (parseFloat(sess.kabel) > 0) items.push({ material_type: "kabel", inventory_code: codeFor("kabel"), label: "Kabel", qty: parseFloat(sess.kabel), satuan: "meter" });
  Object.entries(sess.freon || {}).forEach(([label, tabungs]) => {
    const arr = (tabungs || []).filter(t => parseFloat(t.kg) > 0).map(t => ({ label: t.label || "Tabung", kg: parseFloat(t.kg) }));
    if (arr.length > 0) items.push({ material_type: "freon", inventory_code: codeFor("freon", label), label, qty: arr.length, satuan: "kg", weight_kg: arr });
  });
  (sess.lain || []).forEach(l => {
    if (l.label && parseFloat(l.qty) > 0) items.push({ material_type: "lain", inventory_code: null, label: l.label, qty: parseFloat(l.qty), satuan: l.satuan || "pcs" });
  });
  return items;
}

// DB row.items → state sesi (untuk menampilkan yang sudah tersimpan)
function itemsToSession(row) {
  const s = emptySession();
  if (row.photo_url) s.photoUrl = row.photo_url;
  s.notes = row.notes || "";
  (row.items || []).forEach(it => {
    if (it.material_type === "pipa") s.pipa = String(it.qty);
    else if (it.material_type === "kabel") s.kabel = String(it.qty);
    else if (it.material_type === "freon") s.freon[it.label] = (Array.isArray(it.weight_kg) ? it.weight_kg : []).map(t => ({ label: t.label, kg: String(t.kg) }));
    else if (it.material_type === "lain") s.lain.push({ label: it.label, qty: String(it.qty), satuan: it.satuan });
  });
  return s;
}

function MaterialCheckoutView({ supabase, currentUser, showNotif, fotoSrc, _apiFetch, _apiHeaders, notifyOwnerWA, appSettings }) {
  const myName = currentUser?.name || "";
  const date = todayJkt();
  const [catalog, setCatalog] = useState([]);
  const [pagi, setPagi] = useState(emptySession());
  const [pulang, setPulang] = useState(emptySession());
  const [savedPagi, setSavedPagi] = useState(null);   // DB row
  const [savedPulang, setSavedPulang] = useState(null);
  const [busy, setBusy] = useState("");

  const freonTypes = catalog.filter(c => c.material_type === "freon").map(c => c.label);

  const load = useCallback(async () => {
    const { data: cat } = await supabase.from("material_checkout_items").select("*").eq("active", true).order("sort_order");
    setCatalog(cat || []);
    const { data: rows } = await supabase.from("teknisi_material_checkout")
      .select("*").eq("teknisi_name", myName).eq("checkout_date", date);
    const p = (rows || []).find(r => r.session_type === "pagi") || null;
    const u = (rows || []).find(r => r.session_type === "pulang") || null;
    setSavedPagi(p); setSavedPulang(u);
    if (p) setPagi(itemsToSession(p));
    if (u) setPulang(itemsToSession(u));
  }, [supabase, myName, date]);

  useEffect(() => { load(); }, [load]);

  const tolerances = (() => {
    try { return appSettings?.material_recon_tolerances ? JSON.parse(appSettings.material_recon_tolerances) : RECON_TOLERANCE; }
    catch { return RECON_TOLERANCE; }
  })();

  const uploadPhoto = async (file, session, setSess) => {
    try {
      setBusy(session + "_photo");
      const { base64, preview } = await compressToBase64(file);
      setSess(s => ({ ...s, photoPreview: preview }));
      const folder = "material-checkout/" + date.slice(0, 7) + "/" + slug(myName);
      const res = await _apiFetch("/api/upload-foto", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({ base64, filename: session + "_" + Date.now() + ".jpg", folder, mimeType: "image/jpeg" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.key) throw new Error(d.error || "upload gagal");
      setSess(s => ({ ...s, photoUrl: "/api/foto?key=" + encodeURIComponent(d.key) }));
      showNotif("✅ Foto terupload");
    } catch (e) { showNotif("❌ Upload foto gagal: " + (e?.message || e)); }
    finally { setBusy(""); }
  };

  const saveSession = async (session) => {
    const sess = session === "pagi" ? pagi : pulang;
    const saved = session === "pagi" ? savedPagi : savedPulang;
    const items = buildItems(sess, catalog);
    if (items.length === 0) { showNotif("⚠️ Belum ada material diinput"); return; }
    setBusy(session);
    try {
      const payload = {
        teknisi_name: myName, teknisi_id: currentUser?.id || null, checkout_date: date,
        session_type: session, items, notes: sess.notes || null,
        source: "app", created_by_name: myName, updated_at: new Date().toISOString(),
      };
      // Merge: jangan timpa photo_url dari jalur WA bila app tak punya foto baru
      if (sess.photoUrl) payload.photo_url = sess.photoUrl;
      let err;
      if (saved?.id) ({ error: err } = await supabase.from("teknisi_material_checkout").update(payload).eq("id", saved.id));
      else ({ error: err } = await supabase.from("teknisi_material_checkout").insert(payload));
      if (err) throw err;
      showNotif(`✅ Material ${session} tersimpan`);
      await load();
      if (session === "pulang") await runReconAlert();
    } catch (e) { showNotif("❌ Gagal simpan: " + (e?.message || e)); }
    finally { setBusy(""); }
  };

  // Setelah pulang tersimpan & pagi ada → recon; bila flag → alert owner
  const runReconAlert = async () => {
    try {
      const { data: rows } = await supabase.from("teknisi_material_checkout")
        .select("session_type,items").eq("teknisi_name", myName).eq("checkout_date", date);
      const p = (rows || []).find(r => r.session_type === "pagi");
      const u = (rows || []).find(r => r.session_type === "pulang");
      if (!p || !u) return;
      const { data: tx } = await supabase.from("inventory_transactions")
        .select("inventory_code,inventory_name,qty,qty_actual,type")
        .eq("teknisi_name", myName).eq("job_date", date).eq("type", "usage");
      const lines = reconcileDay(p.items, u.items, sumReportedUsage(tx || []), tolerances);
      const status = reconStatus(lines);
      if (status === "FLAGGED" && typeof notifyOwnerWA === "function") {
        const flagged = lines.filter(l => l.flag === "OVER" || l.flag === "UNDER");
        const msg = "⚠️ *Selisih Material Harian*\nTeknisi: " + myName + "\nTanggal: " + date + "\n\n" +
          flagged.map(l => `• ${l.label}: terpakai ${l.used_implied}${l.satuan} vs lapor ${l.used_reported}${l.satuan} (selisih ${l.selisih}) [${l.flag}]`).join("\n") +
          "\n\nCek di Stok Material → Recon. — ARA";
        notifyOwnerWA(msg);
      }
    } catch (e) { console.warn("[recon-alert]", e?.message || e); }
  };

  // ── UI helpers ──
  const setFreonTabung = (setSess, type, idx, kg) => setSess(s => {
    const f = { ...(s.freon || {}) };
    const arr = [...(f[type] || [])];
    arr[idx] = { ...arr[idx], kg };
    f[type] = arr;
    return { ...s, freon: f };
  });
  const addFreonTabung = (setSess, type) => setSess(s => {
    const f = { ...(s.freon || {}) };
    f[type] = [...(f[type] || []), { label: "Tabung " + ((f[type] || []).length + 1), kg: "" }];
    return { ...s, freon: f };
  });
  const removeFreonTabung = (setSess, type, idx) => setSess(s => {
    const f = { ...(s.freon || {}) };
    f[type] = (f[type] || []).filter((_, i) => i !== idx);
    return { ...s, freon: f };
  });

  const inp = { width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 11px", color: cs.text, fontSize: 14, outline: "none", boxSizing: "border-box" };
  const lbl = { fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 };

  const SessionCard = ({ session, sess, setSess, saved }) => (
    <div style={{ background: cs.panel, border: "1px solid " + cs.border, borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: cs.text }}>
          {session === "pagi" ? "🌅 Pagi — Material Dibawa" : "🌇 Pulang — Material Dikembalikan"}
        </div>
        {saved && <span style={{ fontSize: 11, color: cs.green, fontWeight: 700 }}>✓ Tersimpan</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div><div style={lbl}>Pipa AC (meter)</div><input type="number" inputMode="decimal" value={sess.pipa} onChange={e => setSess(s => ({ ...s, pipa: e.target.value }))} style={inp} placeholder="0" /></div>
        <div><div style={lbl}>Kabel (meter)</div><input type="number" inputMode="decimal" value={sess.kabel} onChange={e => setSess(s => ({ ...s, kabel: e.target.value }))} style={inp} placeholder="0" /></div>
      </div>

      {/* Freon per tipe — timbang per tabung (kg) */}
      <div style={{ marginBottom: 12 }}>
        <div style={lbl}>Freon (timbang per tabung, kg)</div>
        {freonTypes.map(type => (
          <div key={type} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: 10, marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{type}</span>
              <button onClick={() => addFreonTabung(setSess, type)} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Tabung</button>
            </div>
            {(sess.freon?.[type] || []).map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: cs.muted, minWidth: 70 }}>{t.label || "Tabung " + (i + 1)}</span>
                <input type="number" inputMode="decimal" value={t.kg} onChange={e => setFreonTabung(setSess, type, i, e.target.value)} style={{ ...inp, flex: 1 }} placeholder="kg" />
                <button onClick={() => removeFreonTabung(setSess, type, i)} style={{ background: "none", border: "none", color: cs.red, cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Foto bukti */}
      <div style={{ marginBottom: 12 }}>
        <div style={lbl}>Foto Bukti</div>
        {(sess.photoPreview || sess.photoUrl) && (
          <img src={sess.photoPreview || fotoSrc(sess.photoUrl)} alt="bukti" style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
        )}
        <label style={{ display: "block", background: cs.card, border: "1px dashed " + cs.border, borderRadius: 8, padding: "10px", textAlign: "center", color: cs.muted, cursor: "pointer", fontSize: 13 }}>
          {busy === session + "_photo" ? "⏳ Upload..." : "📷 Pilih / Ambil Foto"}
          <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => e.target.files[0] && uploadPhoto(e.target.files[0], session, setSess)} />
        </label>
      </div>

      <button disabled={busy === session} onClick={() => saveSession(session)}
        style={{ width: "100%", background: busy === session ? cs.border : "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: 12, borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
        {busy === session ? "Menyimpan..." : saved ? "Update " + session : "Simpan " + session}
      </button>
    </div>
  );

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: cs.text }}>📥 Material Harian</div>
        <div style={{ fontSize: 13, color: cs.muted }}>{myName} · {date}</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 6, background: cs.panel, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 11px" }}>
          Catat material yang <b>dibawa pagi</b> & <b>dikembalikan sore</b>. Selisih dicocokkan dengan pemakaian di laporan job. Bisa juga kirim foto via WA: caption <b>"Material Pagi"</b> / <b>"Material Pulang"</b>.
        </div>
      </div>
      <SessionCard session="pagi" sess={pagi} setSess={setPagi} saved={savedPagi} />
      <SessionCard session="pulang" sess={pulang} setSess={setPulang} saved={savedPulang} />
    </div>
  );
}

export default MaterialCheckoutView;
