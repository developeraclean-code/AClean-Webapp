import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAppServer } from '../server/http-app.mjs';

let root;
let server;
let base;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aclean-selfhost-'));
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'index.html'), '<h1>AClean</h1>');
  await writeFile(path.join(root, 'assets', 'app.js'), 'export default 1');
  server = createAppServer({
    staticDir: root,
    maxBodyBytes: 32,
    unifiedHandler: (req, res) => res.json({ route: req.query.route, action: req.query.action, body: req.body }),
    directHandlers: { 'cron-reminder': (req, res) => res.status(401).json({ code: 'test-only' }) },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (root) await rm(root, { recursive: true, force: true });
});

test('API tidak jatuh ke SPA dan query/body diteruskan', async () => {
  const response = await fetch(`${base}/api/payment-media-health?action=check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { route: 'payment-media-health', action: 'check', body: { test: true } });
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${base}/api/_auth`)).status, 404);
  assert.equal((await fetch(`${base}/api`)).status, 404);
  assert.equal((await fetch(`${base}/api/unknown/deep`)).status, 404);
});

test('entrypoint langsung tetap terpisah dari router gabungan', async () => {
  const response = await fetch(`${base}/api/cron-reminder`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: 'test-only' });
});

test('handler yang diam tidak berubah menjadi sukses palsu', async () => {
  const silent = createAppServer({ staticDir: root, unifiedHandler: () => {} });
  silent.listen(0, '127.0.0.1');
  await once(silent, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${silent.address().port}/api/health`);
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /tidak mengirim respons/);
  } finally {
    await new Promise(resolve => silent.close(resolve));
  }
});

test('handler yang mengirim header tanpa mengakhiri respons tidak menggantung koneksi', async () => {
  const partial = createAppServer({
    staticDir: root,
    unifiedHandler: (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.write('partial'); },
  });
  partial.listen(0, '127.0.0.1');
  await once(partial, 'listening');
  try {
    await assert.rejects(async () => {
      const response = await fetch(`http://127.0.0.1:${partial.address().port}/api/health`);
      await response.text();
    });
  } finally {
    await new Promise(resolve => partial.close(resolve));
  }
});

test('exception API tidak membocorkan detail internal ke klien', async () => {
  const broken = createAppServer({ staticDir: root, unifiedHandler: () => { throw new Error('internal-secret-value'); } });
  broken.listen(0, '127.0.0.1');
  await once(broken, 'listening');
  const originalError = console.error;
  const logged = [];
  console.error = (...parts) => { logged.push(parts); };
  try {
    const response = await fetch(`http://127.0.0.1:${broken.address().port}/api/health`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
    assert.ok(logged.length > 0, 'kegagalan tetap tercatat');
    assert.doesNotMatch(JSON.stringify(logged), /internal-secret-value/);
  } finally {
    console.error = originalError;
    await new Promise(resolve => broken.close(resolve));
  }
});

test('frontend SPA dan asset dilayani dengan cache berbeda', async () => {
  const page = await fetch(`${base}/planning-order`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AClean/);
  assert.match(page.headers.get('cache-control'), /no-cache/);
  const asset = await fetch(`${base}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
});

test('body rusak atau terlalu besar tidak diteruskan ke handler', async () => {
  const broken = await fetch(`${base}/api/health`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(broken.status, 400);
  const oversized = await fetch(`${base}/api/health`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ huge: 'a'.repeat(100) }),
  });
  assert.equal(oversized.status, 413);
});

test('handler health asli merespons tanpa database pada probe app', async () => {
  const previous = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OWNER_PHONE'].map(key => [key, process.env[key]]));
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_KEY = 'offline-test-only';
  process.env.OWNER_PHONE = '6280000000000';
  let liveServer;
  try {
    const { default: realHandler } = await import('../api/[route].js');
    liveServer = createAppServer({ unifiedHandler: realHandler, staticDir: root });
    liveServer.listen(0, '127.0.0.1');
    await once(liveServer, 'listening');
    const response = await fetch(`http://127.0.0.1:${liveServer.address().port}/api/health?component=app`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.component, 'app');
    assert.equal(result.component_status, 'ok');
  } finally {
    if (liveServer) await new Promise(resolve => liveServer.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
