import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WaMessageAttachment from "../WaMessageAttachment.jsx";

afterEach(() => { delete import.meta.env.VITE_R2_CDN_URL; });

describe("WhatsApp attachment previews", () => {
  it("shows a temporary chat photo through the existing private R2 proxy", () => {
    const html=renderToStaticMarkup(<WaMessageAttachment value="/api/foto?key=wa-staging%2F2026-11%2Fphoto.jpg" />);
    expect(html).toContain('<img');expect(html).toContain('wa-staging%2F');expect(html).toContain('sementara');
  });
  it("offers an explicit PDF link without a failing image preview", () => {
    const html=renderToStaticMarkup(<WaMessageAttachment value="/api/foto?key=wa-staging%2F2026-11%2Fpo.pdf" />);
    expect(html).toContain('Buka PDF');expect(html).not.toContain('<img');expect(html).toContain('po.pdf');
  });
  it("keeps archived evidence separate from temporary media", () => {
    const html=renderToStaticMarkup(<WaMessageAttachment value="/api/foto?key=wa-inbox%2F2026-11%2Fproof.jpg" />);
    expect(html).toContain('<img');expect(html).not.toContain('sementara');
  });
  it("does not render executable or invalid attachment links", () => {
    expect(renderToStaticMarkup(<WaMessageAttachment value="javascript:alert(1)" />)).toBe('');
    expect(renderToStaticMarkup(<WaMessageAttachment value="https://" />)).toBe('');
  });
});

it("keeps temporary media on the authenticated app proxy when a public CDN is configured", () => {
  import.meta.env.VITE_R2_CDN_URL="https://cdn.example.com";
  const html=renderToStaticMarkup(<WaMessageAttachment value="/api/foto?key=wa-staging%2F2026-11%2Fphoto.jpg" />);
  expect(html).toContain('/api/foto?key=wa-staging%2F');expect(html).not.toContain('cdn.example.com');
});
