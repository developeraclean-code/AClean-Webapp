import { useState } from "react";
import { fotoUrl } from "../lib/fotoUrl.js";
import { cs } from "../theme/cs.js";

// Failed legacy objects stay visible as an actionable warning, not a hidden image
// or a timer-driven retry. Changing the URL naturally permits the new file.
export default function PaymentEvidencePreview({ url }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const src = fotoUrl(url);
  if (!src) return null;
  if (failedUrl === src) return <div role="status" style={{ width: 160, minHeight: 120, flexShrink: 0, padding: 12, boxSizing: "border-box", background: cs.surface, borderRadius: 8, color: cs.yellow, fontSize: 12 }}>
    Berkas bukti tidak tersedia. Periksa WA asli lalu unggah ulang melalui Lampirkan Bukti. Status pembayaran tidak berubah.
  </div>;
  return <a href={src} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
    {/\.pdf(?:[?#]|$)/i.test(src)
      ? <div style={{ width: 160, height: 200, display: "grid", placeItems: "center", color: cs.text, background: cs.surface, borderRadius: 8 }}>📄 Buka PDF</div>
      : <img src={src} alt="Bukti pembayaran WA" loading="lazy" onError={() => setFailedUrl(src)} style={{ width: 160, height: 200, objectFit: "cover", borderRadius: 8, border: "1px solid " + cs.border }} />}
  </a>;
}
