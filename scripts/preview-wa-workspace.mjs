import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
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
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AClean — Testing WhatsApp Lokal</title><link rel="stylesheet" href="/main.css"></head><body><div id="root"></div><script src="/main.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  try {
    if (path === "/") {
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
