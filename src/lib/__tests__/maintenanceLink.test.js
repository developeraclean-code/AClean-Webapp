// Guard penautan order ↔ klien kontrak. Semua skenario di sini diambil dari DATA
// PRODUKSI NYATA (verifikasi 20-22 Jul 2026), bukan karangan — terutama kasus
// "Pak Tonny" yang membuktikan kenapa kunci harus customer_id, bukan nomor HP.
import { describe, it, expect } from "vitest";
import { resolveMaintenanceClient, isMaintenanceCustomer, withMaintenanceLink } from "../maintenanceLink.js";

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
