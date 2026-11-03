// Local/self-hosted HTTP adapter for the existing Vercel-style API handlers.
// This module deliberately does not load .env files or start a listener on import.
import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function securityHeaders(res) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
}

function decorateResponse(res) {
  res.status = function status(code) { this.statusCode = code; return this; };
  res.json = function json(value) {
    if (!this.hasHeader('Content-Type')) this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.end(JSON.stringify(value));
    return this;
  };
  res.send = function send(value) {
    if (Buffer.isBuffer(value) || typeof value === 'string') this.end(value);
    else this.json(value);
    return this;
  };
}

async function parseBody(req, maxBodyBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error('Request body terlalu besar');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type.endsWith('+json')) {
    try { return JSON.parse(raw); }
    catch {
      const error = new Error('JSON tidak valid');
      error.statusCode = 400;
      throw error;
    }
  }
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(raw));
  if (type === 'text/plain') return raw;
  const error = new Error('Content-Type tidak didukung');
  error.statusCode = 415;
  throw error;
}

async function serveStatic(req, res, pathname, staticDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return res.status(400).end(); }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) {
    return res.status(404).end();
  }
  const isAsset = decoded.startsWith('/assets/');
  const requested = path.resolve(staticDir, `.${decoded}`);
  if (requested !== staticDir && !requested.startsWith(staticDir + path.sep)) return res.status(404).end();
  let file = requested;
  let info;
  try { info = await stat(file); }
  catch { /* SPA fallback below. */ }
  if (!info?.isFile()) {
    if (isAsset || path.extname(decoded)) return res.status(404).end();
    file = path.join(staticDir, 'index.html');
    try { info = await stat(file); }
    catch { return res.status(503).json({ error: 'Frontend belum dibangun' }); }
  }
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`)
    ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate');
  res.setHeader('Content-Length', info.size);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file);
  stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  stream.pipe(res);
}

export function createAppServer({ unifiedHandler, directHandlers = {}, staticDir, maxBodyBytes = 10 * 1024 * 1024 }) {
  if (typeof unifiedHandler !== 'function' || !staticDir) throw new Error('Handler dan staticDir wajib diisi');
  const resolvedStaticDir = path.resolve(staticDir);
  return http.createServer(async (req, res) => {
    securityHeaders(res);
    decorateResponse(res);
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return res.status(400).end(); }
    const pathname = url.pathname;
    if (pathname === '/api') return res.status(404).json({ error: 'API route tidak ditemukan' });
    if (!pathname.startsWith('/api/')) {
      return serveStatic(req, res, pathname, resolvedStaticDir);
    }
    const route = pathname.slice('/api/'.length);
    if (!/^[a-z][a-z0-9-]*$/.test(route)) return res.status(404).json({ error: 'API route tidak ditemukan' });
    const handler = Object.hasOwn(directHandlers, route) ? directHandlers[route] : unifiedHandler;
    if (!handler || typeof handler !== 'function') return res.status(404).json({ error: 'API route tidak ditemukan' });
    req.query = Object.fromEntries(url.searchParams);
    req.query.route = route;
    try {
      req.body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? {} : await parseBody(req, maxBodyBytes);
      await handler(req, res);
      if (!res.writableEnded) {
        console.error('[selfhost-api] Handler returned without a response:', route);
        if (res.headersSent) return res.destroy();
        res.status(500).json({ error: 'Handler tidak mengirim respons' });
      }
    } catch (error) {
      // Exception messages may contain a signed URL or token. Keep console output minimal;
      // handlers/Sentry own the detailed, access-controlled diagnostics.
      if (!error.statusCode) console.error('[selfhost-api] Handler failed', {
        route,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      if (res.headersSent) return res.destroy();
      return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
  });
}
