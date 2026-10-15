import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';

// Isolated UI preview: no .env read, no Supabase client initialization/API proxy.
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.MAINT_VRV_PREVIEW_PORT || 4176);
const bundle = await context({ absWorkingDir: root, entryPoints: ['preview/maintenance/main.jsx'], bundle: true, write: false, outdir: '/tmp/aclean-maintenance-vrv-preview', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}' } });
let output = await bundle.rebuild();
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AClean — Preview Maintenance VRV</title><style>*{box-sizing:border-box}body{margin:0;background:#081321;color:#e6edf5;font:14px system-ui}main{max-width:1150px;margin:auto;padding:22px}h1{font-size:25px}h2{font-size:19px}header p{color:#91a5bc}nav{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}section{background:#0e1e2e;padding:18px;border:1px solid #243b53;border-radius:12px;margin:15px 0}.notice{padding:12px;background:#133245;border:1px solid #26617a;border-radius:8px;line-height:1.5}.warning{color:#ffc65c}.good{color:#64deac}li{margin:8px 0}button,input,select,textarea{font:inherit}@media(max-width:500px){main{padding:12px}section{padding:10px}h1{font-size:21px}}</style></head><body><div id="root"></div><script src="/main.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
  try {
    if (req.url === '/' && req.method === 'GET') { output = await bundle.rebuild(); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
    else if (req.url === '/main.js' && req.method === 'GET') { const file = output.outputFiles.find(f => f.path.endsWith('/main.js')); res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); res.end(file.contents); }
    else { res.writeHead(404); res.end('Preview only; no API endpoints.'); }
  } catch { res.writeHead(500); res.end('Preview gagal dibangun. Periksa terminal.'); }
});
server.on('error', async error => { console.error(error.message); await bundle.dispose(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Preview maintenance VRV: http://127.0.0.1:${port}\nSimulasi lokal saja; tidak terhubung ke Supabase/WA. Refresh setelah edit kode.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); await bundle.dispose(); process.exit(0); });
