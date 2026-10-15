import { isVrvType, capacityPkNumber } from "./maintenanceAcTypes.js";
import { clientCleaningUnitRate } from "./maintClientPrice.js";
import { hargaPerUnitFromTipe, isServiceBesarPekerjaan } from "./pricing.js";

// Laporan lapangan tetap boleh disimpan; uang/invoice menunggu tarif eksplisit
// Owner. Tidak menyamakan 40 indoor + 12 outdoor dengan 52 paket cleaning reguler.
export const reportHasVrv = units => Array.isArray(units) && units.some(u => isVrvType(u?.tipe));
export function unpricedVrvUnits({ service, units, clientPrices = [], priceListData = [] }) {
  if (!["Cleaning", "Maintenance"].includes(service) || !Array.isArray(units)) return [];
  return units.filter(u => {
    if (!isVrvType(u?.tipe)) return false;
    if (capacityPkNumber(u.pk) == null) return true;
    const rate = clientCleaningUnitRate(clientPrices, u);
    if (rate?.included_in_service === true && rate.unit_price === 0) return false;
    const global = hargaPerUnitFromTipe(service, u.tipe, priceListData, {}, { serviceBesar: isServiceBesarPekerjaan(u.pekerjaan) });
    return !(Number(rate?.unit_price ?? global) > 0);
  });
}
export const vrvInvoiceUnitLabel = (unit, bracket) => isVrvType(unit?.tipe) && capacityPkNumber(unit.pk) != null ? `${bracket} ${capacityPkNumber(unit.pk)}PK` : bracket;
