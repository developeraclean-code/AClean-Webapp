// Guard: pemetaan unit registry maintenance → bentuk unit laporan.
// `tipe` menentukan HARGA (hargaPerUnitFromTipe / harga kontrak per tipe+PK), jadi
// kalau tipe gagal terisi, teknisi harus koreksi manual di lapangan — dan bila
// validasi longgar, unit bisa lolos tanpa tipe → baris jasa hilang dari invoice.
import { describe, it, expect } from "vitest";
import { maintUnitToHist, TIPE_AC_OPT } from "../laporanConstants.js";

const unit = (over = {}) => ({ id: "u1", unit_code: "AC-01", location: "Lt.2", brand: "Daikin", ac_type: "split", capacity_pk: "1.5", ...over });

describe("maintUnitToHist — resolusi tipe", () => {
  it("PK desimal normal cocok daftar", () => {
    expect(maintUnitToHist(unit({ capacity_pk: "1.5" })).tipe).toBe("AC Split 1.5PK");
    expect(maintUnitToHist(unit({ capacity_pk: "0.75" })).tipe).toBe("AC Split 0.75PK");
  });

  it("PK bulat sebagai teks cocok", () => {
    expect(maintUnitToHist(unit({ capacity_pk: "2" })).tipe).toBe("AC Split 2PK");
  });

  it("nol di belakang dinormalkan — '2.0'/'3.00' bukan alasan gagal", () => {
    expect(maintUnitToHist(unit({ capacity_pk: "2.0" })).tipe).toBe("AC Split 2PK");
    expect(maintUnitToHist(unit({ capacity_pk: "1.0" })).tipe).toBe("AC Split 1PK");
    expect(maintUnitToHist(unit({ ac_type: "cassette", capacity_pk: "3.0" })).tipe).toBe("AC Cassette 3PK");
    expect(maintUnitToHist(unit({ ac_type: "cassette", capacity_pk: "2.00" })).tipe).toBe("AC Cassette 2PK");
  });

  it("angka (bukan teks) tetap jalan", () => {
    expect(maintUnitToHist(unit({ capacity_pk: 2 })).tipe).toBe("AC Split 2PK");
    expect(maintUnitToHist(unit({ capacity_pk: 1.5 })).tipe).toBe("AC Split 1.5PK");
  });

  it("normalisasi TIDAK merusak desimal bermakna (1.5 tetap 1.5, bukan 15)", () => {
    expect(maintUnitToHist(unit({ capacity_pk: "1.50" })).tipe).toBe("AC Split 1.5PK");
    expect(maintUnitToHist(unit({ ac_type: "cassette", capacity_pk: "4.50" })).tipe).toBe("AC Cassette 4.5PK");
  });

  it("kombinasi di luar daftar → tipe kosong (teknisi wajib pilih manual)", () => {
    // cassette tanpa PK → default 1PK, daftar cassette mulai 2PK
    expect(maintUnitToHist(unit({ ac_type: "cassette", capacity_pk: null })).tipe).toBe("");
    // ducted 8PK di luar daftar (maks 6PK)
    expect(maintUnitToHist(unit({ ac_type: "ducted", capacity_pk: "8" })).tipe).toBe("");
  });

  it("semua tipe hasil normalisasi memang anggota TIPE_AC_OPT", () => {
    ["1", "1.0", "2", "2.0", "1.5", "1.50"].forEach(pk => {
      const t = maintUnitToHist(unit({ capacity_pk: pk })).tipe;
      if (t) expect(TIPE_AC_OPT).toContain(t);
    });
  });

  it("label & merk diturunkan apa adanya dari registry", () => {
    const h = maintUnitToHist(unit());
    expect(h.label).toBe("AC-01 — Lt.2");
    expect(h.merk).toBe("Daikin");
    expect(maintUnitToHist(unit({ brand: null })).merk).toBe("");
  });
});
