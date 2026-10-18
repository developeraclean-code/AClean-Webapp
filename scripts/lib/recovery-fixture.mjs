import { BACKUP_TABLES } from '../../api/_backup.js';
export function recoveryFixture(jobs = 200) {
  const tables = Object.fromEntries(BACKUP_TABLES.map(t => [t, []]));
  const schema = Object.fromEntries(BACKUP_TABLES.map(t => [t, { columns: [{ name: 'id', type: 'text' }], primary_key: ['id'], foreign_keys: [] }]));
  tables.customers = [{ id: 'CUSTOMER-SIMULASI' }];
  schema.orders.columns.push({ name: 'customer_id', type: 'text' });
  schema.orders.foreign_keys.push({ columns: ['customer_id'], target: 'customers', target_schema: 'public', target_columns: ['id'] });
  schema.invoices.columns.push({ name: 'job_id', type: 'text' }, { name: 'total', type: 'numeric' });
  schema.invoices.foreign_keys.push({ columns: ['job_id'], target: 'orders', target_schema: 'public', target_columns: ['id'] });
  schema.invoice_payments.columns.push({ name: 'invoice_id', type: 'text' }, { name: 'amount', type: 'numeric' });
  schema.invoice_payments.foreign_keys.push({ columns: ['invoice_id'], target: 'invoices', target_schema: 'public', target_columns: ['id'] });
  for (let i = 0; i < jobs; i++) {
    tables.orders.push({ id: 'JOB-' + i, customer_id: 'CUSTOMER-SIMULASI' });
    tables.invoices.push({ id: 'INV-' + i, job_id: 'JOB-' + i, total: 200000 + i });
    tables.invoice_payments.push({ id: 'PAY-' + i, invoice_id: 'INV-' + i, amount: 100000 + i });
  }
  return { format: 2, schema_version: 216, exported_at: '2026-10-18T07:00:00.000Z', tables, schema };
}
