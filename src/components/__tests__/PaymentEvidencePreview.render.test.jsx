import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PaymentEvidencePreview from "../PaymentEvidencePreview.jsx";

afterEach(() => { delete import.meta.env.VITE_R2_CDN_URL; });

describe("PaymentEvidencePreview", () => {
  it("memuat bukti R2 lewat origin aplikasi saat CDN masih r2.dev", () => {
    import.meta.env.VITE_R2_CDN_URL = "https://pub-example.r2.dev";
    const html = renderToStaticMarkup(
      <PaymentEvidencePreview url="https://pub-example.r2.dev/wa-inbox/2026-11/bukti.jpg" />,
    );
    expect(html).toContain("/api/foto?key=wa-inbox%2F2026-11%2Fbukti.jpg");
    expect(html).not.toContain("r2.dev");
  });
});
