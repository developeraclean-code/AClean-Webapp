// Dasar bonus per job. Satu invoice bersama tidak boleh menjadi omset/item penuh
// untuk tiap job. Hanya billing part atau invoice sumber dengan pemilik jelas
// yang boleh dipakai; data legacy ambigu masuk tinjauan, bukan perkiraan diam-diam.
import { detectBonusFromInvoice } from './bonus.js';
import { isMarginBonus, marginBonusForProfit } from './bonusSettings.js';

export const mergedInvoiceTarget = invoice =>
  /\[Digabung ke ([^\]\s]+)\]/i.exec(String(invoice?.service || ''))?.[1] || null;

const money = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const parseLines = value => {
  if (value == null || value === '') return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error('Rincian invoice bukan daftar item');
  return parsed;
};
const quantityPool = lines => {
  const pool = new Map();
  for (const line of lines) {
    const name = norm(line?.nama || line?.name);
    const qty = Number(line?.jumlah ?? line?.qty ?? 1);
    if (!name || !Number.isFinite(qty) || qty <= 0) throw new Error('Nama/jumlah item invoice tidak valid');
    const key = name + '|' + norm(line?.satuan || line?.unit || 'unit');
    pool.set(key, (pool.get(key) || 0) + qty);
  }
  return pool;
};

// Largest remainder dalam sen: hasil alokasi selalu tepat sama dengan invoice
// terakhir, termasuk diskon/edit harga. Tidak membagi rata jumlah job.
export function allocateBonusRevenue(total, weights) {
  const value = money(total);
  const cents = Math.round(Number(value) * 100);
  if (value == null || !Number.isSafeInteger(cents)) throw new Error('Total invoice tidak valid');
  const sum = weights.reduce((s, weight) => s + Number(weight), 0);
  if (!Number.isFinite(sum) || weights.some(weight => money(weight) == null) || (!sum && cents)) throw new Error('Nilai sumber alokasi tidak lengkap');
  if (!sum) return weights.map(() => 0);
  const shares = weights.map((weight, index) => {
    const exact = cents * Number(weight) / sum;
    return { index, cents: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = cents - shares.reduce((s, share) => s + share.cents, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining-- > 0) share.cents++;
  }
  return shares.map(share => share.cents / 100);
}

export function buildBonusBillingBases({ orders = [], invoices = [], parts = [] } = {}) {
  const invoiceMap = new Map(invoices.map(invoice => [invoice.id, invoice]));
  const bases = {};
  const groups = new Map();
  const groupInvoice = new Map(invoices.filter(inv => inv.status !== 'CANCELLED' && inv.job_id).map(inv => [inv.job_id, inv.id]));
  const rootOf = id => {
    const visited = new Set();
    while (id && invoiceMap.has(id)) {
      if (visited.has(id)) throw new Error('Tautan invoice gabungan membentuk siklus');
      visited.add(id);
      const next = mergedInvoiceTarget(invoiceMap.get(id));
      if (!next) return invoiceMap.get(id);
      id = next;
    }
    return null;
  };
  for (const order of orders) {
    if (order.status === 'CANCELLED') continue;
    let root;
    try { root = rootOf(order.invoice_id || (order.is_team_split && groupInvoice.get(order.job_group_id))); }
    catch (error) { bases[order.id] = { invoiceId: order.invoice_id, resolved: false, reason: error.message }; continue; }
    if (!root) { bases[order.id] = { invoiceId: order.invoice_id, resolved: false, reason: 'Invoice pekerjaan belum tersedia' }; continue; }
    if (!groups.has(root.id)) groups.set(root.id, { root, jobs: [] });
    groups.get(root.id).jobs.push(order);
  }
  for (const { root, jobs } of groups.values()) {
    const shared = jobs.length > 1;
    const common = { invoiceId: root.id, invoiceTotal: money(root.total), shared,
      peerOrderIds: jobs.map(job => job.id).sort(), warnings: [] };
    try {
      if (root.status === 'CANCELLED') throw new Error('Invoice dibatalkan; dasar bonus perlu ditinjau');
      if (money(root.total) == null) throw new Error('Total invoice tidak valid');
      const finalLines = parseLines(root.materials_detail);
      quantityPool(finalLines);
      const leaves = [];
      const collect = (invoice, path = new Set()) => {
        if (path.has(invoice.id)) throw new Error('Tautan invoice gabungan membentuk siklus');
        const children = invoices.filter(inv => mergedInvoiceTarget(inv) === invoice.id);
        if (!children.length) { leaves.push(invoice); return; }
        children.forEach(child => collect(child, new Set([...path, invoice.id])));
      };
      collect(root);
      if (leaves.some(leaf => Number(leaf.material) > 0 && parseLines(leaf.materials_detail).length === 0)) {
        throw new Error('Invoice menagih material tetapi rincian item belum tersedia; biaya tidak diasumsikan nol');
      }
      const claims = [];
      for (const leaf of leaves) {
        const owners = jobs.filter(job => job.invoice_id === leaf.id || job.id === leaf.job_id ||
          (job.is_team_split && job.job_group_id === leaf.job_id) ||
          (leaf.id === root.id && (job.invoice_id === root.id || (job.is_team_split && job.job_group_id === leaf.job_id))));
        if (owners.length === 1 && !shared && leaves.length === 1) {
          if (leaf.job_id && leaf.job_id !== owners[0].id && !owners[0].is_team_split) throw new Error('Invoice tertaut ke job lain; rincian asal perlu ditinjau');
          claims.push({ jobId: owners[0].id, total: money(leaf.total), lines: parseLines(leaf.materials_detail), source: leaf.id });
        } else if (owners.length === 1 && leaves.length > 1) {
          claims.push({ jobId: owners[0].id, total: money(leaf.total), lines: parseLines(leaf.materials_detail), source: leaf.id });
        } else {
          if (!owners.length) throw new Error('Pemilik invoice sumber belum tertaut ke job');
          for (const owner of owners) {
            const rows = parts.filter(part => part.order_id === owner.id);
            if (rows.length !== 1) throw new Error('Rincian per job belum lengkap/ambigu; total gabungan tidak digunakan otomatis');
            const part = rows[0];
            if (owner.is_team_split && part.group_id !== owner.job_group_id) throw new Error('Billing part tertaut ke grup pekerjaan yang berbeda');
            claims.push({ jobId: owner.id, total: money(part.total), lines: parseLines(part.invoice_payload?.materials_detail), source: part.report_id });
          }
        }
      }
      if (claims.some(claim => claim.total == null) || jobs.some(job => !claims.some(claim => claim.jobId === job.id))) {
        throw new Error('Alokasi invoice belum mencakup seluruh pekerjaan');
      }
      // Jumlah item sumber harus sesuai invoice akhir. Satu kapasitor tidak boleh
      // diklaim dua job meski masing-masing laporan menyebut kapasitor.
      if (shared || leaves.length > 1) {
        const actual = quantityPool(finalLines), claimed = quantityPool(claims.flatMap(claim => claim.lines));
        if (actual.size !== claimed.size || [...actual].some(([key, qty]) => Math.abs(qty - (claimed.get(key) || 0)) > 0.000001)) {
          throw new Error('Item/jumlah sumber berbeda dari invoice akhir; perlu peninjauan agar tidak dipakai berulang');
        }
      }
      const sorted = [...jobs].sort((a, b) => a.id.localeCompare(b.id));
      const weights = sorted.map(job => claims.filter(claim => claim.jobId === job.id).reduce((s, claim) => s + claim.total, 0));
      const allocated = allocateBonusRevenue(root.total, weights);
      const sourceTotal = weights.reduce((s, value) => s + value, 0);
      const adjusted = Math.abs(sourceTotal - Number(root.total)) > 0.005;
      if (adjusted) common.warnings.push('Diskon/edit total invoice dialokasikan proporsional terhadap nilai pekerjaan sumber');
      sorted.forEach((job, index) => {
        const own = claims.filter(claim => claim.jobId === job.id);
        const materials_detail = JSON.stringify(own.flatMap(claim => claim.lines));
        const sourceIds = own.map(claim => claim.source).sort();
        bases[job.id] = { ...common, resolved: true, total: allocated[index], materials_detail, sourceIds,
          source: shared || leaves.length > 1 ? 'billing_per_job' : 'invoice_job', adjusted,
          signature: JSON.stringify([root.id, Number(root.total), common.peerOrderIds, sourceIds, allocated[index], materials_detail]) };
      });
    } catch (error) {
      jobs.forEach(job => { bases[job.id] = { ...common, resolved: false, total: null, materials_detail: '[]', reason: error.message }; });
    }
  }
  return bases;
}

export function scopedBonusInvoice(basis) {
  return { id: basis?.invoiceId, total: basis?.resolved ? basis.total : 0,
    materials_detail: basis?.resolved ? basis.materials_detail : '[]' };
}

export function validateBonusBillingEntries(entries, basis, categories) {
  const detected = detectBonusFromInvoice(basis?.materials_detail, '', categories).detected;
  for (const entry of entries) {
    if (!Number.isFinite(Number(entry.total_amount)) || Number(entry.total_amount) <= 0) throw new Error('Nominal bonus harus lebih dari 0');
    if (entry.bonus_type === 'manual') {
      if (!String(entry.note || '').trim()) throw new Error('Bonus manual wajib diberi alasan');
      continue;
    }
    if (!categories.some(category => category.id === entry.bonus_type)) throw new Error('Kategori bonus berubah/tidak tersedia; muat ulang setting');
    if (String(entry.bonus_type).startsWith('install')) continue; // basis unit/hari, bukan invoice
    if (!basis?.resolved) throw new Error(basis?.reason || 'Dasar bonus per job belum dapat dipastikan');
    if (isMarginBonus({ id: entry.bonus_type })) {
      const cost = money(entry.material_cost), revenue = money(entry.gross_revenue);
      if (cost == null || revenue == null || Math.abs(revenue - basis.total) > 0.005) throw new Error('Omset bonus harus memakai nilai pekerjaan ini, bukan total invoice gabungan');
      const tier = marginBonusForProfit(revenue - cost, categories);
      if (!tier || tier.id !== entry.bonus_type || Number(entry.total_amount) !== Number(tier.amount)) throw new Error('Tingkat bonus berubah/tidak sesuai margin; muat ulang perhitungan');
    } else if (basis.shared && !detected.includes(entry.bonus_type)) {
      throw new Error('Kategori ini tidak ada pada item milik job ini. Gunakan bonus manual dengan alasan bila diperlukan');
    }
  }
}
