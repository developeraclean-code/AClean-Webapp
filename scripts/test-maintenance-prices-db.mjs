// PostgreSQL/WASM only; tidak membaca .env atau data produksi.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite(); let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log('PASS', name); };
const row = async sql => (await db.query(sql)).rows[0];
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE maintenance_clients(id uuid PRIMARY KEY);
    INSERT INTO maintenance_clients VALUES ('10000000-0000-4000-8000-000000000001');`);
  await db.exec(readFileSync(new URL('../migrations/108_maintenance_client_prices.sql', import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO maintenance_client_prices(client_id,service_type,ac_type,capacity_pk,unit_price)
    VALUES ('10000000-0000-4000-8000-000000000001','Cuci Rutin','split',1,95000),
      ('10000000-0000-4000-8000-000000000001','Cuci Rutin','vrv_outdoor',34.2,0);`);
  const migration = readFileSync(new URL('../migrations/207_maintenance_included_service_prices.sql', import.meta.url), 'utf8');
  await check('migration idempotent; harga lama dan 0 legacy tidak dianggap termasuk', async () => {
    await db.exec(migration); await db.exec(migration);
    assert.equal((await row('SELECT count(*)::int n FROM maintenance_client_prices')).n, 2);
    assert.equal((await row('SELECT sum(unit_price)::int n FROM maintenance_client_prices')).n, 95000);
    assert.equal((await row('SELECT count(*)::int n FROM maintenance_client_prices WHERE included_in_service')).n, 0);
  });
  await check('outdoor termasuk penawaran Rp0 sah dan tersimpan', async () => {
    await db.exec("UPDATE maintenance_client_prices SET included_in_service=true WHERE ac_type='vrv_outdoor'");
    assert.equal((await row("SELECT included_in_service FROM maintenance_client_prices WHERE ac_type='vrv_outdoor'")).included_in_service, true);
  });
  await check('DB menolak included dengan tarif positif atau tanpa tipe', async () => {
    await assert.rejects(() => db.exec("UPDATE maintenance_client_prices SET unit_price=100 WHERE ac_type='vrv_outdoor'"), /mcp_included_service_zero_price/);
    await assert.rejects(() => db.exec("UPDATE maintenance_client_prices SET ac_type=NULL WHERE ac_type='vrv_outdoor'"), /mcp_included_service_zero_price/);
  });
  await check('RLS tetap menutup price book dari anon/authenticated', async () => {
    await db.exec('GRANT USAGE ON SCHEMA public TO anon,authenticated; GRANT SELECT ON maintenance_client_prices TO anon,authenticated');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      assert.equal((await row('SELECT count(*)::int n FROM maintenance_client_prices')).n, 0);
      await db.exec('RESET ROLE');
    }
  });
  console.log(JSON.stringify({ passed: checks, production_writes: false }));
} finally { await db.close(); }
