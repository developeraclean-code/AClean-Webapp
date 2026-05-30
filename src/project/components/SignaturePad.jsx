import React, { useRef, useState, useEffect } from "react";
import Modal from "./Modal.jsx";
import { cs } from "../../theme/cs.js";
import { btn } from "../utils/styles.js";

export default function SignaturePad({ kepada, initialName = "", onSave, onClose }) {
  const canvasRef = useRef(null);
  const [name, setName] = useState(initialName === "(belum)" ? "" : initialName);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d");
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#0f172a";
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
    };
    const start = (e) => { drawing.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move = (e) => { if (!drawing.current) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
    const end = () => { drawing.current = false; };
    c.addEventListener("mousedown", start); c.addEventListener("mousemove", move); window.addEventListener("mouseup", end);
    c.addEventListener("touchstart", start); c.addEventListener("touchmove", move); c.addEventListener("touchend", end);
    return () => {
      c.removeEventListener("mousedown", start); c.removeEventListener("mousemove", move); window.removeEventListener("mouseup", end);
      c.removeEventListener("touchstart", start); c.removeEventListener("touchmove", move); c.removeEventListener("touchend", end);
    };
  }, []);

  const clear = () => { const c = canvasRef.current; const ctx = c.getContext("2d"); ctx.clearRect(0, 0, c.width, c.height); };
  const save = () => {
    if (!name.trim()) { alert("Isi nama dulu"); return; }
    const dataUrl = canvasRef.current.toDataURL();
    onSave({ name: name.trim(), img: dataUrl });
  };

  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 14, color: cs.text }}>Tanda Tangan Virtual — {kepada}</h3>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: cs.muted, marginBottom: 5 }}>Nama penanda tangan (customer)</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth: Pak Hadi"
          style={{ width: "100%", background: cs.surface, border: `1px solid ${cs.border}`, color: cs.text, borderRadius: 9, padding: "9px 11px", fontSize: 13, fontFamily: "inherit" }} />
      </div>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 6 }}>Tanda tangan di kotak — mouse / jari:</div>
      <canvas ref={canvasRef} width={460} height={170}
        style={{ background: "#fff", borderRadius: 8, width: "100%", touchAction: "none", cursor: "crosshair", border: `1px solid ${cs.border}` }} />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
        <button style={btn("ghost")} onClick={clear}>Hapus</button>
        <button style={btn("ghost")} onClick={onClose}>Batal</button>
        <button style={btn("green")} onClick={save}>Simpan TTD</button>
      </div>
    </Modal>
  );
}
