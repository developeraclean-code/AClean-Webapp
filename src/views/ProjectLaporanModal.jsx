import { useState, useRef, useCallback, useEffect } from "react";
import { cs } from "../theme/cs.js";

const MAX_FOTO = 20;
const MAX_DIM  = 1280;
const QUALITY  = 0.72;

function compressFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const c  = document.createElement("canvas");
        c.width  = Math.round(img.width  * sc);
        c.height = Math.round(img.height * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", QUALITY));
      };
      img.onerror = () => rej(new Error("Gambar tidak valid"));
      img.src = e.target.result;
    };
    r.onerror = () => rej(new Error("Gagal baca file"));
    r.readAsDataURL(file);
  });
}

// Cek apakah user bisa edit laporan yang sudah ada.
// Bisa edit jika: submitter sendiri, atau teknisi utama order (lead/PIC).
function canEditReport(existing, currentUser, order) {
  if (!existing) return true; // belum ada → siapa saja bisa submit
  if (existing.status === "VERIFIED") return false; // sudah diverifikasi Owner
  const myName = currentUser?.name || "";
  const isSubmitter  = existing.submitted_by === myName;
  const isLeadTeknis = (order?.teknisi || "") === myName;
  return isSubmitter || isLeadTeknis;
}

export default function ProjectLaporanModal({
  order,
  project,
  currentUser,
  supabase,
  apiFetch,
  apiHeaders,
  fotoSrc,
  onClose,
  showNotif,
}) {
  // ── State ──
  const [loading,    setLoading]    = useState(true);
  const [existing,   setExisting]   = useState(null);  // row dari DB jika sudah ada
  const [pekerjaan,  setPekerjaan]  = useState("");
  const [kendala,    setKendala]    = useState("");
  const [fotos,      setFotos]      = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const fileRef   = useRef();
  const submitRef = useRef(false);

  // ── Load existing report untuk order ini ──
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!order?.id) { setLoading(false); return; }
      const { data } = await supabase
        .from("project_daily_reports")
        .select("id,status,submitted_by,pekerjaan,kendala,foto_urls,revision_note")
        .eq("order_id", order.id)
        .maybeSingle();
      if (cancel) return;
      if (data) {
        setExisting(data);
        // Pre-fill form dengan data existing (untuk teknisi utama yang mau edit)
        setPekerjaan(data.pekerjaan || "");
        setKendala(data.kendala || "");
        // foto existing: tampilkan sebagai URL-only (sudah di R2)
        const existingFotos = (data.foto_urls || []).map((url, i) => ({
          id: `ex_${i}`, data_url: null, url, uploading: false, errMsg: "",
        }));
        setFotos(existingFotos);
      }
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [order?.id, supabase]);

  const canEdit = canEditReport(existing, currentUser, order);
  const isVerified = existing?.status === "VERIFIED";
  const isRevision = existing?.status === "REVISION";

  // ── Upload foto ──
  const addFiles = useCallback(async (files) => {
    const sisa = MAX_FOTO - fotos.length;
    if (sisa <= 0) { showNotif(`Maksimal ${MAX_FOTO} foto`); return; }
    const picked = Array.from(files).slice(0, sisa);
    const placeholders = picked.map((_, i) => ({
      id: `ph_${Date.now()}_${i}`, data_url: null, url: null, uploading: true, errMsg: "",
    }));
    setFotos(prev => [...prev, ...placeholders]);

    for (let i = 0; i < picked.length; i++) {
      const ph   = placeholders[i];
      const file = picked[i];
      try {
        const dataUrl = await compressFile(file);
        setFotos(prev => prev.map(f => f.id === ph.id ? { ...f, data_url: dataUrl } : f));
        const headers = await apiHeaders();
        const res     = await apiFetch("/api/upload-foto", {
          method: "POST",
          headers,
          body: JSON.stringify({
            base64: dataUrl,
            filename: `${ph.id}.jpg`,
            reportId: `proj-${order?.id || "tmp"}`,
            mimeType: "image/jpeg",
            hash: ph.id,
            currentUserRole: currentUser?.role || "Unknown",
          }),
        });
        const d = await res.json();
        if (d.success && d.url) {
          setFotos(prev => prev.map(f => f.id === ph.id ? { ...f, url: d.url, uploading: false } : f));
        } else {
          setFotos(prev => prev.map(f => f.id === ph.id ? { ...f, uploading: false, errMsg: "Upload gagal" } : f));
        }
      } catch (e) {
        setFotos(prev => prev.map(f => f.id === ph.id ? { ...f, uploading: false, errMsg: e.message || "Error" } : f));
      }
    }
  }, [fotos.length, order, currentUser, apiFetch, apiHeaders]);

  const removePhoto = (id) => setFotos(prev => prev.filter(f => f.id !== id));

  // ── Submit ──
  const handleSubmit = async () => {
    if (submitRef.current) return;
    if (!pekerjaan.trim()) { showNotif("Isi deskripsi pekerjaan hari ini"); return; }
    if (fotos.some(f => f.uploading)) { showNotif("Tunggu upload foto selesai..."); return; }
    const failedCount = fotos.filter(f => f.errMsg).length;
    if (failedCount > 0) {
      const ok = window.confirm(`${failedCount} foto gagal upload. Lanjutkan submit tanpa foto tersebut?`);
      if (!ok) return;
    }

    submitRef.current = true;
    setSubmitting(true);
    try {
      const fotoUrls  = fotos.filter(f => f.url).map(f => f.url);
      const helperArr = [order?.helper, order?.helper2, order?.helper3].filter(Boolean);
      const myName    = currentUser?.name || null;

      if (existing) {
        // UPDATE — hanya submitter atau teknisi utama
        const { error } = await supabase
          .from("project_daily_reports")
          .update({
            pekerjaan:    pekerjaan.trim(),
            kendala:      kendala.trim() || null,
            foto_urls:    fotoUrls,
            status:       "PENDING",     // reset ke PENDING setelah di-edit
            revision_note: null,
            submitted_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) throw error;
        showNotif(`✅ Laporan ${order.date} diperbarui — ${fotoUrls.length} foto`);
      } else {
        // INSERT baru
        const id = "PDR-" + order.id + "-" + Date.now().toString(36).toUpperCase();
        const { error } = await supabase
          .from("project_daily_reports")
          .insert({
            id,
            project_id:   order.project_id,
            order_id:     order.id,
            tanggal:      order.date,
            teknisi_name: order.teknisi || myName,
            helper_names: helperArr,
            pekerjaan:    pekerjaan.trim(),
            kendala:      kendala.trim() || null,
            foto_urls:    fotoUrls,
            status:       "PENDING",
            submitted_by: myName,
            submitted_at: new Date().toISOString(),
          });
        if (error) throw error;
        showNotif(`✅ Berita acara ${order.date} tersimpan — ${fotoUrls.length} foto`);
      }
      onClose();
    } catch (e) {
      showNotif("❌ Gagal submit: " + (e?.message || e));
      submitRef.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  const projectName = project?.nama || order?.customer || "Project";
  const stilUpl     = fotos.some(f => f.uploading);

  // ── Loading ──
  if (loading) {
    return (
      <ModalShell onClose={onClose}>
        <div style={{ textAlign: "center", padding: "40px 0", color: cs.muted, fontSize: 13 }}>
          <div style={{ marginBottom: 8 }}>⏳ Memuat data laporan...</div>
        </div>
      </ModalShell>
    );
  }

  // ── Status VERIFIED — read-only untuk semua ──
  if (isVerified) {
    return (
      <ModalShell onClose={onClose}>
        <ModalHeader projectName={projectName} order={order} />
        <div style={{ background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#166534", fontWeight: 600 }}>
          ✅ Laporan ini sudah diverifikasi Owner/Admin — tidak bisa diedit.
        </div>
        <ReadOnlyContent existing={existing} fotos={fotos} fotoSrc={fotoSrc} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btnStyle(false)}>Tutup</button>
        </div>
      </ModalShell>
    );
  }

  // ── Laporan sudah ada tapi user ini tidak berhak edit ──
  if (existing && !canEdit) {
    const submitter = existing.submitted_by || "anggota tim";
    return (
      <ModalShell onClose={onClose}>
        <ModalHeader projectName={projectName} order={order} />
        <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 10, padding: "12px 14px", fontSize: 13, color: cs.text }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>🔒 Laporan sudah diisi oleh <span style={{ color: cs.accent }}>{submitter}</span></div>
          <div style={{ fontSize: 12, color: cs.muted }}>Hanya <b>{submitter}</b> atau <b>teknisi utama ({order?.teknisi || "—"})</b> yang bisa merevisi.</div>
        </div>
        <ReadOnlyContent existing={existing} fotos={fotos} fotoSrc={fotoSrc} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btnStyle(false)}>Tutup</button>
        </div>
      </ModalShell>
    );
  }

  // ── Form edit / submit ──
  return (
    <ModalShell onClose={onClose}>
      <ModalHeader projectName={projectName} order={order} />

      {/* Banner edit mode */}
      {existing && isRevision && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>
          <b>⚠️ Mode Revisi:</b> {existing.revision_note || "Owner/Admin meminta revisi laporan ini."}
        </div>
      )}
      {existing && !isRevision && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#1e40af" }}>
          <b>✏️ Edit laporan</b> — diisi oleh <b>{existing.submitted_by || "—"}</b>.
          {(order?.teknisi || "") === (currentUser?.name || "") && existing.submitted_by !== currentUser?.name
            ? " Anda edit sebagai teknisi utama."
            : ""}
        </div>
      )}

      {/* Pekerjaan */}
      <div>
        <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>
          Pekerjaan Hari Ini <span style={{ color: cs.red }}>*</span>
        </label>
        <textarea
          value={pekerjaan}
          onChange={e => setPekerjaan(e.target.value)}
          placeholder="Contoh: Instalasi pipa refrigeran unit 1–3, finishing insulator, uji tekanan..."
          rows={4}
          style={textareaStyle}
        />
      </div>

      {/* Kendala */}
      <div>
        <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>
          Kendala / Catatan <span style={{ color: cs.muted }}>(opsional)</span>
        </label>
        <textarea
          value={kendala}
          onChange={e => setKendala(e.target.value)}
          placeholder="Misal: Kompresor unit 2 bocor, tunggu spare part besok..."
          rows={2}
          style={textareaStyle}
        />
      </div>

      {/* Foto Upload */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: cs.muted }}>Foto Dokumentasi ({fotos.length}/{MAX_FOTO})</label>
          {fotos.length < MAX_FOTO && (
            <button onClick={() => fileRef.current?.click()} style={addFotoBtn}>+ Tambah Foto</button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
          onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />

        {fotos.length === 0 ? (
          <div onClick={() => fileRef.current?.click()} style={dropZone}>
            📷 Tap untuk tambah foto (maks {MAX_FOTO})
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 8 }}>
            {fotos.map(f => (
              <div key={f.id} style={{ position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden", border: `1px solid ${cs.border}`, background: cs.card }}>
                {(f.data_url || f.url) ? (
                  <img
                    src={f.data_url || (f.url ? (fotoSrc ? fotoSrc(f.url) : f.url) : "")}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", opacity: f.uploading ? 0.4 : 1 }}
                  />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${cs.accent}`, borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
                  </div>
                )}
                {f.uploading && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ fontSize: 9, color: "#fff", background: "rgba(0,0,0,0.55)", padding: "2px 5px", borderRadius: 4 }}>⏳</div>
                  </div>
                )}
                {f.errMsg && (
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(239,68,68,0.85)", fontSize: 9, color: "#fff", padding: "2px 4px", textAlign: "center" }}>❌ Gagal</div>
                )}
                {!f.uploading && (
                  <button onClick={() => removePhoto(f.id)} style={removePhotoBtn}>✕</button>
                )}
              </div>
            ))}
            {fotos.length < MAX_FOTO && (
              <div onClick={() => fileRef.current?.click()} style={{ aspectRatio: "1", borderRadius: 8, border: `2px dashed ${cs.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: cs.muted, fontSize: 22, cursor: "pointer", background: cs.card }}>+</div>
            )}
          </div>
        )}
        {stilUpl && <div style={{ fontSize: 11, color: cs.accent, marginTop: 6 }}>⏳ Mengupload foto...</div>}
      </div>

      {/* Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
        <button onClick={onClose} disabled={submitting} style={btnStyle(false)}>Batal</button>
        <button
          onClick={handleSubmit}
          disabled={submitting || stilUpl || !pekerjaan.trim()}
          style={{
            padding: "11px 0", borderRadius: 10, border: "none",
            background: (submitting || !pekerjaan.trim()) ? cs.border : "linear-gradient(135deg,#3b82f6,#2563eb)",
            color: "#fff", cursor: (submitting || !pekerjaan.trim()) ? "not-allowed" : "pointer",
            fontWeight: 800, fontSize: 13,
          }}>
          {submitting
            ? "Menyimpan..."
            : existing
              ? `✏️ Simpan Revisi${fotos.filter(f => f.url).length ? ` · ${fotos.filter(f => f.url).length} foto` : ""}`
              : `✅ Submit Berita Acara${fotos.filter(f => f.url).length ? ` · ${fotos.filter(f => f.url).length} foto` : ""}`}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Sub-komponen ──

function ModalShell({ children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: cs.surface, borderRadius: 16, padding: 24, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 16 }}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ projectName, order }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: cs.text }}>📋 Berita Acara Harian</div>
        <div style={{ fontSize: 12, color: cs.accent, marginTop: 2, fontWeight: 600 }}>{projectName}</div>
        <div style={{ fontSize: 11, color: cs.muted }}>
          {order?.date} · {[order?.teknisi, order?.helper].filter(Boolean).join(", ")}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyContent({ existing, fotos, fotoSrc }) {
  if (!existing) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Pekerjaan</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 10, padding: "10px 12px", color: cs.text }}>
          {existing.pekerjaan || "—"}
        </div>
      </div>
      {existing.kendala && (
        <div>
          <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Kendala</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 12px", color: "#92400e" }}>
            {existing.kendala}
          </div>
        </div>
      )}
      {fotos.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: cs.muted, marginBottom: 6 }}>{fotos.length} Foto</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 8 }}>
            {fotos.map(f => (
              <div key={f.id} style={{ aspectRatio: "1", borderRadius: 8, overflow: "hidden", border: `1px solid ${cs.border}` }}>
                <img src={fotoSrc ? fotoSrc(f.url) : f.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            ))}
          </div>
        </div>
      )}
      {existing.revision_note && (
        <div style={{ fontSize: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", color: "#92400e" }}>
          <b>Catatan revisi:</b> {existing.revision_note}
        </div>
      )}
    </div>
  );
}

// ── Style constants ──
const textareaStyle = {
  width: "100%", background: cs.card, border: `1px solid ${cs.border}`,
  borderRadius: 10, padding: "10px 12px", color: cs.text,
  fontSize: 13, resize: "vertical", boxSizing: "border-box",
  outline: "none", fontFamily: "inherit",
};

const addFotoBtn = {
  background: cs.accent + "22", border: `1px solid ${cs.accent}55`,
  color: cs.accent, borderRadius: 8, padding: "5px 12px",
  fontSize: 12, cursor: "pointer", fontWeight: 600,
};

const dropZone = {
  border: `2px dashed ${cs.border}`, borderRadius: 12,
  padding: "28px 16px", textAlign: "center",
  color: cs.muted, fontSize: 12, cursor: "pointer",
};

const removePhotoBtn = {
  position: "absolute", top: 3, right: 3,
  background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%",
  color: "#fff", fontSize: 11, width: 20, height: 20,
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  lineHeight: 1,
};

function btnStyle(primary) {
  return {
    padding: "11px 0", borderRadius: 10,
    border: primary ? "none" : `1px solid ${cs.border}`,
    background: primary ? "linear-gradient(135deg,#3b82f6,#2563eb)" : "transparent",
    color: primary ? "#fff" : cs.muted,
    cursor: "pointer", fontWeight: 600, fontSize: 13,
  };
}
