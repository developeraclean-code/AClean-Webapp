// Shared isolated PostgreSQL/WASM harness. No credentials, network or live data.
import { readFileSync } from 'node:fs';
import { rawInvoice, sampleProof } from '../../preview/payment-withholding/fixture.js';
const sqlFile = name => readFileSync(new URL('../../migrations/' + name, import.meta.url), 'utf8');
export const snapshotMigration = () => sqlFile('213_payment_withholding_snapshot.sql');

export async function createPaymentWithholdingDb({ applyWithholding = true, applySnapshotFix = true, database = null } = {}) {
  let db = database;
  if (!db) { const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite'); db = new PGlite(); }
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'authenticated'::text $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
      CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
      SET test.role='Owner'; CREATE TABLE user_profiles(id uuid,name text,role text); CREATE TABLE customers(phone text,last_service date);
      CREATE TABLE invoices(id text PRIMARY KEY,customer text,phone text,service text,job_id text,units int,labor bigint,material bigint,discount bigint,total bigint,status text,due date,teknisi text,materials_detail text,sent boolean,
        paid_amount numeric,remaining_amount numeric,paid_at timestamptz,paid_method text,paid_notes text,payment_proof_url text,last_changed_by text,pdf_url text,pdf_generated_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
        pph23 boolean DEFAULT false,pph23_amount numeric DEFAULT 0,trade_in_amount numeric DEFAULT 0,unit_ac_amount bigint DEFAULT 0,quotation_id text,invoice_type text);
      CREATE TABLE orders(id text PRIMARY KEY,invoice_id text,status text,last_changed_by text);
      CREATE TABLE invoice_payments(id uuid PRIMARY KEY,invoice_id text REFERENCES invoices(id),amount numeric CHECK(amount>0),method text,notes text,paid_at date,recorded_by text,recorded_by_name text,created_at timestamptz DEFAULT now(),quotation_payment_id uuid);
      CREATE TABLE operational_mutations(mutation_key text PRIMARY KEY,operation text,actor_id uuid,actor_name text,result jsonb DEFAULT '{}',completed_at timestamptz);
      CREATE TABLE payment_suggestions(id uuid PRIMARY KEY,phone text,sender_name text,amount numeric,image_url text,invoice_id text,status text,validation_status text DEFAULT 'PENDING',order_id text,matched_at timestamptz,match_source text,resolved_at timestamptz,resolved_by text,created_at timestamptz DEFAULT now());
      CREATE TABLE wa_payment_receipts(id uuid PRIMARY KEY,suggestion_id uuid UNIQUE,payload jsonb,result jsonb,actor text);
      CREATE TABLE quotations(id text PRIMARY KEY,job_id text,customer text,total bigint);
      CREATE TABLE quotation_payments(id uuid PRIMARY KEY,quotation_id text,amount numeric,paid_at date,created_at timestamptz);`);
    await db.exec(sqlFile('173_invoice_payment_idempotency.sql'));
    const workflow = sqlFile('177_atomic_invoice_report_order_workflows.sql');
    await db.exec(workflow.slice(workflow.indexOf('CREATE OR REPLACE FUNCTION public.settle_invoice_atomic'), workflow.indexOf('CREATE OR REPLACE FUNCTION public.submit_service_report_atomic')));
    await db.exec(sqlFile('206_invoice_merge_payment_review.sql'));
    if (applyWithholding) await db.exec(sqlFile('212_reviewed_payment_withholding.sql'));
    if (applySnapshotFix && applyWithholding) await db.exec(snapshotMigration());
    return db;
  } catch (error) { await db.close(); throw error; }
}

export async function seedBrowserPayment(db) {
  await db.query(`INSERT INTO invoices(id,job_id,customer,phone,total,labor,material,discount,status,paid_amount,remaining_amount,pph23,pph23_amount,materials_detail)
    VALUES($1,$2,$3,$4,$5::bigint,$6,$7,0,'UNPAID',0,$5::bigint,false,0,$8)`,
    [rawInvoice.id, rawInvoice.job_id, rawInvoice.customer, rawInvoice.phone, rawInvoice.total, rawInvoice.labor, rawInvoice.material, rawInvoice.materials_detail]);
  await db.query("INSERT INTO orders(id,invoice_id,status) VALUES($1,$2,'INVOICE_APPROVED')", [rawInvoice.job_id, rawInvoice.id]);
  await db.query("INSERT INTO payment_suggestions(id,phone,sender_name,amount,image_url,status,validation_status) VALUES($1,$2,$3,$4,$5,'PENDING','PENDING')",
    [sampleProof.id, sampleProof.phone, sampleProof.sender_name, sampleProof.amount, sampleProof.image_url]);
}

export async function callBrowserPaymentRpc(db, args) {
  return (await db.query('SELECT confirm_invoice_wa_withholding_atomic($1,$2,$3,$4,$5,$6,$7,$8) result',
    [args.p_request_id, args.p_invoice_id, args.p_suggestion_id, args.p_expected_proof_url, JSON.stringify(args.p_expected_invoice), args.p_paid_at, args.p_note, args.p_review_ack])).rows[0].result;
}
