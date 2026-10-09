import { useEffect, useState } from "react";
import { fotoUrl } from "../lib/fotoUrl.js";
import { catalogCaption, catalogPrice } from "../lib/waCatalog.js";
import "./WaCatalogView.css";

const empty = { title: "", description: "", image_key: "", price_source: "none", source_id: null, fixed_price: null, is_active: true, sort_order: 0 };
const readFile = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
  reader.onerror = () => reject(new Error("Foto gagal dibaca"));
  reader.readAsDataURL(file);
});

export default function WaCatalogView({ supabase, apiFetch, priceListData = [], currentUser, showNotif }) {
  const [items, setItems] = useState([]);
  const [acPrices, setAcPrices] = useState([]);
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filePreview, setFilePreview] = useState("");
  const canEdit = currentUser?.role === "Owner";
  useEffect(() => {
    if (!file) { setFilePreview(""); return; }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [catalog, ac] = await Promise.all([
        supabase.from("wa_catalog_items").select("*").order("sort_order").order("title"),
        supabase.from("ac_price_list").select("id,brand,tipe,kapasitas,seri,harga_unit,harga_inc_pasang,is_active").eq("is_active", true).order("brand"),
      ]);
      if (catalog.error) setError(`Katalog belum dapat dimuat: ${catalog.error.message}. Pastikan migrasi 198 sudah diterapkan.`);
      else setItems(catalog.data || []);
      if (ac.error) setError(previous => `${previous} Harga AC gagal dimuat: ${ac.error.message}`);
      else setAcPrices(ac.data || []);
    } catch (cause) { setError(`Katalog gagal dimuat: ${cause.message}`); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [supabase]);

  const choose = item => { setFile(null); setError(""); setForm(item ? { ...item } : { ...empty }); };
  const save = async () => {
    if (!canEdit || saving) return;
    const title = form.title.trim();
    const description = form.description.trim();
    if (!title || title.length > 120 || description.length > 1200) { setError("Nama wajib diisi (maks. 120) dan deskripsi maks. 1200 karakter."); return; }
    if (["price_list", "ac_unit", "ac_installed"].includes(form.price_source) && !form.source_id) { setError("Pilih sumber harga."); return; }
    if (form.price_source === "fixed" && (!Number.isFinite(Number(form.fixed_price)) || Number(form.fixed_price) < 0 || form.fixed_price === null)) { setError("Harga tetap tidak valid."); return; }
    if (!file && !form.image_key) { setError("Foto katalog wajib diunggah."); return; }
    setSaving(true); setError("");
    try {
      let imageKey = form.image_key;
      if (file) {
        const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
        const response = await apiFetch("/api/upload-foto", { method: "POST", body: JSON.stringify({ folder: "catalog", filename: `${crypto.randomUUID()}.${ext}`, mimeType: file.type, base64: await readFile(file) }) });
        const result = await response.json();
        if (!response.ok || !result.success || !/^catalog\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(result.key || "")) throw new Error(result.error || "Foto gagal disimpan di R2");
        imageKey = result.key;
        setForm(previous => ({ ...previous, image_key: imageKey }));
        setFile(null);
      }
      const values = { title, description, image_key: imageKey, price_source: form.price_source,
        source_id: ["price_list", "ac_unit", "ac_installed"].includes(form.price_source) ? String(form.source_id) : null,
        fixed_price: form.price_source === "fixed" ? Number(form.fixed_price) : null,
        is_active: form.is_active, sort_order: Number(form.sort_order) || 0, updated_at: new Date().toISOString() };
      const query = form.id ? supabase.from("wa_catalog_items").update(values).eq("id", form.id) : supabase.from("wa_catalog_items").insert(values);
      const { data, error: saveError } = await query.select("*").single();
      if (saveError || !data) throw new Error(saveError?.message || "Item belum tersimpan");
      choose(data);
      await load();
      showNotif("✅ Item katalog tersimpan");
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  };

  const price = catalogPrice(form, priceListData, acPrices);
  const imageUrl = filePreview || fotoUrl(form.image_key);
  return <div className="wa-catalog-page">
    <div className="wa-catalog-heading"><div><h2>🖼️ Katalog WhatsApp</h2><p>Simpan gambar dan deskripsi. Admin memilih item ini dari Balasan Cepat; harga sumber dibaca ulang saat dikirim.</p></div><button onClick={() => choose(null)} disabled={!canEdit}>+ Item baru</button></div>
    {error && <div className="wa-catalog-error" role="alert">{error}</div>}
    <div className="wa-catalog-layout">
      <section className="wa-catalog-list" aria-label="Daftar item katalog">
        {loading && <p>Memuat katalog…</p>}
        {!loading && !items.length && <p>Belum ada item. Tambahkan foto katalog pertama.</p>}
        {items.map(item => <button key={item.id} className={form.id === item.id ? "selected" : ""} onClick={() => choose(item)}>
          <img src={fotoUrl(item.image_key)} alt="" loading="lazy"/><span><strong>{item.title}</strong><small>{item.is_active ? "Aktif" : "Nonaktif"} · {item.price_source === "none" ? "Tanpa harga" : item.price_source === "fixed" ? "Harga tetap" : "Harga dari daftar"}</small></span>
        </button>)}
      </section>
      <section className="wa-catalog-editor" aria-label="Edit item katalog">
        <h3>{form.id ? "Detail item" : "Item baru"}</h3>
        <div className="wa-catalog-fields"><label>Nama katalog<input disabled={!canEdit || saving} maxLength={120} value={form.title} onChange={event => setForm(previous => ({ ...previous, title: event.target.value }))} placeholder="Contoh: SOP Cleaning Service" /></label>
          <label>Deskripsi / rincian<textarea disabled={!canEdit || saving} maxLength={1200} rows={4} value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} placeholder="Penjelasan layanan untuk pelanggan" /></label>
          <label>Foto (JPG, PNG, WebP · maks. 2,5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!canEdit || saving} onChange={event => {
            const next = event.target.files?.[0]; if (!next) return;
            if (!["image/jpeg", "image/png", "image/webp"].includes(next.type) || next.size > 2.5 * 1024 * 1024) { setError("Foto harus JPG/PNG/WebP dan maksimal 2,5 MB."); event.target.value = ""; return; }
            setError(""); setFile(next);
          }}/></label>
          {imageUrl && <img className="wa-catalog-preview-image" src={imageUrl} alt={`Pratinjau ${form.title || "foto katalog"}`} />}
          <div className="wa-catalog-grid"><label>Sumber harga<select disabled={!canEdit || saving} value={form.price_source} onChange={event => setForm(previous => ({ ...previous, price_source: event.target.value, source_id: null, fixed_price: null }))}>
            <option value="none">Tanpa harga</option><option value="price_list">Price List jasa</option><option value="ac_unit">Harga unit AC</option><option value="ac_installed">Harga AC termasuk pasang</option><option value="fixed">Harga tetap</option>
          </select></label>
          {form.price_source === "fixed" && <label>Harga (Rp)<input disabled={!canEdit || saving} type="number" min="0" value={form.fixed_price ?? ""} onChange={event => setForm(previous => ({ ...previous, fixed_price: event.target.value }))}/></label>}
          {form.price_source === "price_list" && <label>Item Price List<select disabled={!canEdit || saving} value={form.source_id || ""} onChange={event => setForm(previous => ({ ...previous, source_id: event.target.value }))}><option value="">Pilih jasa…</option>{priceListData.filter(row => row.is_active !== false).map(row => <option key={row.id} value={row.id}>{row.service} · {row.type} · Rp {Number(row.price).toLocaleString("id-ID")}</option>)}</select></label>}
          {["ac_unit", "ac_installed"].includes(form.price_source) && <label>Item harga AC<select disabled={!canEdit || saving} value={form.source_id || ""} onChange={event => setForm(previous => ({ ...previous, source_id: event.target.value }))}><option value="">Pilih AC…</option>{acPrices.map(row => <option key={row.id} value={row.id}>{row.brand} {row.tipe} {row.kapasitas} {row.seri || ""} · Rp {Number(form.price_source === "ac_unit" ? row.harga_unit : row.harga_inc_pasang).toLocaleString("id-ID")}</option>)}</select></label>}
          <label>Urutan<input disabled={!canEdit || saving} type="number" value={form.sort_order} onChange={event => setForm(previous => ({ ...previous, sort_order: event.target.value }))}/></label></div>
          <label className="wa-catalog-check"><input type="checkbox" disabled={!canEdit || saving} checked={form.is_active} onChange={event => setForm(previous => ({ ...previous, is_active: event.target.checked }))}/>Aktif di Balasan Cepat</label>
        </div>
        <div className="wa-catalog-caption"><strong>Pratinjau caption</strong><p>{price === null && form.price_source !== "none" ? "Sumber harga tidak tersedia. Pilih item aktif." : catalogCaption(form, price) || "Isi nama dan deskripsi."}</p></div>
        {canEdit ? <button className="wa-catalog-save" onClick={save} disabled={saving}>{saving ? "Menyimpan…" : "Simpan item"}</button> : <p>Pengelolaan katalog hanya untuk Owner. Admin dapat memilih dan mengirim item aktif melalui WhatsApp Workspace.</p>}
      </section>
    </div>
  </div>;
}
