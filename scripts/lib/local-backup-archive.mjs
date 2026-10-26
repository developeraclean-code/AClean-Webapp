// Local, encrypted recovery archives. Never writes plaintext payloads to disk.
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { backupEncryptionKey } from '../../api/_backup.js';

const MAGIC = Buffer.from('ACLFULL1\0');
const HEADER = MAGIC.length + 12;
const ID = /^[a-f0-9-]{36}$/;
const OBJECT = /^object-\d{6}\.enc$/;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const requireCondition = (ok, code) => { if (!ok) throw new Error(code); };
export function localDatabaseUrl(value) {
  const url = new URL(value);
  requireCondition(['postgres:', 'postgresql:'].includes(url.protocol), 'BACKUP_POSTGRES_URL_REQUIRED');
  requireCondition(url.hostname === '127.0.0.1' && Number(url.port) >= 1024, 'BACKUP_LOCAL_DATABASE_ONLY');
  requireCondition(!url.search, 'BACKUP_DB_URL_OPTIONS_NOT_ALLOWED');
  return url;
}
export function privateFile(file, maxBytes = 16 * 1024 * 1024) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    requireCondition(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o077) === 0 && stat.size <= maxBytes, 'BACKUP_PRIVATE_FILE_REQUIRED');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
export function readKey(file, archiveDir) {
  const real = fs.realpathSync(file), relative = path.relative(path.resolve(archiveDir), real);
  requireCondition(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'BACKUP_KEY_MUST_BE_OUTSIDE_ARCHIVE');
  const bytes = privateFile(file, 128);
  return backupEncryptionKey(bytes.length === 32 ? bytes : bytes.toString('utf8').trim());
}
function objectPath(dir, name) {
  requireCondition(OBJECT.test(name) || name === 'manifest.enc', 'BACKUP_OBJECT_NAME_INVALID');
  return path.join(dir, name);
}
function regularObject(dir, name) {
  const full = objectPath(dir, name), stat = fs.lstatSync(full);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0, 'BACKUP_UNSAFE_ARCHIVE_OBJECT');
  return { full, stat };
}
const hashSink = () => {
  const state = { bytes: 0, hash: createHash('sha256'), prefix: Buffer.alloc(0) };
  const stream = new Writable({ write(chunk, encoding, cb) {
    if (state.prefix.length < 5) state.prefix = Buffer.concat([state.prefix, chunk.subarray(0, 5 - state.prefix.length)]);
    state.bytes += chunk.length; state.hash.update(chunk); cb();
  } });
  return { stream, result: () => ({ bytes: state.bytes, sha256: state.hash.digest('hex'), prefixHex: state.prefix.toString('hex') }) };
};
export async function encryptObject(dir, name, source, key, context, maxBytes = 2 * 1024 ** 3) {
  const full = objectPath(dir, name), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', backupEncryptionKey(key), iv);
  cipher.setAAD(Buffer.from('ACLFULL1:' + context));
  const fd = fs.openSync(full, 'wx', 0o600);
  fs.writeSync(fd, Buffer.concat([MAGIC, iv]));
  let bytes = 0; const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, enc, cb) {
    bytes += chunk.length;
    if (bytes > maxBytes) { cb(new Error('BACKUP_PAYLOAD_SIZE_LIMIT')); return; }
    hash.update(chunk); cb(null, chunk);
  } });
  await pipeline(source, meter, cipher, fs.createWriteStream(full, { fd, start: HEADER, autoClose: true }));
  fs.appendFileSync(full, cipher.getAuthTag());
  const syncFd = fs.openSync(full, 'r'); try { fs.fsyncSync(syncFd); } finally { fs.closeSync(syncFd); }
  return { file: name, context, bytes, sha256: hash.digest('hex') };
}
export async function decryptObject(dir, object, key, destination) {
  const { full, stat } = regularObject(dir, object.file);
  requireCondition(stat.size === object.bytes + HEADER + 16 && object.bytes >= 0, 'BACKUP_OBJECT_SIZE_MISMATCH');
  const fd = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const header = Buffer.alloc(HEADER), tag = Buffer.alloc(16);
  try { fs.readSync(fd, header, 0, HEADER, 0); fs.readSync(fd, tag, 0, 16, stat.size - 16); }
  finally { fs.closeSync(fd); }
  requireCondition(header.subarray(0, MAGIC.length).equals(MAGIC), 'BACKUP_ENVELOPE_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', backupEncryptionKey(key), header.subarray(MAGIC.length));
  decipher.setAAD(Buffer.from('ACLFULL1:' + object.context)); decipher.setAuthTag(tag);
  let bytes = 0; const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, enc, cb) { bytes += chunk.length; hash.update(chunk); cb(null, chunk); } });
  const source = object.bytes === 0 ? Readable.from([]) : fs.createReadStream(full, {
    start: HEADER, end: stat.size - 17, flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  });
  await pipeline(source, decipher, meter, destination);
  requireCondition(bytes === object.bytes && hash.digest('hex') === object.sha256, 'BACKUP_PLAINTEXT_CHECKSUM_MISMATCH');
}
export async function verifyObject(dir, object, key) {
  const sink = hashSink(); await decryptObject(dir, object, key, sink.stream); return sink.result();
}
export async function objectBuffer(dir, object, key, maxBytes = 16 * 1024 * 1024) {
  requireCondition(object.bytes <= maxBytes, 'BACKUP_BUFFER_SIZE_LIMIT');
  const chunks = []; await decryptObject(dir, object, key, new Writable({ write(chunk, enc, cb) { chunks.push(chunk); cb(); } }));
  return Buffer.concat(chunks);
}
export function safeMediaKey(key) {
  requireCondition(typeof key === 'string' && key.length > 0 && key.length < 1024 && !key.includes('\\') && !/[\u0000-\u001f]/.test(key)
    && !key.startsWith('/') && key.split('/').every(v => v && v !== '.' && v !== '..'), 'BACKUP_MEDIA_PATH_INVALID');
  return key;
}
export function listMedia(root) {
  requireCondition(fs.realpathSync(root) === path.resolve(root), 'BACKUP_MEDIA_ROOT_SYMLINK');
  const result = [];
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const key = prefix + name, full = path.join(dir, name), stat = fs.lstatSync(full);
      requireCondition(!stat.isSymbolicLink(), 'BACKUP_MEDIA_SYMLINK');
      if (stat.isDirectory()) walk(full, key + '/');
      else {
        requireCondition(stat.isFile() && stat.nlink === 1, 'BACKUP_MEDIA_NOT_REGULAR_FILE'); safeMediaKey(key);
        result.push({ key, bytes: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, inode: stat.ino });
      }
    }
  }
  walk(root); return result;
}
export async function publishManifest(dir, key, manifest) {
  requireCondition(ID.test(manifest.id), 'BACKUP_ID_INVALID');
  const object = await encryptObject(dir, 'manifest.enc', Readable.from([JSON.stringify(manifest)]), key, manifest.id + ':manifest', 16 * 1024 * 1024);
  await verifyObject(dir, object, key);
  // Publication is last. Missing header means incomplete; never overwrite a previous backup.
  fs.writeFileSync(path.join(dir, 'COMPLETE.json'), JSON.stringify({ format: 1, id: manifest.id, manifest: object }), { mode: 0o600, flag: 'wx' });
  const markerFd = fs.openSync(path.join(dir,'COMPLETE.json'),'r'); try { fs.fsyncSync(markerFd); } finally { fs.closeSync(markerFd); }
  const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export async function inspectArchive(dir, key, { verifyPayloads = true } = {}) {
  const stat = fs.lstatSync(dir);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'BACKUP_PRIVATE_DIRECTORY_REQUIRED');
  const header = JSON.parse(privateFile(path.join(dir, 'COMPLETE.json'), 8192));
  requireCondition(header.format === 1 && ID.test(header.id) && header.manifest.file === 'manifest.enc'
    && header.manifest.context === header.id + ':manifest', 'BACKUP_HEADER_INVALID');
  const manifest = JSON.parse(await objectBuffer(dir, header.manifest, key));
  requireCondition(manifest.id === header.id && manifest.format === 1 && manifest.scope === 'LOCAL_ONLY', 'BACKUP_MANIFEST_INVALID');
  requireCondition(manifest.productionReady === false, 'BACKUP_READINESS_CLAIM_INVALID');
  requireCondition(manifest.mediaSnapshotAcknowledged === true, 'BACKUP_MEDIA_SNAPSHOT_NOT_ACKNOWLEDGED');
  for (const name of ['database','config','application','tool']) requireCondition(!!manifest.objects?.[name], 'BACKUP_COMPONENT_MISSING:' + name);
  requireCondition(Array.isArray(manifest.media) && Array.isArray(manifest.database?.tables) && Array.isArray(manifest.database?.definitions), 'BACKUP_BASELINE_MISSING');
  for (const table of ['public.app_settings','public.user_profiles','auth.users','auth.identities','public.operational_mutations','public.wa_outbox'])
    requireCondition(manifest.database.tables.some(t => t.schema + '.' + t.table === table), 'BACKUP_CRITICAL_TABLE_MISSING:' + table);
  const seen = new Set(); const objects = [];
  requireCondition(Object.keys(manifest.objects).sort().join(',') === 'application,config,database,tool', 'BACKUP_COMPONENT_SET_INVALID');
  for (const [name,object] of Object.entries(manifest.objects)) {
    requireCondition(object.context === manifest.id + ':' + name, 'BACKUP_COMPONENT_CONTEXT_INVALID'); objects.push(object);
  }
  for (const item of manifest.media) {
    safeMediaKey(item.key); requireCondition(!seen.has(item.key), 'BACKUP_DUPLICATE_MEDIA_KEY'); seen.add(item.key);
    requireCondition(item.object.context === manifest.id + ':media:' + item.key, 'BACKUP_COMPONENT_CONTEXT_INVALID'); objects.push(item.object);
  }
  const files = new Set();
  for (const object of objects) {
    requireCondition(OBJECT.test(object.file) && !files.has(object.file) && Number.isSafeInteger(object.bytes) && object.bytes >= 0
      && /^[a-f0-9]{64}$/.test(object.sha256), 'BACKUP_OBJECT_INVALID'); files.add(object.file);
    if (verifyPayloads) {
      const verified = await verifyObject(dir, object, key);
      if (object === manifest.objects.database) requireCondition(verified.prefixHex === '5047444d50', 'BACKUP_DATABASE_DUMP_INVALID');
    }
  }
  requireCondition(fs.readdirSync(dir).sort().join('\n') === ['COMPLETE.json','manifest.enc',...files].sort().join('\n'), 'BACKUP_UNDECLARED_ARCHIVE_FILE');
  if (verifyPayloads) {
    const config = JSON.parse(await objectBuffer(dir,manifest.objects.config,key));
    requireCondition(config.version === 1 && config.scope === 'LOCAL_ONLY' && config.auth && config.environment && config.deployment, 'BACKUP_CONFIG_SECTIONS_REQUIRED');
  }
  return manifest;
}
