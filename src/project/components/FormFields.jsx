import React, { useState, useMemo, useRef, useEffect } from "react";
import Modal from "./Modal.jsx";
import { cs } from "../../theme/cs.js";
import { btn, btnSm, tableStyles } from "../utils/styles.js";

// Generic form renderer dipanggil dari ModalContext.
// fields: array of { name, label, type?, options?, columns?, val?, ph?, hint? }
// type: text|number|date|time|textarea|select|checks|grid|photo
export default function FormFields({ title, fields, onSubmit, onClose, today, gps }) {
  const initRows = useMemo(() => {
    const r = {};
    fields.forEach((f) => {
      if (f.type === "grid") r[f.name] = (f.rows && f.rows.length ? f.rows : [{}, {}, {}]).map((x) => ({ ...x }));
      else if (f.type === "checks") r[f.name] = [];
      else if (f.type === "photo") r[f.name + "_files"] = [];
      else r[f.name] = f.val ?? "";
    });
    return r;
  }, [fields]);
  const [data, setData] = useState(initRows);
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const out = {};
    fields.forEach((f) => {
      if (f.type === "grid") {
        out[f.name] = (data[f.name] || []).map((r) => ({ ...r })).filter((r) => Object.values(r).some((v) => v !== "" && v !== undefined && v !== null));
      } else if (f.type === "photo") {
        out[f.name] = data[f.name + "_files"] || [];  // [{name, dataUrl}]
      } else {
        out[f.name] = data[f.name];
      }
    });
    out._photos = fields.filter((f) => f.type === "photo").reduce((s, f) => s + (data[f.name + "_files"]?.length || 0), 0);
    onSubmit?.(out);
  };

  const wide = fields.some((f) => f.type === "grid");
  return (
    <Modal wide={wide} onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 14, color: cs.text }}>{title}</h3>
      <form onSubmit={handleSubmit}>
        {fields.map((f) => (
          <Field key={f.name} f={f} data={data} set={set} today={today} gps={gps} />
        ))}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
          <button type="button" style={btn("ghost")} onClick={onClose}>Batal</button>
          <button type="submit" style={btn()}>Simpan</button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ f, data, set, today, gps }) {
  const baseInput = { width: "100%", background: cs.surface, border: `1px solid ${cs.border}`, color: cs.text, borderRadius: 9, padding: "9px 11px", fontSize: 13, fontFamily: "inherit" };
  if (f.type === "select") {
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: cs.muted, marginBottom: 5 }}>{f.label}</label>
        <select style={baseInput} value={data[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)}>
          {f.options.map((o) => (<option key={o} value={o}>{o}</option>))}
        </select>
      </div>
    );
  }
  if (f.type === "textarea") {
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: cs.muted, marginBottom: 5 }}>{f.label}</label>
        <textarea style={{ ...baseInput, minHeight: 64 }} placeholder={f.ph || ""} value={data[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} />
      </div>
    );
  }
  if (f.type === "checks") {
    const sel = data[f.name] || [];
    const toggle = (o) => set(f.name, sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]);
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: cs.muted, marginBottom: 5 }}>{f.label}</label>
        <div style={{ background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 9, padding: 8, maxHeight: 150, overflow: "auto" }}>
          {f.options.length ? f.options.map((o) => (
            <label key={o} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: cs.text, cursor: "pointer", padding: "3px 0" }}>
              <input type="checkbox" checked={sel.includes(o)} onChange={() => toggle(o)} /> {o}
            </label>
          )) : <span style={{ color: cs.muted, fontSize: 13 }}>tidak ada item tersedia</span>}
        </div>
      </div>
    );
  }
  if (f.type === "photo") {
    return <PhotoField f={f} files={data[f.name + "_files"] || []} setFiles={(v) => set(f.name + "_files", v)} gps={gps} />;
  }
  if (f.type === "grid") {
    const rows = data[f.name] || [];
    const setRows = (r) => set(f.name, r);
    const addRow = () => setRows([...rows, {}]);
    const delRow = (i) => setRows(rows.filter((_, j) => j !== i));
    const setCell = (i, key, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 4px" }}>
          <label style={{ fontSize: 12, color: cs.muted }}>{f.label}</label>
          <button type="button" style={btnSm()} onClick={addRow}>+ Baris</button>
        </div>
        {f.hint && <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>{f.hint}</div>}
        <div style={{ overflow: "auto" }}>
          <table style={tableStyles.table}>
            <thead><tr>
              <th style={{ ...tableStyles.th, width: 22 }}>#</th>
              {f.columns.map((c) => (<th key={c.key} style={tableStyles.th}>{c.label}</th>))}
              <th style={{ ...tableStyles.th, width: 26 }}></th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...tableStyles.td, color: cs.muted, fontSize: 11, textAlign: "center" }}>{i + 1}</td>
                  {f.columns.map((c) => (
                    <td key={c.key} style={{ ...tableStyles.td, padding: "3px 4px" }}>
                      {c.type === "select" ? (
                        <select style={cellInput} value={r[c.key] ?? c.options[0]} onChange={(e) => setCell(i, c.key, e.target.value)}>
                          {c.options.map((o) => (<option key={o} value={o}>{o}</option>))}
                        </select>
                      ) : (
                        <input type={c.type || "text"} style={cellInput} value={r[c.key] ?? ""} onChange={(e) => setCell(i, c.key, e.target.value)} />
                      )}
                    </td>
                  ))}
                  <td style={{ ...tableStyles.td, padding: "3px 4px" }}>
                    <button type="button" style={btnSm("ghost")} onClick={() => delRow(i)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  // default text/number/date/time
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12, color: cs.muted, marginBottom: 5 }}>{f.label}</label>
      <input type={f.type || "text"} style={baseInput} placeholder={f.ph || ""} value={data[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} />
    </div>
  );
}

const cellInput = { width: "100%", background: cs.surface, border: `1px solid ${cs.border}`, color: cs.text, borderRadius: 6, padding: "6px 7px", fontSize: 12, fontFamily: "inherit" };

// Burn timestamp + GPS ke gambar (anti foto lama) lalu kompres → dataURL jpeg.
async function stampPhoto(file, stampText) {
  const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = dataUrl; });
    const maxW = 1280;
    const scale = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const lines = stampText.split("\n");
    const fs = Math.max(13, Math.round(w * 0.024));
    ctx.font = `bold ${fs}px sans-serif`;
    const pad = Math.round(fs * 0.5);
    const stripH = fs * lines.length + pad * 2.4;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, h - stripH, w, stripH);
    ctx.fillStyle = "#fff"; ctx.textBaseline = "top";
    lines.forEach((ln, i) => ctx.fillText(ln, pad, h - stripH + pad + i * (fs + 2)));
    return c.toDataURL("image/jpeg", 0.82);
  } catch { return dataUrl; }  // fallback: gambar asli tanpa stamp
}

function PhotoField({ f, files, setFiles, gps }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (!picked.length) return;
    const take = picked.slice(0, 30 - files.length);
    setBusy(true);
    const stamp = `${new Date().toLocaleString("id-ID")}\nLok: ${gps}`;
    const stamped = [];
    for (const file of take) { try { stamped.push({ name: file.name, dataUrl: await stampPhoto(file, stamp) }); } catch { /* skip file rusak */ } }
    setFiles([...files, ...stamped]);
    setBusy(false);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12, color: cs.muted, marginBottom: 5 }}>{f.label}</label>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={onPick} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8 }}>
        {files.map((p, i) => (
          <div key={i} style={{ position: "relative", aspectRatio: 1, borderRadius: 10, overflow: "hidden", border: `1px solid ${cs.border}` }}>
            <img alt="" src={p.dataUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}
              style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: 9, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 11, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
        ))}
        {files.length < 30 && (
          <div onClick={() => !busy && inputRef.current?.click()} style={{ position: "relative", aspectRatio: 1, background: "linear-gradient(135deg,#1b2740,#0f1b30)", border: `1px dashed ${cs.border}`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: cs.accent, fontSize: 11, cursor: busy ? "wait" : "pointer", textAlign: "center" }}>
            {busy ? "…" : "+ foto"}
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: cs.muted, marginTop: 10 }}>{files.length} / 30 foto · timestamp + GPS otomatis di-stamp · diupload ke R2</div>
    </div>
  );
}
