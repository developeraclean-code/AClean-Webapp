import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ invoices: [], suggestions: [], updates: [], messages: [] }));

vi.mock('../../../api/_tasks/_shared.js', () => {
  const sb = {
    from(table) {
      const filters = [];
      let patch = null;
      let range = [0, Number.MAX_SAFE_INTEGER];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push(row => row[column] === value); return query; },
        gt(column, value) { filters.push(row => row[column] > value); return query; },
        gte(column, value) { filters.push(row => row[column] >= value); return query; },
        not(column, operator, value) { if (operator === 'is' && value === null) filters.push(row => row[column] != null); return query; },
        in() { return query; },
        or() { return query; },
        order() { return query; },
        range(start, end) { range = [start, end]; return query; },
        update(value) { patch = value; return query; },
        then(resolve, reject) {
          const rows = table === 'app_settings'
            ? [{ key: 'bukti_bayar_scan_enabled', value: 'true' }]
            : table === 'invoices' ? state.invoices : state.suggestions;
          const matched = rows.filter(row => filters.every(filter => filter(row))).slice(range[0], range[1] + 1);
          if (patch) {
            for (const row of matched) { Object.assign(row, patch); state.updates.push({ table, id: row.id, patch }); }
          }
          return Promise.resolve(resolve({ data: matched, error: null })).catch(reject);
        },
      };
      return query;
    },
  };
  return {
    sb,
    sendWA: async (phone, message) => { state.messages.push({ phone, message }); },
    log: async () => {},
    isCronJobEnabled: () => true,
    OWNER_PHONE: '628000000000',
  };
});

import { taskScanBuktiBayar } from '../../../api/_tasks/wa-ai.js';

beforeEach(() => {
  state.invoices = [{ id: 'INV-A', customer: 'Pelanggan', status: 'PAID', total: 500000,
    created_at: new Date().toISOString(), payment_proof_url: null }];
  state.suggestions = [];
  state.updates = [];
  state.messages = [];
});

describe('cron pemulihan bukti bayar', () => {
  it('tidak memasang bukti dari saran PENDING atau invoice lain; hanya link admin yang tepat', async () => {
    const base = { id: 'S-1', image_url: '/api/foto?key=wa-inbox%2Fproof.jpg',
      created_at: new Date().toISOString(), status: 'PENDING', validation_status: 'PENDING', invoice_id: 'INV-A' };
    state.suggestions = [base];
    expect((await taskScanBuktiBayar()).updated).toBe(0);
    expect(state.updates).toHaveLength(0);

    state.suggestions = [{ ...base, status: 'CONFIRMED', validation_status: 'LINKED', invoice_id: 'INV-B' }];
    expect((await taskScanBuktiBayar()).updated).toBe(0);
    expect(state.updates).toHaveLength(0);

    state.suggestions = [{ ...base, status: 'CONFIRMED', validation_status: 'LINKED' }];
    expect((await taskScanBuktiBayar()).updated).toBe(1);
    expect(state.updates).toMatchObject([{ table: 'invoices', id: 'INV-A', patch: { payment_proof_url: base.image_url } }]);
    expect(state.messages).toHaveLength(1);
  });
});
