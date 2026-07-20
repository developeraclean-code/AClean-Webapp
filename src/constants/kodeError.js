// Referensi kode error AC per brand — dipakai menu "Kode Error" (semua role).
// Data statis (bukan dari Supabase). Dikompilasi & di-cross-check via riset web
// (situs resmi brand, forum teknisi HVAC, blog teknisi AC Indonesia) untuk unit
// split/inverter residential & light-commercial yang umum di Indonesia.
//
// PENTING: kode & pola bisa BERBEDA antar seri/model dalam 1 brand yang sama
// (mis. Midea/Sharp punya konvensi berbeda antara seri lama vs inverter baru).
// Selalu cross-check ke manual servis resmi unit ybs untuk kasus kritis.
//
// Struktur tiap kode: { kode, keterangan, cek_kendala: [...], kemungkinan_kerusakan: [...] }

export const KODE_ERROR_BRANDS = [
  { key: "daikin", label: "Daikin", icon: "❄️" },
  { key: "gree", label: "Gree", icon: "🌀" },
  { key: "panasonic", label: "Panasonic", icon: "🔷" },
  { key: "midea", label: "Midea", icon: "🔶" },
  { key: "sharp", label: "Sharp", icon: "⚡" },
];

export const KODE_ERROR_DATA = {
  daikin: [
    {
      kode: "A1",
      keterangan: "Malfungsi PCB indoor unit (papan kontrol indoor rusak).",
      cek_kendala: ["Cek tegangan supply ke PCB indoor", "Reset power unit 5-10 menit lalu nyalakan ulang", "Cek fisik PCB — bekas terbakar/korosi/kelembaban"],
      kemungkinan_kerusakan: ["PCB indoor rusak — perlu ganti", "Kerusakan akibat surge/tegangan tidak stabil", "Konektor PCB kendor"],
    },
    {
      kode: "A3",
      keterangan: "Sistem drain bermasalah (drain pan penuh / pompa drain / float switch).",
      cek_kendala: ["Cek pompa drain (kalau ada) menyala normal", "Cek saluran pembuangan tidak tersumbat/mampet", "Cek posisi float switch drain pan"],
      kemungkinan_kerusakan: ["Drain pan penuh/tersumbat lendir", "Pompa drain rusak/macet", "Float switch rusak/kotor"],
    },
    {
      kode: "A5",
      keterangan: "Proteksi tekanan tinggi (heating) / anti-freeze evaporator (cooling) aktif.",
      cek_kendala: ["Cek filter & evaporator indoor tidak kotor/tersumbat", "Cek aliran udara indoor lancar (blower normal)", "Cek thermistor pipa indoor & tekanan freon"],
      kemungkinan_kerusakan: ["Filter/evaporator kotor menghambat udara", "Freon kurang bikin pipa terlalu dingin lokal", "Thermistor pipa indoor rusak/salah baca"],
    },
    {
      kode: "A6",
      keterangan: "Malfungsi motor fan indoor (macet/overload/putus jalur).",
      cek_kendala: ["Cek putaran fan indoor manual (matikan unit dulu)", "Cek capacitor fan (kalau motor AC/non-DC)", "Cek kabel & konektor motor fan"],
      kemungkinan_kerusakan: ["Motor fan indoor aus/macet", "Capacitor fan lemah/rusak", "Bearing motor kering/aus"],
    },
    {
      kode: "A9",
      keterangan: "Malfungsi electronic expansion valve (EEV).",
      cek_kendala: ["Cek kabel & konektor EEV ke PCB", "Cek fisik valve — macet/kotor", "Cek sinyal drive EEV dari PCB"],
      kemungkinan_kerusakan: ["EEV coil rusak/putus", "Valve macet karena kotoran/karat", "PCB driver EEV rusak"],
    },
    {
      kode: "C4",
      keterangan: "Malfungsi thermistor pipa liquid heat exchanger indoor.",
      cek_kendala: ["Cek posisi thermistor menempel benar di pipa", "Ukur resistansi thermistor vs tabel spek", "Cek kabel thermistor tidak putus/kendor"],
      kemungkinan_kerusakan: ["Thermistor rusak/nilai resistansi melenceng", "Kabel thermistor putus/korosi", "Konektor thermistor kendor"],
    },
    {
      kode: "C9",
      keterangan: "Malfungsi thermistor suhu udara hisap (suction air) indoor.",
      cek_kendala: ["Cek posisi sensor tidak terhalang benda lain", "Ukur resistansi thermistor vs tabel spek", "Cek kabel & konektor sensor"],
      kemungkinan_kerusakan: ["Thermistor suction air rusak", "Kabel sensor putus/korosi", "PCB gagal baca sinyal sensor"],
    },
    {
      kode: "E1",
      keterangan: "Malfungsi PCB outdoor unit.",
      cek_kendala: ["Cek tegangan supply ke PCB outdoor", "Cek fisik PCB — bekas terbakar/korosi", "Cek konektor-konektor PCB terpasang benar"],
      kemungkinan_kerusakan: ["PCB outdoor rusak — perlu ganti", "Kerusakan akibat surge/petir", "Kelembaban masuk ke box elektrik outdoor"],
    },
    {
      kode: "E3",
      keterangan: "Proteksi tekanan tinggi refrigerant aktif (high pressure switch trip).",
      cek_kendala: ["Cek kondensor outdoor kotor/tersumbat debu", "Cek kipas outdoor berputar normal", "Cek tekanan freon tidak overcharge"],
      kemungkinan_kerusakan: ["Kondensor outdoor kotor menghambat pembuangan panas", "Kipas outdoor rusak/lambat", "Freon overcharge/kelebihan"],
    },
    {
      kode: "E4",
      keterangan: "Proteksi tekanan rendah refrigerant aktif (low pressure switch trip).",
      cek_kendala: ["Cek kebocoran freon di sambungan pipa", "Cek filter/evaporator indoor tidak tersumbat", "Cek valve service terbuka penuh"],
      kemungkinan_kerusakan: ["Freon kurang/bocor", "Evaporator/filter indoor buntu", "Low pressure sensor/switch rusak"],
    },
    {
      kode: "E5",
      keterangan: "Proteksi overload/lock kompresor inverter (kompresor kepanasan/terkunci).",
      cek_kendala: ["Cek arus kompresor vs nameplate (ampere meter)", "Cek pendinginan area outdoor tidak terhalang", "Cek freon tidak kurang (indikasi kerja berat)"],
      kemungkinan_kerusakan: ["Kompresor overheat/lock", "Freon kurang bikin kompresor kerja berat", "Inverter PCB rusak / koneksi UVW salah"],
    },
    {
      kode: "E6",
      keterangan: "Kompresor gagal start / lock rotor terdeteksi.",
      cek_kendala: ["Cek tegangan supply saat start (drop tegangan?)", "Cek arus start kompresor", "Cek koneksi kabel UVW ke kompresor"],
      kemungkinan_kerusakan: ["Kompresor macet/lock secara mekanis", "Tegangan supply tidak stabil saat start", "Inverter PCB bermasalah"],
    },
    {
      kode: "E7",
      keterangan: "Malfungsi/lock motor fan outdoor (overload).",
      cek_kendala: ["Cek putaran fan outdoor manual (matikan unit dulu)", "Cek kabel & konektor motor fan outdoor", "Cek ada benda menghalangi fan (daun, kotoran)"],
      kemungkinan_kerusakan: ["Motor fan outdoor rusak/macet", "Bearing fan aus", "Benda asing menghalangi kipas"],
    },
    {
      kode: "F3",
      keterangan: "Suhu pipa discharge kompresor terlalu tinggi.",
      cek_kendala: ["Cek freon sesuai takaran (kurang bikin suhu discharge naik)", "Cek kondensor outdoor bersih & kipas normal", "Cek thermistor discharge terpasang benar"],
      kemungkinan_kerusakan: ["Freon kurang", "Kondensor kotor/kipas outdoor lemah", "Kompresor mulai aus"],
    },
    {
      kode: "H9",
      keterangan: "Malfungsi thermistor suhu udara luar (outdoor ambient sensor).",
      cek_kendala: ["Ukur resistansi thermistor ambient vs tabel spek", "Cek posisi sensor tidak kena panas langsung/hujan", "Cek kabel & konektor sensor"],
      kemungkinan_kerusakan: ["Thermistor ambient rusak/short", "Kabel sensor putus/korosi", "Konektor kendor"],
    },
    {
      kode: "J3",
      keterangan: "Malfungsi thermistor pipa discharge kompresor.",
      cek_kendala: ["Cek posisi thermistor menempel di pipa discharge", "Ukur resistansi vs tabel spek", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Thermistor discharge rusak", "Kabel sensor putus", "Sensor lepas dari dudukan"],
    },
    {
      kode: "L5",
      keterangan: "Proteksi arus lebih inverter (kompresor/inverter PCB overload).",
      cek_kendala: ["Cek kompresor tidak short/ground fault (megger test)", "Cek modul inverter tidak overheat (heatsink & pasta thermal)", "Cek kabel power ke kompresor"],
      kemungkinan_kerusakan: ["Inverter PCB / modul daya rusak — perlu ganti", "Kompresor short/ground fault membebani inverter", "Overheat karena heatsink kotor/pasta kering"],
    },
    {
      kode: "U0",
      keterangan: "Indikasi kekurangan refrigerant (freon kurang dari kebutuhan sistem).",
      cek_kendala: ["Cek kebocoran di semua sambungan flare/las", "Cek tekanan freon saat running", "Vacuum & isi ulang freon sesuai spek kalau memang kurang"],
      kemungkinan_kerusakan: ["Kebocoran freon di pipa/sambungan", "Undercharge saat instalasi awal", "Kebocoran di evaporator/kondensor"],
    },
    {
      kode: "U2",
      keterangan: "Tegangan supply tidak normal (over/under voltage) atau DC bus abnormal.",
      cek_kendala: ["Ukur tegangan supply saat unit running", "Cek kabel power tidak longgar (voltage drop)", "Cek kapasitor DC bus di inverter PCB"],
      kemungkinan_kerusakan: ["Tegangan PLN tidak stabil", "Kabel power kendor/rugi tegangan", "Kapasitor/inverter PCB bermasalah"],
    },
    {
      kode: "U4",
      keterangan: "Malfungsi transmisi/komunikasi antara indoor dan outdoor unit (error paling umum).",
      cek_kendala: ["Cek kabel signal indoor-outdoor tidak putus/kendor", "Cek konektor di kedua PCB", "Cek kabel signal tidak berdempet kabel power (interferensi)"],
      kemungkinan_kerusakan: ["Kabel signal putus/kendor", "PCB indoor atau outdoor rusak di bagian komunikasi", "Interferensi elektromagnetik dari kabel power"],
    },
  ],

  gree: [
    {
      kode: "E1",
      keterangan: "Proteksi tekanan tinggi refrigerant aktif (high pressure protection).",
      cek_kendala: ["Cek kondensor outdoor kotor/tersumbat", "Cek kipas outdoor berputar normal", "Cek freon tidak overcharge"],
      kemungkinan_kerusakan: ["Kondensor kotor menghambat pembuangan panas", "Kipas outdoor lemah/rusak", "Freon kelebihan takaran"],
    },
    {
      kode: "E2",
      keterangan: "Proteksi anti-freeze evaporator indoor (pipa indoor membeku).",
      cek_kendala: ["Cek filter indoor tidak kotor/tersumbat", "Cek aliran udara indoor tidak terhambat", "Cek freon tidak kurang"],
      kemungkinan_kerusakan: ["Filter/evaporator kotor menghambat udara", "Freon kurang bikin pipa terlalu dingin lokal", "Fan indoor lemah/kotor"],
    },
    {
      kode: "E3",
      keterangan: "Proteksi tekanan rendah refrigerant aktif (low pressure protection).",
      cek_kendala: ["Cek kebocoran freon di sambungan pipa", "Cek valve service terbuka penuh", "Cek filter/dryer tidak tersumbat"],
      kemungkinan_kerusakan: ["Freon kurang/bocor", "Valve service tertutup sebagian", "Filter dryer buntu"],
    },
    {
      kode: "E4",
      keterangan: "Proteksi suhu discharge kompresor terlalu tinggi.",
      cek_kendala: ["Cek freon sesuai takaran", "Cek kondensor outdoor bersih & kipas normal", "Cek sensor discharge"],
      kemungkinan_kerusakan: ["Freon kurang", "Kondensor kotor/kipas lemah", "Kompresor mulai aus"],
    },
    {
      kode: "E5",
      keterangan: "Proteksi arus lebih (overcurrent) — sering akibat tegangan tidak stabil.",
      cek_kendala: ["Ukur tegangan supply saat running (drop/spike?)", "Ukur arus kompresor vs nameplate", "Cek freon tidak overcharge (beban berat)"],
      kemungkinan_kerusakan: ["Tegangan supply drop/tidak stabil", "Kompresor mulai aus/short sebagian", "Freon overcharge"],
    },
    {
      kode: "E6",
      keterangan: "Malfungsi komunikasi indoor-outdoor (error Gree paling umum).",
      cek_kendala: ["Cek kabel signal 3-wire indoor-outdoor", "Cek konektor di kedua PCB", "Cek kabel signal tidak berdempet kabel power"],
      kemungkinan_kerusakan: ["Kabel signal putus/kendor", "PCB indoor/outdoor rusak di bagian komunikasi", "Interferensi elektromagnetik"],
    },
    {
      kode: "EE",
      keterangan: "Malfungsi EEPROM/memori pada PCB (control board).",
      cek_kendala: ["Reset power unit 5-10 menit lalu nyalakan ulang", "Cek tegangan supply ke PCB stabil", "Cek fisik PCB — bekas terbakar/korosi"],
      kemungkinan_kerusakan: ["EEPROM corrupt akibat surge listrik", "PCB rusak — perlu ganti", "Kelembaban masuk ke box elektrik"],
    },
    {
      kode: "F0",
      keterangan: "Deteksi kekurangan refrigerant / mode recovery freon.",
      cek_kendala: ["Cek kebocoran freon di semua sambungan", "Cek tekanan freon saat running", "Vacuum & isi ulang sesuai spek kalau memang kurang"],
      kemungkinan_kerusakan: ["Freon kurang/bocor", "Undercharge saat instalasi awal", "Sensor tekanan salah baca"],
    },
    {
      kode: "F1",
      keterangan: "Malfungsi sensor suhu indoor (ambient/pipa evaporator — bisa beda per seri).",
      cek_kendala: ["Ukur resistansi sensor vs tabel spek", "Cek posisi sensor tidak terhalang/menempel benar", "Cek kabel & konektor sensor"],
      kemungkinan_kerusakan: ["Sensor indoor rusak", "Kabel sensor putus/korosi", "Konektor kendor"],
    },
    {
      kode: "F2",
      keterangan: "Malfungsi sensor pipa kondensor (coil) outdoor.",
      cek_kendala: ["Cek posisi sensor menempel pipa kondensor", "Ukur resistansi vs tabel spek", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor coil outdoor rusak", "Kabel sensor putus", "Sensor lepas dari dudukan pipa"],
    },
    {
      kode: "F3",
      keterangan: "Malfungsi sensor suhu ambient outdoor.",
      cek_kendala: ["Ukur resistansi sensor ambient vs tabel spek", "Cek posisi sensor tidak kena panas langsung", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor ambient outdoor rusak", "Kabel sensor putus/korosi", "Konektor kendor"],
    },
    {
      kode: "F4",
      keterangan: "Malfungsi sensor suhu discharge kompresor.",
      cek_kendala: ["Cek posisi sensor menempel pipa discharge", "Ukur resistansi vs tabel spek", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor discharge rusak", "Kabel sensor putus", "Sensor lepas dari pipa"],
    },
    {
      kode: "C5",
      keterangan: "Malfungsi jumper cap / konfigurasi sistem (jumper cap salah/tidak terpasang).",
      cek_kendala: ["Cek jumper cap terpasang di PCB indoor", "Kalau baru ganti PCB — pindahkan jumper dari PCB lama", "Cek jumper cap tidak rusak/salah tipe"],
      kemungkinan_kerusakan: ["Jumper cap hilang/tidak terpasang", "Jumper cap salah/rusak", "PCB salah konfigurasi kapasitas"],
    },
    {
      kode: "H3",
      keterangan: "Proteksi overload kompresor (thermal overload aktif).",
      cek_kendala: ["Ukur arus kompresor vs nameplate", "Cek pendinginan area outdoor tidak terhalang", "Cek freon tidak kurang"],
      kemungkinan_kerusakan: ["Kompresor overheat karena beban lebih", "Freon kurang bikin kompresor kerja berat", "Overload protector lemah"],
    },
    {
      kode: "H5",
      keterangan: "Proteksi modul IPM inverter (overcurrent/short pada modul daya).",
      cek_kendala: ["Cek kompresor tidak short/ground fault (megger test)", "Cek modul IPM & heatsink tidak overheat", "Cek kabel power ke kompresor"],
      kemungkinan_kerusakan: ["Modul IPM rusak — perlu ganti PCB inverter", "Kompresor short merusak modul", "Overheat karena heatsink kotor/pasta kering"],
    },
    {
      kode: "H6",
      keterangan: "Tidak ada feedback motor fan indoor (fan terblokir/tidak berputar).",
      cek_kendala: ["Cek putaran fan indoor manual (matikan unit dulu)", "Cek kabel feedback motor ke PCB", "Cek konektor motor fan"],
      kemungkinan_kerusakan: ["Motor fan indoor rusak/macet", "Kabel feedback putus/kendor", "PCB gagal baca sinyal feedback"],
    },
    {
      kode: "P4",
      keterangan: "Proteksi suhu modul IPM inverter terlalu tinggi (unit stop sampai dingin).",
      cek_kendala: ["Cek heatsink modul IPM bersih & pasta thermal masih baik", "Cek kipas outdoor bekerja normal (pendinginan modul)", "Cek beban kompresor tidak berlebihan"],
      kemungkinan_kerusakan: ["Heatsink kotor/pasta thermal kering", "Kipas outdoor lemah", "Modul IPM mulai aus"],
    },
  ],

  panasonic: [
    {
      kode: "H11",
      keterangan: "Komunikasi antara indoor dan outdoor unit abnormal/terputus.",
      cek_kendala: ["Cek kabel signal indoor-outdoor tidak putus/kendor", "Cek konektor di kedua PCB", "Cek kabel signal tidak berdempet kabel power"],
      kemungkinan_kerusakan: ["Kabel signal putus/kendor", "PCB indoor atau outdoor rusak", "Interferensi elektromagnetik"],
    },
    {
      kode: "H12",
      keterangan: "Kombinasi kapasitas indoor dan outdoor tidak sesuai (mismatch).",
      cek_kendala: ["Cek model indoor & outdoor sesuai pasangan resmi", "Cek setting kapasitas di PCB (kalau ada)", "Cek riwayat penggantian unit sebelumnya"],
      kemungkinan_kerusakan: ["Indoor/outdoor tertukar pasangan (bukan 1 set asli)", "Setting kapasitas di PCB salah", "PCB salah kirim data model"],
    },
    {
      kode: "H14",
      keterangan: "Malfungsi sensor suhu udara masuk (room temperature sensor) indoor.",
      cek_kendala: ["Ukur resistansi sensor vs tabel spek", "Cek posisi sensor tidak terhalang", "Cek kabel & konektor sensor"],
      kemungkinan_kerusakan: ["Sensor room temp rusak", "Kabel sensor putus/korosi", "Konektor kendor"],
    },
    {
      kode: "H15",
      keterangan: "Malfungsi sensor suhu kompresor (compressor temperature sensor).",
      cek_kendala: ["Cek posisi sensor menempel body/pipa kompresor", "Ukur resistansi vs tabel spek", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor kompresor rusak", "Kabel sensor putus", "Sensor lepas dari dudukan"],
    },
    {
      kode: "H16",
      keterangan: "Arus kompresor terlalu rendah terdeteksi CT (indikasi freon kurang / trafo arus).",
      cek_kendala: ["Cek tekanan/isi freon sesuai spek", "Cek posisi CT sensor terpasang benar di kabel kompresor", "Ukur arus aktual kompresor dengan clamp meter"],
      kemungkinan_kerusakan: ["Freon kurang bikin arus rendah", "CT sensor / rangkaian deteksi arus rusak", "Kompresor tidak bekerja normal"],
    },
    {
      kode: "H17",
      keterangan: "Malfungsi sensor pipa suction (isap) outdoor.",
      cek_kendala: ["Cek posisi sensor menempel pipa suction", "Ukur resistansi vs tabel spek", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor suction rusak", "Kabel sensor putus", "Sensor lepas dari pipa"],
    },
    {
      kode: "H19",
      keterangan: "Motor fan indoor macet/terkunci (lock detection).",
      cek_kendala: ["Cek putaran fan indoor manual (matikan unit dulu)", "Cek ada benda menghalangi blower", "Cek capacitor fan (kalau motor AC/non-DC)"],
      kemungkinan_kerusakan: ["Motor fan indoor macet/aus", "Bearing motor kering", "Blower terhalang kotoran/benda asing"],
    },
    {
      kode: "H23",
      keterangan: "Malfungsi sensor pipa evaporator (indoor heat exchanger sensor).",
      cek_kendala: ["Cek posisi sensor menempel pipa evaporator", "Ukur resistansi vs tabel spek", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor pipa indoor rusak", "Kabel sensor putus", "Sensor lepas dari dudukan"],
    },
    {
      kode: "H27",
      keterangan: "Malfungsi sensor suhu udara luar (outdoor air/ambient sensor).",
      cek_kendala: ["Ukur resistansi sensor ambient vs tabel spek", "Cek posisi sensor tidak kena panas langsung", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor ambient outdoor rusak", "Kabel sensor putus/korosi", "Konektor kendor"],
    },
    {
      kode: "H28",
      keterangan: "Malfungsi sensor pipa outdoor (outdoor heat exchanger/pipe sensor).",
      cek_kendala: ["Cek posisi sensor menempel pipa kondensor outdoor", "Ukur resistansi vs tabel spek", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor pipa outdoor rusak", "Kabel sensor putus", "Sensor lepas dari pipa"],
    },
    {
      kode: "H33",
      keterangan: "Koneksi/tegangan indoor-outdoor tidak sesuai (incorrect linking voltage).",
      cek_kendala: ["Cek kabel signal & power terpasang benar (tidak terbalik)", "Cek tegangan supply indoor & outdoor sesuai spek", "Cek versi/tipe PCB indoor & outdoor kompatibel"],
      kemungkinan_kerusakan: ["Kabel salah pasang/terbalik", "PCB tidak kompatibel (beda seri)", "Tegangan supply salah/tidak sesuai"],
    },
    {
      kode: "H97",
      keterangan: "Motor fan outdoor (DC motor) macet/terkunci.",
      cek_kendala: ["Cek putaran fan outdoor manual (matikan unit dulu)", "Cek kabel & konektor motor fan outdoor", "Cek ada benda menghalangi fan (daun, kotoran)"],
      kemungkinan_kerusakan: ["Motor fan outdoor DC rusak/macet", "Bearing fan aus", "Benda asing menghalangi kipas"],
    },
    {
      kode: "H98",
      keterangan: "Proteksi tekanan tinggi indoor (high pressure protection).",
      cek_kendala: ["Cek filter & evaporator indoor tidak tersumbat", "Cek aliran udara indoor lancar", "Cek freon tidak overcharge"],
      kemungkinan_kerusakan: ["Filter/evaporator indoor kotor", "Freon overcharge", "Fan indoor lemah"],
    },
    {
      kode: "H99",
      keterangan: "Proteksi anti-freeze evaporator indoor (freeze prevention aktif).",
      cek_kendala: ["Bersihkan filter indoor yang tersumbat", "Cek aliran udara indoor tidak terhambat", "Cek freon tidak kurang"],
      kemungkinan_kerusakan: ["Filter/evaporator indoor kotor", "Freon kurang bikin pipa membeku", "Fan indoor lemah/kotor"],
    },
    {
      kode: "F90",
      keterangan: "Malfungsi rangkaian PFC / modul inverter (power factor correction).",
      cek_kendala: ["Cek tegangan supply stabil", "Cek modul inverter & heatsink tidak overheat", "Cek kompresor tidak short/ground fault"],
      kemungkinan_kerusakan: ["Modul inverter/PFC rusak — perlu ganti PCB", "Kompresor short merusak modul", "Tegangan supply tidak stabil"],
    },
    {
      kode: "F91",
      keterangan: "Siklus refrigerant abnormal (indikasi freon kurang/bocor).",
      cek_kendala: ["Cek kebocoran freon di sambungan pipa", "Cek tekanan freon saat running", "Cek valve service terbuka penuh"],
      kemungkinan_kerusakan: ["Freon kurang/bocor", "Valve service tertutup sebagian", "Buntu/sumbatan di siklus refrigerant"],
    },
    {
      kode: "F93",
      keterangan: "Putaran kompresor abnormal (kompresor stall/gagal sinkron).",
      cek_kendala: ["Cek tegangan supply stabil saat start", "Cek freon tidak overcharge (beban start berat)", "Cek modul inverter tidak overheat"],
      kemungkinan_kerusakan: ["Kompresor mulai aus/stall", "Tegangan supply tidak stabil", "Modul inverter bermasalah"],
    },
    {
      kode: "F95",
      keterangan: "Proteksi suhu kondensor outdoor terlalu tinggi (overheat coil).",
      cek_kendala: ["Cek kondensor outdoor kotor/tersumbat", "Cek kipas outdoor berputar normal", "Cek area outdoor tidak sempit/panas terkurung"],
      kemungkinan_kerusakan: ["Kondensor kotor menghambat pembuangan panas", "Kipas outdoor lemah/rusak", "Sirkulasi udara outdoor buruk"],
    },
    {
      kode: "F96",
      keterangan: "Proteksi suhu modul IPM / kompresor terlalu tinggi (overheat).",
      cek_kendala: ["Cek heatsink modul bersih & pasta thermal masih baik", "Cek kipas outdoor bekerja normal", "Cek beban kompresor tidak berlebihan"],
      kemungkinan_kerusakan: ["Heatsink kotor/pasta kering", "Kipas outdoor lemah", "Modul IPM / kompresor mulai aus"],
    },
  ],

  midea: [
    {
      kode: "E1",
      keterangan: "Malfungsi komunikasi indoor-outdoor (error Midea mini-split paling umum).",
      cek_kendala: ["Cek kabel signal indoor-outdoor tidak putus/kendor", "Cek konektor di kedua PCB", "Cek kabel signal tidak berdempet kabel power"],
      kemungkinan_kerusakan: ["Kabel signal putus/kendor", "PCB indoor atau outdoor rusak di bagian komunikasi", "Interferensi elektromagnetik"],
    },
    {
      kode: "E2",
      keterangan: "Error deteksi sinyal zero-crossing pada PCB indoor.",
      cek_kendala: ["Cek tegangan supply AC stabil", "Cek fisik PCB indoor — komponen terbakar", "Reset power unit lalu nyalakan ulang"],
      kemungkinan_kerusakan: ["PCB indoor rusak di rangkaian zero-crossing", "Tegangan supply tidak stabil", "Komponen elektronik PCB aus"],
    },
    {
      kode: "E3",
      keterangan: "Kecepatan motor fan indoor tidak terkendali (out of control).",
      cek_kendala: ["Cek putaran fan indoor manual (matikan unit dulu)", "Cek kabel feedback motor ke PCB", "Cek konektor motor fan"],
      kemungkinan_kerusakan: ["Motor fan indoor rusak", "Kabel feedback putus/kendor", "PCB gagal baca/atur kecepatan fan"],
    },
    {
      kode: "E4",
      keterangan: "Malfungsi sensor suhu ruangan indoor (T1 sensor).",
      cek_kendala: ["Ukur resistansi sensor T1 vs tabel spek", "Cek posisi sensor tidak terhalang", "Cek kabel & konektor sensor"],
      kemungkinan_kerusakan: ["Sensor T1 (room temp) rusak", "Kabel sensor putus/korosi", "Konektor kendor"],
    },
    {
      kode: "E5",
      keterangan: "Malfungsi sensor suhu outdoor (open/short sensor T3/T4).",
      cek_kendala: ["Ukur resistansi sensor outdoor vs tabel spek", "Cek posisi sensor menempel benar", "Cek kabel & konektor sensor"],
      kemungkinan_kerusakan: ["Sensor outdoor (T3/T4) rusak/short/open", "Kabel sensor putus/korosi", "Konektor kendor"],
    },
    {
      kode: "E6",
      keterangan: "Malfungsi sensor pipa evaporator indoor (T2 coil sensor).",
      cek_kendala: ["Cek posisi sensor T2 menempel pipa evaporator", "Ukur resistansi vs tabel spek", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor T2 (coil indoor) rusak", "Kabel sensor putus", "Sensor lepas dari dudukan pipa"],
    },
    {
      kode: "EC",
      keterangan: "Deteksi kebocoran refrigerant (refrigerant leakage detection).",
      cek_kendala: ["Cek kebocoran freon di semua sambungan flare/las", "Cek tekanan freon saat running", "Vacuum & isi ulang sesuai spek kalau kurang"],
      kemungkinan_kerusakan: ["Kebocoran freon di pipa/sambungan", "Undercharge saat instalasi awal", "Kebocoran di evaporator/kondensor"],
    },
    {
      kode: "F1",
      keterangan: "Malfungsi sensor pipa kondensor outdoor (T3 sensor).",
      cek_kendala: ["Cek posisi sensor T3 menempel pipa kondensor", "Ukur resistansi vs tabel spek", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor T3 rusak", "Kabel sensor putus", "Sensor lepas dari pipa"],
    },
    {
      kode: "F2",
      keterangan: "Malfungsi sensor suhu ambient outdoor (T4 sensor).",
      cek_kendala: ["Ukur resistansi sensor T4 vs tabel spek", "Cek posisi sensor tidak kena panas langsung", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor T4 (ambient) rusak", "Kabel sensor putus/korosi", "Konektor kendor"],
    },
    {
      kode: "F3",
      keterangan: "Malfungsi sensor suhu discharge kompresor (TP sensor).",
      cek_kendala: ["Cek posisi sensor menempel pipa discharge", "Ukur resistansi vs tabel spek", "Cek kabel sensor"],
      kemungkinan_kerusakan: ["Sensor discharge (TP) rusak", "Kabel sensor putus", "Sensor lepas dari pipa"],
    },
    {
      kode: "P0",
      keterangan: "Malfungsi/proteksi modul IPM (IGBT overcurrent) inverter.",
      cek_kendala: ["Cek kompresor tidak short/ground fault (megger test)", "Cek modul IPM & heatsink tidak overheat", "Cek kabel power ke kompresor"],
      kemungkinan_kerusakan: ["Modul IPM rusak — perlu ganti PCB inverter", "Kompresor short merusak modul", "Overheat karena heatsink kotor"],
    },
    {
      kode: "P1",
      keterangan: "Proteksi tegangan (over-voltage / under-voltage).",
      cek_kendala: ["Ukur tegangan supply saat unit running", "Cek stabilizer/panel listrik rumah", "Cek kabel power tidak longgar (voltage drop)"],
      kemungkinan_kerusakan: ["Tegangan PLN tidak stabil", "Kabel power kendor/rugi tegangan", "Beban listrik rumah berlebihan"],
    },
    {
      kode: "P2",
      keterangan: "Proteksi suhu tinggi modul IPM / puncak kompresor (compressor top).",
      cek_kendala: ["Cek heatsink modul bersih & pasta thermal masih baik", "Cek kipas outdoor bekerja normal", "Cek freon & beban kompresor tidak berlebihan"],
      kemungkinan_kerusakan: ["Heatsink kotor/pasta kering", "Kipas outdoor lemah", "Kompresor overheat / freon bermasalah"],
    },
    {
      kode: "P3",
      keterangan: "Suhu ambient outdoor terlalu rendah untuk operasi (low ambient protection).",
      cek_kendala: ["Cek suhu lingkungan outdoor (memang dingin ekstrem?)", "Cek sensor ambient T4 tidak salah baca", "Tunggu/normalkan kondisi lalu restart"],
      kemungkinan_kerusakan: ["Kondisi ambient memang di bawah batas operasi", "Sensor ambient T4 salah baca", "Setting mode tidak sesuai kondisi"],
    },
    {
      kode: "P4",
      keterangan: "Error drive kompresor inverter (inverter compressor drive error).",
      cek_kendala: ["Cek tegangan supply saat start kompresor", "Cek kompresor tidak macet secara mekanis", "Cek koneksi kabel UVW ke kompresor"],
      kemungkinan_kerusakan: ["Kompresor macet/lock", "Modul driver inverter bermasalah", "Tegangan supply drop saat start"],
    },
    {
      kode: "P5",
      keterangan: "Konflik mode antar indoor pada sistem multi-split (mode conflict).",
      cek_kendala: ["Cek semua indoor pakai mode sama (tidak cooling vs heating bersamaan)", "Samakan mode semua unit indoor", "Cek setting master/slave indoor"],
      kemungkinan_kerusakan: ["Indoor beda mode di sistem multi", "Setting mode antar unit tidak sinkron", "PCB salah baca perintah mode"],
    },
  ],

  sharp: [
    {
      kode: "E1",
      keterangan: "Malfungsi PCB indoor (papan kontrol indoor rusak).",
      cek_kendala: ["Cek fisik PCB indoor — komponen terbakar/meleleh", "Cek tegangan supply ke PCB stabil", "Reset power unit 5-10 menit lalu nyalakan ulang"],
      kemungkinan_kerusakan: ["PCB indoor rusak — perlu ganti", "Kerusakan akibat tegangan tidak stabil/surge", "Komponen elektronik PCB aus"],
    },
    {
      kode: "E5",
      keterangan: "Gangguan pada unit outdoor secara umum (sensor/PCB/kompresor outdoor).",
      cek_kendala: ["Cek LED indikator PCB outdoor berkedip", "Cek sensor-sensor outdoor & koneksinya", "Cek kompresor & kipas outdoor bekerja normal"],
      kemungkinan_kerusakan: ["Sensor outdoor rusak", "PCB outdoor bermasalah", "Kompresor/kipas outdoor bermasalah"],
    },
    {
      kode: "C4",
      keterangan: "Jumper cap salah pasang / konfigurasi kapasitas salah.",
      cek_kendala: ["Cek jumper cap terpasang benar di PCB", "Kalau baru ganti PCB — pindahkan jumper dari PCB lama", "Cek tipe jumper sesuai kapasitas unit"],
      kemungkinan_kerusakan: ["Jumper cap salah pasang/tipe", "PCB salah konfigurasi kapasitas", "Jumper cap rusak"],
    },
    {
      kode: "C5",
      keterangan: "Gagal fungsi bagian jumper cap (jumper hilang/rusak).",
      cek_kendala: ["Cek jumper cap ada & tidak lepas", "Cek jumper cap tidak rusak", "Pasang ulang jumper cap yang benar"],
      kemungkinan_kerusakan: ["Jumper cap hilang/tidak terpasang", "Jumper cap rusak", "Slot jumper di PCB bermasalah"],
    },
    {
      kode: "F1",
      keterangan: "Malfungsi sensor evaporator (indoor coil sensor).",
      cek_kendala: ["Bersihkan sirip evaporator", "Ukur resistansi sensor vs tabel spek", "Cek kabel sensor & reset setelah ganti/kalibrasi"],
      kemungkinan_kerusakan: ["Sensor evaporator rusak", "Kabel sensor putus/korosi", "Sensor lepas dari dudukan pipa"],
    },
    {
      kode: "F2",
      keterangan: "Malfungsi sensor kondensor (outdoor coil sensor).",
      cek_kendala: ["Lap sensor kondensor dari debu", "Ukur resistansi vs tabel spek", "Pastikan kabel sensor tidak putus"],
      kemungkinan_kerusakan: ["Sensor kondensor rusak", "Kabel sensor putus/korosi", "Sensor lepas dari pipa"],
    },
    {
      kode: "F3",
      keterangan: "Malfungsi sensor suhu lingkungan (ambient) unit outdoor.",
      cek_kendala: ["Ukur resistansi sensor ambient vs tabel spek", "Cek posisi sensor tidak kena panas langsung", "Pastikan konektor ke mainboard kuat"],
      kemungkinan_kerusakan: ["Sensor ambient outdoor rusak", "Kabel/konektor sensor bermasalah", "Konektor kendor di mainboard"],
    },
    {
      kode: "F4",
      keterangan: "Malfungsi sensor discharge / deteksi aliran udara buangan outdoor.",
      cek_kendala: ["Pastikan kipas buangan (outdoor) bekerja normal", "Cek sensor discharge & koneksinya", "Ukur resistansi sensor vs tabel spek"],
      kemungkinan_kerusakan: ["Sensor discharge rusak", "Kipas outdoor lemah/tidak normal", "Kabel sensor putus"],
    },
    {
      kode: "H3",
      keterangan: "Proteksi overload kompresor / sirkulasi udara terhambat.",
      cek_kendala: ["Bersihkan filter udara & area outdoor", "Pastikan sirkulasi udara tidak terhalang", "Ukur arus kompresor vs nameplate"],
      kemungkinan_kerusakan: ["Kompresor overheat karena beban lebih", "Kondensor/filter kotor menghambat udara", "Overload protector lemah"],
    },
    {
      kode: "H5",
      keterangan: "Proteksi modul IPM inverter (overcurrent/overheat modul daya).",
      cek_kendala: ["Cek kompresor tidak short/ground fault (megger test)", "Cek modul IPM & heatsink tidak overheat", "Cek kabel power ke kompresor"],
      kemungkinan_kerusakan: ["Modul IPM rusak — perlu ganti PCB inverter", "Kompresor short merusak modul", "Overheat karena heatsink kotor/pasta kering"],
    },
    {
      kode: "H6",
      keterangan: "Malfungsi motor fan (kipas sulit beroperasi / terminal lepas).",
      cek_kendala: ["Bersihkan bilah kipas outdoor", "Lumasi as motor kalau putaran berat", "Cek terminal & konektor motor fan tidak lepas"],
      kemungkinan_kerusakan: ["Motor fan rusak/macet", "Terminal/konektor motor lepas", "Mainboard indoor rusak di bagian kontrol fan"],
    },
    {
      kode: "P0",
      keterangan: "Proteksi umum inverter (perlu reset — kalau tetap error, komponen inverter).",
      cek_kendala: ["Matikan AC beberapa menit lalu hidupkan ulang", "Cek tegangan supply stabil", "Kalau tetap error, cek modul & PCB inverter"],
      kemungkinan_kerusakan: ["Proteksi sementara (glitch) — hilang setelah reset", "Modul/PCB inverter bermasalah", "Tegangan supply tidak stabil"],
    },
    {
      kode: "P1",
      keterangan: "Proteksi tegangan listrik terlalu tinggi (over-voltage).",
      cek_kendala: ["Ukur tegangan supply saat unit running", "Cek stabilizer/panel listrik rumah", "Cek kabel power tidak longgar"],
      kemungkinan_kerusakan: ["Tegangan PLN terlalu tinggi/tidak stabil", "Kabel power bermasalah", "Rangkaian proteksi tegangan PCB"],
    },
    {
      kode: "U8",
      keterangan: "Malfungsi sirkuit deteksi zero-crossing motor fan indoor (IDU).",
      cek_kendala: ["Cek motor fan indoor & koneksinya", "Cek fisik PCB indoor di rangkaian deteksi", "Reset power unit lalu nyalakan ulang"],
      kemungkinan_kerusakan: ["PCB indoor rusak di rangkaian zero-crossing", "Motor fan indoor bermasalah", "Kabel/konektor motor fan kendor"],
    },
  ],
};
