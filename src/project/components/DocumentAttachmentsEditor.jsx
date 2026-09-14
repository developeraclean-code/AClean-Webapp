import React, { useRef, useState } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { MAX_DOCUMENT_ATTACHMENTS, normalizeDocumentAttachments, prepareDocumentImage } from "../utils/documentAttachments.js";

export default function DocumentAttachmentsEditor({ value, onChange, uploadFiles, notify = () => {}, disabled = false }) {
  const attachments = normalizeDocumentAttachments(value);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const selectFiles = async (event) => {
    const room = MAX_DOCUMENT_ATTACHMENTS - attachments.length;
    const files = Array.from(event.target.files || []).slice(0, room);
    event.target.value = "";
    if (!files.length) {
      if (room <= 0) notify(`⚠️ Maksimal ${MAX_DOCUMENT_ATTACHMENTS} foto per dokumen`);
      return;
    }
    setUploading(true);
    try {
      notify(`⏳ Menyiapkan ${files.length} foto…`);
      const prepared = [];
      for (const file of files) prepared.push(await prepareDocumentImage(file));
      const existingHashes = new Set(attachments.map(row => row.hash).filter(Boolean));
      const unique = prepared.filter(row => !existingHashes.has(row.hash));
      if (!unique.length) { notify("⚠️ Semua foto yang dipilih sudah terlampir"); return; }
      const urls = await uploadFiles(unique);
      if (!Array.isArray(urls) || urls.length !== unique.length || urls.some(url => !url)) throw new Error("Hasil upload foto tidak lengkap");
      const added = unique.map((row, index) => ({
        id: `${row.hash}-${Date.now()}-${index}`,
        url: urls[index], name: row.originalName, hash: row.hash,
        caption: `Dokumentasi ${attachments.length + index + 1}`,
      }));
      onChange([...attachments, ...added]);
      notify(`✅ ${added.length} foto ditambahkan ke dokumen`);
    } catch (error) {
      notify(`❌ ${error.message || "Gagal upload lampiran"}`);
    } finally {
      setUploading(false);
    }
  };

  const patch = (index, fields) => onChange(attachments.map((row, i) => i === index ? { ...row, ...fields } : row));
  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= attachments.length) return;
    const next = [...attachments];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div style={{ marginTop: 14, padding: 12, border: `1px solid ${cs.border}`, borderRadius: 10, background: cs.surface }}>
      <div style={{ ...S.between, gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ color: cs.text, fontWeight: 800, fontSize: 13 }}>📷 Lampiran Gambar</div>
          <div style={{ color: cs.muted, fontSize: 11 }}>Tampil berurutan di PDF · maksimal {MAX_DOCUMENT_ATTACHMENTS} foto</div>
        </div>
        <button type="button" style={{ ...S.btnSm(), opacity: disabled || uploading || attachments.length >= MAX_DOCUMENT_ATTACHMENTS ? 0.55 : 1 }}
          disabled={disabled || uploading || attachments.length >= MAX_DOCUMENT_ATTACHMENTS} onClick={() => inputRef.current?.click()}>
          {uploading ? "Mengupload…" : "+ Attach Gambar"}
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={selectFiles} />
      </div>
      {disabled && <div style={{ color: cs.yellow, fontSize: 11, marginBottom: 8 }}>Migration 172 belum aktif. Lampiran belum dapat disimpan.</div>}
      {attachments.length === 0 ? (
        <div style={{ color: cs.muted, fontSize: 12, padding: "12px 4px", textAlign: "center" }}>Belum ada gambar terlampir</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 9 }}>
          {attachments.map((row, index) => (
            <div key={row.id} style={{ border: `1px solid ${cs.border}`, borderRadius: 8, padding: 7, minWidth: 0 }}>
              <img src={row.url} alt={row.caption || row.name} style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 6, display: "block" }} />
              <input value={row.caption} placeholder={`Keterangan foto ${index + 1}`}
                onChange={event => patch(index, { caption: event.target.value })}
                style={{ width: "100%", marginTop: 6, background: cs.card, border: `1px solid ${cs.border}`, color: cs.text, borderRadius: 6, padding: "6px 7px", boxSizing: "border-box", fontSize: 11 }} />
              <div style={{ display: "flex", gap: 5, justifyContent: "flex-end", marginTop: 6 }}>
                <button type="button" style={S.btnSm("ghost")} disabled={index === 0} onClick={() => move(index, -1)}>←</button>
                <button type="button" style={S.btnSm("ghost")} disabled={index === attachments.length - 1} onClick={() => move(index, 1)}>→</button>
                <button type="button" style={{ ...S.btnSm("ghost"), color: cs.red }} onClick={() => onChange(attachments.filter((_, i) => i !== index))}>Hapus</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
