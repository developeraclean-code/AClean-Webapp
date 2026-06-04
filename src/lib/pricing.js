// Price list default — hanya daftar nama item (skeleton), harga semua 0.
// Harga live selalu dari Supabase price_list via buildPriceListFromDB().
// Jika item tidak ada di DB, harga = 0 (tidak ada fallback hardcode).
export const PRICE_LIST_DEFAULT = {
  "Cleaning": {
    "AC Split 0.5-1PK": 0,
    "AC Split 1.5-2.5PK": 0,
    "AC Cassette 2-2.5PK": 0,
    "AC Cassette 3PK": 0,
    "AC Cassette 4PK": 0,
    "AC Cassette 5PK": 0,
    "AC Cassette 6PK": 0,
    "AC Floor Standing 2-2.5PK": 0,
    "AC Floor Standing 3PK": 0,
    "AC Floor Standing 4PK": 0,
    "AC Floor Standing 5PK": 0,
    "AC Standing": 0,
    "AC Split Duct 2PK": 0,
    "AC Split Duct 2.5PK": 0,
    "AC Split Duct 3PK": 0,
    "AC Split Duct 3.5PK": 0,
    "AC Split Duct 4PK": 0,
    "AC Split Duct 5PK": 0,
    "AC Split Duct 6PK": 0,
    "Jasa Service Besar 0,5PK - 1PK": 0,
    "Jasa Service Besar 1,5PK - 2,5PK": 0,
    "default": 0,
  },
  "Install": {
    "Jasa Pergantian Instalasi AC": 0,
    "Pemasangan AC Baru 0,5PK - 1PK": 0,
    "Pemasangan AC Baru 1,5PK - 2PK": 0,
    "Pasang AC Split 3PK": 0,
    "Bongkar Pasang AC Split 1/2 - 1PK": 0,
    "Bongkar Pasang AC Split 1,5 - 2,5PK": 0,
    "Jasa Bongkar Unit AC 0,5PK - 1PK": 0,
    "Jasa Bongkar Unit AC 1,5PK - 2,5PK": 0,
    "Jasa Bongkar Pasang Indoor": 0,
    "Jasa Bongkar Pasang Outdoor": 0,
    "Jasa Vacum AC 0,5PK - 2,5PK": 0,
    "Jasa Vacum Unit AC >3PK": 0,
    "Jasa Penarikan Pipa AC": 0,
    "Jasa Penarikan Pipa Ruko": 0,
    "Pasang AC Cassette": 0,
    "Pasang AC Floor Standing": 0,
    "Pasang AC Standing": 0,
    "Pemasangan AC Baru Apartemen": 0,
    "Jasa Instalasi Pipa AC": 0,
    "Jasa Instalasi Listrik": 0,
    "Flaring Pipa": 0,
    "Flushing Pipa": 0,
    "Jasa Bobok Tembok": 0,
    "Jasa Pengelasan Pipa AC": 0,
    "Jasa Pembuatan Saluran Pembuangan": 0,
    "default": 0,
    "Pipa AC Hoda 1PK": 0,
    "Pipa AC Hoda 1,5PK": 0,
    "Pipa AC Hoda 2PK": 0,
    "Pipa AC Hoda 2,5PK": 0,
    "Pipa AC Hoda 3PK": 0,
    "Kabel Listrik 3x1,5": 0,
    "Kabel Listrik 3x2,5": 0,
    "Duct Tape Non Lem": 0,
    "Duct Tape Lem": 0,
    "Breket Outdoor Inc Dinabolt": 0,
    "DINABOLT Set": 0,
    "KARET MOUNTING": 0,
  },
  "Repair": {
    "Biaya Pengecekan AC": 0,
    "Perbaikan Hermaplex": 0,
    "Jasa Pemasangan Sparepart": 0,
    "Perbaikan PCB/Elektrik": 0,
    "Pergantian Kapasitor Fan Indoor": 0,
    "Pergantian Sensor Indoor": 0,
    "Pergantian Overload Outdoor": 0,
    "Jasa Pemasangan Sparepart Daikin": 0,
    "Kapasitor AC 0.5-1.5PK": 0,
    "Pergantian Kapasitor Outdoor 1PK": 0,
    "Pergantian Modul Indoor Standart": 0,
    "Kapasitor AC 2-2.5PK": 0,
    "Pergantian Kapasitor Outdoor 1,5-2,5PK": 0,
    "Test Press Unit": 0,
    "Jasa Pemasangan Kompresor": 0,
    "Pergantian Modul Indoor Inverter": 0,
    "Kuras Vacum + Isi Freon R32/R410": 0,
    "Kuras Vacum Freon R22": 0,
    "default": 0,
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
    "Perawatan AC Preventif 0,5PK - 1PK": 0,
    "Perawatan AC Preventif 1,5PK - 2,5PK": 0,
    "Perawatan AC Musiman": 0,
    "Pemeriksaan Berkala AC": 0,
    "Pembersihan Filter AC": 0,
    "Penggantian Filter AC": 0,
    "Lubrikasi Kompresor": 0,
    "default": 0,
  },
  "freon_R22": 0,
  "freon_R410A": 0,
  "freon_R32": 0,
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
  const isFloorStanding = t.includes("floor standing");
  const isDuct = t.includes("duct") || (t.includes("standing") && !isFloorStanding);

  if (service === "Cleaning") {
    if (isFloorStanding) {
      if (pk <= 2.5) return "AC Floor Standing 2-2.5PK";
      if (pk <= 3) return "AC Floor Standing 3PK";
      if (pk <= 4) return "AC Floor Standing 4PK";
      return "AC Floor Standing 5PK";
    }
    if (isCassette) {
      if (pk <= 2.5) return "AC Cassette 2-2.5PK";
      if (pk <= 3) return "AC Cassette 3PK";
      if (pk <= 4) return "AC Cassette 4PK";
      if (pk <= 5) return "AC Cassette 5PK";
      return "AC Cassette 6PK";
    }
    if (isDuct) {
      if (pk <= 2) return "AC Split Duct 2PK";
      if (pk <= 2.5) return "AC Split Duct 2.5PK";
      if (pk <= 3) return "AC Split Duct 3PK";
      if (pk <= 3.5) return "AC Split Duct 3.5PK";
      if (pk <= 4) return "AC Split Duct 4PK";
      if (pk <= 5) return "AC Split Duct 5PK";
      return "AC Split Duct 6PK";
    }
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

// Harga per unit. Prioritas: priceListData DB row active → priceFallback (jika > 0) → 0.
export const hargaPerUnitFromTipe = (service, tipe, priceListData = [], priceFallback = PRICE_LIST_DEFAULT) => {
  const bracket = getBracketKey(service, tipe);
  if (!bracket) return 0;
  const dbRow = priceListData.find(r =>
    r.is_active !== false && r.service === service && r.type === bracket);
  if (dbRow && dbRow.price > 0) return Number(dbRow.price);
  const fallback = priceFallback[service]?.[bracket] ?? priceFallback[service]?.default ?? 0;
  return fallback;
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
