import { useState, useEffect, useRef } from "react";
import { cs } from "../theme/cs.js";

const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const CATEGORIES = [
  { id: "cuci-ac",       label: "Cuci AC",       icon: "🧹" },
  { id: "bongkar-pasang",label: "Bongkar Pasang", icon: "🔧" },
  { id: "ducting",       label: "Ducting AC",     icon: "🏗" },
  { id: "pasang-ac",     label: "Pasang AC Baru", icon: "❄️" },
  { id: "isi-freon",     label: "Isi Freon",      icon: "🧊" },
  { id: "jual-ac",       label: "Jual Unit AC",   icon: "🛒" },
];

const BLOG_CATEGORIES = [
  { id: "tips",           label: "Tips & Info" },
  { id: "area",          label: "Area / Lokasi" },
  { id: "panduan",       label: "Panduan" },
  { id: "bongkar-pasang",label: "Bongkar Pasang" },
  { id: "ducting",       label: "Ducting AC" },
];

const EMPTY_BLOG = { slug: "", title: "", cover_image_url: "", excerpt: "", category: "tips", published_at: "", read_minutes: 7, is_published: true };

async function sbFetch(path, opts = {}) {
  return fetch(`${SB_URL}/rest/v1${path}`, {
    headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation", ...(opts.headers || {}) },
    ...opts,
  });
}

export default function WebsiteContentView({ currentUser, supabase, showNotif, showConfirm, _apiFetch, _apiHeaders }) {
  const [tab, setTab] = useState("portfolio");
  const [portfolioCat, setPortfolioCat] = useState("cuci-ac");
  const [portfolio, setPortfolio] = useState([]);
  const [blog, setBlog] = useState([]);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [loadingBlog, setLoadingBlog] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingBlog, setSavingBlog] = useState(false);
  const [blogModal, setBlogModal] = useState(null); // null | 'add' | {id,...}
  const [blogForm, setBlogForm] = useState(EMPTY_BLOG);
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [blogFilter, setBlogFilter] = useState("all");
  const fileInputRef = useRef(null);
  const coverInputRef = useRef(null);

  // ── Load portfolio ───────────────────────────────────────────────
  useEffect(() => {
    if (tab !== "portfolio") return;
    loadPortfolio();
  }, [tab, portfolioCat]);

  async function loadPortfolio() {
    setLoadingPortfolio(true);
    try {
      const { data, error } = await supabase
        .from("website_portfolio")
        .select("*")
        .eq("category", portfolioCat)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      setPortfolio(data || []);
    } catch (e) {
      showNotif("Gagal memuat portfolio: " + e.message, "error");
    } finally {
      setLoadingPortfolio(false);
    }
  }

  // ── Load blog ────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== "blog") return;
    loadBlog();
  }, [tab]);

  async function loadBlog() {
    setLoadingBlog(true);
    try {
      const { data, error } = await supabase
        .from("website_blog_meta")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("published_at", { ascending: false });
      if (error) throw error;
      setBlog(data || []);
    } catch (e) {
      showNotif("Gagal memuat artikel: " + e.message, "error");
    } finally {
      setLoadingBlog(false);
    }
  }

  // ── Upload image to R2 ───────────────────────────────────────────
  async function uploadImage(file, folder) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64 = e.target.result.split(",")[1];
          const res = await _apiFetch("/api/upload-foto", {
            method: "POST",
            headers: await _apiHeaders(),
            body: JSON.stringify({ base64, filename: file.name, folder, mimeType: file.type }),
          });
          const d = await res.json();
          if (!d.success || !d.url) throw new Error(d.error || "Upload gagal");
          resolve(d.url);
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Portfolio: upload foto baru ──────────────────────────────────
  async function handlePortfolioUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    let successCount = 0;
    for (const file of files) {
      try {
        const url = await uploadImage(file, `website-portfolio/${portfolioCat}`);
        const maxOrder = portfolio.length ? Math.max(...portfolio.map(p => p.sort_order || 0)) : 0;
        const { error } = await supabase.from("website_portfolio").insert({
          category: portfolioCat,
          title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
          image_url: url,
          sort_order: maxOrder + 1,
          is_active: true,
        });
        if (error) throw error;
        successCount++;
      } catch (err) {
        showNotif("Gagal upload " + file.name + ": " + err.message, "error");
      }
    }
    if (successCount) {
      showNotif(`${successCount} foto berhasil diupload`, "success");
      loadPortfolio();
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Portfolio: update caption ────────────────────────────────────
  async function updateCaption(id, title) {
    const { error } = await supabase.from("website_portfolio").update({ title }).eq("id", id);
    if (error) showNotif("Gagal update caption: " + error.message, "error");
  }

  // ── Portfolio: toggle active ─────────────────────────────────────
  async function toggleActive(item) {
    const { error } = await supabase.from("website_portfolio").update({ is_active: !item.is_active }).eq("id", item.id);
    if (error) { showNotif("Gagal: " + error.message, "error"); return; }
    setPortfolio(prev => prev.map(p => p.id === item.id ? { ...p, is_active: !item.is_active } : p));
  }

  // ── Portfolio: reorder ───────────────────────────────────────────
  async function moveItem(index, dir) {
    const next = [...portfolio];
    const swapIdx = index + dir;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[index], next[swapIdx]] = [next[swapIdx], next[index]];
    setPortfolio(next);
    await Promise.all([
      supabase.from("website_portfolio").update({ sort_order: index }).eq("id", next[index].id),
      supabase.from("website_portfolio").update({ sort_order: swapIdx }).eq("id", next[swapIdx].id),
    ]);
  }

  // ── Portfolio: delete ────────────────────────────────────────────
  async function deletePortfolio(item) {
    showConfirm(`Hapus foto "${item.title || "ini"}"?`, async () => {
      const { error } = await supabase.from("website_portfolio").delete().eq("id", item.id);
      if (error) { showNotif("Gagal hapus: " + error.message, "error"); return; }
      showNotif("Foto dihapus", "success");
      setPortfolio(prev => prev.filter(p => p.id !== item.id));
    });
  }

  // ── Blog: open add modal ─────────────────────────────────────────
  function openAdd() {
    setBlogForm({ ...EMPTY_BLOG, published_at: new Date().toISOString().slice(0, 10) });
    setCoverFile(null); setCoverPreview("");
    setBlogModal("add");
  }

  // ── Blog: open edit modal ────────────────────────────────────────
  function openEdit(article) {
    setBlogForm({
      slug: article.slug,
      title: article.title,
      cover_image_url: article.cover_image_url || "",
      excerpt: article.excerpt || "",
      category: article.category || "tips",
      published_at: article.published_at || "",
      read_minutes: article.read_minutes || 7,
      is_published: article.is_published !== false,
    });
    setCoverFile(null); setCoverPreview(article.cover_image_url || "");
    setBlogModal(article);
  }

  // ── Blog: cover file pick ────────────────────────────────────────
  function onCoverPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setCoverPreview(ev.target.result);
    reader.readAsDataURL(file);
  }

  // ── Blog: save (add / edit) ──────────────────────────────────────
  async function saveBlog() {
    if (!blogForm.slug.trim() || !blogForm.title.trim()) {
      showNotif("Slug dan Judul wajib diisi", "error"); return;
    }
    setSavingBlog(true);
    try {
      let coverUrl = blogForm.cover_image_url;
      if (coverFile) {
        coverUrl = await uploadImage(coverFile, "blog-covers");
      }
      const payload = { ...blogForm, cover_image_url: coverUrl || null };
      if (blogModal === "add") {
        const maxOrder = blog.length ? Math.max(...blog.map(b => b.sort_order || 0)) : 0;
        payload.sort_order = maxOrder + 1;
        const { error } = await supabase.from("website_blog_meta").insert(payload);
        if (error) throw error;
        showNotif("Artikel berhasil ditambah", "success");
      } else {
        const { error } = await supabase.from("website_blog_meta").update(payload).eq("id", blogModal.id);
        if (error) throw error;
        showNotif("Artikel diperbarui", "success");
      }
      setBlogModal(null);
      loadBlog();
    } catch (e) {
      showNotif("Gagal simpan: " + e.message, "error");
    } finally {
      setSavingBlog(false);
    }
  }

  // ── Blog: delete ─────────────────────────────────────────────────
  function deleteBlog(article) {
    showConfirm(`Hapus artikel "${article.title}"?`, async () => {
      const { error } = await supabase.from("website_blog_meta").delete().eq("id", article.id);
      if (error) { showNotif("Gagal hapus: " + error.message, "error"); return; }
      showNotif("Artikel dihapus", "success");
      setBlog(prev => prev.filter(b => b.id !== article.id));
    });
  }

  // ── Blog: toggle published ───────────────────────────────────────
  async function togglePublished(article) {
    const { error } = await supabase.from("website_blog_meta").update({ is_published: !article.is_published }).eq("id", article.id);
    if (error) { showNotif("Gagal: " + error.message, "error"); return; }
    setBlog(prev => prev.map(b => b.id === article.id ? { ...b, is_published: !article.is_published } : b));
  }

  // ── Blog: move sort order ────────────────────────────────────────
  async function moveBlog(index, dir) {
    const filtered = filteredBlog;
    const swapIdx = index + dir;
    if (swapIdx < 0 || swapIdx >= filtered.length) return;
    const a = filtered[index], b = filtered[swapIdx];
    await Promise.all([
      supabase.from("website_blog_meta").update({ sort_order: b.sort_order }).eq("id", a.id),
      supabase.from("website_blog_meta").update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    loadBlog();
  }

  const filteredBlog = blogFilter === "all" ? blog : blog.filter(b => b.category === blogFilter);

  const btnStyle = (active) => ({
    padding: "6px 14px", borderRadius: 8, border: "1px solid " + (active ? cs.accent : cs.border),
    background: active ? cs.accent + "22" : "transparent", color: active ? cs.accent : cs.muted,
    cursor: "pointer", fontSize: 13, fontWeight: active ? 700 : 400,
  });

  const card = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 12 };

  // ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "20px 24px", maxWidth: 1100, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 800, fontSize: 20, color: cs.text }}>Konten Website</div>
        <div style={{ fontSize: 13, color: cs.muted, marginTop: 4 }}>Kelola foto portfolio dan artikel blog aclean.id dari sini.</div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <button style={btnStyle(tab === "portfolio")} onClick={() => setTab("portfolio")}>🖼 Portfolio Foto</button>
        <button style={btnStyle(tab === "blog")} onClick={() => setTab("blog")}>📝 Artikel Blog</button>
      </div>

      {/* ── PORTFOLIO TAB ──────────────────────────────────────────── */}
      {tab === "portfolio" && (
        <div>
          {/* Category tabs */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            {CATEGORIES.map(c => (
              <button key={c.id} style={btnStyle(portfolioCat === c.id)} onClick={() => setPortfolioCat(c.id)}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>

          {/* Upload button */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <button
              style={{ padding: "8px 18px", borderRadius: 9, background: cs.accent, color: "#fff", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14, opacity: uploading ? 0.6 : 1 }}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Mengupload..." : "+ Upload Foto"}
            </button>
            <span style={{ fontSize: 12, color: cs.muted }}>Bisa pilih beberapa foto sekaligus. JPG/PNG, maks 5 MB/foto.</span>
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handlePortfolioUpload} />
          </div>

          {/* Grid */}
          {loadingPortfolio ? (
            <div style={{ padding: 40, textAlign: "center", color: cs.muted }}>Memuat...</div>
          ) : portfolio.length === 0 ? (
            <div style={{ ...card, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
              <div style={{ color: cs.muted, fontSize: 14 }}>Belum ada foto untuk kategori ini.</div>
              <div style={{ color: cs.muted, fontSize: 13, marginTop: 4 }}>Klik "Upload Foto" untuk menambah.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {portfolio.map((item, idx) => (
                <PortfolioCard
                  key={item.id} item={item} idx={idx} total={portfolio.length}
                  onMove={moveItem} onToggle={toggleActive} onDelete={deletePortfolio}
                  onCaptionSave={updateCaption} cs={cs}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── BLOG TAB ───────────────────────────────────────────────── */}
      {tab === "blog" && (
        <div>
          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            <button
              style={{ padding: "8px 18px", borderRadius: 9, background: cs.accent, color: "#fff", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14 }}
              onClick={openAdd}
            >+ Artikel Baru</button>
            <div style={{ flex: 1 }} />
            {/* Filter */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button style={btnStyle(blogFilter === "all")} onClick={() => setBlogFilter("all")}>Semua</button>
              {BLOG_CATEGORIES.map(c => (
                <button key={c.id} style={btnStyle(blogFilter === c.id)} onClick={() => setBlogFilter(c.id)}>{c.label}</button>
              ))}
            </div>
          </div>

          {loadingBlog ? (
            <div style={{ padding: 40, textAlign: "center", color: cs.muted }}>Memuat...</div>
          ) : (
            <div style={{ ...card, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid " + cs.border }}>
                    {["Cover", "Judul", "Kategori", "Tanggal", "Menit", "Status", "Aksi"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, color: cs.muted, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredBlog.map((article, idx) => (
                    <BlogRow
                      key={article.id} article={article} idx={idx} total={filteredBlog.length}
                      onEdit={() => openEdit(article)}
                      onDelete={() => deleteBlog(article)}
                      onToggle={() => togglePublished(article)}
                      onMove={(dir) => moveBlog(idx, dir)}
                      cs={cs}
                    />
                  ))}
                </tbody>
              </table>
              {filteredBlog.length === 0 && (
                <div style={{ padding: 32, textAlign: "center", color: cs.muted, fontSize: 14 }}>Tidak ada artikel.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── BLOG MODAL ─────────────────────────────────────────────── */}
      {blogModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", overflowY: "auto" }}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 16, padding: 28, width: "100%", maxWidth: 560, position: "relative" }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: cs.text, marginBottom: 20 }}>
              {blogModal === "add" ? "Tambah Artikel Baru" : "Edit Artikel"}
            </div>

            <Field label="Slug (URL)" help="contoh: tips-hemat-listrik-ac">
              <input
                value={blogForm.slug} onChange={e => setBlogForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }))}
                placeholder="tips-hemat-listrik-ac" style={inputStyle(cs)}
                disabled={blogModal !== "add"}
              />
            </Field>

            <Field label="Judul Artikel">
              <input value={blogForm.title} onChange={e => setBlogForm(p => ({ ...p, title: e.target.value }))} placeholder="Cara Merawat AC agar Awet" style={inputStyle(cs)} />
            </Field>

            <Field label="Excerpt (ringkasan 1–2 kalimat)">
              <textarea value={blogForm.excerpt} onChange={e => setBlogForm(p => ({ ...p, excerpt: e.target.value }))} rows={3} style={{ ...inputStyle(cs), resize: "vertical" }} placeholder="Deskripsi singkat artikel..." />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Kategori">
                <select value={blogForm.category} onChange={e => setBlogForm(p => ({ ...p, category: e.target.value }))} style={inputStyle(cs)}>
                  {BLOG_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Tanggal Terbit">
                <input type="date" value={blogForm.published_at} onChange={e => setBlogForm(p => ({ ...p, published_at: e.target.value }))} style={inputStyle(cs)} />
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Estimasi baca (menit)">
                <input type="number" min={1} max={30} value={blogForm.read_minutes} onChange={e => setBlogForm(p => ({ ...p, read_minutes: parseInt(e.target.value) || 7 }))} style={inputStyle(cs)} />
              </Field>
              <Field label="Status">
                <select value={blogForm.is_published ? "published" : "draft"} onChange={e => setBlogForm(p => ({ ...p, is_published: e.target.value === "published" }))} style={inputStyle(cs)}>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </Field>
            </div>

            <Field label="Cover Image">
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <input value={blogForm.cover_image_url} onChange={e => setBlogForm(p => ({ ...p, cover_image_url: e.target.value }))} placeholder="https://... atau upload di bawah" style={inputStyle(cs)} />
                  <div style={{ marginTop: 8 }}>
                    <button style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid " + cs.border, background: cs.card, color: cs.text, cursor: "pointer", fontSize: 13 }} onClick={() => coverInputRef.current?.click()}>
                      📎 Upload Cover
                    </button>
                    <input ref={coverInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onCoverPick} />
                  </div>
                </div>
                {coverPreview && (
                  <img src={coverPreview} alt="preview" style={{ width: 90, height: 60, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                )}
              </div>
            </Field>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 24 }}>
              <button style={{ padding: "8px 18px", borderRadius: 9, border: "1px solid " + cs.border, background: "transparent", color: cs.muted, cursor: "pointer" }} onClick={() => setBlogModal(null)}>
                Batal
              </button>
              <button
                style={{ padding: "8px 18px", borderRadius: 9, background: cs.accent, color: "#fff", border: "none", cursor: "pointer", fontWeight: 700, opacity: savingBlog ? 0.6 : 1 }}
                onClick={saveBlog} disabled={savingBlog}
              >
                {savingBlog ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function PortfolioCard({ item, idx, total, onMove, onToggle, onDelete, onCaptionSave, cs }) {
  const [caption, setCaption] = useState(item.title || "");
  const [editing, setEditing] = useState(false);

  return (
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, overflow: "hidden", opacity: item.is_active ? 1 : 0.5 }}>
      <div style={{ position: "relative" }}>
        <img src={item.image_url} alt={caption} style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }} loading="lazy" />
        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}>
          <button title="Pindah ke atas" onClick={() => onMove(idx, -1)} disabled={idx === 0}
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "rgba(0,0,0,.5)", color: "#fff", cursor: "pointer", fontSize: 14, opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
          <button title="Pindah ke bawah" onClick={() => onMove(idx, 1)} disabled={idx === total - 1}
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "rgba(0,0,0,.5)", color: "#fff", cursor: "pointer", fontSize: 14, opacity: idx === total - 1 ? 0.3 : 1 }}>↓</button>
        </div>
        <div style={{ position: "absolute", top: 8, left: 8 }}>
          <span style={{ padding: "3px 8px", borderRadius: 6, background: item.is_active ? "#22c55e" : "#94a3b8", color: "#fff", fontSize: 11, fontWeight: 700 }}>
            {item.is_active ? "Aktif" : "Nonaktif"}
          </span>
        </div>
      </div>
      <div style={{ padding: 12 }}>
        {editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input value={caption} onChange={e => setCaption(e.target.value)} style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid " + cs.border, background: cs.surface, color: cs.text, fontSize: 13 }}
              onKeyDown={e => { if (e.key === "Enter") { onCaptionSave(item.id, caption); setEditing(false); } if (e.key === "Escape") { setCaption(item.title || ""); setEditing(false); } }} autoFocus />
            <button onClick={() => { onCaptionSave(item.id, caption); setEditing(false); }}
              style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: cs.accent, color: "#fff", cursor: "pointer", fontSize: 12 }}>✓</button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1, fontSize: 13, color: cs.text, fontWeight: 500 }}>{caption || <span style={{ color: cs.muted }}>Klik untuk beri caption</span>}</span>
            <button onClick={() => setEditing(true)} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid " + cs.border, background: "transparent", color: cs.muted, cursor: "pointer", fontSize: 12 }}>✏️</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button onClick={() => onToggle(item)}
            style={{ flex: 1, padding: "5px 0", borderRadius: 7, border: "1px solid " + cs.border, background: "transparent", color: cs.muted, cursor: "pointer", fontSize: 12 }}>
            {item.is_active ? "Sembunyikan" : "Tampilkan"}
          </button>
          <button onClick={() => onDelete(item)}
            style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #ef4444", background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: 12 }}>🗑</button>
        </div>
      </div>
    </div>
  );
}

function BlogRow({ article, idx, total, onEdit, onDelete, onToggle, onMove, cs }) {
  const cat = BLOG_CATEGORIES.find(c => c.id === article.category);
  return (
    <tr style={{ borderBottom: "1px solid " + cs.border + "44" }}>
      <td style={{ padding: "10px 12px" }}>
        {article.cover_image_url
          ? <img src={article.cover_image_url} alt="" style={{ width: 60, height: 40, objectFit: "cover", borderRadius: 6 }} />
          : <div style={{ width: 60, height: 40, borderRadius: 6, background: cs.border, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📄</div>
        }
      </td>
      <td style={{ padding: "10px 12px" }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: cs.text, lineHeight: 1.3 }}>{article.title}</div>
        <div style={{ fontSize: 11, color: cs.muted, marginTop: 2, fontFamily: "monospace" }}>{article.slug}</div>
      </td>
      <td style={{ padding: "10px 12px" }}>
        <span style={{ padding: "2px 8px", borderRadius: 6, background: cs.accent + "22", color: cs.accent, fontSize: 11, fontWeight: 600 }}>
          {cat?.label || article.category}
        </span>
      </td>
      <td style={{ padding: "10px 12px", fontSize: 13, color: cs.muted, whiteSpace: "nowrap" }}>
        {article.published_at ? new Date(article.published_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-"}
      </td>
      <td style={{ padding: "10px 12px", fontSize: 13, color: cs.muted, textAlign: "center" }}>{article.read_minutes} mnt</td>
      <td style={{ padding: "10px 12px" }}>
        <button onClick={onToggle} style={{ padding: "3px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700,
          background: article.is_published ? "#22c55e22" : cs.border, color: article.is_published ? "#22c55e" : cs.muted }}>
          {article.is_published ? "Published" : "Draft"}
        </button>
      </td>
      <td style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => onMove(-1)} disabled={idx === 0} title="Naik" style={{ padding: "4px 7px", borderRadius: 6, border: "1px solid " + cs.border, background: "transparent", color: cs.muted, cursor: "pointer", fontSize: 12, opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
          <button onClick={() => onMove(1)} disabled={idx === total - 1} title="Turun" style={{ padding: "4px 7px", borderRadius: 6, border: "1px solid " + cs.border, background: "transparent", color: cs.muted, cursor: "pointer", fontSize: 12, opacity: idx === total - 1 ? 0.3 : 1 }}>↓</button>
          <button onClick={onEdit} style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid " + cs.border, background: "transparent", color: cs.text, cursor: "pointer", fontSize: 12 }}>Edit</button>
          <button onClick={onDelete} style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid #ef4444", background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: 12 }}>Hapus</button>
        </div>
      </td>
    </tr>
  );
}

function Field({ label, help, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: cs.muted, marginBottom: 4 }}>
        {label}{help && <span style={{ fontWeight: 400, marginLeft: 6, opacity: 0.7 }}>— {help}</span>}
      </label>
      {children}
    </div>
  );
}

function inputStyle(cs) {
  return { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid " + cs.border, background: cs.surface, color: cs.text, fontSize: 14 };
}
