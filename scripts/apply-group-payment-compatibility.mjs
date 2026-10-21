// Release migration 221 only. --check is read-only; --apply requires an explicit argument.
// Never invokes a payment RPC or modifies historical business rows.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

const mode = process.argv[2] || '--check';
assert.ok(['--check', '--apply'].includes(mode), 'Use --check or --apply');
const env = { ...process.env };
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match && !env[match[1]]) env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
}
const ref = new URL(env.SUPABASE_URL || env.VITE_SUPABASE_URL).hostname.split('.')[0];
assert.equal(ref, 'apsbeppcmsxeldnejibz', 'Unexpected Supabase project');
const target = new URL(env.SUPABASE_DB_URL);
assert.ok(target.hostname.includes(ref) || decodeURIComponent(target.username).includes(ref));
if (env.SUPABASE_DB_PASSWORD) target.password = env.SUPABASE_DB_PASSWORD;
const db = new pg.Client({
  connectionString: target.toString(), ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000, query_timeout: 12000,
  application_name: 'aclean-group-payment-compatibility-221',
});
const version = '20261021000000221', name = '221_group_payment_header_compatibility';
const source = readFileSync(new URL('../migrations/' + name + '.sql', import.meta.url), 'utf8');
const oldSource = readFileSync(new URL('../migrations/220_atomic_group_payment.sql', import.meta.url), 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const signature = 'public.record_group_payment_atomic(uuid,text[],numeric,timestamptz,text,text,jsonb,text,uuid,boolean)';
let phase = 'connect';
const query = async (sql, params = []) => { phase = sql.slice(0, 85); return (await db.query(sql, params)).rows; };

async function verify() {
  const history = await query('SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE version=ANY($1) OR name=ANY($2)',
    [['20261021000000220', version], ['220_atomic_group_payment', name]]);
  const old = history.find(row => row.version === '20261021000000220');
  assert.equal(old?.name, '220_atomic_group_payment');
  assert.ok(old.statements.some(statement => sha(statement) === sha(oldSource)), 'Migration 220 source differs');
  const applied = history.find(row => row.version === version || row.name === name);
  if (applied) {
    assert.equal(applied.version, version);
    assert.equal(applied.name, name);
    assert.ok(applied.statements.some(statement => sha(statement) === sha(source)), 'Migration 221 source differs');
  }
  const functionDef = (await query('SELECT pg_get_functiondef($1::regprocedure) definition', [signature]))[0].definition;
  const invoiceColumn = (await query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='invoice_id'"))[0];
  assert.equal(invoiceColumn?.is_nullable, 'NO');
  const constraint = (await query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.payments'::regclass AND conname='payments_method_check'"))[0]?.definition;
  assert.ok(constraint, 'payments_method_check missing');
  const patched = functionDef.includes('anchor_invoice_id text;') && functionDef.includes('INSERT INTO public.payments(invoice_id,customer_phone');
  const expanded = constraint.includes('transfer_bca') && constraint.includes('transfer_mandiri');
  if (applied) assert.ok(patched && expanded, 'Migration 221 recorded but live function/constraint differs');
  else assert.ok(!patched && !expanded, 'Live function/constraint changed without migration 221');
  return { applied: Boolean(applied), patched, expanded, sourceSha256: sha(source) };
}

try {
  await db.connect();
  await db.query(mode === '--check' ? 'BEGIN READ ONLY' : 'BEGIN');
  await db.query("SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s'");
  const before = await verify();
  if (mode === '--apply' && !before.applied) {
    const targets = ['invoices', 'payments', 'invoice_payments', 'payment_suggestions', 'orders'];
    const countsBefore = {};
    for (const table of targets) countsBefore[table] = (await query(`SELECT count(*)::int n FROM public.${table}`))[0].n;
    await query(source.replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, ''));
    await query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements,created_by) VALUES($1,$2,$3::text[],$4)',
      [version, name, [source], 'Codex: perbaikan grup disetujui Owner 21 Oktober 2026']);
    const after = await verify();
    assert.ok(after.applied && after.patched && after.expanded);
    for (const table of targets) assert.equal((await query(`SELECT count(*)::int n FROM public.${table}`))[0].n, countsBefore[table], `${table} changed`);
    await db.query('COMMIT');
    console.log(JSON.stringify({ result: '221_committed', ...after, historicalRowCountsUnchanged: true, paymentCallsExecuted: 0 }));
  } else {
    await db.query('ROLLBACK');
    console.log(JSON.stringify({ result: mode === '--check' ? 'checked' : 'already_applied', ...before, paymentCallsExecuted: 0 }));
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ failed: true, phase, code: error.code, error: String(error.message).slice(0, 300) }));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
