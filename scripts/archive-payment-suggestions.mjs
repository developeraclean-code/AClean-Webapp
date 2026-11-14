// One-time, resumable production archive. Run inside the app container with
// --before, --expected and --batch-id. Never removes the source R2 object.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { extractR2Key } from "../api/_r2-key.js";
import { downloadBufferFromR2, uploadBufferToR2 } from "../api/_r2-upload.js";
import { sniffMediaMimeType } from "../api/_media-format.js";

const args = Object.fromEntries(process.argv.slice(2).map((arg, index, all) =>
  arg.startsWith("--") ? [arg.slice(2), all[index + 1]] : null).filter(Boolean));
const cutoff = args.before;
const expected = Number(args.expected);
const batchId = args["batch-id"];
const execute = process.argv.includes("--execute");
if (!cutoff || !Number.isFinite(Date.parse(cutoff)) || !Number.isSafeInteger(expected) || expected < 1 ||
    !/^[0-9a-f-]{36}$/.test(batchId || "")) {
  throw new Error("Required: --before ISO_TIME --expected COUNT --batch-id UUID [--execute]");
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error("Supabase service configuration missing");
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: pending, error: pendingError } = await sb.from("payment_suggestions")
  .select("id,image_url,created_at,status,validation_status")
  .eq("status", "PENDING").eq("validation_status", "PENDING")
  .not("image_url", "is", null).lte("created_at", cutoff)
  .order("id", { ascending: true }).limit(1000);
if (pendingError) throw pendingError;
const { data: archived, error: archiveError } = await sb.from("payment_suggestion_archives")
  .select("suggestion_id,archive_r2_key,sha256,size_bytes")
  .eq("batch_id", batchId).is("restored_at", null).limit(1000);
if (archiveError) throw archiveError;
if (pending.length + archived.length !== expected) {
  throw new Error(`Snapshot changed: ${pending.length} pending + ${archived.length} archived, expected ${expected}`);
}
const keys = pending.map(row => ({ row, key: extractR2Key(row.image_url) }));
if (keys.some(item => !item.key || !/^(wa-inbox|wa-images)\//.test(item.key))) {
  throw new Error("Unexpected source R2 key; nothing changed");
}
console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", batchId,
  pending: pending.length, alreadyArchived: archived.length, expected }));
if (!execute) process.exit(0);

const extension = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "application/pdf": "pdf" };
// Read and validate the entire snapshot before changing any DB row. The
// snapshot is small; keeping it in memory avoids partial archives from a
// missing/expired original source object.
for (const item of keys) {
  const source = await downloadBufferFromR2(item.key, { timeoutMs: 20000 });
  if (!source.ok || !source.buffer?.length) throw new Error(`Source R2 read failed for ${item.row.id}: ${source.err}`);
  const mimeType = sniffMediaMimeType(source.buffer);
  if (!extension[mimeType]) throw new Error(`Unsupported media for ${item.row.id}`);
  item.buffer = source.buffer;
  item.mimeType = mimeType;
}
let completed = archived.length;
for (const { row, buffer, mimeType } of keys) {
  const archiveKey = `payment-archive/${new Date(cutoff).toISOString().slice(0, 7)}/${batchId}/${row.id}.${extension[mimeType]}`;
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const uploaded = await uploadBufferToR2({ buffer, key: archiveKey, mimeType, timeoutMs: 20000 });
  if (!uploaded.ok) throw new Error(`Archive R2 write failed for ${row.id}: ${uploaded.err}`);
  const verified = await downloadBufferFromR2(archiveKey, { timeoutMs: 20000 });
  if (!verified.ok || createHash("sha256").update(verified.buffer).digest("hex") !== sha256) {
    throw new Error(`Archive R2 readback mismatch for ${row.id}`);
  }
  const { error } = await sb.rpc("archive_payment_suggestion_244", {
    p_batch_id: batchId, p_suggestion_id: row.id, p_archive_r2_key: archiveKey,
    p_sha256: sha256, p_size_bytes: buffer.length,
  });
  if (error) throw new Error(`DB archive failed for ${row.id}: ${error.message}`);
  completed++;
  console.log(JSON.stringify({ archived: completed, expected, suggestionId: row.id }));
}
console.log(JSON.stringify({ complete: completed === expected, archived: completed, batchId }));
