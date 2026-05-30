import React from "react";
import { cs } from "../../theme/cs.js";

export default function ProjectDocsView() {
  return (
    <div style={{ padding: 22 }}>
      <h2 style={{ color: cs.text, marginBottom: 4, fontSize: 18 }}>Dokumen / BAST</h2>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 16 }}>
        Surat Penerimaan, Pengiriman Barang, Berita Acara Pengerjaan. Editor grid ala Excel + TTD virtual + preview PDF.
      </div>
      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 24, color: cs.muted }}>
        Coming soon.
      </div>
    </div>
  );
}
