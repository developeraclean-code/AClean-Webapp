// Source cancellation, job links and unreviewed proof links commit together.
// No non-atomic fallback: a missing RPC must be visible, never a half-merge.
export async function createConsolidatedInvoice(invList, {
  supabase, currentUser, showNotif, addAgentLog, setInvoicesData, setOrdersData,
  setPaymentSuggestions, getLocalDate, samePhone, normalizeLines, summarize,
  checkInvoiceConsistency, describeInconsistency,
}) {
  try {
    const ids = [...new Set((invList || []).map(i => i.id))];
    if (ids.length < 2 || ids.length !== invList.length || ids.length > 20) throw new Error('Pilih 2–20 invoice berbeda');
    const { data: fresh, error: readError } = await supabase.from('invoices').select('*').in('id', ids);
    if (readError) throw readError;
    if (!fresh || fresh.length !== ids.length) throw new Error('Invoice sumber tidak lengkap; muat ulang');
    const sorted = [...fresh].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id));
    const first = sorted[0];
    if (!first.phone || !sorted.every(i => samePhone(i.phone, first.phone))) throw new Error('Semua invoice harus dari nomor customer yang sama');
    // Do not silently use a different quote than the one the user selected.
    for (const row of fresh) {
      const shown = invList.find(i => i.id === row.id);
      for (const field of ['total', 'labor', 'material', 'discount', 'materials_detail', 'phone', 'customer', 'trade_in_amount', 'pph23', 'unit_ac_amount', 'quotation_id']) {
        if (shown[field] !== undefined && JSON.stringify(shown[field]) !== JSON.stringify(row[field])) throw new Error('Nilai invoice berubah; muat ulang dan periksa sebelum menggabungkan');
      }
      if (row.pph23 || Number(row.trade_in_amount) > 0 || Number(row.unit_ac_amount) > 0 || row.quotation_id || row.invoice_type === 'UNIT_AC') {
        throw new Error('Invoice PPh/trade-in/unit AC/quotation gunakan Gabung & Kirim PDF; konsolidasi ini hanya untuk invoice jasa/material tanpa DP');
      }
    }
    const lines = normalizeLines(sorted.flatMap(inv => {
      let md = inv.materials_detail;
      if (typeof md === 'string') {
        try { md = JSON.parse(md); } catch { throw new Error(`Item ${inv.id} tidak valid; periksa invoice sumber`); }
      }
      if (Array.isArray(md) && md.length) return md;
      return [
        ...(Number(inv.labor) > 0 ? [{ nama: inv.service || 'Jasa', jumlah: 1, satuan: 'unit', harga_satuan: Number(inv.labor), subtotal: Number(inv.labor), category: 'LABOR' }] : []),
        ...(Number(inv.material) > 0 ? [{ nama: 'Material', jumlah: 1, satuan: 'unit', harga_satuan: Number(inv.material), subtotal: Number(inv.material), category: 'PART' }] : []),
      ];
    }));
    const discount = sorted.reduce((sum, inv) => sum + Number(inv.discount || 0), 0);
    const sum = summarize(lines, { discount });
    if (sum.total !== sorted.reduce((n, inv) => n + Number(inv.total || 0), 0)
      || sum.labor !== sorted.reduce((n, inv) => n + Number(inv.labor || 0), 0)
      || sum.material !== sorted.reduce((n, inv) => n + Number(inv.material || 0), 0)) {
      throw new Error('Total/item invoice sumber tidak konsisten; tidak ada invoice yang dibatalkan');
    }
    const today = getLocalDate().replace(/-/g, '');
    const nonce = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12).toUpperCase();
    if (!nonce) throw new Error('Browser tidak mendukung ID permintaan aman');
    const newInv = {
      id: `INV-${today}-${nonce}`, customer: first.customer, phone: first.phone,
      service: `Invoice Gabungan (${sorted.length} pekerjaan)`, job_id: null,
      units: sorted.reduce((n, i) => n + (Number(i.units) || 1), 0), labor: sum.labor, material: sum.material,
      discount, total: sum.total, status: 'UNPAID',
      due: sorted.map(i => i.due).filter(Boolean).sort().at(-1) || null,
      teknisi: first.teknisi || null, materials_detail: JSON.stringify(lines), sent: false,
    };
    const check = checkInvoiceConsistency({ ...newInv, lines });
    if (!check.ok) throw new Error(describeInconsistency(check, newInv.id));
    const { data, error } = await supabase.rpc('consolidate_invoices_atomic', {
      p_sources: sorted, p_invoice: newInv, p_actor_name: currentUser?.name || null,
    });
    if (error) throw error;
    if (!data?.invoice?.id || !Array.isArray(data.sources) || !Array.isArray(data.orders) || !Array.isArray(data.suggestions)) {
      throw new Error('Respons konsolidasi tidak lengkap; muat ulang untuk memeriksa hasil, jangan membuat invoice manual baru');
    }
    const replacements = new Map([...data.sources, data.invoice].map(i => [i.id, i]));
    setInvoicesData(prev => [data.invoice, ...prev.filter(i => i.id !== data.invoice.id).map(i => replacements.get(i.id) || i)]);
    const orderMap = new Map(data.orders.map(o => [o.id, o]));
    setOrdersData?.(prev => prev.map(o => orderMap.get(o.id) || o));
    const suggestionMap = new Map(data.suggestions.map(s => [s.id, s]));
    setPaymentSuggestions?.(prev => {
      const all = new Map(prev.map(s => [s.id, s]));
      for (const [id, s] of suggestionMap) { if (s.status === 'PENDING') all.set(id, s); else all.delete(id); }
      return [...all.values()];
    });
    addAgentLog?.('INVOICE_CONSOLIDATED', `${ids.join(', ')} → ${data.invoice.id}; bukti tetap menunggu verifikasi`, 'SUCCESS');
    showNotif(`✅ Invoice ${data.invoice.id} ${data.replayed ? 'sudah tersimpan' : 'berhasil digabung'}; periksa bukti sebelum menandai lunas`);
    return { ok: true, newInvoice: data.invoice, replayed: !!data.replayed };
  } catch (error) {
    const missing = error?.code === 'PGRST202' || /could not find.*function/i.test(error?.message || '');
    const message = missing ? 'Migrasi 206 belum terpasang; konsolidasi dibatalkan tanpa jalur cadangan' : error?.message || 'Konsolidasi gagal';
    showNotif(`❌ ${message}`);
    addAgentLog?.('INVOICE_CONSOLIDATE_FAILED', message, 'WARNING');
    return { ok: false, error: message };
  }
}
