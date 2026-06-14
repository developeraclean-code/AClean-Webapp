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

const MAX_PHOTOS = 5;
const todayJkt = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const slug = (s) => String(s || "tek").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "tek";

// Klasifikasi item inventory → kategori form (pipa/kabel/freon). Selain itu di-skip.
function classifyInv(name) {
  const n = String(name || "").toLowerCase();
  if (n.startsWith("freon")) return "freon";
  if (n.startsWith("pipa ac")) return "pipa";
  if (n.startsWith("kabel")) return "kabel";  // termasuk "KABEL Listrik 4x2,5"
  return null;                                 // KLEM PIPA PVC dll → diabaikan
}

const emptySession = () => ({ pipa: {}, kabel: {}, freon: {}, photos: [], notes: "" });

// state sesi → items[] standar utk DB + recon (keyed per inventory_code)
function buildItems(sess, materials) {
  const items = [];
  const nameOf = (code) => (materials.find((m) => m.code === code) || {}).name || code;
  Object.entries(sess.pipa || {}).forEach(([code, v]) => {
    if (parseFloat(v) > 0) items.push({ material_type: "pipa", inventory_code: code, label: nameOf(code), qty: parseFloat(v), satuan: "meter" });
  });
  Object.entries(sess.kabel || {}).forEach(([code, v]) => {
    if (parseFloat(v) > 0) items.push({ material_type: "kabel", inventory_code: code, label: nameOf(code), qty: parseFloat(v), satuan: "meter" });
  });
  Object.entries(sess.freon || {}).forEach(([code, tabungs]) => {
    const arr = (tabungs || []).filter((t) => parseFloat(t.kg) > 0).map((t) => ({ label: t.label || "Tabung", kg: parseFloat(t.kg) }));
    if (arr.length > 0) items.push({ material_type: "freon", inventory_code: code, label: nameOf(code), qty: arr.length, satuan: "kg", weight_kg: arr });
  });
  return items;
}

// DB row → state sesi
function itemsToSession(row) {
  const s = emptySession();
  s.notes = row.notes || "";
  const urls = Array.isArray(row.photo_urls) && row.photo_urls.length ? row.photo_urls : (row.photo_url ? [row.photo_url] : []);
  s.photos = urls.map((u, i) => ({ id: "saved" + i, url: u, preview: "" }));
  (row.items || []).forEach((it) => {
    const code = it.inventory_code || it.label;
    if (it.material_type === "pipa") s.pipa[code] = String(it.qty);
    else if (it.material_type === "kabel") s.kabel[code] = String(it.qty);
    else if (it.material_type === "freon") s.freon[code] = (Array.isArray(it.weight_kg) ? it.weight_kg : []).map((t) => ({ label: t.label, kg: String(t.kg) }));
  });
  return s;
}

function MaterialCheckoutView({ supabase, currentUser, showNotif, fotoSrc, _apiFetch, _apiHeaders, notifyOwnerWA, appSettings }) {
  const myName = currentUser?.name || "";
  const date = todayJkt();
  const [materials, setMaterials] = useState([]);  // [{code,name,kategori,unit,stock}]
  const [pagi, setPagi] = useState(emptySession());
  const [pulang, setPulang] = useState(emptySession());
  const [savedPagi, setSavedPagi] = useState(null);
  const [savedPulang, setSavedPulang] = useState(null);
  const [busy, setBusy] = useState("");

  const byKat = (k) => materials.filter((m) => m.kategori === k);

  const load = useCallback(async () => {
    const { data: inv } = await supabase.from("inventory").select("code,name,unit,stock,status");
    const mats = (inv || [])
      .map((it) => ({ ...it, kategori: classifyInv(it.name) }))
      .filter((it) => it.kategori)
      .sort((a, b) => a.kategori.localeCompare(b.kategori) || a.name.localeCompare(b.name));
    setMaterials(mats);
    const { data: rows } = await supabase.from("teknisi_material_checkout")
      .select("*").eq("teknisi_name", myName).eq("checkout_date", date);
    const p = (rows || []).find((r) => r.session_type === "pagi") || null;
    const u = (rows || []).find((r) => r.session_type === "pulang") || null;
    setSavedPagi(p); setSavedPulang(u);
    if (p) setPagi(itemsToSession(p));
    if (u) setPulang(itemsToSession(u));
  }, [supabase, myName, date]);

  useEffect(() => { load(); }, [load]);

  const tolerances = (() => {
    try { return appSettings?.material_recon_tolerances ? JSON.parse(appSettings.material_recon_tolerances) : RECON_TOLERANCE; }
    catch { return RECON_TOLERANCE; }
  })();

  // ── Foto (multi, max 5) ──
  const addPhotos = async (fileList, session, sess, setSess) => {
    const files = Array.from(fileList || []).slice(0, MAX_PHOTOS - sess.photos.length);
    if (!files.length) { showNotif(`Maksimal ${MAX_PHOTOS} foto`); return; }
    setBusy(session + "_photo");
    try {
      for (const file of files) {
        const tid = Date.now() + "_" + Math.random().toString(36).slice(2, 7);
        const { base64, preview } = await compressToBase64(file);
        setSess((s) => ({ ...s, photos: [...s.photos, { id: tid, url: "", preview }] }));
        const folder = "material-checkout/" + date.slice(0, 7) + "/" + slug(myName);
        const res = await _apiFetch("/api/upload-foto", {
          method: "POST", headers: await _apiHeaders(),
          body: JSON.stringify({ base64, filename: session + "_" + tid + ".jpg", folder, mimeType: "image/jpeg" }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.key) throw new Error(d.error || "upload gagal");
        const url = "/api/foto?key=" + encodeURIComponent(d.key);
        setSess((s) => ({ ...s, photos: s.photos.map((p) => (p.id === tid ? { ...p, url } : p)) }));
      }
      showNotif("✅ Foto terupload");
    } catch (e) { showNotif("❌ Upload foto gagal: " + (e?.message || e)); }
    finally { setBusy(""); }
  };
  const removePhoto = (setSess, id) => setSess((s) => ({ ...s, photos: s.photos.filter((p) => p.id !== id) }));

  const saveSession = async (session) => {
    const sess = session === "pagi" ? pagi : pulang;
    const saved = session === "pagi" ? savedPagi : savedPulang;
    const items = buildItems(sess, materials);
    if (items.length === 0) { showNotif("⚠️ Belum ada material diinput"); return; }
    const photoUrls = sess.photos.map((p) => p.url).filter(Boolean);
    setBusy(session);
    try {
      const payload = {
        teknisi_name: myName, teknisi_id: currentUser?.id || null, checkout_date: date,
        session_type: session, items, notes: sess.notes || null,
        source: "app", created_by_name: myName, updated_at: new Date().toISOString(),
        photo_urls: photoUrls,
      };
      if (photoUrls.length) payload.photo_url = photoUrls[0];  // kompat reader lama / WA
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

  const runReconAlert = async () => {
    try {
      const { data: rows } = await supabase.from("teknisi_material_checkout")
        .select("session_type,items").eq("teknisi_name", myName).eq("checkout_date", date);
      const p = (rows || []).find((r) => r.session_type === "pagi");
      const u = (rows || []).find((r) => r.session_type === "pulang");
      if (!p || !u) return;
      const { data: tx } = await supabase.from("inventory_transactions")
        .select("inventory_code,inventory_name,qty,qty_actual,type")
        .eq("teknisi_name", myName).eq("job_date", date).eq("type", "usage");
      const lines = reconcileDay(p.items, u.items, sumReportedUsage(tx || []), tolerances);
      if (reconStatus(lines) === "FLAGGED" && typeof notifyOwnerWA === "function") {
        const flagged = lines.filter((l) => l.flag === "OVER" || l.flag === "UNDER");
        const msg = "⚠️ *Selisih Material Harian*\nTeknisi: " + myName + "\nTanggal: " + date + "\n\n" +
          flagged.map((l) => `• ${l.label}: terpakai ${l.used_implied}${l.satuan} vs lapor ${l.used_reported}${l.satuan} (selisih ${l.selisih}) [${l.flag}]`).join("\n") +
          "\n\nCek di Stok Material → Recon. — ARA";
        notifyOwnerWA(msg);
      }
    } catch (e) { console.warn("[recon-alert]", e?.message || e); }
  };

  // ── setters ──
  const setMeter = (setSess, kat, code, v) => setSess((s) => ({ ...s, [kat]: { ...s[kat], [code]: v } }));
  const setFreonTabung = (setSess, code, idx, kg) => setSess((s) => {
    const f = { ...(s.freon || {}) }; const arr = [...(f[code] || [])];
    arr[idx] = { ...arr[idx], kg }; f[code] = arr; return { ...s, freon: f };
  });
  const addFreonTabung = (setSess, code) => setSess((s) => {
    const f = { ...(s.freon || {}) };
    f[code] = [...(f[code] || []), { label: "Tabung " + ((f[code] || []).length + 1), kg: "" }];
    return { ...s, freon: f };
  });
  const removeFreonTabung = (setSess, code, idx) => setSess((s) => {
    const f = { ...(s.freon || {}) }; f[code] = (f[code] || []).filter((_, i) => i !== idx); return { ...s, freon: f };
  });
  // pulang freon: preset label dari pagi, input sisa
  const setPulangFreon = (code, idx, kg, label) => setPulang((s) => {
    const f = { ...(s.freon || {}) }; const arr = [...(f[code] || [])];
    arr[idx] = { label, kg }; f[code] = arr; return { ...s, freon: f };
  });

  const inp = { width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 11px", color: cs.text, fontSize: 14, outline: "none", boxSizing: "border-box" };
  const lbl = { fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 6 };
  const stockTag = (m) => <span style={{ fontSize: 11, color: cs.muted }}> · stok kantor <b style={{ color: Number(m.stock) > 0 ? cs.green : cs.red }}>{m.stock} {m.unit?.toLowerCase()}</b></span>;

  // ── PAGI: semua material dari stok, input qty dibawa ──
  // NB: render-function (dipanggil langsung), bukan komponen JSX → input tak remount/kehilangan fokus.
  const pagiMeterRow = (kat, m) => (
    <div key={m.code} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: cs.text }}>{m.name}</div>
        <div>{stockTag(m)}</div>
      </div>
      <input type="number" inputMode="decimal" value={pagi[kat]?.[m.code] || ""} onChange={(e) => setMeter(setPagi, kat, m.code, e.target.value)} style={{ ...inp, width: 110 }} placeholder="meter" />
    </div>
  );

  const renderPagi = () => (
    <div style={{ background: cs.panel, border: "1px solid " + cs.border, borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: cs.text }}>🌅 Pagi — Material Dibawa</div>
        {savedPagi && <span style={{ fontSize: 11, color: cs.green, fontWeight: 700 }}>✓ Tersimpan</span>}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={lbl}>🔧 Pipa AC (meter)</div>
        {byKat("pipa").length === 0 ? <div style={{ fontSize: 12, color: cs.muted }}>—</div> : byKat("pipa").map((m) => pagiMeterRow("pipa", m))}
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={lbl}>⚡ Kabel (meter)</div>
        {byKat("kabel").length === 0 ? <div style={{ fontSize: 12, color: cs.muted }}>—</div> : byKat("kabel").map((m) => pagiMeterRow("kabel", m))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={lbl}>🧪 Freon (timbang per tabung, kg)</div>
        {byKat("freon").map((m) => (
          <div key={m.code} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: 10, marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{m.name}{stockTag(m)}</span>
              <button onClick={() => addFreonTabung(setPagi, m.code)} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Tabung</button>
            </div>
            {(pagi.freon?.[m.code] || []).map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: cs.muted, minWidth: 70 }}>{t.label || "Tabung " + (i + 1)}</span>
                <input type="number" inputMode="decimal" value={t.kg} onChange={(e) => setFreonTabung(setPagi, m.code, i, e.target.value)} style={{ ...inp, flex: 1 }} placeholder="kg" />
                <button onClick={() => removeFreonTabung(setPagi, m.code, i)} style={{ background: "none", border: "none", color: cs.red, cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {renderPhotos("pagi", pagi, setPagi)}
      {renderSaveBtn("pagi", savedPagi)}
    </div>
  );

  // ── PULANG: hanya item yang dibawa pagi, input SISA ──
  const broughtMeters = (kat) => byKat(kat).filter((m) => parseFloat(pagi[kat]?.[m.code]) > 0);
  const broughtFreon = () => byKat("freon").filter((m) => (pagi.freon?.[m.code] || []).some((t) => parseFloat(t.kg) > 0));
  const hasBrought = broughtMeters("pipa").length + broughtMeters("kabel").length + broughtFreon().length > 0;

  const pulangMeterRow = (kat, m) => {
    const dibawa = pagi[kat]?.[m.code] || 0;
    return (
      <div key={m.code} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: cs.text }}>{m.name}</div>
          <div style={{ fontSize: 11, color: cs.muted }}>dibawa <b style={{ color: cs.text }}>{dibawa} m</b></div>
        </div>
        <input type="number" inputMode="decimal" value={pulang[kat]?.[m.code] || ""} onChange={(e) => setMeter(setPulang, kat, m.code, e.target.value)} style={{ ...inp, width: 110 }} placeholder="sisa (m)" />
      </div>
    );
  };

  const renderPulang = () => (
    <div style={{ background: cs.panel, border: "1px solid " + cs.border, borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: cs.text }}>🌇 Pulang — Material Dikembalikan</div>
        {savedPulang && <span style={{ fontSize: 11, color: cs.green, fontWeight: 700 }}>✓ Tersimpan</span>}
      </div>
      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 10 }}>Preset dari bawaan pagi. Isi <b>sisa aktual</b> yang dikembalikan (meter / kg). Terpakai = dibawa − sisa.</div>

      {!hasBrought ? (
        <div style={{ fontSize: 13, color: cs.muted, padding: "8px 0" }}>Belum ada material dibawa di sesi Pagi. Simpan Pagi dulu.</div>
      ) : (
        <>
          {broughtMeters("pipa").length > 0 && <div style={{ marginBottom: 12 }}><div style={lbl}>🔧 Pipa AC — sisa (meter)</div>{broughtMeters("pipa").map((m) => pulangMeterRow("pipa", m))}</div>}
          {broughtMeters("kabel").length > 0 && <div style={{ marginBottom: 12 }}><div style={lbl}>⚡ Kabel — sisa (meter)</div>{broughtMeters("kabel").map((m) => pulangMeterRow("kabel", m))}</div>}
          {broughtFreon().length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={lbl}>🧪 Freon — sisa per tabung (kg)</div>
              {broughtFreon().map((m) => (
                <div key={m.code} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: 10, marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: cs.text, marginBottom: 6 }}>{m.name}</div>
                  {(pagi.freon?.[m.code] || []).filter((t) => parseFloat(t.kg) > 0).map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: cs.muted, minWidth: 130 }}>{t.label || "Tabung " + (i + 1)} <span style={{ color: cs.text }}>(dibawa {t.kg}kg)</span></span>
                      <input type="number" inputMode="decimal" value={pulang.freon?.[m.code]?.[i]?.kg || ""} onChange={(e) => setPulangFreon(m.code, i, e.target.value, t.label || "Tabung " + (i + 1))} style={{ ...inp, flex: 1 }} placeholder="sisa kg" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {renderPhotos("pulang", pulang, setPulang)}
      {renderSaveBtn("pulang", savedPulang)}
    </div>
  );

  const renderPhotos = (session, sess, setSess) => (
    <div style={{ marginBottom: 12 }}>
      <div style={lbl}>Foto Bukti <span style={{ fontWeight: 400 }}>({sess.photos.length}/{MAX_PHOTOS})</span></div>
      {sess.photos.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {sess.photos.map((p) => (
            <div key={p.id} style={{ position: "relative", width: 84, height: 84 }}>
              <img src={p.preview || (fotoSrc ? fotoSrc(p.url) : p.url)} alt="bukti" style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8, opacity: p.url || p.preview ? 1 : 0.4 }} />
              {!p.url && p.preview && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", background: "#0008", borderRadius: 8 }}>⏳</span>}
              <button onClick={() => removePhoto(setSess, p.id)} style={{ position: "absolute", top: -6, right: -6, background: cs.red, color: "#fff", border: "none", borderRadius: 99, width: 20, height: 20, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}
      {sess.photos.length < MAX_PHOTOS && (
        <label style={{ display: "block", background: cs.card, border: "1px dashed " + cs.border, borderRadius: 8, padding: "10px", textAlign: "center", color: cs.muted, cursor: "pointer", fontSize: 13 }}>
          {busy === session + "_photo" ? "⏳ Upload..." : `📷 Tambah Foto (maks ${MAX_PHOTOS})`}
          <input type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={(e) => e.target.files?.length && addPhotos(e.target.files, session, sess, setSess)} />
        </label>
      )}
    </div>
  );

  const renderSaveBtn = (session, saved) => (
    <button disabled={busy === session} onClick={() => saveSession(session)}
      style={{ width: "100%", background: busy === session ? cs.border : "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: 12, borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
      {busy === session ? "Menyimpan..." : saved ? "Update " + session : "Simpan " + session}
    </button>
  );

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: cs.text }}>📥 Material Harian</div>
        <div style={{ fontSize: 13, color: cs.muted }}>{myName} · {date}</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 6, background: cs.panel, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 11px" }}>
          Catat material yang <b>dibawa pagi</b> (pilih dari stok kantor) & <b>sisa yang dikembalikan sore</b>. Selisih dicocokkan dengan pemakaian di laporan job. Bisa juga kirim foto via WA: caption <b>"Material Pagi"</b> / <b>"Material Pulang"</b>.
        </div>
      </div>
      {renderPagi()}
      {renderPulang()}
    </div>
  );
}

export default MaterialCheckoutView;
