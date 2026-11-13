import { describe, expect, it } from "vitest";
import { guidelineImageUrl, parseGuidelineContent, serializeGuidelineContent } from "../teamGuidelineContent.js";

const url = guidelineImageUrl("foto/team-guidelines/0123456789abcdef0123.jpg");
describe("team guideline content compatibility and image boundaries", () => {
  it("preserves old text, paragraph breaks, HTML and Markdown as literal text", () => {
    const text = "Aturan lama\n\n<script>alert(1)</script>\n**teks**";
    expect(parseGuidelineContent(text)).toEqual({ text, images: [] });
  });
  it("round trips image-only and mixed content without a schema change", () => {
    expect(parseGuidelineContent(serializeGuidelineContent("", [url]))).toEqual({ text: "", images: [url] });
    expect(parseGuidelineContent(serializeGuidelineContent("Dua\nbaris", [url]))).toEqual({ text: "Dua\nbaris", images: [url] });
  });
  it.each(["javascript:alert(1)", "data:image/svg+xml,evil", "https://tracker.invalid/pixel.jpg", "/api/foto?key=payments%2Fproof.jpg", "/api/foto?key=%zz", "/api/foto?key=foto%2Fteam-guidelines%2F..%2Fsecret.jpg"])("keeps untrusted image reference as text: %s", value => {
    const raw = `![Gambar tata tertib](${value})`;
    expect(parseGuidelineContent(raw)).toEqual({ text: raw, images: [] });
    expect(() => serializeGuidelineContent("", [value])).toThrow();
  });
  it("limits rendered images and keeps excess references visible rather than dropping data", () => {
    const content = Array(5).fill(`![Gambar tata tertib](${url})`).join("\n");
    expect(parseGuidelineContent(content).images).toHaveLength(4);
    expect(parseGuidelineContent(content).text).toContain(url);
  });
});
