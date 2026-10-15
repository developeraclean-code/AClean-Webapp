// Data onboarding sesuai dua gambar Owner, bukan harga hardcode aplikasi.
// Penggunaan produksi harus melalui preflight + transaksi; import file ini saja tidak menulis DB.
export const dupoin = {
  client_id: '7b5adaad-0733-458f-a418-77f9257917e5', customer_id: 'CUST1589',
  name: 'PT. DUPOIN FUTURES INDONESIA', pic_name: 'Ibu Brigitta', pic_phone: '6285781595604',
  address: 'Centennial Tower, Jl. Gatot Subroto No.Kav 24-25 Lantai 27 Unit A, RT.2/RW.2, Karet Semanggi, Kecamatan Setiabudi, Kota Jakarta Selatan, Daerah Khusus Ibukota Jakarta 12930',
  quotation_ref: '832/09/10/2026/INV', expected_total: 15600000,
};
const large = [
  ['vrv_indoor', 'PEFY-P200VMHS-E', 7.63, 1, 450000],
  ['vrv_indoor', 'PEFY-P140VMA-E', 5.45, 4, 450000],
  ['vrv_indoor', 'PEFY-P125VMA-E', 4.77, 1, 450000],
  ['vrv_outdoor', 'PUCY-P800YSKA P400 YKA', 34.20, 2, 0],
];
const small = [
  ['vrv_indoor', 'PEFY-P100VMA-E', 3.69, 3, 300000],
  ['vrv_indoor', 'PEFY-P63VMA-E', 2.35, 1, 300000],
  ['vrv_outdoor', 'PUCY-P300 YKA', 13.42, 1, 0],
];
export const dupoinUnits = [];
const rates = new Map();
for (const zone of 'ABCDEFGH') {
  const counters = { vrv_indoor: 0, vrv_outdoor: 0 };
  for (const [ac_type, model, capacity_pk, qty, unit_price] of ('ABEF'.includes(zone) ? large : small)) {
    const included = ac_type === 'vrv_outdoor';
    rates.set(`${ac_type}:${capacity_pk}`, { service_type: 'Cuci Rutin', ac_type, capacity_pk, unit_price, included_in_service: included,
      notes: `Penawaran ${dupoin.quotation_ref}. ${included ? 'Outdoor Rp0 sesuai penawaran, tidak ditagih terpisah; bukan tarif kosong.' : 'Harga per indoor sesuai kapasitas pada penawaran.'}` });
    for (let i = 0; i < qty; i++) {
      const component = included ? 'OUTDOOR' : 'INDOOR';
      const seq = ++counters[ac_type];
      dupoinUnits.push({ unit_code: `DUP-27-${zone}-${included ? 'OD' : 'ID'}-${String(seq).padStart(2, '0')}`, zone, model,
        location: `Lantai 27 · Zona ${zone} · ${component} ${seq}`, brand: 'Mitsubishi', ac_type, capacity_pk, refrigerant: 'R410A',
        serial_no: null, year_installed: null, last_service_date: null, next_service_date: null, status: 'active',
        // Belum ada kesepakatan interval PM. Jangan mengarang tanggal layanan/kontrak.
        service_interval_months: null,
        notes: `Model: ${model}. Penawaran ${dupoin.quotation_ref}. Kode internal usulan; label/serial fisik perlu verifikasi di lokasi. Interval PM belum ditentukan.`,
      });
    }
  }
}
export const dupoinPrices = [...rates.values()];
