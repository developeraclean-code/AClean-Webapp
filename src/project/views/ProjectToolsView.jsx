import React from "react";
import { cs } from "../../theme/cs.js";

export default function ProjectToolsView() {
  return (
    <div style={{ padding: 22 }}>
      <h2 style={{ color: cs.text, marginBottom: 4, fontSize: 18 }}>Alat Kerja Project</h2>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 16 }}>
        Master alat + lokasi (gudang / di-lokasi). Terpisah dari Tas Teknisi reguler.
      </div>
      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 24, color: cs.muted }}>
        Coming soon.
      </div>
    </div>
  );
}
