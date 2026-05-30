import React from "react";
import { cs } from "../../theme/cs.js";

export default function ProjectUsageView() {
  return (
    <div style={{ padding: 22 }}>
      <h2 style={{ color: cs.text, marginBottom: 4, fontSize: 18 }}>Pemakaian Material</h2>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 16 }}>
        Pemakaian terecord per project &amp; tanggal. Input multi-baris ala Excel.
      </div>
      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 24, color: cs.muted }}>
        Coming soon.
      </div>
    </div>
  );
}
