// Guard penautan order ↔ klien kontrak. Semua skenario di sini diambil dari DATA
// PRODUKSI NYATA (verifikasi 20-22 Jul 2026), bukan karangan — terutama kasus
// "Pak Tonny" yang membuktikan kenapa kunci harus customer_id, bukan nomor HP.
import { describe, it, expect } from "vitest";
import { resolveMaintenanceClient, isMaintenanceCustomer, withMaintenanceLink, findMaintClientByPhoneAddr } from "../maintenanceLink.js";

// Cuplikan maintenance_clients produksi (kolom yang dipakai saja)
const KLIEN = [
  { id: "84d74362", name: "PT. VINCO MAKMUR MANDIRI", customer_id: "CUST855" },
  { id: "264b2f28", name: "PT UICCP", customer_id: "CUST240" },
  { id: "588be41d", name: "PT. Jaya Kreasi Indonesia - Jalan Panjang", customer_id: "CUST176" },
  { id: "efbcfa34", name: "PT. Jaya Kreasi Indonesia - Alam Sutera", customer_id: "CUST784" },
  { id: "787e4170", name: "PT. Jaya Kreasi Indonesia Spectra", customer_id: null }, // belum ditautkan
];

describe("resolveMaintenanceClient", () => {
  it("customer klien kontrak → dapat klien yang benar", () => {
    expect(resolveMaintenanceClient("CUST855", KLIEN)).toEqual({ id: "84d74362", name: "PT. VINCO MAKMUR MANDIRI" });
  });

  it("customer reguler → null", () => {
    expect(resolveMaintenanceClient("CUST999", KLIEN)).toBeNull();
  });

  it("customer_id kosong → null, JANGAN menebak", () => {
    expect(resolveMaintenanceClient(null, KLIEN)).toBeNull();
    expect(resolveMaintenanceClient("", KLIEN)).toBeNull();
    expect(resolveMaintenanceClient("   ", KLIEN)).toBeNull();
  });

  it("klien yang customer_id-nya belum diisi tidak pernah cocok (bukan cocok ke null)", () => {
    // Spectra customer_id null — customer manapun tak boleh tertaut ke dia
    expect(resolveMaintenanceClient(null, KLIEN)).toBeNull();
    const spectra = KLIEN.find(k => k.name.includes("Spectra"));
    expect(spectra.customer_id).toBeNull();
  });

  it("daftar klien kosong/rusak tidak bikin crash", () => {
    expect(resolveMaintenanceClient("CUST855", [])).toBeNull();
    expect(resolveMaintenanceClient("CUST855", null)).toBeNull();
    expect(resolveMaintenanceClient("CUST855", [null, undefined])).toBeNull();
  });

  it("MULTI-SITE: tiap site menuju kontraknya sendiri, tidak tertukar", () => {
    // HP ketiganya SAMA (6287775196231) — kalau kunci-nya HP, ini pasti tertukar
    expect(resolveMaintenanceClient("CUST176", KLIEN).name).toContain("Jalan Panjang");
    expect(resolveMaintenanceClient("CUST784", KLIEN).name).toContain("Alam Sutera");
  });
});

describe("REGRESI WAJIB — kasus Pak Tonny (HP dipakai bersama)", () => {
  // Produksi: HP 6281287619907 dipakai "BAPAK TONNY M TOWN" (CUST perorangan)
  // DAN "PT UICCP" (CUST240, klien kontrak). Job pribadi Pak Tonny TIDAK BOLEH
  // dianggap pekerjaan kontrak hanya karena nomor HP-nya sama.
  it("customer perorangan ber-HP sama TIDAK tertaut ke kontrak", () => {
    const tonny = { customer_id: "CUST_TONNY", customer: "BAPAK TONNY M TOWN" };
    const { payload, linked } = withMaintenanceLink(tonny, KLIEN);
    expect(linked).toBeNull();
    expect(payload.maintenance_client_id).toBeUndefined();
  });

  it("customer PT UICCP dgn HP yang sama TETAP tertaut", () => {
    const { linked } = withMaintenanceLink({ customer_id: "CUST240" }, KLIEN);
    expect(linked).toEqual({ id: "264b2f28", name: "PT UICCP" });
  });
});

describe("withMaintenanceLink", () => {
  it("mengisi maintenance_client_id untuk klien kontrak", () => {
    const { payload, linked } = withMaintenanceLink({ id: "JOB-1", customer_id: "CUST855" }, KLIEN);
    expect(payload.maintenance_client_id).toBe("84d74362");
    expect(linked.name).toBe("PT. VINCO MAKMUR MANDIRI");
    expect(payload.id).toBe("JOB-1"); // field lain utuh
  });

  it("TIDAK menimpa pilihan eksplisit (order dari panel Maintenance / dipilih admin)", () => {
    const eksplisit = { customer_id: "CUST855", maintenance_client_id: "PILIHAN-ADMIN" };
    const { payload, linked } = withMaintenanceLink(eksplisit, KLIEN);
    expect(payload.maintenance_client_id).toBe("PILIHAN-ADMIN");
    expect(linked).toBeNull(); // tak perlu notif, bukan hasil auto-link
  });

  it("customer reguler → payload tidak berubah sama sekali", () => {
    const asal = { id: "JOB-2", customer_id: "CUST999", customer: "Ibu Ani" };
    const { payload, linked } = withMaintenanceLink(asal, KLIEN);
    expect(linked).toBeNull();
    expect(payload).toEqual(asal);
  });

  it("payload tanpa customer_id (mis. order lama) aman", () => {
    const { payload, linked } = withMaintenanceLink({ customer: "Walk-in" }, KLIEN);
    expect(linked).toBeNull();
    expect(payload.maintenance_client_id).toBeUndefined();
  });

  it("tidak memutasi objek asli (hindari efek samping tersembunyi)", () => {
    const asal = { customer_id: "CUST855" };
    withMaintenanceLink(asal, KLIEN);
    expect(asal.maintenance_client_id).toBeUndefined();
  });
});

describe("isMaintenanceCustomer (badge turunan di menu Customer)", () => {
  it("membedakan kontrak vs reguler", () => {
    expect(isMaintenanceCustomer("CUST855", KLIEN)).toBe(true);
    expect(isMaintenanceCustomer("CUST999", KLIEN)).toBe(false);
    expect(isMaintenanceCustomer(null, KLIEN)).toBe(false);
  });
});

describe("findMaintClientByPhoneAddr (trigger popup pilih-unit)", () => {
  // Klien + kontak (pic_phone/address di baris klien, atau via customer tertaut).
  const MC = [
    { id: "vinco", name: "PT. VINCO", customer_id: "C1", pic_phone: "081200000001", address: "Jl. Industri No. 5, Cikarang" },
    { id: "uiccp", name: "PT UICCP", customer_id: "C2", pic_phone: "081287619907", address: "Gedung UICCP, Sudirman Kav 10, Jakarta" },
    // 3 site Jaya Kreasi berbagi 1 nomor HP → alamat pembeda
    { id: "jk-panjang", name: "JK - Jalan Panjang", customer_id: "C3", pic_phone: "087775196231", address: "Jl. Panjang No. 88, Kebon Jeruk" },
    { id: "jk-sutera", name: "JK - Alam Sutera", customer_id: "C4", pic_phone: "087775196231", address: "Ruko Alam Sutera Blok B12, Serpong" },
    { id: "jk-spectra", name: "JK - Spectra", customer_id: null, pic_phone: "087775196231", address: "Spectra Tower Lt 3, BSD" },
  ];
  const CUSTOMERS = [
    { id: "C2", phone: "081287619907", address: "Gedung UICCP, Sudirman Kav 10, Jakarta" },
  ];

  it("HP unik ke 1 klien → langsung match (via phone-unique)", () => {
    const r = findMaintClientByPhoneAddr("081200000001", "Jl. Industri No. 5", MC, CUSTOMERS);
    expect(r).toMatchObject({ id: "vinco", via: "phone-unique" });
  });

  it("HP tak dikenal → null", () => {
    expect(findMaintClientByPhoneAddr("089999999999", "mana saja", MC, CUSTOMERS)).toBeNull();
  });

  it("tanpa HP → null (jangan menebak)", () => {
    expect(findMaintClientByPhoneAddr("", "Jl. Panjang", MC, CUSTOMERS)).toBeNull();
  });

  it("1 HP → 3 site Jaya Kreasi: alamat memilih site yang benar", () => {
    expect(findMaintClientByPhoneAddr("087775196231", "Ruko Alam Sutera Blok B12", MC, CUSTOMERS))
      .toMatchObject({ id: "jk-sutera", via: "phone+address" });
    expect(findMaintClientByPhoneAddr("087775196231", "Jl. Panjang No 88 Kebon Jeruk", MC, CUSTOMERS))
      .toMatchObject({ id: "jk-panjang", via: "phone+address" });
    expect(findMaintClientByPhoneAddr("087775196231", "Spectra Tower Lantai 3 BSD", MC, CUSTOMERS))
      .toMatchObject({ id: "jk-spectra", via: "phone+address" });
  });

  it("multi-site tapi order tanpa alamat → null (ambigu, jangan tebak)", () => {
    expect(findMaintClientByPhoneAddr("087775196231", "", MC, CUSTOMERS)).toBeNull();
  });

  it("multi-site & alamat tak mirip mana pun → null", () => {
    expect(findMaintClientByPhoneAddr("087775196231", "Jl. Antah Berantah 999 Papua", MC, CUSTOMERS)).toBeNull();
  });

  it("normalisasi HP: 0812.. == 62812.. == +62 812", () => {
    expect(findMaintClientByPhoneAddr("6281200000001", "Jl. Industri", MC, CUSTOMERS)).toMatchObject({ id: "vinco" });
    expect(findMaintClientByPhoneAddr("+62 812-0000-0001", "Jl. Industri", MC, CUSTOMERS)).toMatchObject({ id: "vinco" });
  });

  it("guard personal+kontrak: HP UICCP dipakai job beralamat jelas beda → null", () => {
    // Pak Tonny pinjam HP yang sama tapi alamat rumahnya beda total
    expect(findMaintClientByPhoneAddr("081287619907", "Perumahan Griya Asri Blok C2 Depok", MC, CUSTOMERS)).toBeNull();
  });

  it("cocok via customer tertaut (kontak dari customersData, bukan baris klien)", () => {
    const mcNoAddr = [{ id: "uiccp", name: "PT UICCP", customer_id: "C2", pic_phone: "", address: "" }];
    expect(findMaintClientByPhoneAddr("081287619907", "Gedung UICCP Sudirman Kav 10", mcNoAddr, CUSTOMERS))
      .toMatchObject({ id: "uiccp", via: "phone-unique" });
  });
});
