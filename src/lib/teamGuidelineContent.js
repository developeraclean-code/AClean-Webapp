// Keep existing plain text rows readable. Images use a narrowly supported
// Markdown line in the existing content column; arbitrary HTML/URLs never render.
export const MAX_GUIDELINE_IMAGES = 4;
export const GUIDELINE_IMAGE_FOLDER = "foto/team-guidelines";

export function guidelineImageUrl(key) {
  return typeof key === "string" && /^foto\/team-guidelines\/[a-f0-9]{20}\.jpg$/.test(key)
    ? `/api/foto?key=${encodeURIComponent(key)}` : "";
}

export function parseGuidelineContent(content = "") {
  const images = [], text = [];
  for (const line of String(content).split("\n")) {
    const match = line.match(/^!\[Gambar tata tertib\]\((\/api\/foto\?key=[^\s)]+)\)$/);
    let url = "";
    if (match) {
      try { url = guidelineImageUrl(decodeURIComponent(match[1].slice("/api/foto?key=".length))); }
      catch { /* Invalid encoding stays visible as plain text. */ }
    }
    if (url && images.length < MAX_GUIDELINE_IMAGES) images.push(url);
    else text.push(line);
  }
  return { text: text.join("\n").trim(), images };
}

export function serializeGuidelineContent(text, images = []) {
  const valid = images.slice(0, MAX_GUIDELINE_IMAGES).map(url => {
    const parsed = parseGuidelineContent(`![Gambar tata tertib](${url})`);
    if (parsed.images.length !== 1) throw new Error("Referensi gambar tidak valid");
    return `![Gambar tata tertib](${parsed.images[0]})`;
  });
  return [String(text || "").trim(), ...valid].filter(Boolean).join("\n\n");
}
