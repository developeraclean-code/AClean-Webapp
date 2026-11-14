import { Fragment, useState, useEffect, useCallback, useRef } from "react";
import { cs } from "../theme/cs.js";
import TeamGuidelineEditor from "../components/TeamGuidelineEditor.jsx";
import { parseGuidelineContent } from "../lib/teamGuidelineContent.js";
import { SOP_GUIDELINE_CATEGORIES, normalizeSopGuidelineCategory, sortSopGuidelines } from "../lib/teamGuidelineCategories.js";

// Existing text and uploaded image references share team_guidelines.content.
// Owner/Admin manage points; other roles read. Static SOP posters stay available.

const TABS = [
  { key: "tata_tertib", label: "📋 Tata Tertib", roleScoped: false, color: cs.accent },
  { key: "tugas_kewajiban", label: "✅ Tugas & Kewajiban", roleScoped: true, color: cs.green },
  { key: "jobdesk", label: "🛠 Jobdesk", roleScoped: true, color: cs.yellow },
  { key: "sop", label: "🧾 SOP Layanan", roleScoped: false, color: cs.ara },
];

// Poster SOP untuk customer — file statis di public/sop/ (bukan dari DB).
const SOP_DOCS = [
  { key: "cleaning", chip: "🧽 Cleaning", title: "SOP Cleaning Service AC",
    desc: "Tahapan pekerjaan tim AClean saat cleaning unit AC.", src: "/sop/sop-cleaning.png" },
  { key: "cek", chip: "🔧 Cek Unit", title: "SOP Pengecekan Unit Bermasalah",
    desc: "Untuk kendala AC panas / tidak dingin atau bocor air.", src: "/sop/sop-cek-unit.png" },
  { key: "testpress", chip: "🧪 Test Press", title: "SOP Test Press Unit AC",
    desc: "Dilakukan saat ditemukan indikasi kekurangan tekanan Freon.", src: "/sop/sop-test-press.png" },
];

export default function TeamGuidelinesView({ supabase, currentUser, showNotif, showConfirm, apiFetch }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("tata_tertib");
  const [sub, setSub] = useState("teknisi"); // teknisi | helper (untuk tab role-scoped)
  const [sopKey, setSopKey] = useState(SOP_DOCS[0].key); // dokumen SOP aktif (tab "sop")
  const [sopCategoryFilter, setSopCategoryFilter] = useState("all");
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loadError, setLoadError] = useState("");
  const mutationLock = useRef(false);
  const loadSequence = useRef(0);

  const canEdit = currentUser?.role === "Owner" || currentUser?.role === "Admin";

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setLoadError("");
    try {
      const { data, error } = await supabase
        .from("team_guidelines")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });
      if (sequence !== loadSequence.current) return false;
      if (error) throw error;
      setRows(data || []);
      return true;
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError("Poin belum berhasil dimuat: " + error.message);
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [supabase]);

  useEffect(() => { load(); return () => { loadSequence.current++; }; }, [load]);

  const tabCfg = TABS.find((t) => t.key === tab);
  const scope = tabCfg.roleScoped ? sub : "all";
  const items = rows
    .filter((r) => r.section === tab && r.role_scope === scope && (canEdit || (r.content || "").trim() !== ""))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const visibleItems = tab === "sop"
    ? sortSopGuidelines(items).filter(row => sopCategoryFilter === "all" || normalizeSopGuidelineCategory(row.category) === sopCategoryFilter)
    : items;

  const startEdit = (row) => { setAdding(false); setEditId(row.id); };
  const cancelEdit = () => { setEditId(null); };
  const cancelAdd = () => { setAdding(false); };
  const reloadAfterSave = async () => {
    if (await load()) { cancelEdit(); cancelAdd(); }
  };

  const savePoint = async (content, selectedCategory = "umum", row = null) => {
    if (!canEdit || mutationLock.current) throw new Error("Perubahan belum dapat disimpan");
    mutationLock.current = true;
    try {
      const category = tab === "sop" ? normalizeSopGuidelineCategory(selectedCategory) : "umum";
      const patch = { content, category, updated_at: new Date().toISOString(), updated_by: currentUser?.name || null };
      const maxOrder = rows.filter(r => r.section === tab && r.role_scope === scope
        && normalizeSopGuidelineCategory(r.category) === category)
        .reduce((max, r) => Math.max(max, r.sort_order || 0), 0);
      if (row && normalizeSopGuidelineCategory(row.category) !== category) patch.sort_order = maxOrder + 1;
      let result;
      if (row) result = await supabase.from("team_guidelines").update(patch).eq("id", row.id).select().single();
      else {
        result = await supabase.from("team_guidelines").insert({ ...patch, section: tab, role_scope: scope, sort_order: maxOrder + 1 }).select().single();
      }
      if (result.error) throw new Error("Gagal simpan: " + result.error.message);
      if (!result.data?.id) throw new Error("Penyimpanan belum terkonfirmasi. Muat ulang sebelum mencoba lagi.");
      setRows(previous => row ? previous.map(r => r.id === row.id ? result.data : r) : [...previous, result.data]);
      if (tab === "sop" && sopCategoryFilter !== "all") setSopCategoryFilter(category);
      cancelEdit(); cancelAdd(); showNotif?.("✅ Poin tersimpan");
    } finally { mutationLock.current = false; }
  };

  const handleDelete = async (row) => {
    if (!canEdit || mutationLock.current || saving) return;
    mutationLock.current = true; setSaving(true);
    try {
      const ok = showConfirm
        ? await showConfirm({ icon: "🗑️", title: "Hapus poin?", danger: true, message: "Hapus teks dan gambar pada poin ini dari daftar?", confirmText: "Hapus" })
        : window.confirm("Hapus poin ini?");
      if (!ok) return;
      const { data, error } = await supabase.from("team_guidelines").delete().eq("id", row.id).select("id").single();
      if (error) throw error;
      if (!data?.id) throw new Error("Penghapusan belum terkonfirmasi");
      setRows(previous => previous.filter(r => r.id !== row.id));
      showNotif?.("🗑️ Poin dihapus");
    } catch (error) { showNotif?.("Gagal hapus: " + error.message); }
    finally { mutationLock.current = false; setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: cs.text }}>📋 Tata Tertib & Jobdesk</div>
        <div style={{ fontSize: 13, color: cs.muted, marginTop: 2 }}>
          Acuan aturan, tugas, jobdesk, dan SOP layanan tim AClean.
          {canEdit && <span style={{ color: cs.accent }}> Tambahkan teks atau gambar, atau edit tiap poin (✏️).</span>}
        </div>
      </div>

      {/* Tab utama */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} disabled={saving} onClick={() => { setTab(t.key); cancelEdit(); cancelAdd(); }}
              style={{
                padding: "9px 14px", borderRadius: 99, cursor: "pointer", fontSize: 13, fontWeight: 700,
                border: "1px solid " + (active ? t.color : cs.border),
                background: active ? t.color : cs.surface,
                color: active ? "#0a0f1e" : cs.muted,
              }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Sub-toggle Teknisi/Helper */}
      {tabCfg.roleScoped && (
        <div style={{ display: "flex", gap: 4, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: 4, marginBottom: 14, width: "fit-content" }}>
          {["teknisi", "helper"].map((s) => (
            <button key={s} disabled={saving} onClick={() => { setSub(s); cancelEdit(); cancelAdd(); }}
              style={{
                padding: "7px 18px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                background: sub === s ? cs.accent : "transparent", color: sub === s ? "#0a0f1e" : cs.muted,
                textTransform: "capitalize",
              }}>
              {s === "teknisi" ? "🔧 Teknisi" : "🧢 Helper"}
            </button>
          ))}
        </div>
      )}

      {/* Tab SOP: poster statis, read-only, semua role */}
      {tab === "sop" && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SOP_DOCS.map((d) => (
              <button key={d.key} onClick={() => setSopKey(d.key)}
                style={{
                  padding: "7px 14px", borderRadius: 99, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                  border: "1px solid " + (sopKey === d.key ? cs.accent : cs.border),
                  background: sopKey === d.key ? cs.accent : cs.surface,
                  color: sopKey === d.key ? "#0a0f1e" : cs.muted,
                }}>
                {d.chip}
              </button>
            ))}
          </div>
          {SOP_DOCS.filter((d) => d.key === sopKey).map((d) => (
            <div key={d.key} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: cs.text }}>{d.title}</div>
              <div style={{ fontSize: 12.5, color: cs.muted, marginTop: 2, marginBottom: 10 }}>{d.desc}</div>
              <a href={d.src} target="_blank" rel="noopener noreferrer" title="Klik untuk buka ukuran penuh">
                <img src={d.src} alt={d.title} loading="lazy"
                  style={{ width: "100%", display: "block", borderRadius: 10, border: "1px solid " + cs.border, background: "#fff" }} />
              </a>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <a href={d.src} target="_blank" rel="noopener noreferrer"
                  style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: "none", background: cs.accent + "22", color: cs.accent, border: "1px solid " + cs.accent + "44" }}>
                  🔍 Buka ukuran penuh
                </a>
                <a href={d.src} download={d.src.split("/").pop()}
                  style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: "none", background: cs.surface, color: cs.muted, border: "1px solid " + cs.border }}>
                  ⬇️ Unduh gambar
                </a>
              </div>
              <div style={{ fontSize: 11.5, color: cs.muted, marginTop: 9, lineHeight: 1.5 }}>
                Boleh dikirim ke customer sebagai penjelasan tahapan kerja & aturan biaya.
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Daftar poin */}
      {tab === "sop" && <div style={{ marginTop: 18, marginBottom: 10, color: cs.text, fontWeight: 700 }}>Panduan SOP tambahan</div>}
      {tab === "sop" && !loading && !loadError && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: cs.muted, marginBottom: 7 }}>Kategori panduan tambahan</div>
          <div role="group" style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-label="Filter kategori panduan SOP">
            {[{ key: "all", label: "Semua" }, ...SOP_GUIDELINE_CATEGORIES].map(category => {
              const count = category.key === "all" ? items.length
                : items.filter(row => normalizeSopGuidelineCategory(row.category) === category.key).length;
              const active = sopCategoryFilter === category.key;
              return <button key={category.key} type="button" disabled={saving} aria-pressed={active}
                onClick={() => { setSopCategoryFilter(category.key); cancelEdit(); cancelAdd(); }}
                style={{ padding: "6px 11px", borderRadius: 99, cursor: "pointer", fontSize: 12,
                  border: "1px solid " + (active ? cs.accent : cs.border),
                  background: active ? cs.accent + "22" : cs.surface,
                  color: active ? cs.accent : cs.muted, fontWeight: active ? 700 : 500 }}>
                {category.label} ({count})
              </button>;
            })}
          </div>
        </div>
      )}
      {loading ? (
        <div style={{ textAlign: "center", color: cs.muted, fontSize: 13, padding: 24 }}>Memuat…</div>
      ) : loadError ? (
        <div role="alert" style={{ color: cs.red, padding: 16 }}>{loadError} <button onClick={load}>Coba lagi</button></div>
      ) : visibleItems.length === 0 ? (
        <div style={{ background: cs.surface, border: "1px dashed " + cs.border, borderRadius: 12, padding: 20, textAlign: "center", fontSize: 12.5, color: cs.muted }}>
          {tab === "sop" && sopCategoryFilter !== "all" ? "Belum ada panduan dalam kategori ini." : "Belum ada isi untuk bagian ini."}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {visibleItems.map((row, idx) => {
            const isEditing = editId === row.id;
            const parsed = parseGuidelineContent(row.content);
            const empty = !parsed.text && !parsed.images.length;
            const category = normalizeSopGuidelineCategory(row.category);
            const previousCategory = idx > 0 ? normalizeSopGuidelineCategory(visibleItems[idx - 1].category) : null;
            const categoryLabel = SOP_GUIDELINE_CATEGORIES.find(option => option.key === category)?.label || "Umum";
            return (
              <Fragment key={row.id}>
              {tab === "sop" && category !== previousCategory && <div style={{ marginTop: idx ? 10 : 0, color: cs.accent, fontSize: 13, fontWeight: 700 }}>
                {categoryLabel}
              </div>}
              <div style={{
                background: cs.card, border: "1px solid " + (isEditing ? cs.accent : cs.border),
                borderRadius: 10, padding: "11px 13px", display: "flex", gap: 11, alignItems: "flex-start",
              }}>
                <span style={{ flex: "none", width: 24, height: 24, borderRadius: 99, background: tabCfg.color + "22", color: tabCfg.color, fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                  {idx + 1}
                </span>
                {isEditing ? (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TeamGuidelineEditor key={row.id} content={row.content} category={category}
                      categoryOptions={tab === "sop" ? SOP_GUIDELINE_CATEGORIES : []}
                      apiFetch={apiFetch} onBusyChange={setSaving}
                      onSave={(content, selectedCategory) => savePoint(content, selectedCategory, row)} onCancel={cancelEdit} onReload={reloadAfterSave} />
                  </div>
                ) : (
                  <>
                    <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontSize: 13, color: empty ? cs.muted : cs.text, lineHeight: 1.55, fontStyle: empty ? "italic" : "normal", paddingTop: 2 }}>
                      {empty ? "(kosong — klik ✏️ untuk isi)" : <>
                        {parsed.text && <div style={{ whiteSpace: "pre-wrap" }}>{parsed.text}</div>}
                        {parsed.images.map((url, imageIndex) => <GuidelineImage key={url} url={url} index={imageIndex} />)}
                      </>}
                    </div>
                    {canEdit && (
                      <div style={{ flex: "none", display: "flex", gap: 5 }}>
                        <button disabled={saving} aria-label={`Edit poin ${idx + 1}`} onClick={() => startEdit(row)}
                          style={{ padding: "4px 9px", background: cs.accent + "22", color: cs.accent, border: "1px solid " + cs.accent + "44", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                          ✏️
                        </button>
                        <button disabled={saving} aria-label={`Hapus poin ${idx + 1}`} onClick={() => handleDelete(row)}
                          style={{ padding: "4px 9px", background: cs.red + "22", color: cs.red, border: "1px solid " + cs.red + "44", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                          🗑️
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              </Fragment>
            );
          })}
        </div>
      )}

      {/* Tambah poin baru (Owner/Admin) */}
      {canEdit && !loading && !loadError && (
        <div style={{ marginTop: 12 }}>
          {adding ? (
            <div style={{ background: cs.card, border: "1px solid " + cs.accent, borderRadius: 10, padding: "11px 13px", display: "grid", gap: 8 }}>
              <TeamGuidelineEditor key={`${tab}-${scope}-${sopCategoryFilter}`}
                category={tab === "sop" && sopCategoryFilter !== "all" ? sopCategoryFilter : "umum"}
                categoryOptions={tab === "sop" ? SOP_GUIDELINE_CATEGORIES : []}
                apiFetch={apiFetch} onBusyChange={setSaving}
                onSave={(content, selectedCategory) => savePoint(content, selectedCategory)} onCancel={cancelAdd} onReload={reloadAfterSave} />
            </div>
          ) : (
            <button disabled={saving} onClick={() => { setAdding(true); cancelEdit(); }}
              style={{ width: "100%", padding: "11px", background: "transparent", border: "1px dashed " + cs.border, color: cs.accent, borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              + Tambah Poin / Gambar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GuidelineImage({ url, index }) {
  const [failed, setFailed] = useState(false);
  return <div style={{ marginTop: 10 }}>
    {failed ? <div role="alert" style={{ color: cs.muted }}>Gambar belum dapat dimuat. <button onClick={() => setFailed(false)}>Coba lagi</button></div>
      : <a href={url} target="_blank" rel="noopener noreferrer" title="Buka gambar ukuran penuh">
        <img src={url} alt={`Gambar poin ${index + 1}`} loading="lazy" onError={() => setFailed(true)}
          style={{ display: "block", maxWidth: "100%", maxHeight: 500, borderRadius: 8, objectFit: "contain" }} />
      </a>}
  </div>;
}
