import { describe, it, expect } from "vitest";
import { condSetelahTone } from "../reportConditions.js";

describe("condSetelahTone — nada badge kondisi sesudah di report card", () => {
  it("kondisi baik → green", () => {
    expect(condSetelahTone("AC Dingin Kembali")).toBe("green");
    expect(condSetelahTone("Semua Fungsi Normal")).toBe("green");
  });
  it("'Tidak Melakukan Cek ...' → neutral (bukan positif hijau)", () => {
    expect(condSetelahTone("Tidak Melakukan Cek Freon")).toBe("neutral");
    expect(condSetelahTone("Tidak Melakukan Cek Ampere")).toBe("neutral");
    expect(condSetelahTone("Belum Test Press")).toBe("neutral");
  });
  it("kondisi bermasalah → red", () => {
    expect(condSetelahTone("AC Masih Terkendala")).toBe("red");
    expect(condSetelahTone("Kompresor Bermasalah")).toBe("red");
    expect(condSetelahTone("AC Rusak Perlu Pergantian Unit")).toBe("red");
  });
  it("perlu tindak lanjut → warn", () => {
    expect(condSetelahTone("Perlu Pergantian Sparepart")).toBe("warn");
    expect(condSetelahTone("Perlu Test Press")).toBe("warn");
  });
  it("kosong/aman → green (default)", () => {
    expect(condSetelahTone("")).toBe("green");
    expect(condSetelahTone(null)).toBe("green");
  });
});
