import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { digest, encryptObject, decryptObject, inspectArchive, publishManifest, readKey, privateFile,
  localDatabaseUrl, listMedia, safeMediaKey, verifyObject, objectBuffer } from './lib/local-backup-archive.mjs';
import { captureLocalBackup } from './lib/local-backup-capture.mjs';

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aclean-backup-unit-'));
const key = randomBytes(32), keyFile = path.join(root,'key'); fs.writeFileSync(keyFile,key,{mode:0o600});
const makeDir = () => fs.mkdtempSync(path.join(root,'archive-'));
const stream = value => Readable.from([Buffer.from(value)]);
async function fixture() {
  const dir=makeDir(),id=randomUUID(),objects={}; let n=0;
  for(const [name,value] of Object.entries({database:'PGDMP\0synthetic',config:JSON.stringify({version:1,scope:'LOCAL_ONLY',auth:{},environment:{},deployment:{}}),application:'code tar placeholder',tool:'{}'}))
    objects[name]=await encryptObject(dir,'object-'+String(++n).padStart(6,'0')+'.enc',stream(value),key,id+':'+name);
  const manifest={format:1,id,scope:'LOCAL_ONLY',productionReady:false,mediaSnapshotAcknowledged:true,objects,media:[],
    database:{tables:['public.app_settings','public.user_profiles','auth.users','auth.identities','public.operational_mutations','public.wa_outbox'].map(s=>({schema:s.split('.')[0],table:s.split('.')[1],rows:'0'})),definitions:[]}};
  return {dir,manifest};
}
test('local database URLs only; reject production, localhost alias, options and Unix socket',()=>{
  assert.equal(localDatabaseUrl('postgresql://user@127.0.0.1:15432/db').hostname,'127.0.0.1');
  for(const url of ['postgresql://user@db.example.supabase.co:5432/db','postgresql://user@localhost:5432/db','postgresql://user@127.0.0.1:5432/db?host=prod.invalid','postgresql:///db','https://127.0.0.1:5432'])
    assert.throws(()=>localDatabaseUrl(url));
});
test('encryption round-trip; ciphertext hides plaintext',async()=>{
  const dir=makeDir(),payload='private settings and passwords';
  const o=await encryptObject(dir,'object-000001.enc',stream(payload),key,'test:one');
  assert.equal((await objectBuffer(dir,o,key)).toString(),payload);
  assert.equal(fs.readFileSync(path.join(dir,o.file)).includes(Buffer.from(payload)),false);
});
test('empty file round-trip remains authenticated',async()=>{
  const dir=makeDir(),o=await encryptObject(dir,'object-000001.enc',Readable.from([]),key,'test:zero');
  assert.equal((await objectBuffer(dir,o,key)).length,0); assert.equal(o.sha256,digest(Buffer.alloc(0)));
});
test('wrong key fails',async()=>{
  const f=await fixture(); await assert.rejects(()=>verifyObject(f.dir,f.manifest.objects.database,randomBytes(32)));
});
test('short key fails before plaintext is written',async()=>{
  await assert.rejects(()=>encryptObject(makeDir(),'object-000001.enc',stream('secret'),Buffer.alloc(4),'x'));
});
test('ciphertext bit corruption fails',async()=>{
  const f=await fixture(),o=f.manifest.objects.database,p=path.join(f.dir,o.file),b=fs.readFileSync(p); b[b.length-17]^=1; fs.writeFileSync(p,b);
  await assert.rejects(()=>verifyObject(f.dir,o,key));
});
test('truncation fails',async()=>{
  const f=await fixture(),o=f.manifest.objects.database,p=path.join(f.dir,o.file);fs.truncateSync(p,20);
  await assert.rejects(()=>verifyObject(f.dir,o,key),/SIZE/);
});
test('forged plaintext checksum fails',async()=>{
  const f=await fixture();await assert.rejects(()=>verifyObject(f.dir,{...f.manifest.objects.database,sha256:'0'.repeat(64)},key),/CHECKSUM/);
});
test('component context substitution fails authentication',async()=>{
  const f=await fixture();await assert.rejects(()=>verifyObject(f.dir,{...f.manifest.objects.database,context:'other-package:database'},key));
});
test('oversized payload leaves no completion marker',async()=>{
  const dir=makeDir();await assert.rejects(()=>encryptObject(dir,'object-000001.enc',stream('too long'),key,'x',2),/SIZE_LIMIT/);
  assert.equal(fs.existsSync(path.join(dir,'COMPLETE.json')),false);
});
test('source read error never publishes success',async()=>{
  const dir=makeDir();const source=new Readable({read(){this.destroy(new Error('injected read failure'));}});
  await assert.rejects(()=>encryptObject(dir,'object-000001.enc',source,key,'x'));assert.equal(fs.existsSync(path.join(dir,'COMPLETE.json')),false);
});
test('complete package validates all required components',async()=>{
  const f=await fixture();await publishManifest(f.dir,key,f.manifest);assert.equal((await inspectArchive(f.dir,key)).id,f.manifest.id);
});
test('missing component is reported, not successful',async()=>{
  const f=await fixture();delete f.manifest.objects.config;await publishManifest(f.dir,key,f.manifest);
  await assert.rejects(()=>inspectArchive(f.dir,key),/COMPONENT_MISSING/);
});
test('undeclared plaintext file in archive is rejected',async()=>{
  const f=await fixture();await publishManifest(f.dir,key,f.manifest);fs.writeFileSync(path.join(f.dir,'config-plaintext.json'),'secret',{mode:0o600});
  await assert.rejects(()=>inspectArchive(f.dir,key),/UNDECLARED/);
});
test('missing critical Auth table is reported',async()=>{
  const f=await fixture();f.manifest.database.tables=f.manifest.database.tables.filter(t=>t.schema!=='auth');await publishManifest(f.dir,key,f.manifest);
  await assert.rejects(()=>inspectArchive(f.dir,key),/CRITICAL_TABLE/);
});
test('missing idempotency history is reported',async()=>{
  const f=await fixture();f.manifest.database.tables=f.manifest.database.tables.filter(t=>t.table!=='operational_mutations');await publishManifest(f.dir,key,f.manifest);
  await assert.rejects(()=>inspectArchive(f.dir,key),/CRITICAL_TABLE/);
});
test('swapped component metadata is rejected',async()=>{
  const f=await fixture();[f.manifest.objects.config,f.manifest.objects.database]=[f.manifest.objects.database,f.manifest.objects.config];await publishManifest(f.dir,key,f.manifest);
  await assert.rejects(()=>inspectArchive(f.dir,key),/CONTEXT/);
});
test('undeclared extra components are rejected',async()=>{
  const f=await fixture();f.manifest.objects.hidden=f.manifest.objects.tool;await publishManifest(f.dir,key,f.manifest);await assert.rejects(()=>inspectArchive(f.dir,key),/COMPONENT_SET/);
});
test('false production-readiness claim is rejected',async()=>{
  const f=await fixture();f.manifest.productionReady=true;await publishManifest(f.dir,key,f.manifest);await assert.rejects(()=>inspectArchive(f.dir,key),/READINESS/);
});
test('missing media snapshot acknowledgement is rejected',async()=>{
  const f=await fixture();f.manifest.mediaSnapshotAcknowledged=false;await publishManifest(f.dir,key,f.manifest);await assert.rejects(()=>inspectArchive(f.dir,key),/SNAPSHOT/);
});
test('incomplete directory without completion marker fails closed',async()=>{
  const f=await fixture();await assert.rejects(()=>inspectArchive(f.dir,key),/ENOENT/);
});
test('completion marker is not overwritable',async()=>{
  const f=await fixture();await publishManifest(f.dir,key,f.manifest);await assert.rejects(()=>publishManifest(f.dir,key,f.manifest),/EEXIST/);
});
test('symlink archive object is rejected',async()=>{
  const f=await fixture(),o=f.manifest.objects.database,p=path.join(f.dir,o.file);fs.renameSync(p,p+'.saved');fs.symlinkSync(p+'.saved',p);
  await assert.rejects(()=>verifyObject(f.dir,o,key),/UNSAFE/);
});
test('hardlink archive object is rejected',async()=>{
  const f=await fixture(),o=f.manifest.objects.database;fs.linkSync(path.join(f.dir,o.file),path.join(f.dir,'linked'));
  await assert.rejects(()=>verifyObject(f.dir,o,key),/UNSAFE/);
});
test('public-read key permissions are rejected',()=>{
  const p=path.join(root,'public-key');fs.writeFileSync(p,key,{mode:0o644});assert.throws(()=>readKey(p,makeDir()),/PRIVATE_FILE/);
});
test('key inside archive is rejected',()=>{
  const dir=makeDir(),p=path.join(dir,'key');fs.writeFileSync(p,key,{mode:0o600});assert.throws(()=>readKey(p,dir),/OUTSIDE/);
});
test('base64 and raw key formats are supported',()=>{
  const p=path.join(root,'base64-key');fs.writeFileSync(p,key.toString('base64'),{mode:0o600});assert.deepEqual(readKey(p,makeDir()),key);assert.deepEqual(readKey(keyFile,makeDir()),key);
});
test('unsafe media keys rejected',()=>{
  for(const key of ['/abs','../x','a/../x','a//b','a\\b','a\nfile',''])assert.throws(()=>safeMediaKey(key));
  assert.equal(safeMediaKey('payments/2026/nota 01.pdf'),'payments/2026/nota 01.pdf');
});
test('media listing has no 1000-file cap',()=>{
  const dir=makeDir();for(let i=0;i<1201;i++)fs.writeFileSync(path.join(dir,'file-'+i+'.png'),'x');assert.equal(listMedia(dir).length,1201);
});
test('symlink media rejected',()=>{
  const dir=makeDir();fs.symlinkSync(keyFile,path.join(dir,'outside'));assert.throws(()=>listMedia(dir),/SYMLINK/);
});
test('hardlink media rejected',()=>{
  const dir=makeDir();fs.linkSync(keyFile,path.join(dir,'linked'));assert.throws(()=>listMedia(dir),/REGULAR/);
});
test('readable-only encrypted objects permissions stay private',async()=>{
  const f=await fixture();for(const o of Object.values(f.manifest.objects))assert.equal(fs.statSync(path.join(f.dir,o.file)).mode & 0o077,0);
});
test('object path traversal is rejected before reads',async()=>{
  const f=await fixture();await assert.rejects(()=>verifyObject(f.dir,{...f.manifest.objects.database,file:'../key'},key),/NAME_INVALID/);
});
test('bad size and payload hashes cannot masquerade as valid metadata',async()=>{
  const f=await fixture();f.manifest.objects.database.bytes=-1;await publishManifest(f.dir,key,f.manifest);await assert.rejects(()=>inspectArchive(f.dir,key),/OBJECT_INVALID/);
});
test('private config read does not follow symlinks',()=>{
  const p=path.join(root,'key-link');fs.symlinkSync(keyFile,p);assert.throws(()=>privateFile(p));
});
test('fresh backup rejects remote DB before opening config or filesystem',async()=>{
  await assert.rejects(()=>captureLocalBackup({databaseUrl:'postgresql://user@actual.supabase.co:5432/db'}),/LOCAL_DATABASE/);
});
test('fresh backup requires explicit frozen-media acknowledgement',async()=>{
  await assert.rejects(()=>captureLocalBackup({databaseUrl:'postgresql://user@127.0.0.1:15432/db'}),/SNAPSHOT_NOT/);
});
test('streaming decrypt supports large payload without buffering object',async()=>{
  const dir=makeDir(),chunk=Buffer.alloc(1024*1024,17),source=Readable.from((function*(){for(let i=0;i<24;i++)yield chunk;})());
  const object=await encryptObject(dir,'object-000001.enc',source,key,'test:large');
  let bytes=0;await decryptObject(dir,object,key,new Writable({write(b,enc,cb){bytes+=b.length;cb();}}));assert.equal(bytes,24*1024*1024);
  await assert.rejects(()=>objectBuffer(dir,object,key,1024),/BUFFER_SIZE/);
});
