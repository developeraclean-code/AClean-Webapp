import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { context } from "esbuild";

// Independent of Vite/app startup: no .env, credentials, API proxy, or Supabase client.
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.WA_PREVIEW_PORT || 4174);
const bundle = await context({
  absWorkingDir: root, entryPoints: ["preview/whatsapp/main.jsx"], bundle: true,
  write: false, outdir: "/tmp/aclean-wa-preview", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
});
let output = await bundle.rebuild();
const catalogMedia = new Map();
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AClean — Testing WhatsApp Lokal</title><link rel="stylesheet" href="/main.css"></head><body><div id="root"></div><script src="/main.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
  const requestUrl = new URL(req.url, "http://127.0.0.1");
  const path = requestUrl.pathname;
  try {
    if (path === "/api/upload-foto" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 8 * 1024 * 1024) throw new Error("Foto demo terlalu besar"); }
      const payload = JSON.parse(body);
      const key = `catalog/${String(payload.filename || "demo.jpg").replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
      if (!/^image\/(jpeg|png|webp)$/.test(payload.mimeType || "") || !payload.base64) throw new Error("Format foto demo tidak valid");
      catalogMedia.set(key, { buffer: Buffer.from(payload.base64, "base64"), mime: payload.mimeType });
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ success: true, key }));
    } else if (path === "/api/foto" && req.method === "GET") {
      const key = requestUrl.searchParams.get("key");
      const media = catalogMedia.get(key);
      const buffer = media?.buffer || (key === "catalog/demo.jpg" ? await readFile(new URL("../public/sop/sop-cleaning.png", import.meta.url)) : null);
      if (!buffer) { res.writeHead(404); res.end("Foto demo tidak ditemukan"); return; }
      res.writeHead(200, { "Content-Type": media?.mime || "image/png" }); res.end(buffer);
    } else if (path === "/") {
      output = await bundle.rebuild();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html);
    } else if (["/main.js", "/main.css"].includes(path)) {
      const file = output.outputFiles.find(f => f.path.endsWith(path));
      res.writeHead(200, { "Content-Type": path.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/css; charset=utf-8" });
      res.end(file.contents);
    } else { res.writeHead(404); res.end("Not found"); }
  } catch (error) {
    console.error(error.message);
    res.writeHead(500); res.end("Preview gagal dibangun. Periksa terminal.");
  }
});
server.on("error", async error => { console.error(error.message); await bundle.dispose(); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`Preview WhatsApp: http://127.0.0.1:${port}\nData simulasi saja. Refresh browser setelah mengedit file. Ctrl+C untuk berhenti.`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { server.close(); await bundle.dispose(); process.exit(0); });
