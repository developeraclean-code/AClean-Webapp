// PostgreSQL/WASM only: menguji migrasi tanpa koneksi ke produksi.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const sql = readFileSync(new URL('../migrations/211_prevent_legacy_complain_repair_child.sql', import.meta.url), 'utf8');

try {
  await db.exec(`CREATE TABLE orders (
    id text PRIMARY KEY, service text NOT NULL, parent_job_id text,
    notes text, status text NOT NULL DEFAULT 'CONFIRMED'
  );
  INSERT INTO orders(id,service,status) VALUES ('COMPLAIN-1','Complain','DISPATCHED');
  INSERT INTO orders(id,service,parent_job_id) VALUES
    ('OLD-REPAIR-1','Repair','COMPLAIN-1'),
    ('OLD-REPAIR-2','Repair','COMPLAIN-1');`);

  await db.exec(sql);
  await db.exec(sql); // aman dijalankan ulang
  assert.equal((await db.query("SELECT count(*)::int n FROM orders WHERE parent_job_id='COMPLAIN-1'")).rows[0].n, 2);

  await assert.rejects(
    () => db.exec("INSERT INTO orders(id,service,parent_job_id) VALUES ('NEW-CHILD','Repair','COMPLAIN-1')"),
    /Upgrade Complain ke Repair harus memakai ID job yang sama/,
  );

  await db.exec("UPDATE orders SET service='Repair', notes='[UPGRADED_FROM_COMPLAIN]' WHERE id='COMPLAIN-1'");
  await assert.rejects(
    () => db.exec("INSERT INTO orders(id,service,parent_job_id) VALUES ('NEW-CHILD-2','Repair','COMPLAIN-1')"),
    /Upgrade Complain ke Repair harus memakai ID job yang sama/,
  );
  await db.exec("UPDATE orders SET status='REPORT_SUBMITTED' WHERE id='OLD-REPAIR-1'");
  await db.exec("INSERT INTO orders(id,service,status) VALUES ('NORMAL-1','Cleaning','CONFIRMED')");
  await db.exec("INSERT INTO orders(id,service,parent_job_id) VALUES ('NORMAL-REPAIR','Repair','NORMAL-1')");
  assert.equal((await db.query("SELECT count(*)::int n FROM orders WHERE parent_job_id='NORMAL-1'")).rows[0].n, 1);
  console.log('PASS migration idempotent, legacy rows preserved, future duplicate child blocked, unrelated jobs unaffected');
} finally {
  await db.close();
}
