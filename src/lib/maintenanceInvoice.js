// Shared by the B2B screen and server preview/create. No hardcoded rupiah fallback.
import { MAINT_REPORT_BASE, normalizeMaintenanceAcType, capacityPkNumber, isVrvType } from "./maintenanceAcTypes.js";
import { clientCleaningUnitRate } from "./maintClientPrice.js";
import { hargaPerUnitFromTipe } from "./pricing.js";
import { summarize } from "./invoicing.js";

export const isMaintenanceCleaningLog = log => /cuci|cleaning|perawatan|preventi/i.test(String(log.service_type || ""))
  || /^(maintenance|pm)$/i.test(String(log.service_type || "").trim())
  || log.service_category === "cuci_rutin";

export function maintenanceLogInvoiceLine(log, unit, clientPrices, priceListData = []) {
  if (!unit || (log.client_id && unit.client_id && log.client_id !== unit.client_id)) {
    throw new Error("Aset log tidak ditemukan atau bukan milik perusahaan ini");
  }
  const code = normalizeMaintenanceAcType(unit.ac_type);
  const pk = capacityPkNumber(unit.capacity_pk);
  const cleaning = isMaintenanceCleaningLog(log);
  const label = unit.unit_code || unit.id || "Unit";
  let price, source, included = false;
  if (cleaning) {
    if (!code || pk == null) throw new Error(`${label}: tipe/kapasitas AC belum valid`);
    const reportUnit = { tipe: isVrvType(code) ? MAINT_REPORT_BASE[code] : `${MAINT_REPORT_BASE[code]} ${pk}PK`, pk: `${pk}PK` };
    const rate = clientCleaningUnitRate(clientPrices, reportUnit);
    if (rate) {
      price = rate.unit_price; included = rate.included_in_service; source = "maintenance_client_prices";
    } else if (!isVrvType(code) && Number(log.cost) > 0 && Number.isFinite(Number(log.cost))) {
      price = Number(log.cost); source = "log_cost";
    } else {
      price = hargaPerUnitFromTipe("Cleaning", reportUnit.tipe, priceListData);
      source = "price_list";
      if (!(price > 0)) throw new Error(`${label}: tarif cleaning ${MAINT_REPORT_BASE[code]} ${pk}PK belum diatur`);
    }
  } else {
    // A repair/freon/install log is not a cleaning package. Never invent its price.
    price = Number(log.cost); source = "log_cost";
    if (!Number.isFinite(price) || price <= 0) throw new Error(`${label}: isi biaya aktual untuk ${log.service_type || "jenis servis ini"}`);
  }
  const suffix = included ? " — termasuk penawaran (tidak ditagih terpisah)" : source === "maintenance_client_prices" ? " — harga kontrak" : "";
  return {
    nama: `${log.service_type || "Maintenance"} ${MAINT_REPORT_BASE[code] || "AC"}${pk == null ? "" : ` ${pk}PK`} (${label}${unit.location ? ` — ${unit.location}` : ""})${suffix}`,
    jumlah: 1, satuan: "unit", harga_satuan: price, subtotal: price, keterangan: "jasa", category: "LABOR",
    log_id: log.id, maintenance_unit_id: unit.id, order_id: log.order_id || null,
    unit_code: label, location: unit.location || "-", brand: unit.brand || "-", pk: pk ?? "-", ac_type: code,
    service_type: log.service_type || "Maintenance", service_date: log.service_date || "-",
    price, price_source: source, included_in_service: included,
  };
}

export function buildMaintenanceInvoiceQuote({ clientId, logs, units, clientPrices, priceListData = [], discount = 0 }) {
  if (!Array.isArray(clientPrices)) throw new Error("Harga khusus maintenance belum berhasil dimuat");
  const cut = Number(discount);
  if (!Number.isSafeInteger(cut) || cut < 0) throw new Error("Diskon harus berupa rupiah bulat yang tidak negatif");
  const unitById = new Map(units.map(u => [u.id, u]));
  const sorted = [...logs].sort((a, b) => String(a.service_date).localeCompare(String(b.service_date)) || String(a.id).localeCompare(String(b.id)));
  const lines = sorted.map(log => maintenanceLogInvoiceLine(log, unitById.get(log.unit_id), clientPrices, priceListData));
  const summary = summarize(lines, { discount: cut });
  if (cut > summary.labor) throw new Error("Diskon tidak boleh melebihi subtotal");
  const total = summary.labor - cut;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("Nilai invoice tidak valid dalam rupiah bulat");
  // Server recomputes this at create-time. A stale preview may never silently change the amount.
  const quoteKey = JSON.stringify({ client_id: clientId, discount: cut, lines });
  return { line_items: lines, labor: summary.labor, material: 0, discount: cut, total, count: lines.length, quote_key: quoteKey };
}
