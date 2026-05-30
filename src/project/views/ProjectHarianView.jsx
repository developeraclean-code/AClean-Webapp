import React from "react";
import { cs } from "../../theme/cs.js";

export default function ProjectHarianView() {
  return (
    <div style={{ padding: 22 }}>
      <h2 style={{ color: cs.text, marginBottom: 4, fontSize: 18 }}>Laporan Harian (Pagi / Sore)</h2>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 16 }}>
        Sesi Pagi (berangkat) &amp; Sore (pulang) + foto bertanda waktu &amp; GPS, alat checkout dari list, verify mengunci hari.
      </div>
      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 24, color: cs.muted }}>
        Coming soon.
      </div>
    </div>
  );
}
