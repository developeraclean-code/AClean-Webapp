// Bridge lokal: jalankan handler ASLI api/[route].js sebagai server HTTP,
// supaya UI (vite dev) bisa panggil /api/* full-stack saat smoke-test.
// Emulasi req/res ala Vercel. Port 3300.
import http from "node:http";
import { readFileSync } from "node:fs";

// load .env.local ke process.env
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const handler = (await import("../api/[route].js")).default;

const server = http.createServer(async (nreq, nres) => {
  const u = new URL(nreq.url, "http://localhost");
  const route = u.pathname.replace(/^\/api\//, "").replace(/^\/api$/, "");
  const query = Object.fromEntries(u.searchParams.entries());
  query.route = route;

  // baca body
  let raw = "";
  for await (const chunk of nreq) raw += chunk;
  let body = {};
  if (raw) { try { body = JSON.parse(raw); } catch { body = {}; } }

  // req ala Vercel
  const req = { method: nreq.method, url: nreq.url, headers: nreq.headers, query, body };
  // res ala Vercel
  const res = {
    statusCode: 200,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; nres.setHeader(k, v); return this; },
    status(c) { this.statusCode = c; return this; },
    json(obj) { nres.statusCode = this.statusCode; nres.setHeader("Content-Type", "application/json"); nres.end(JSON.stringify(obj)); return this; },
    send(d) { nres.statusCode = this.statusCode; nres.end(typeof d === "string" ? d : JSON.stringify(d)); return this; },
    end(d) { nres.statusCode = this.statusCode; nres.end(d); return this; },
  };

  try { await handler(req, res); }
  catch (e) { console.error("[bridge]", route, e.message); if (!nres.headersSent) { nres.statusCode = 500; nres.end(JSON.stringify({ error: "bridge error" })); } }
});

server.listen(3300, () => console.log("API bridge ready on http://localhost:3300"));
