import { useRef, useState } from "react";
import { cs } from "../theme/cs.js";
import { prepareDocumentImage } from "../project/utils/documentAttachments.js";
import { GUIDELINE_IMAGE_FOLDER, MAX_GUIDELINE_IMAGES, guidelineImageUrl, parseGuidelineContent, serializeGuidelineContent } from "../lib/teamGuidelineContent.js";

export default function TeamGuidelineEditor({ content = "", apiFetch, onSave, onCancel, onBusyChange, onReload }) {
  const initial = parseGuidelineContent(content);
  const [text, setText] = useState(initial.text);
  const [images, setImages] = useState(initial.images);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const lock = useRef(false);
  const input = useRef(null);
  const run = async (action, savingPoint = false) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError("");
    try { await action(); }
    catch (e) {
      setError(e.message || "Belum berhasil. Silakan coba lagi.");
      if (savingPoint) setNeedsReload(true);
    }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  };
  const upload = event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || images.length >= MAX_GUIDELINE_IMAGES) return;
    return run(async () => {
      if (!apiFetch) throw new Error("Upload gambar belum tersedia");
      const image = await prepareDocumentImage(file);
      const url = guidelineImageUrl(`${GUIDELINE_IMAGE_FOLDER}/${image.hash}.jpg`);
      if (images.includes(url)) throw new Error("Gambar ini sudah ditambahkan");
      const response = await apiFetch("/api/upload-foto", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: GUIDELINE_IMAGE_FOLDER, hash: image.hash, filename: image.name, mimeType: "image/jpeg", base64: image.dataUrl }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true || guidelineImageUrl(result.key) !== url) {
        throw new Error(result.error || "Upload gambar belum terkonfirmasi");
      }
      setImages(previous => [...previous, url]);
    });
  };
  return <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <label style={{ display: "grid", gap: 6, fontSize: 13, color: cs.text }}>
      Teks poin
      <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Tulis poin baru atau tambahkan gambar…"
        style={{ width: "100%", boxSizing: "border-box", background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 8, padding: 10, color: cs.text, font: "inherit", lineHeight: 1.5, resize: "vertical" }} />
    </label>
    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      {images.map((url, index) => <div key={url} style={{ minWidth: 0 }}>
        <img src={url} alt={`Gambar poin ${index + 1}`} style={{ display: "block", maxWidth: "100%", maxHeight: 360, borderRadius: 8, objectFit: "contain" }} />
        <button type="button" onClick={() => setImages(previous => previous.filter(value => value !== url))} style={{ marginTop: 5, color: cs.red, background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 6, padding: 6 }}>Hapus gambar {index + 1}</button>
      </div>)}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      <button type="button" disabled={images.length >= MAX_GUIDELINE_IMAGES} onClick={() => input.current?.click()}
        style={{ padding: "8px 12px", background: cs.surface, color: cs.accent, border: `1px solid ${cs.border}`, borderRadius: 7 }}>+ Tambah Gambar</button>
      <input ref={input} type="file" accept="image/*" aria-label="Pilih gambar poin" hidden onChange={upload} />
      <button type="button" disabled={needsReload || (!text.trim() && !images.length)} onClick={() => run(() => onSave(serializeGuidelineContent(text, images)), true)}
        style={{ padding: "8px 14px", background: cs.green, color: "#fff", border: 0, borderRadius: 7, fontWeight: 700 }}>Simpan Poin</button>
      <button type="button" onClick={onCancel} style={{ padding: "8px 12px", background: cs.surface, color: cs.muted, border: `1px solid ${cs.border}`, borderRadius: 7 }}>Batal</button>
    </div>
    <div style={{ fontSize: 12, color: cs.muted, marginTop: 8 }}>Teks, gambar, atau keduanya · maksimal {MAX_GUIDELINE_IMAGES} gambar, 15 MB per file. Tekan Simpan Poin untuk menerbitkan perubahan.</div>
    {busy && <div role="status" style={{ color: cs.accent, marginTop: 8 }}>Memproses…</div>}
    {error && <div role="alert" style={{ color: cs.red, marginTop: 8 }}>{error}</div>}
    {needsReload && <div style={{ color: cs.muted, marginTop: 8 }}>Periksa daftar sebelum mengirim ulang agar poin tidak terduplikasi. <button type="button" onClick={() => run(onReload)}>Muat ulang daftar</button></div>}
  </fieldset>;
}
