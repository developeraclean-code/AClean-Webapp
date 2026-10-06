// Read-only ListObjectsV2 inventory. No content download, upload or DELETE.
import fs from 'node:fs';
import { getR2BucketUsage } from '../api/_r2-upload.js';

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const objects = [];
const result = await getR2BucketUsage({ maxPages: 500, totalTimeoutMs: 180000, onPage: rows => objects.push(...rows) });
if (!result.ok) throw new Error(`Inventory incomplete: ${result.err}; ${objects.length} objects read`);
const prefixes = {};
for (const obj of objects) {
  const prefix = obj.key.includes('/') ? obj.key.split('/')[0] + '/' : '[root]';
  const group = prefixes[prefix] ||= { objects: 0, bytes: 0, older30: 0, older60: 0, older90: 0, bytesOlder90: 0 };
  const age = (Date.now() - new Date(obj.lastModified).getTime()) / 86400000;
  group.objects++; group.bytes += obj.size;
  for (const days of [30, 60, 90]) if (age > days) group['older' + days]++;
  if (age > 90) group.bytesOlder90 += obj.size;
}
const summary = { ...result, prefixes };
const manifestAt = process.argv.indexOf('--manifest');
if (manifestAt >= 0) {
  const target = process.argv[manifestAt + 1];
  if (!target || target.startsWith('--')) throw new Error('--manifest requires a private output path');
  fs.writeFileSync(target, JSON.stringify({ summary, objects }, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify(summary, null, 2));
