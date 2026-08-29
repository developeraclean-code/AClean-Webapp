import { describe, it, expect } from "vitest";
import { pickSuggestionsToClose, CLOSE_AMOUNT_TOLERANCE } from "../paymentSuggestionClose.js";
import { samePhone } from "../phone.js";

const inv = (over = {}) => ({ id: "INV-1", phone: "628111", total: 190000, job_id: "JOB-1", ...over });
const sug = (over = {}) => ({ id: "s1", phone: "628111", amount: 190000, status: "PENDING", invoice_id: null, ...over });

describe("pickSuggestionsToClose", () => {
  it("menutup bukti dgn HP & nominal cocok", () => {
    expect(pickSuggestionsToClose(inv(), [sug()], samePhone).map(s => s.id)).toEqual(["s1"]);
  });

  it("TIDAK menutup bukti milik customer lain walau nominal sama", () => {
    expect(pickSuggestionsToClose(inv(), [sug({ phone: "628999" })], samePhone)).toHaveLength(0);
  });

  it("TIDAK menutup kalau nominal beda — customer bisa punya >1 invoice", () => {
    // Inti penjaganya: nomor HP saja tidak cukup. IBU MARISKA punya invoice 400rb sekaligus
    // keluhan berjalan; bukti 190rb miliknya tidak boleh menutup invoice 400rb.
    expect(pickSuggestionsToClose(inv({ total: 400000 }), [sug({ amount: 190000 })], samePhone)).toHaveLength(0);
  });

  it("memaafkan selisih kecil (biaya admin transfer)", () => {
    expect(pickSuggestionsToClose(inv(), [sug({ amount: 190000 - CLOSE_AMOUNT_TOLERANCE })], samePhone)).toHaveLength(1);
    expect(pickSuggestionsToClose(inv(), [sug({ amount: 190000 - CLOSE_AMOUNT_TOLERANCE - 1 })], samePhone)).toHaveLength(0);
  });

  it("TIDAK menyentuh bukti yang sudah tertaut invoice LAIN", () => {
    expect(pickSuggestionsToClose(inv(), [sug({ invoice_id: "INV-LAIN" })], samePhone)).toHaveLength(0);
  });

  it("boleh menutup bukti yang sudah tertaut invoice ini sendiri (sisa retro-match lama)", () => {
    expect(pickSuggestionsToClose(inv(), [sug({ invoice_id: "INV-1" })], samePhone)).toHaveLength(1);
  });

  it("melewati baris yang bukan PENDING", () => {
    expect(pickSuggestionsToClose(inv(), [sug({ status: "CONFIRMED" })], samePhone)).toHaveLength(0);
    expect(pickSuggestionsToClose(inv(), [sug({ status: "DISMISSED" })], samePhone)).toHaveLength(0);
  });

  it("melewati bukti tanpa nominal terbaca (amount null/0)", () => {
    expect(pickSuggestionsToClose(inv(), [sug({ amount: null })], samePhone)).toHaveLength(0);
    expect(pickSuggestionsToClose(inv(), [sug({ amount: 0 })], samePhone)).toHaveLength(0);
  });

  it("menutup beberapa bukti kalau customer mengirim ulang nominal sama", () => {
    const out = pickSuggestionsToClose(inv(), [sug(), sug({ id: "s2" })], samePhone);
    expect(out.map(s => s.id)).toEqual(["s1", "s2"]);
  });

  it("invoice tanpa HP / tanpa nilai → tidak menutup apa pun", () => {
    expect(pickSuggestionsToClose(inv({ phone: null }), [sug()], samePhone)).toHaveLength(0);
    expect(pickSuggestionsToClose(inv({ total: 0 }), [sug()], samePhone)).toHaveLength(0);
  });

  it("format nomor beda (62 vs 0) tetap dianggap sama lewat samePhone", () => {
    expect(pickSuggestionsToClose(inv({ phone: "08111" }), [sug({ phone: "628111" })], samePhone)).toHaveLength(1);
  });
});
