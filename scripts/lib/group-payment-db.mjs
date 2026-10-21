// Synthetic PostgreSQL only. Never loads .env or contacts Supabase.
import { readFileSync } from 'node:fs';
import { createPaymentWithholdingDb } from './payment-withholding-db.mjs';
export const groupMigration = () => [
  '../../migrations/220_atomic_group_payment.sql',
  '../../migrations/221_group_payment_header_compatibility.sql',
].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
export const ownerId = '40000000-0000-4000-8000-000000000001';
export async function createGroupPaymentDb({ apply = true, database = null } = {}) {
  const db = await createPaymentWithholdingDb({ database });
  await db.exec(`ALTER TABLE user_profiles ADD COLUMN active boolean DEFAULT true;
    ALTER TABLE orders ADD COLUMN customer text;
    INSERT INTO user_profiles(id,name,role,active) VALUES
      ('${ownerId}','Owner','Owner',true),
      ('40000000-0000-4000-8000-000000000002','Admin','Admin',true),
      ('40000000-0000-4000-8000-000000000003','Finance','Finance',true),
      ('40000000-0000-4000-8000-000000000004','Teknisi','Teknisi',true),
      ('40000000-0000-4000-8000-000000000005','Helper','Helper',true),
      ('40000000-0000-4000-8000-000000000006','Inactive','Owner',false);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    SELECT set_config('test.uid','${ownerId}',false);
    GRANT USAGE ON SCHEMA auth,public TO authenticated,anon;
    CREATE TABLE payments(id bigserial PRIMARY KEY,invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount bigint NOT NULL,method text CHECK(method IN ('cash','transfer','gopay','ovo','dana','qris','other')),
      notes text,paid_at timestamptz NOT NULL DEFAULT now(),
      verified boolean,verified_by text,verified_at timestamptz,created_at timestamptz DEFAULT now(),customer_phone text,
      customer_name text,total_amount numeric,is_partial boolean,invoice_ids text[],payment_proof_url text,allocation_detail jsonb);
    ALTER TABLE invoice_payments ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE operational_mutations ADD COLUMN created_at timestamptz DEFAULT now();
    ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY; ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE payment_suggestions ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON user_profiles TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON payments,payment_suggestions TO authenticated;
    CREATE POLICY payments_all ON payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY suggestions_read ON payment_suggestions FOR SELECT TO authenticated USING (true);
    CREATE POLICY suggestions_update ON payment_suggestions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    CREATE INDEX ON invoice_payments(invoice_id);`);
  if (apply) await db.exec(groupMigration());
  return db;
}
export async function groupRpc(db, args) {
  return (await db.query('SELECT record_group_payment_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result', [
    args.p_request_id,args.p_invoice_ids,args.p_total_received,args.p_paid_at,args.p_method,
    args.p_customer_phone,JSON.stringify(args.p_expected),args.p_payment_proof_url,args.p_suggestion_id,args.p_review_ack,
  ])).rows[0].result;
}
export async function seedGroup(db, suffix = '') {
  for (const [id,total,date] of [['A',1655000,'2026-10-16'],['B',2645000,'2026-10-17']]) {
    await db.query(`INSERT INTO invoices(id,job_id,customer,phone,total,status,paid_amount,remaining_amount,created_at)
      VALUES($1,$2,'Synthetic school','628000000001',$3,'UNPAID',0,NULL,$4)`, [id+suffix,'JOB-'+id+suffix,total,date]);
    await db.query("INSERT INTO orders(id,invoice_id,status) VALUES($1,$2,'INVOICE_APPROVED')", ['JOB-'+id+suffix,id+suffix]);
  }
}
