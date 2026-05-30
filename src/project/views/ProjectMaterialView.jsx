import React from "react";
import { cs } from "../../theme/cs.js";

export default function ProjectMaterialView() {
  return (
    <div style={{ padding: 22 }}>
      <h2 style={{ color: cs.text, marginBottom: 4, fontSize: 18 }}>Stok Material Project</h2>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 16 }}>
        Berdiri sendiri dari Inventori utama. Gudang + alokasi per project, dikelompokkan per sub-kategori.
      </div>
      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 24, color: cs.muted }}>
        Coming soon.
      </div>
    </div>
  );
}
