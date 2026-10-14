import { buildBonusBillingBases, mergedInvoiceTarget } from './bonusBilling.js';

const INVOICE_COLS = 'id,job_id,total,status,service,materials_detail,labor,material,discount,trade_in_amount';
const ORDER_COLS = 'id,date,customer,customer_id,service,units,teknisi,teknisi2,teknisi3,helper,helper2,helper3,invoice_id,status,is_multi_day,parent_job_id,day_number,is_team_split,job_group_id';
const unique = values => [...new Set(values.filter(Boolean))];
const pages = async (query, label) => {
  const rows = [];
  for (let from = 0; from < 20000; from += 500) {
    const { data, error } = await query().range(from, from + 499);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < 500) return rows;
  }
  throw new Error(`${label}: data melebihi batas pembacaan aman`);
};
const byIds = async (supabase, table, cols, field, ids) => {
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    rows.push(...await pages(() => supabase.from(table).select(cols).in(field, ids.slice(offset, offset + 100)).order('id'), table));
  }
  return rows;
};

export const loadBonusHppInventory = supabase => pages(() => supabase.from('inventory')
  .select('name,purchase_price').order('code'), 'Harga beli material');

// Baca peer di luar bulan yang dipilih juga. Kalau hanya memakai order bulan ini,
// satu invoice lintas bulan bisa kembali dianggap milik satu job saja.
export async function loadBonusBillingContext(supabase, periodOrders) {
  const seedIds = unique(periodOrders.map(order => order.invoice_id));
  const invoiceMap = new Map((await byIds(supabase, 'invoices', INVOICE_COLS, 'id', seedIds)).map(row => [row.id, row]));
  const sourceTargets = new Set();
  const attemptedInvoiceIds = new Set(seedIds);
  for (let pass = 0; pass < 6; pass++) {
    const missing = unique([...invoiceMap.values()].map(mergedInvoiceTarget)).filter(id => !attemptedInvoiceIds.has(id));
    missing.forEach(id => attemptedInvoiceIds.add(id));
    (await byIds(supabase, 'invoices', INVOICE_COLS, 'id', missing)).forEach(row => invoiceMap.set(row.id, row));
    const targets = [...invoiceMap.values()].filter(invoice => !sourceTargets.has(invoice.id) &&
      (invoice.job_id == null || /invoice gabungan/i.test(invoice.service || '') ||
        [...invoiceMap.values()].some(source => mergedInvoiceTarget(source) === invoice.id)));
    for (let offset = 0; offset < targets.length; offset += 4) {
      const batches = await Promise.all(targets.slice(offset,offset + 4).map(async invoice => {
        sourceTargets.add(invoice.id);
        const escaped = String(invoice.id).replace(/[\\%_]/g, value => '\\' + value);
        return pages(() => supabase.from('invoices').select(INVOICE_COLS)
          .like('service', `%[Digabung ke ${escaped}]%`).order('id'), 'Invoice sumber gabungan');
      }));
      batches.flat().forEach(row => invoiceMap.set(row.id, row));
    }
    if (!missing.length && !targets.length) break;
    if (pass === 5) throw new Error('Rantai invoice gabungan terlalu panjang; perlu tinjauan');
  }
  const peerMap = new Map(periodOrders.map(order => [order.id, order]));
  (await byIds(supabase, 'orders', ORDER_COLS, 'invoice_id', [...invoiceMap.keys()])).forEach(row => peerMap.set(row.id, row));
  const groupIds = unique([...peerMap.values()].filter(order => order.is_team_split).map(order => order.job_group_id));
  (await byIds(supabase, 'orders', ORDER_COLS, 'job_group_id', groupIds)).forEach(row => peerMap.set(row.id, row));
  const partRows = [];
  const partIds = unique([...peerMap.values()].filter(order => order.is_team_split).map(order => order.id));
  for (let offset = 0; offset < partIds.length; offset += 100) {
    partRows.push(...await pages(() => supabase.from('team_invoice_parts')
      .select('report_id,order_id,group_id,total,invoice_payload').in('order_id',partIds.slice(offset, offset + 100))
      .order('report_id'), 'Billing part per job'));
  }
  const orders = [...peerMap.values()], invoices = [...invoiceMap.values()];
  return { orders, invMap: Object.fromEntries(invoiceMap),
    bases: buildBonusBillingBases({ orders, invoices, parts: partRows }) };
}
