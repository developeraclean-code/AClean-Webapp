import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowed = ['api/', 'server/', 'src/lib/'];

test('seluruh import relatif server ada dalam file yang dibawa image runtime', () => {
  const visited = new Set();
  const inspect = file => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\b(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), match[1]);
      const relative = path.relative(root, target).split(path.sep).join('/');
      assert.ok(allowed.some(prefix => relative.startsWith(prefix)), `${relative} berada di luar image runtime`);
      assert.equal(statSync(target).isFile(), true, `${relative} tidak ada`);
      inspect(target);
    }
  };
  inspect(path.join(root, 'server/index.mjs'));
  assert.ok(visited.size > 30, `import graph terlalu kecil: ${visited.size}`);
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  for (const line of ['COPY api ./api', 'COPY server ./server', 'COPY src/lib ./src/lib']) {
    assert.ok(dockerfile.includes(line), `Dockerfile kehilangan ${line}`);
  }
});
