// Guard regresi: field metadata `unit_no` pada baris jasa/barang (Step 3 laporan)
// TIDAK BOLEH memengaruhi kalkulasi invoice. summarize() adalah jantung 2 builder
// invoice yang wajib paritas (submitLaporan.js jalur submit & buildVerifyInvoice
// jalur verify) — kalau suatu saat summarize mulai membaca field asing, test ini
// gagal SEBELUM salah tagih sampai ke customer.
import { describe, it, expect } from "vitest";
import { summarize } from "../invoicing.js";

const baris = (over = {}) => ({ nama: "Jasa Bongkar Pasang", jumlah: 1, satuan: "unit", harga_satuan: 200000, keterangan: "jasa", ...over });

describe("unit_no = metadata pasif, bukan input kalkulasi", () => {
  it("hasil summarize identik dengan/atau tanpa unit_no", () => {
    const tanpa = [baris(), baris({ nama: "Pipa AC", harga_satuan: 150000, jumlah: 5, keterangan: "barang" })];
    const dengan = [baris({ unit_no: 2 }), baris({ nama: "Pipa AC", harga_satuan: 150000, jumlah: 5, keterangan: "barang", unit_no: 1 })];
    expect(summarize(dengan)).toEqual(summarize(tanpa));
  });

  it("unit_no null / undefined / angka → total sama persis", () => {
    const base = summarize([baris()]);
    expect(summarize([baris({ unit_no: null })])).toEqual(base);
    expect(summarize([baris({ unit_no: undefined })])).toEqual(base);
    expect(summarize([baris({ unit_no: 3 })])).toEqual(base);
  });

  it("nilai unit_no aneh (string/0/negatif) tetap tidak mengubah angka", () => {
    const base = summarize([baris()]);
    expect(summarize([baris({ unit_no: "2" })])).toEqual(base);
    expect(summarize([baris({ unit_no: 0 })])).toEqual(base);
    expect(summarize([baris({ unit_no: -1 })])).toEqual(base);
  });
});
