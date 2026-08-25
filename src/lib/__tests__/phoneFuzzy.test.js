import { describe, it, expect } from "vitest";
import { isNearPhone, findNearPhoneInvoice, findNearPhoneSuggestion } from "../phoneFuzzy.js";
import { isNearPhone as isNearPhoneApi, findNearPhoneInvoice as findNearApi } from "../../../api/_validate.js";

// Kasus nyata yang memicu fitur ini (22 Agu 2026).
const RICKY_WA = "628121047006";  // nomor asli di WhatsApp
const RICKY_DB = "62812047006";   // nomor di DB, digit "1" hilang

describe("isNearPhone", () => {
  it("menangkap digit hilang — kasus Bapak Ricky", () => {
    expect(isNearPhone(RICKY_WA, RICKY_DB)).toBe(true);
    expect(isNearPhone(RICKY_DB, RICKY_WA)).toBe(true); // simetris
  });

  it("menangkap satu digit salah ketik", () => {
    expect(isNearPhone("628121047006", "628121047007")).toBe(true);
    expect(isNearPhone("628121047006", "628121047106")).toBe(true);
  });

  it("menolak nomor yang sama persis (itu tugas exact match)", () => {
    expect(isNearPhone(RICKY_WA, RICKY_WA)).toBe(false);
  });

  it("menolak beda 2 digit atau lebih", () => {
    expect(isNearPhone("628121047006", "628121047077")).toBe(false);
    expect(isNearPhone("628121047006", "628999047006")).toBe(false);
    expect(isNearPhone("628121047006", "6281210470")).toBe(false); // 2 digit hilang
  });

  it("menolak nomor pelanggan lain yang kebetulan mirip panjangnya", () => {
    expect(isNearPhone("628121047006", "628170832908")).toBe(false);
    expect(isNearPhone("628121047006", "62811159933")).toBe(false);
  });

  it("menolak nomor terlalu pendek dan non-Indonesia", () => {
    expect(isNearPhone("62812345", "6281234")).toBe(false);
    expect(isNearPhone("491761234567", "491761234568")).toBe(false);
  });

  it("tahan terhadap format (spasi, strip, plus)", () => {
    expect(isNearPhone("+62 812-1047-006", "62812047006")).toBe(true);
  });

  it("aman untuk input kosong / null", () => {
    expect(isNearPhone(null, RICKY_DB)).toBe(false);
    expect(isNearPhone("", "")).toBe(false);
    expect(isNearPhone(RICKY_WA, undefined)).toBe(false);
  });
});

describe("findNearPhoneInvoice", () => {
  const invoices = [
    { id: "INV-A", phone: RICKY_DB, total: 190000, status: "UNPAID" },
    { id: "INV-B", phone: "628159973627", total: 190000, status: "UNPAID" },
    { id: "INV-C", phone: RICKY_DB, total: 450000, status: "UNPAID" },
  ];

  it("menemukan invoice Bapak Ricky: nominal sama + nomor beda 1 digit", () => {
    expect(findNearPhoneInvoice(RICKY_WA, invoices, 190000)?.id).toBe("INV-A");
  });

  it("menyerah kalau nominal tidak sama persis", () => {
    expect(findNearPhoneInvoice(RICKY_WA, invoices, 195000)).toBe(null);
    expect(findNearPhoneInvoice(RICKY_WA, invoices, 0)).toBe(null);
  });

  it("menyerah kalau kandidatnya lebih dari satu — jangan menebak", () => {
    const ambigu = [
      { id: "INV-A", phone: RICKY_DB, total: 190000 },
      { id: "INV-D", phone: "628121047016", total: 190000 }, // juga beda 1 digit
    ];
    expect(findNearPhoneInvoice(RICKY_WA, ambigu, 190000)).toBe(null);
  });

  it("tidak menyentuh invoice orang lain walau nominalnya sama", () => {
    expect(findNearPhoneInvoice("628159973627", invoices, 190000)).toBe(null);
  });

  it("aman untuk daftar kosong / bukan array", () => {
    expect(findNearPhoneInvoice(RICKY_WA, [], 190000)).toBe(null);
    expect(findNearPhoneInvoice(RICKY_WA, null, 190000)).toBe(null);
  });
});

describe("findNearPhoneSuggestion (arah retro-match)", () => {
  const suggestions = [
    { id: "s1", phone: RICKY_WA, amount: 190000 },
    { id: "s2", phone: "6288976538047", amount: 190000 },
  ];

  it("menemukan bukti bayar dari nomor asli untuk invoice bernomor typo", () => {
    expect(findNearPhoneSuggestion(RICKY_DB, suggestions, 190000)?.id).toBe("s1");
  });

  it("menyerah kalau nominal beda", () => {
    expect(findNearPhoneSuggestion(RICKY_DB, suggestions, 200000)).toBe(null);
  });
});

// Backend memakai salinan fungsi ini (Vercel tidak import lintas folder src/).
// Test ini yang mencegah dua salinan itu menyimpang diam-diam.
describe("parity src/lib/phoneFuzzy.js vs api/_validate.js", () => {
  const kasus = [
    [RICKY_WA, RICKY_DB],
    [RICKY_DB, RICKY_WA],
    ["628121047006", "628121047007"],
    ["628121047006", "628121047077"],
    ["628121047006", "628121047006"],
    ["628121047006", "62811159933"],
    ["62812345", "6281234"],
    ["491761234567", "491761234568"],
    ["+62 812-1047-006", "62812047006"],
    [null, RICKY_DB],
    ["", ""],
  ];

  it("isNearPhone identik di kedua salinan", () => {
    for (const [a, b] of kasus) {
      expect(isNearPhoneApi(a, b), `beda pada ${a} vs ${b}`).toBe(isNearPhone(a, b));
    }
  });

  it("findNearPhoneInvoice identik di kedua salinan", () => {
    const invoices = [
      { id: "INV-A", phone: RICKY_DB, total: 190000 },
      { id: "INV-B", phone: "628159973627", total: 190000 },
    ];
    expect(findNearApi(RICKY_WA, invoices, 190000)?.id).toBe(findNearPhoneInvoice(RICKY_WA, invoices, 190000)?.id);
    expect(findNearApi(RICKY_WA, invoices, 1)).toBe(findNearPhoneInvoice(RICKY_WA, invoices, 1));
  });
});
