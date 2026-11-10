import { useState } from "react";
import { fotoProxyUrl } from "../lib/fotoUrl.js";
import { waMediaUrl } from "../lib/waPaymentContext.js";

export default function WaMessageAttachment({ value }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  let href = waMediaUrl(value);
  if (!href) return null;
  let parsed;
  try { parsed = new URL(href, "https://aclean.invalid"); } catch { return null; }
  const key = parsed.searchParams.get("key") || parsed.pathname.replace(/^\/+/, "");
  const pdf = /\.pdf$/i.test(key);
  const temporary = key.startsWith("wa-staging/");
  if (temporary) href = fotoProxyUrl(value);
  return <a href={href} target="_blank" rel="noopener noreferrer" className="wa-media">
    {pdf ? <span>📄 PDF</span> : previewFailed ? <span>Pratinjau tidak tersedia</span>
      : <img src={href} alt="Lampiran pesan WhatsApp" loading="lazy" onError={() => setPreviewFailed(true)} />}
    <span>{pdf ? "Buka PDF" : "Buka lampiran"}{temporary ? " · sementara" : ""} ↗</span>
  </a>;
}
