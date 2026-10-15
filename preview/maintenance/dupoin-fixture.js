// Salinan data gambar Owner untuk PREVIEW/TEST saja, bukan seed produksi.
// Kode DUP-... adalah label internal usulan, bukan serial pabrik terverifikasi.
import { dupoinUnits, dupoinPrices } from "../../scripts/data/dupoin-maintenance-20261015.mjs";
export const dupoinPreviewUnits = dupoinUnits.map(u => ({ ...u, id: `preview-${u.unit_code}`, client_id: "preview-dupoin" }));
export const dupoinPreviewPrices = dupoinPrices.map((p, i) => ({ ...p, id: `preview-price-${i}`, client_id: "preview-dupoin" }));
