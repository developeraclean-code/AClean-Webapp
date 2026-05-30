import React from "react";
import { cs } from "../../theme/cs.js";

export default function Modal({ wide, onClose, children }) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(2,6,15,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }}>
      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 16, width: "100%", maxWidth: wide ? 760 : 520, maxHeight: "90vh", overflow: "auto", padding: 20 }}>
        {children}
      </div>
    </div>
  );
}
