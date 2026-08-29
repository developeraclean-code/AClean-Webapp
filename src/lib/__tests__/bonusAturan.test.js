import { describe, it, expect } from "vitest";
import {
  isMultiDayJob, cariKomplain30Hari, cariJobBersambung, bonusCandidateInfo, KOMPLAIN_VOID_HARI,
} from "../bonus.js";

const job = (over = {}) => ({
  id: "J1", date: "2026-04-10", customer: "IBU MINA", customer_id: "CUST343",
  service: "Cleaning", units: 1, ...over,
});

describe("job lintas hari tidak dapat bonus", () => {
  it("mengenali ketiga penanda multi-hari", () => {
    expect(isMultiDayJob(job({ is_multi_day: true }))).toBe(true);
    expect(isMultiDayJob(job({ parent_job_id: "J0" }))).toBe(true);
    expect(isMultiDayJob(job({ day_number: 2 }))).toBe(true);
  });

  it("job normal hari-1 tidak dianggap multi-hari", () => {
    expect(isMultiDayJob(job({ day_number: 1 }))).toBe(false);
    expect(isMultiDayJob(job())).toBe(false);
  });

  it("menggugurkan kandidat walau omset besar & ada material bonus", () => {
    const c = bonusCandidateInfo(job({ is_multi_day: true }), 5000000, ["freon"]);
    expect(c.eligible).toBe(false);
    expect(c.multiDay).toBe(true);
    expect(c.blockedReason).toMatch(/lintas hari/i);
    // Alasan kelayakan tetap dilaporkan supaya rekap bisa menjelaskan apa yang hangus.
    expect(c.reasons.length).toBeGreaterThan(0);
  });

  it("job 1 hari dengan material bonus tetap layak", () => {
    expect(bonusCandidateInfo(job(), 400000, ["kapasitor"]).eligible).toBe(true);
  });
});

describe("komplain 30 hari — peringatan, bukan pembatal otomatis", () => {
  const komplain = (d, over = {}) => ({ id: "C" + d, date: d, service: "Complain", customer: "IBU MINA", customer_id: "CUST343", ...over });

  it("menangkap komplain di dalam 30 hari", () => {
    const hits = cariKomplain30Hari(job(), [komplain("2026-04-18")]);
    expect(hits).toHaveLength(1);
    expect(hits[0].jarakHari).toBe(8);
  });

  it("tepat di hari ke-30 masih kena, hari ke-31 tidak", () => {
    expect(cariKomplain30Hari(job(), [komplain("2026-05-10")])).toHaveLength(1);
    expect(cariKomplain30Hari(job(), [komplain("2026-05-11")])).toHaveLength(0);
    expect(KOMPLAIN_VOID_HARI).toBe(30);
  });

  it("komplain SEBELUM job diabaikan", () => {
    expect(cariKomplain30Hari(job(), [komplain("2026-04-01")])).toHaveLength(0);
  });

  it("pelanggan lain tidak ikut terjaring", () => {
    expect(cariKomplain30Hari(job(), [komplain("2026-04-18", { customer: "IBU HANI", customer_id: "CUST430" })])).toHaveLength(0);
  });

  it("dua customer bernama sama dibedakan lewat customer_id", () => {
    // Kasus nyata: 'IBU HANI MODERNLAND' vs 'IBU HANI PASADENA'.
    const hani = job({ customer: "IBU HANI", customer_id: "CUST243" });
    const lain = komplain("2026-04-18", { customer: "IBU HANI", customer_id: "CUST430" });
    expect(cariKomplain30Hari(hani, [lain])).toHaveLength(0);
  });

  it("data lama tanpa customer_id jatuh ke pencocokan nama", () => {
    const lama = { id: "J9", date: "2026-04-10", customer: "  ibu mina  ", service: "Cleaning" };
    const komp = { id: "C9", date: "2026-04-15", customer: "IBU MINA", service: "Complain" };
    expect(cariKomplain30Hari(lama, [komp])).toHaveLength(1);
  });

  it("TETAP layak bonus — komplain hanya memunculkan peringatan", () => {
    const c = bonusCandidateInfo(job(), 400000, ["freon"], [komplain("2026-04-18")]);
    expect(c.eligible).toBe(true);
    expect(c.komplain).toHaveLength(1);
    expect(c.warnings.join(" ")).toMatch(/Komplain 8 hari/);
  });
});

describe("deteksi job bersambung (belum ditandai multi-hari)", () => {
  it("menandai pelanggan sama di hari berdampingan", () => {
    // Kasus nyata: Bapak Sonny Vista, Install 16 & 17 April.
    const h16 = job({ id: "A", date: "2026-04-16", customer: "SONNY", customer_id: "C1", service: "Install" });
    const h17 = { id: "B", date: "2026-04-17", customer: "SONNY", customer_id: "C1", service: "Install" };
    expect(cariJobBersambung(h16, [h17])).toHaveLength(1);
    expect(cariJobBersambung(h17, [h16])).toHaveLength(1);
  });

  it("jarak 2 hari tidak ditandai", () => {
    const a = job({ id: "A", date: "2026-04-16", customer_id: "C1" });
    const b = { id: "B", date: "2026-04-18", customer: "IBU MINA", customer_id: "C1" };
    expect(cariJobBersambung(a, [b])).toHaveLength(0);
  });

  it("kunjungan Complain di hari berikutnya BUKAN job bersambung", () => {
    const a = job({ id: "A", date: "2026-04-16", customer_id: "C1" });
    const komp = { id: "B", date: "2026-04-17", customer: "IBU MINA", customer_id: "C1", service: "Complain" };
    expect(cariJobBersambung(a, [komp])).toHaveLength(0);
    // ...tapi tetap muncul sebagai peringatan komplain.
    expect(cariKomplain30Hari(a, [komp])).toHaveLength(1);
  });

  it("job yang sudah bertanda multi-hari tidak perlu peringatan tebakan", () => {
    const a = job({ id: "A", date: "2026-04-16", is_multi_day: true, customer_id: "C1" });
    const b = { id: "B", date: "2026-04-17", customer: "IBU MINA", customer_id: "C1" };
    expect(cariJobBersambung(a, [b])).toHaveLength(0);
  });
});
