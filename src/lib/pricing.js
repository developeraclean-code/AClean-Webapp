// Price list default — fallback kalau DB belum di-load.
// Live data dari tabel price_list akan di-merge via buildPriceListFromDB().
export const PRICE_LIST_DEFAULT = {
  "Cleaning": {
    "AC Split 0.5-1PK": 85000,
    "AC Split 1.5-2.5PK": 100000,
    "AC Cassette 2-2.5PK": 250000,
    "AC Cassette 3PK": 300000,
    "AC Cassette 4PK": 400000,
    "AC Cassette 5PK": 500000,
    "AC Cassette 6PK": 600000,
    "AC Standing": 100000,
    "AC Split Duct": 100000,
    "Jasa Service Besar 0,5PK - 1PK": 400000,
    "Jasa Service Besar 1,5PK - 2,5PK": 450000,
    "default": 85000,
  },
  "Install": {
    "Jasa Pergantian Instalasi AC": 300000,
    "Pemasangan AC Baru 0,5PK - 1PK": 350000,
    "Pemasangan AC Baru 1,5PK - 2PK": 400000,
    "Pasang AC Split 3PK": 450000,
    "Bongkar Pasang AC Split 1/2 - 1PK": 500000,
    "Bongkar Pasang AC Split 1,5 - 2,5PK": 550000,
    "Bongkar Unit AC 0.5-1PK": 150000,
    "Bongkar Unit AC 1.5-2.5PK": 200000,
    "Bongkar Pasang Indoor AC": 200000,
    "Bongkar Pasang Outdoor AC": 200000,
    "Jasa Vacum AC 0,5PK - 2,5PK": 50000,
    "Jasa Vacum Unit AC >3PK": 150000,
    "Jasa Penarikan Pipa AC": 25000,
    "Jasa Penarikan Pipa Ruko": 35000,
    "Pasang AC Cassette": 900000,
    "Pasang AC Standing": 600000,
    "Pemasangan AC Baru Apartemen": 350000,
    "Jasa Instalasi Pipa AC": 200000,
    "Jasa Instalasi Listrik": 150000,
    "Flaring Pipa": 100000,
    "Flushing Pipa": 200000,
    "Jasa Bobok Tembok": 150000,
    "Jasa Pengelasan Pipa AC": 100000,
    "Jasa Pembuatan Saluran Pembuangan": 150000,
    "default": 350000,
    // Material install — fallback default jika tidak ada di DB pricelist/inventory
    "Pipa AC Hoda 1PK": 140000,
    "Pipa AC Hoda 1,5PK": 175000,
    "Pipa AC Hoda 2PK": 200000,
    "Pipa AC Hoda 2,5PK": 230000,
    "Pipa AC Hoda 3PK": 260000,
    "Kabel Eterna 3x1,5": 25000,
    "Kabel Eterna 3x2,5": 35000,
    "Duct Tape Non Lem": 20000,
    "Duct Tape Lem": 20000,
    "Breket Outdoor": 75000,
    "DINABOLT Set": 20000,
    "KARET MOUNTING": 15000,
  },
  "Repair": {
    "Biaya Pengecekan AC": 100000,
    "Perbaikan Hermaplex": 150000,
    "Jasa Pemasangan Sparepart": 250000,
    "Perbaikan PCB/Elektrik": 250000,
    "Pergantian Kapasitor Fan Indoor": 250000,
    "Pergantian Sensor Indoor": 250000,
    "Pergantian Overload Outdoor": 300000,
    "Jasa Pemasangan Sparepart Daikin": 330000,
    "Kapasitor AC 0.5-1.5PK": 350000,
    "Pergantian Kapasitor Outdoor 1PK": 350000,
    "Pergantian Modul Indoor Standart": 400000,
    "Kapasitor AC 2-2.5PK": 450000,
    "Pergantian Kapasitor Outdoor 1,5-2,5PK": 450000,
    "Test Press Unit": 450000,
    "Jasa Pemasangan Kompresor": 500000,
    "Pergantian Modul Indoor Inverter": 500000,
    "Kuras Vacum + Isi Freon R32/R410": 600000,
    "Kuras Vacum Freon R22": 600000,
    "default": 100000,
  },
  "Complain": {
    "Garansi Servis (gratis)": 0,
    "Komplain AC Tidak Dingin": 0,
    "Komplain Bising/Berisik": 0,
    "Komplain Bocor Air": 0,
    "Komplain Garansi": 0,
    "Komplain Setelah Servis": 0,
    "Pengecekan AC Gratis": 0,
    "Pengecekan Ulang": 0,
    "default": 0,
  },
  "Maintenance": {
    "Perawatan AC Preventif 0,5PK - 1PK": 150000,
    "Perawatan AC Preventif 1,5PK - 2,5PK": 200000,
    "Perawatan AC Musiman": 200000,
    "Pemeriksaan Berkala AC": 100000,
    "Pembersihan Filter AC": 50000,
    "Penggantian Filter AC": 100000,
    "Lubrikasi Kompresor": 250000,
    "default": 150000,
  },
  "freon_R22": 450000,
  "freon_R410A": 450000,
  "freon_R32": 450000,
};

// "1.5 PK" / "2,5PK" → numeric. Default 1 PK.
export const tipeToPkNumber = (tipe) => {
  if (!tipe) return 1;
  const m = String(tipe).match(/([\d.,]+)\s*PK/i);
  if (!m) return 1;
  const num = parseFloat(m[1].replace(",", "."));
  return isNaN(num) ? 1 : num;
};

// Mapping tipe AC → bracket PK di PRICE_LIST. Return null kalau service tak dikenal.
export const getBracketKey = (service, tipe) => {
  const pk = tipeToPkNumber(tipe);
  const t = String(tipe || "").toLowerCase();
  const isCassette = t.includes("cassette");
  const isDuct = t.includes("duct") || t.includes("standing");

  if (service === "Cleaning") {
    if (isCassette) {
      if (pk <= 2.5) return "AC Cassette 2-2.5PK";
      if (pk <= 3) return "AC Cassette 3PK";
      if (pk <= 4) return "AC Cassette 4PK";
      if (pk <= 5) return "AC Cassette 5PK";
      return "AC Cassette 6PK";
    }
    if (isDuct) return "AC Split Duct";
    if (pk <= 1) return "AC Split 0.5-1PK";
    if (pk <= 2.5) return "AC Split 1.5-2.5PK";
    return "AC Split 1.5-2.5PK";
  }
  if (service === "Install") {
    if (pk <= 1) return "Pemasangan AC Baru 0,5PK - 1PK";
    if (pk <= 2) return "Pemasangan AC Baru 1,5PK - 2PK";
    return "Pasang AC Split 3PK";
  }
  if (service === "Maintenance") {
    if (pk <= 1) return "Perawatan AC Preventif 0,5PK - 1PK";
    return "Perawatan AC Preventif 1,5PK - 2,5PK";
  }
  return null;
};

// Harga per unit. Prioritas: priceListData DB row active → priceFallback → hardcode 85k.
export const hargaPerUnitFromTipe = (service, tipe, priceListData = [], priceFallback = PRICE_LIST_DEFAULT) => {
  const bracket = getBracketKey(service, tipe);
  if (!bracket) return 0;
  const dbRow = priceListData.find(r =>
    r.is_active !== false && r.service === service && r.type === bracket);
  if (dbRow && dbRow.price > 0) return Number(dbRow.price);
  return priceFallback[service]?.[bracket] || priceFallback[service]?.default || 85000;
};

// Total labor dari array units.
export const hitungLaborFromUnits = (service, units, priceListData = [], priceFallback = PRICE_LIST_DEFAULT) => {
  if (!Array.isArray(units) || units.length === 0) return 0;
  return units.reduce((sum, u) => sum + hargaPerUnitFromTipe(service, u.tipe, priceListData, priceFallback), 0);
};

// Bangun PRICE_LIST shape dari rows DB. Menggantikan duplikasi loader.
// Normalisasi: service/type di-trim. Freon diidentifikasi via notes atau service name.
export const buildPriceListFromDB = (rows, baseDefault = PRICE_LIST_DEFAULT) => {
  const pl = Object.fromEntries(
    Object.entries(baseDefault).map(([k, v]) =>
      [k, v && typeof v === "object" ? { ...v } : v]
    )
  );
  const active = rows.filter(r => r.is_active !== false);
  active.forEach(row => {
    const price = Number(row.price) || 0;
    const notes = (row.notes || "").trim().toLowerCase();
    const svc = (row.service || "").trim();
    const type = (row.type || "").trim();

    if (notes === "freon_r22") { pl["freon_R22"] = price; return; }
    if (notes === "freon_r410a" || notes === "freon_r410") { pl["freon_R410A"] = price; return; }
    if (notes === "freon_r32") { pl["freon_R32"] = price; return; }

    if (svc.toLowerCase().includes("freon")) {
      if (svc.toLowerCase().includes("r22")) { pl["freon_R22"] = price; return; }
      if (svc.toLowerCase().includes("r32")) { pl["freon_R32"] = price; return; }
      if (svc.toLowerCase().includes("r410")) { pl["freon_R410A"] = price; return; }
    }

    if (svc) {
      if (!pl[svc]) pl[svc] = {};
      if (type) pl[svc][type] = price;
    }
  });
  return pl;
};
