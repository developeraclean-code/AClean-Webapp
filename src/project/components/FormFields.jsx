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
      else if (f.type === "photo") r[f.name + "_n"] = 0;
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
        out[f.name] = data[f.name + "_n"] || 0;
      } else {
        out[f.name] = data[f.name];
      }
    });
    out._photos = Object.keys(data).filter((k) => k.endsWith("_n")).reduce((s, k) => s + (data[k] || 0), 0);
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
    const n = data[f.name + "_n"] || 0;
    const add = () => { if (n < 30) set(f.name + "_n", n + 1); };
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: cs.muted, marginBottom: 5 }}>{f.label}</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8 }}>
          {Array.from({ length: n }).map((_, i) => (
            <PhotoCell key={i} stamp={`${today.slice(5)} ${String(8 + Math.floor(i / 4)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}`} gps={gps} mark="✓" />
          ))}
          {n < 30 && (
            <div onClick={add} style={{ position: "relative", aspectRatio: 1, background: "linear-gradient(135deg,#1b2740,#0f1b30)", border: `1px dashed ${cs.border}`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: cs.accent, fontSize: 11, cursor: "pointer" }}>+ foto</div>
          )}
        </div>
        <div style={{ fontSize: 11, color: cs.muted, marginTop: 10 }}>{n} / 30 foto · auto timestamp + GPS (anti foto lama) · R2</div>
      </div>
    );
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

function PhotoCell({ stamp, gps, mark }) {
  return (
    <div style={{ position: "relative", aspectRatio: 1, background: "linear-gradient(135deg,#1b2740,#0f1b30)", border: `1px solid ${cs.border}`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: cs.muted, fontSize: 11, overflow: "hidden" }}>
      {mark}
      <span style={{ position: "absolute", left: 3, right: 3, bottom: 3, fontSize: 7.5, lineHeight: 1.25, background: "rgba(0,0,0,.6)", color: "#e2e8f0", borderRadius: 3, padding: "1px 3px", textAlign: "left" }}>
        {stamp}<br />📍{gps}
      </span>
    </div>
  );
}
