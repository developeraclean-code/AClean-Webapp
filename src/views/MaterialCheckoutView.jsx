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

// Kategori material: semua kini berbasis UNIT (unit_id) dari inventory_units.
const CATS = [
  { key: "pipa", title: "🔧 Pipa AC", satuan: "m" },
  { key: "kabel", title: "⚡ Kabel", satuan: "m" },
  { key: "freon", title: "🧪 Freon", satuan: "kg" },
];

const emptySession = () => ({ pipa: {}, kabel: {}, freon: {}, photos: [], notes: "", jobIds: [] });

// state sesi → items[] (per SKU, simpan unit_id tiap unit). qty = total; freon juga isi weight_kg.
function buildItems(sess, materials) {
  const items = [];
  const nameOf = (code) => (materials.find((m) => m.code === code) || {}).name || code;
  for (const { key: cat, satuan } of [{ key: "pipa", satuan: "meter" }, { key: "kabel", satuan: "meter" }, { key: "freon", satuan: "kg" }]) {
    Object.entries(sess[cat] || {}).forEach(([code, units]) => {
      const arr = (units || []).filter((u) => parseFloat(u.qty) > 0).map((u) => ({ unit_id: u.unit_id || null, label: u.label, qty: parseFloat(u.qty) }));
      if (!arr.length) return;
      const total = Math.round(arr.reduce((s, u) => s + u.qty, 0) * 100) / 100;
      const item = { material_type: cat, inventory_code: code, label: nameOf(code), qty: total, satuan, units: arr };
      if (cat === "freon") item.weight_kg = arr.map((u) => ({ unit_id: u.unit_id, label: u.label, kg: u.qty }));
      items.push(item);
    });
  }
  return items;
}

// DB row → state sesi (unit-aware; fallback legacy single qty)
function itemsToSession(row) {
  const s = emptySession();
  s.notes = row.notes || "";
  s.jobIds = Array.isArray(row.job_ids) ? row.job_ids : [];
  const urls = Array.isArray(row.photo_urls) && row.photo_urls.length ? row.photo_urls : (row.photo_url ? [row.photo_url] : []);
  s.photos = urls.map((u, i) => ({ id: "saved" + i, url: u, preview: "" }));
  (row.items || []).forEach((it) => {
    const cat = it.material_type;
    if (!["pipa", "kabel", "freon"].includes(cat)) return;
    const code = it.inventory_code || it.label;
    let units;
    if (Array.isArray(it.units)) units = it.units.map((u) => ({ unit_id: u.unit_id || null, label: u.label, qty: String(u.qty) }));
    else if (cat === "freon" && Array.isArray(it.weight_kg)) units = it.weight_kg.map((u) => ({ unit_id: u.unit_id || null, label: u.label, qty: String(u.kg) }));
    else units = [{ unit_id: null, label: it.label, qty: String(it.qty) }];  // legacy: 1 entri agregat
    s[cat][code] = units;
  });
  return s;
}

// job_materials_brought rows → state sesi "pagi" (auto-seed, hindari double-entry per-job vs harian).
// Mapping identik dgn itemsToSession: s[cat][code] = [{unit_id,label,qty}].
function broughtToSession(rows) {
  const s = emptySession();
  for (const r of (rows || [])) {
    const cat = String(r.material_type || "").toLowerCase();
    if (!["pipa", "kabel", "freon"].includes(cat)) continue;
    const code = r.inventory_code || r.unit_label;
    if (!code) continue;
    if (!s[cat][code]) s[cat][code] = [];
    s[cat][code].push({
      unit_id: r.unit_id || null,
      label: r.unit_label || code,
      qty: r.qty_estimate != null ? String(r.qty_estimate) : "",
    });
  }
  return s;
}

function sessionHasUnit(sess) {
  return ["pipa", "kabel", "freon"].some((cat) =>
    Object.values(sess[cat] || {}).some((arr) => (arr || []).length > 0));
}

// Preset sesi pulang dari pagi: default sisa tiap unit = jumlah yang dibawa (anggap belum kepake).
function presetPulang(pagiSess) {
  const out = { pipa: {}, kabel: {}, freon: {} };
  for (const cat of ["pipa", "kabel", "freon"]) {
    Object.entries(pagiSess[cat] || {}).forEach(([code, units]) => {
      out[cat][code] = (units || []).map((u) => ({ unit_id: u.unit_id || null, label: u.label, qty: u.qty }));
    });
  }
  return out;
}

function MaterialCheckoutView({ supabase, currentUser, showNotif, fotoSrc, _apiFetch, _apiHeaders, notifyOwnerWA, appSettings }) {
  const myName = currentUser?.name || "";
  const date = todayJkt();
  const confirmMode = appSettings?.material_confirm_deduct_enabled === "true";  // Opsi A
  const [materials, setMaterials] = useState([]);   // [{code,name,kategori,unit,stock}]
  const [units, setUnits] = useState([]);           // inventory_units terlihat teknisi (pipa/kabel/freon)
  const [myJobs, setMyJobs] = useState([]);         // job hari ini utk teknisi/helper ini (tag di pulang)
  const [pagi, setPagi] = useState(emptySession());
  const [pulang, setPulang] = useState(emptySession());
  const [savedPagi, setSavedPagi] = useState(null);
  const [savedPulang, setSavedPulang] = useState(null);
  const [pagiFromJob, setPagiFromJob] = useState(false); // pagi auto-seed dari job_materials_brought
  const [busy, setBusy] = useState("");

  const byKat = (k) => materials.filter((m) => m.kategori === k);

  const load = useCallback(async () => {
    const { data: inv } = await supabase.from("inventory").select("code,name,unit,stock,status");
    const mats = (inv || [])
      .map((it) => ({ ...it, kategori: classifyInv(it.name) }))
      .filter((it) => it.kategori)
      .sort((a, b) => a.kategori.localeCompare(b.kategori) || a.name.localeCompare(b.name));
    setMaterials(mats);
    const codes = mats.map((m) => m.code);
    // Unit fisik (roll pipa/kabel & tabung freon) yang terlihat teknisi: aktif, tak diarsip, stok ≥ min_visible.
    const { data: u } = await supabase.from("inventory_units")
      .select("id,inventory_code,unit_label,stock,min_visible,is_active,archived");
    const vis = (u || []).filter((x) => codes.includes(x.inventory_code) && x.is_active && !x.archived && Number(x.stock) > 0 && Number(x.stock) >= Number(x.min_visible ?? 3))
      .sort((a, b) => String(a.unit_label).localeCompare(String(b.unit_label)));
    setUnits(vis);
    // Job hari ini di mana teknisi/helper ini terlibat — utk tag saat pulang.
    const { data: ords } = await supabase.from("orders")
      .select("id,customer,service,date,status,teknisi,helper,teknisi2,helper2,teknisi3,helper3")
      .eq("date", date);
    const mine = (ords || []).filter((o) => [o.teknisi, o.helper, o.teknisi2, o.helper2, o.teknisi3, o.helper3].some((n) => n && n === myName));
    setMyJobs(mine);
    // Auto-seed "Pagi" dari material yang DIBAWA per-job (job_materials_brought) → satu sumber,
    // teknisi tak input dua kali. Hanya brought_by = saya, dipakai bila sesi pagi belum tersimpan.
    let broughtSess = null;
    const jobIds = mine.map((o) => o.id);
    if (jobIds.length) {
      const { data: brought } = await supabase.from("job_materials_brought")
        .select("inventory_code,unit_id,unit_label,material_type,qty_estimate,status,brought_by,job_id")
        .in("job_id", jobIds).neq("status", "CANCELLED").eq("brought_by", myName);
      const bs = broughtToSession(brought || []);
      if (sessionHasUnit(bs)) broughtSess = bs;
    }
    const { data: rows } = await supabase.from("teknisi_material_checkout")
      .select("*").eq("teknisi_name", myName).eq("checkout_date", date);
    const p = (rows || []).find((r) => r.session_type === "pagi") || null;
    const pl = (rows || []).find((r) => r.session_type === "pulang") || null;
    setSavedPagi(p); setSavedPulang(pl);
    // Prioritas: sesi pagi tersimpan > auto-seed dari job > kosong.
    const pagiSess = p ? itemsToSession(p) : (broughtSess || emptySession());
    setPagi(pagiSess);
    setPagiFromJob(!p && !!broughtSess);
    if (pl) setPulang(itemsToSession(pl));
    else setPulang({ ...emptySession(), ...presetPulang(pagiSess) });
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
      if (session === "pulang") {
        payload.job_ids = sess.jobIds || [];
        // Opsi A: pulang baru/diubah → PENDING confirm Owner. (Jangan reset kalau sudah CONFIRMED.)
        if (confirmMode && saved?.confirm_status !== "CONFIRMED") payload.confirm_status = "PENDING";
      }
      let err;
      if (saved?.id) ({ error: err } = await supabase.from("teknisi_material_checkout").update(payload).eq("id", saved.id));
      else ({ error: err } = await supabase.from("teknisi_material_checkout").insert(payload));
      if (err) throw err;
      showNotif(`✅ Material ${session} tersimpan` + (session === "pulang" && confirmMode ? " — menunggu konfirmasi Owner" : ""));
      await load();
      // Recon vs laporan hanya relevan di mode cross-check (Opsi B). Di Opsi A laporan tak deduct.
      if (session === "pulang" && !confirmMode) await runReconAlert();
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

  // ── unit helpers (generik utk pipa/kabel/freon) ──
  const unitsForCode = (code) => units.filter((u) => u.inventory_code === code);
  const stockFor = (code) => unitsForCode(code).reduce((s, u) => s + Number(u.stock || 0), 0);
  const availableUnitsFor = (cat, code) => {
    const taken = new Set((pagi[cat]?.[code] || []).map((t) => t.unit_id));
    return unitsForCode(code).filter((u) => !taken.has(u.id));
  };

  const addUnit = (cat, code, unit) => {
    const row = { unit_id: unit.id, label: unit.unit_label, qty: String(unit.stock) };
    setPagi((s) => {
      const c = { ...(s[cat] || {}) }; const arr = [...(c[code] || [])];
      if (arr.some((t) => t.unit_id === unit.id)) return s;
      c[code] = [...arr, row]; return { ...s, [cat]: c };
    });
    if (!savedPulang) setPulang((s) => {
      const c = { ...(s[cat] || {}) }; const arr = [...(c[code] || [])];
      if (arr.some((t) => t.unit_id === unit.id)) return s;
      c[code] = [...arr, { ...row }]; return { ...s, [cat]: c };  // default sisa = dibawa
    });
  };
  const setPagiQty = (cat, code, unitId, qty) => setPagi((s) => {
    const c = { ...(s[cat] || {}) }; c[code] = (c[code] || []).map((t) => (t.unit_id === unitId ? { ...t, qty } : t)); return { ...s, [cat]: c };
  });
  const removeUnit = (cat, code, unitId) => {
    setPagi((s) => { const c = { ...(s[cat] || {}) }; c[code] = (c[code] || []).filter((t) => t.unit_id !== unitId); return { ...s, [cat]: c }; });
    if (!savedPulang) setPulang((s) => { const c = { ...(s[cat] || {}) }; c[code] = (c[code] || []).filter((t) => t.unit_id !== unitId); return { ...s, [cat]: c }; });
  };
  const setPulangQty = (cat, code, unitId, qty, label) => setPulang((s) => {
    const c = { ...(s[cat] || {}) }; const arr = [...(c[code] || [])];
    const i = arr.findIndex((t) => t.unit_id === unitId);
    if (i >= 0) arr[i] = { ...arr[i], qty }; else arr.push({ unit_id: unitId, label, qty });
    c[code] = arr; return { ...s, [cat]: c };
  });
  const toggleJob = (jobId) => setPulang((s) => {
    const has = (s.jobIds || []).includes(jobId);
    return { ...s, jobIds: has ? s.jobIds.filter((x) => x !== jobId) : [...(s.jobIds || []), jobId] };
  });
  // Sisa pulang tak boleh > dibawa (cegah "terpakai" negatif) dan tak boleh < 0.
  const clampSisa = (raw, max) => {
    if (raw === "" || raw == null) return "";
    let v = parseFloat(raw);
    if (!Number.isFinite(v) || v < 0) return "0";
    if (Number.isFinite(max) && v > max) return String(max);
    return raw;
  };

  const inp = { width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 11px", color: cs.text, fontSize: 14, outline: "none", boxSizing: "border-box" };
  const lbl = { fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 6 };

  // ── PAGI: per kategori, pilih unit dari stok kantor (multi, tombol +) ──
  // NB: render-function (dipanggil langsung), bukan komponen JSX → input tak remount/kehilangan fokus.
  const pagiCatCard = (cat, satuan, m) => {
    const sel = pagi[cat]?.[m.code] || [];
    const avail = availableUnitsFor(cat, m.code);
    const total = stockFor(m.code);
    const cnt = unitsForCode(m.code).length;
    return (
      <div key={m.code} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: cs.text, marginBottom: 6 }}>
          {m.name} <span style={{ fontSize: 11, fontWeight: 400, color: cs.muted }}>· {cnt} unit di kantor · total <b style={{ color: total > 0 ? cs.green : cs.red }}>{Math.round(total * 10) / 10} {satuan}</b></span>
        </div>
        {sel.map((t) => (
          <div key={t.unit_id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: cs.text, flex: 1, fontWeight: 600 }}>📦 {t.label}</span>
            <input type="number" inputMode="decimal" value={t.qty} onChange={(e) => setPagiQty(cat, m.code, t.unit_id, e.target.value)} style={{ ...inp, width: 90 }} placeholder={satuan} />
            <button onClick={() => removeUnit(cat, m.code, t.unit_id)} style={{ background: "none", border: "none", color: cs.red, cursor: "pointer", fontSize: 18 }}>×</button>
          </div>
        ))}
        {avail.length > 0 ? (
          <select value="" onChange={(e) => { const u = avail.find((x) => x.id === e.target.value); if (u) addUnit(cat, m.code, u); }}
            style={{ ...inp, marginTop: 4, color: cs.accent, fontWeight: 700, cursor: "pointer" }}>
            <option value="">+ Tambah unit…</option>
            {avail.map((u) => <option key={u.id} value={u.id} style={{ color: cs.text }}>{u.unit_label} ({Math.round(Number(u.stock) * 10) / 10} {satuan})</option>)}
          </select>
        ) : (
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 4 }}>{cnt > 0 ? "Semua unit sudah dipilih" : "Tidak ada unit tersedia di kantor"}</div>
        )}
      </div>
    );
  };

  const renderPagi = () => (
    <div style={{ background: cs.panel, border: "1px solid " + cs.border, borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: cs.text }}>🌅 Pagi — Material Dibawa</div>
        {savedPagi
          ? <span style={{ fontSize: 11, color: cs.green, fontWeight: 700 }}>✓ Tersimpan</span>
          : pagiFromJob && <span style={{ fontSize: 11, color: cs.accent, fontWeight: 700 }}>↺ otomatis dari job</span>}
      </div>
      {pagiFromJob && !savedPagi && (
        <div style={{ fontSize: 11, color: cs.accent, background: cs.accent + "12", border: "1px solid " + cs.accent + "33", borderRadius: 8, padding: "8px 11px", marginBottom: 12, lineHeight: 1.5 }}>
          ↺ Terisi otomatis dari material yang kamu <b>bawa per-job</b> (tombol "📝 Laporan & Material").
          Cek angkanya lalu <b>Simpan</b> — tidak perlu input ulang.
        </div>
      )}
      {CATS.map(({ key, title, satuan }) => (
        <div key={key} style={{ marginBottom: 12 }}>
          <div style={lbl}>{title} — pilih unit dari stok kantor</div>
          {byKat(key).length === 0 ? <div style={{ fontSize: 12, color: cs.muted }}>—</div> : byKat(key).map((m) => pagiCatCard(key, satuan, m))}
        </div>
      ))}
      {renderPhotos("pagi", pagi, setPagi)}
      {renderSaveBtn("pagi", savedPagi)}
    </div>
  );

  // ── PULANG: hanya unit yang dibawa pagi, input SISA (preset = dibawa) ──
  const broughtSKUs = (cat) => byKat(cat).filter((m) => (pagi[cat]?.[m.code] || []).some((t) => parseFloat(t.qty) > 0));
  const hasBrought = CATS.some(({ key }) => broughtSKUs(key).length > 0);

  const pulangCatCard = (cat, satuan, m) => (
    <div key={m.code} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: 10, marginBottom: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: cs.text, marginBottom: 6 }}>{m.name}</div>
      {(pagi[cat]?.[m.code] || []).filter((t) => parseFloat(t.qty) > 0).map((t) => {
        const sisa = (pulang[cat]?.[m.code] || []).find((x) => x.unit_id === t.unit_id);
        return (
          <div key={t.unit_id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: cs.muted, minWidth: 150 }}>📦 {t.label} <span style={{ color: cs.text }}>(dibawa {t.qty}{satuan})</span></span>
            <input type="number" inputMode="decimal" min={0} max={parseFloat(t.qty)} value={sisa?.qty ?? ""} onChange={(e) => setPulangQty(cat, m.code, t.unit_id, clampSisa(e.target.value, parseFloat(t.qty)), t.label)} style={{ ...inp, flex: 1 }} placeholder={"sisa " + satuan} />
          </div>
        );
      })}
    </div>
  );

  const renderPulang = () => (
    <div style={{ background: cs.panel, border: "1px solid " + cs.border, borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: cs.text }}>🌇 Pulang — Material Dikembalikan</div>
        {savedPulang && <span style={{ fontSize: 11, color: cs.green, fontWeight: 700 }}>✓ Tersimpan</span>}
      </div>
      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 10 }}>Preset dari unit yang dibawa pagi (default sisa = dibawa). Turunkan kalau kepake. Terpakai = dibawa − sisa.</div>

      {/* Tag pekerjaan hari ini (boleh >1). Bukan pemecah kuantitas — hanya penanda dipakai di job mana. */}
      <div style={{ marginBottom: 12 }}>
        <div style={lbl}>📋 Dipakai untuk pekerjaan hari ini {pulang.jobIds?.length > 0 && <span style={{ color: cs.accent }}>({pulang.jobIds.length})</span>}</div>
        {myJobs.length === 0 ? (
          <div style={{ fontSize: 12, color: cs.muted }}>Tidak ada job terjadwal untuk Anda hari ini.</div>
        ) : (
          <div style={{ display: "grid", gap: 5 }}>
            {myJobs.map((o) => {
              const on = (pulang.jobIds || []).includes(o.id);
              return (
                <label key={o.id} style={{ display: "flex", gap: 9, alignItems: "center", cursor: "pointer", background: on ? cs.accent + "18" : cs.card, border: "1px solid " + (on ? cs.accent + "55" : cs.border), borderRadius: 8, padding: "8px 10px" }}>
                  <input type="checkbox" checked={on} onChange={() => toggleJob(o.id)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: cs.text }}>{o.customer || o.id}</div>
                    <div style={{ fontSize: 11, color: cs.muted }}>{o.service || "-"} · {o.id}</div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {!hasBrought ? (
        <div style={{ fontSize: 13, color: cs.muted, padding: "8px 0" }}>Belum ada material dibawa di sesi Pagi. Simpan Pagi dulu.</div>
      ) : (
        CATS.map(({ key, title, satuan }) => broughtSKUs(key).length > 0 && (
          <div key={key} style={{ marginBottom: 12 }}>
            <div style={lbl}>{title} — sisa ({satuan})</div>
            {broughtSKUs(key).map((m) => pulangCatCard(key, satuan, m))}
          </div>
        ))
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
        {/* Banner arah satu-pintu: input utama kini per-job lewat kartu jadwal (Fase 3) */}
        <div style={{ fontSize: 12, color: cs.accent, marginTop: 8, background: cs.accent + "12", border: "1px solid " + cs.accent + "44", borderRadius: 8, padding: "9px 12px", lineHeight: 1.5 }}>
          💡 <b>Cara baru:</b> input material sekarang lewat tombol <b>"📝 Laporan & Material"</b> di
          tiap kartu job (Dashboard/Jadwal) — otomatis ke-link ke customer yang benar.
          Halaman ini untuk <b>material borongan harian</b> & rekonsiliasi sisa.
        </div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 6, background: cs.panel, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 11px" }}>
          Pilih <b>unit yang dibawa</b> dari stok kantor (pipa/kabel/freon — bisa beberapa unit per barang) & isi <b>sisa yang dikembalikan</b> sore. Selisih dicocokkan dengan pemakaian di laporan job. Bisa juga kirim foto via WA: caption <b>"Material Pagi"</b> / <b>"Material Pulang"</b>.
        </div>
      </div>
      {renderPagi()}
      {renderPulang()}
    </div>
  );
}

export default MaterialCheckoutView;
