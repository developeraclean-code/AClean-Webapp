import { describe, expect, it } from "vitest";
import {
  absoluteAttachmentUrl,
  chunkDocumentAttachments,
  MAX_DOCUMENT_ATTACHMENTS,
  normalizeDocumentAttachments,
} from "../documentAttachments.js";

describe("document attachments", () => {
  it("menormalisasi payload lama/rusak dan membatasi 8 foto", () => {
    const input = [null, { url: "" }, ...Array.from({ length: 10 }, (_, index) => ({ url: `/foto/${index}.jpg`, caption: `Foto ${index}` }))];
    const result = normalizeDocumentAttachments(input);
    expect(result).toHaveLength(MAX_DOCUMENT_ATTACHMENTS);
    expect(result[0]).toMatchObject({ url: "/foto/0.jpg", caption: "Foto 0" });
  });

  it("mendukung json string dan membagi empat foto per halaman", () => {
    const value = JSON.stringify(Array.from({ length: 7 }, (_, index) => ({ id: index, url: `https://cdn.test/${index}.jpg` })));
    expect(chunkDocumentAttachments(value)).toHaveLength(2);
    expect(chunkDocumentAttachments(value)[0]).toHaveLength(4);
    expect(chunkDocumentAttachments(value)[1]).toHaveLength(3);
  });

  it("mengubah URL proxy relatif menjadi absolut untuk renderer PDF", () => {
    expect(absoluteAttachmentUrl("/api/foto?key=a.jpg", "https://aclean.test"))
      .toBe("https://aclean.test/api/foto?key=a.jpg");
    expect(absoluteAttachmentUrl("https://cdn.test/a.jpg", "https://aclean.test"))
      .toBe("https://cdn.test/a.jpg");
  });
});
