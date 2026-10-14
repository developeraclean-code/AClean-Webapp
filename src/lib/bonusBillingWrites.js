import { DEFAULT_BONUS_CATEGORIES } from '../constants/bonus.js';
import { insertOrderBonus } from '../data/writes.js';
import { isMultiDayJob } from './bonus.js';
import { validateBonusBillingEntries } from './bonusBilling.js';
import { loadBonusBillingContext, loadBonusHppInventory } from './bonusBillingReads.js';
import { normalizeBonusCategories } from './bonusSettings.js';
import { invoiceMaterialCostHPP } from './hpp.js';

// Simpan hanya sesudah dasar terkini terverifikasi. Tidak mengubah bonus lama.
// Unique index (order_id, bonus_type) tetap menjadi guard retry antar-browser.
export async function saveScopedOrderBonuses({ supabase, orderRow, entries, teamMembers, billingSignature, createdBy }) {
  if (!entries?.length || !teamMembers?.length || new Set(teamMembers).size !== teamMembers.length) throw new Error('Kategori/penerima bonus belum valid');
  const { data: currentOrder, error: orderError } = await supabase.from('orders')
    .select('id,date,invoice_id,status,is_team_split,job_group_id,is_multi_day,parent_job_id,day_number').eq('id',orderRow.id).single();
  if (orderError) throw new Error(orderError.message);
  if (!currentOrder || currentOrder.status === 'CANCELLED') throw new Error('Pekerjaan dibatalkan/tidak tersedia');
  if (currentOrder.date !== orderRow.date) throw new Error('Tanggal pekerjaan berubah; muat ulang sebelum menyimpan');
  const usesInvoice = entries.some(entry => entry.bonus_type !== 'manual' && !String(entry.bonus_type).startsWith('install'));
  if (usesInvoice && isMultiDayJob(currentOrder)) throw new Error('Job lintas hari tidak memenuhi syarat bonus berbasis invoice');
  const billing = await loadBonusBillingContext(supabase,[currentOrder]), basis = billing.bases[currentOrder.id];
  if (usesInvoice && basis?.signature !== billingSignature) throw new Error('Dasar invoice berubah; refresh dan periksa perhitungan per job sebelum menyimpan');
  const { data: setting, error: settingError } = await supabase.from('app_settings').select('value').eq('key','bonus_categories').maybeSingle();
  if (settingError) throw new Error(settingError.message);
  const raw = setting?.value ? JSON.parse(setting.value) : DEFAULT_BONUS_CATEGORIES;
  if (!Array.isArray(raw) || !raw.length) throw new Error('Setting bonus tidak valid; periksa sebelum menyimpan');
  const categories = normalizeBonusCategories(raw);
  validateBonusBillingEntries(entries,basis,categories);
  if (entries.some(entry => entry.material_cost_source === 'auto')) {
    const inventory = await loadBonusHppInventory(supabase);
    const currentCost = invoiceMaterialCostHPP({materialsDetail:basis.materials_detail,inventory}).total;
    if (entries.some(entry => entry.material_cost_source === 'auto' && Math.abs(Number(entry.material_cost) - currentCost) > 0.005)) {
      throw new Error('Harga beli material berubah; periksa hitungan HPP terbaru sebelum menyimpan');
    }
  }
  const { data: existing, error: existingError } = await supabase.from('order_bonuses')
    .select('bonus_type').eq('order_id',currentOrder.id).neq('status','VOID');
  if (existingError) throw new Error(existingError.message);
  const types = new Set((existing || []).map(row=>row.bonus_type));
  const toInsert = entries.filter(entry => {
    if (types.has(entry.bonus_type) || (String(entry.bonus_type).startsWith('margin') && [...types].some(type=>String(type).startsWith('margin')))) return false;
    types.add(entry.bonus_type);return true;
  });
  const result = { saved:0, skipped:entries.length-toInsert.length, failed:0, errors:[] };
  for (const entry of toInsert) {
    try {
      const { error } = await insertOrderBonus(supabase,{
      order_id:currentOrder.id,order_date:currentOrder.date,bonus_type:entry.bonus_type,
      gross_revenue:entry.gross_revenue ?? null,material_cost:entry.material_cost ?? null,
      material_cost_source:entry.material_cost_source || null,team_members:teamMembers,
      total_amount:entry.total_amount,status:'PENDING',
      note:[entry.note,entry.bonus_type !== 'manual' && !String(entry.bonus_type).startsWith('install') && basis?.resolved
        ? `Basis per job ${currentOrder.id}: ${basis.invoiceId} · Rp ${basis.total} · ${basis.source}` : null].filter(Boolean).join('\n') || null,
      },createdBy);
      if(error)throw new Error(error.message);
      result.saved++;
    } catch (error) { result.failed++;result.errors.push(error?.message || 'Hasil simpan belum terkonfirmasi'); }
  }
  return result;
}
