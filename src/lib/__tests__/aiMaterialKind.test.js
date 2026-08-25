import { describe, it, expect } from "vitest";
import { detectKind, qtyEfektif, cocokkanKePagi, bolehLinkKeJob, pisahkanItemLink, namaItem } from "../aiMaterialKind.js";

// Caption NYATA dari grup WA (ai_extractions, Agu 2026).
describe("detectKind — caption nyata", () => {
  it("laporan sisa dikenali sebagai sisa", () => {
    expect(detectKind({}, "Karet monting sisa 2 set sudah kembali ke kantor")).toBe("sisa");
    expect(detectKind({}, "vakum besar sudah kembali ke kantor")).toBe("sisa");
    expect(detectKind({}, "Kr32 kembali tidak terpakai 4.8kg")).toBe("sisa");
  });

  it('"tidak terpakai" TIDAK boleh terbaca sebagai pemakaian', () => {
    expect(detectKind({}, "freon VR32 isi 2,4kg tidak terpakai")).toBe("sisa");
    expect(detectKind({}, "Gr32 tidak terpakai, kembali kantor")).toBe("sisa");
  });

  it("caption yang menyebut pakai DAN sisa = campuran, jangan ditebak", () => {
    expect(detectKind({}, "pipa A4 - 7 meter terpakai 5 meter tersisa 2 meter")).toBe("campuran");
    expect(detectKind({}, "K R32 terpakai di ibu cassy 0,3 kg, tersisa 4,5kg")).toBe("campuran");
  });

  it("laporan bawa (tanpa kata sisa/pakai) tetap dibawa", () => {
    expect(detectKind({}, "pipa A4 - 7 meter dibawa pak eri")).toBe("dibawa");
    expect(detectKind({}, "bor markita dibawa pak eri")).toBe("dibawa");
  });

  it("kind eksplisit dari AI selalu menang atas tebakan caption", () => {
    expect(detectKind({ kind: "sisa" }, "dibawa pak eri")).toBe("sisa");
    expect(detectKind({ kind: "dibawa" }, "sisa 2 meter")).toBe("dibawa");
  });

  it("kind ngawur dari AI diabaikan, jatuh ke caption", () => {
    expect(detectKind({ kind: "entah" }, "sisa 2 meter")).toBe("sisa");
  });

  it("caption kosong → dianggap dibawa", () => {
    expect(detectKind({}, "")).toBe("dibawa");
    expect(detectKind(null, null)).toBe("dibawa");
  });
});

describe("qtyEfektif — angka yang nyasar ke size", () => {
  it("mengambil angka dari size saat qty cuma pengisi", () => {
    expect(qtyEfektif({ qty: 1, size: "4.8kg" })).toBe(4.8);
    expect(qtyEfektif({ qty: null, size: "2,4kg" })).toBe(2.4);
    expect(qtyEfektif({ qty: 1, size: "7 meter" })).toBe(7);
  });
  it("qty asli dipertahankan kalau memang bermakna", () => {
    expect(qtyEfektif({ qty: 4.5, size: "R32" })).toBe(4.5);
    expect(qtyEfektif({ qty: 2, size: "A4" })).toBe(2);
  });
  it("size tanpa satuan tidak dianggap angka", () => {
    expect(qtyEfektif({ qty: 1, size: "A4" })).toBe(1);
    expect(qtyEfektif({ qty: 1, size: "R32" })).toBe(1);
  });
  it("aman untuk input kosong", () => {
    expect(qtyEfektif({})).toBe(null);
    expect(qtyEfektif(null)).toBe(null);
  });
});

describe("cocokkanKePagi", () => {
  const pagi = [
    { material_type: "pipa", label: "Pipa AC Hoda 1PK", units: [{ unit_id: "u1", label: "Roll 1PK-A4", qty: 7 }] },
    { material_type: "freon", label: "Freon R-32", weight_kg: [{ unit_id: "u2", label: "Tabung R32 - K", kg: 4.8 }] },
  ];
  it("cocok saat hanya ada satu baris dgn jenis itu", () => {
    expect(cocokkanKePagi({ type: "pipa" }, pagi).label).toBe("Pipa AC Hoda 1PK");
    expect(cocokkanKePagi({ type: "freon" }, pagi).label).toBe("Freon R-32");
  });
  it("menyerah kalau jenisnya ada lebih dari satu (ambigu)", () => {
    const dua = [...pagi, { material_type: "pipa", label: "Pipa AC Hoda 2PK", units: [] }];
    expect(cocokkanKePagi({ type: "pipa" }, dua)).toBe(null);
  });
  it("jenis tidak ada di sesi pagi → null", () => {
    expect(cocokkanKePagi({ type: "kabel" }, pagi)).toBe(null);
    expect(cocokkanKePagi({ type: "" }, pagi)).toBe(null);
  });
  it("aman untuk input kosong", () => {
    expect(cocokkanKePagi({ type: "pipa" }, null)).toBe(null);
  });
});

describe("bolehLinkKeJob — hanya pipa AC / kabel / freon", () => {
  it("meloloskan material inti", () => {
    expect(bolehLinkKeJob({ type: "pipa", size: "A4" })).toBe(true);
    expect(bolehLinkKeJob({ type: "kabel", size: "3x1.5" })).toBe(true);
    expect(bolehLinkKeJob({ type: "freon", size: "R32" })).toBe(true);
  });

  it("menolak ALAT yang ikut terfoto", () => {
    expect(bolehLinkKeJob({ type: "lain", brand: "Manifold" })).toBe(false);
    expect(bolehLinkKeJob({ type: "lain", brand: "VALUE", size: "vakum" })).toBe(false);
    expect(bolehLinkKeJob({ type: "lain", brand: "Markita" })).toBe(false);
  });

  it("menolak barang yang tidak dilacak per unit", () => {
    expect(bolehLinkKeJob({ type: "lain", brand: "Duct Tape" })).toBe(false);
    expect(bolehLinkKeJob({ type: "lain", brand: "lakban" })).toBe(false);
  });

  it("paralon ditolak walau AI menandainya pipa", () => {
    expect(bolehLinkKeJob({ type: "pipa", brand: "paralon" })).toBe(false);
    expect(bolehLinkKeJob({ type: "lain", brand: "Paralon 3 inch" })).toBe(false);
  });

  it("material inti yang salah masuk tipe 'lain' tetap lolos lewat namanya", () => {
    expect(bolehLinkKeJob({ type: "lain", brand: "Pipa AC 1/4" })).toBe(true);
    expect(bolehLinkKeJob({ type: "lain", size: "R410" })).toBe(true);
  });

  it("caption yang menyebut alat menahan baris 'lain' yang ambigu", () => {
    expect(bolehLinkKeJob({ type: "lain", brand: "kabel" }, "manifold dibawa")).toBe(false);
  });

  it("aman untuk input kosong", () => {
    expect(bolehLinkKeJob({})).toBe(false);
    expect(bolehLinkKeJob(null)).toBe(false);
  });
});

describe("pisahkanItemLink", () => {
  it("memisahkan material inti dari alat dalam satu foto", () => {
    const { boleh, tolak } = pisahkanItemLink([
      { type: "pipa", size: "A4", qty: 7 },
      { type: "lain", brand: "Manifold", qty: 1 },
      { type: "freon", size: "R32", qty: 4.8 },
      { type: "lain", brand: "Duct Tape", qty: 2 },
    ]);
    expect(boleh.map(namaItem)).toEqual(["pipa A4", "freon R32"]);
    expect(tolak.map(namaItem)).toEqual(["lain Manifold", "lain Duct Tape"]);
  });
  it("aman untuk input kosong", () => {
    expect(pisahkanItemLink(null).boleh).toEqual([]);
  });
});
