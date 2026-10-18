import { BACKUP_TABLES, validateBackup, verifyBackupRelations } from '../../api/_backup.js';

const ident = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Identitas schema backup tidak valid');
  return '"' + value + '"';
};
const type = value => {
  if (!/^(text|uuid|boolean|smallint|integer|bigint|real|double precision|numeric(?:\(\d+(?:,\d+)?\))?|jsonb?|date|time(?:stamp)?(?:\(\d+\))?(?: with(?:out)? time zone)?|character varying(?:\(\d+\))?)(?:\[\])?$/.test(value)) throw new Error('Tipe schema drill belum didukung: ' + value);
  return value;
};

// Only accepts a caller-created PGlite instance, never a Supabase/remote DB URL.
// Rebuilds typed columns + PK/internal FK; excludes production triggers and auth schema.
export async function drillBackupInMemory(db, bundle) {
  const expected = validateBackup(bundle), relations = verifyBackupRelations(bundle);
  await db.exec('BEGIN');
  try {
    for (const table of BACKUP_TABLES) {
      const schema = bundle.schema[table];
      const columns = schema.columns.map(c => `${ident(c.name)} ${type(c.type)}`);
      if (schema.primary_key?.length) columns.push(`PRIMARY KEY (${schema.primary_key.map(ident).join(',')})`);
      for (const unique of schema.unique_keys || []) columns.push(`UNIQUE (${unique.map(ident).join(',')})`);
      await db.exec(`CREATE TABLE ${ident(table)} (${columns.join(',')})`);
    }
    for (const table of BACKUP_TABLES) {
      for (const fk of bundle.schema[table].foreign_keys || []) {
        if (fk.target_schema !== 'public' || !BACKUP_TABLES.includes(fk.target)) continue;
        await db.exec(`ALTER TABLE ${ident(table)} ADD FOREIGN KEY (${fk.columns.map(ident).join(',')}) REFERENCES ${ident(fk.target)} (${fk.target_columns.map(ident).join(',')}) DEFERRABLE INITIALLY DEFERRED`);
      }
    }
    for (const table of BACKUP_TABLES) {
      if (bundle.tables[table].length) await db.query(`INSERT INTO ${ident(table)} SELECT * FROM jsonb_populate_recordset(NULL::${ident(table)},$1::jsonb)`, [JSON.stringify(bundle.tables[table])]);
      const row = (await db.query(`SELECT count(*)::int n FROM ${ident(table)}`)).rows[0];
      if (row.n !== expected[table]) throw new Error('Jumlah restore berbeda: ' + table);
    }
    await db.exec('COMMIT');
    return { tables: BACKUP_TABLES.length, rows: Object.values(expected).reduce((a,b) => a+b,0), checkedRelations: relations.checked,
      externalDependencies: relations.external, productionWrites: 0 };
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
