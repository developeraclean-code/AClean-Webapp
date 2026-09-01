import { describe, it, expect, afterEach } from "vitest";
import { fotoUrl, r2Key } from "../fotoUrl.js";

const setCdn = (v) => { import.meta.env.VITE_R2_CDN_URL = v; };
afterEach(() => { delete import.meta.env.VITE_R2_CDN_URL; });

describe("r2Key — ambil key dari semua bentuk yang pernah tersimpan di DB", () => {
  it("bentuk proxy", () => {
    expect(r2Key("/api/foto?key=laporan%2FJOB-1%2Fa.jpg")).toBe("laporan/JOB-1/a.jpg");
  });
  it("proxy absolut + query tambahan", () => {
    expect(r2Key("https://app.vercel.app/api/foto?key=laporan%2Fa.jpg&v=2")).toBe("laporan/a.jpg");
  });
  it("domain r2.dev", () => {
    expect(r2Key("https://pub-e159.r2.dev/laporan/JOB-1/a.jpg")).toBe("laporan/JOB-1/a.jpg");
  });
  it("endpoint S3 privat", () => {
    expect(r2Key("https://acc.r2.cloudflarestorage.com/aclean-files/wa/b.jpg")).toBe("wa/b.jpg");
  });
  it("path polos", () => {
    expect(r2Key("laporan/JOB-1/a.jpg")).toBe("laporan/JOB-1/a.jpg");
  });
  it("URL luar bukan R2 → kosong", () => {
    expect(r2Key("https://example.com/x.jpg")).toBe("");
  });
  it("idempotent: URL CDN sendiri dikenali sebagai key", () => {
    setCdn("https://cdn.aclean.id");
    expect(r2Key("https://cdn.aclean.id/laporan/JOB-1/a.jpg")).toBe("laporan/JOB-1/a.jpg");
  });
});

describe("fotoUrl — tanpa CDN (perilaku lama harus persis sama)", () => {
  it("semua bentuk jatuh ke proxy", () => {
    expect(fotoUrl("laporan/JOB-1/a.jpg")).toBe("/api/foto?key=laporan%2FJOB-1%2Fa.jpg");
    expect(fotoUrl("https://pub-e159.r2.dev/laporan/a.jpg")).toBe("/api/foto?key=laporan%2Fa.jpg");
  });
  it("hormati apiBase portal", () => {
    expect(fotoUrl("laporan/a.jpg", { apiBase: "/api" })).toBe("/api/foto?key=laporan%2Fa.jpg");
  });
  it("supabase & URL luar lewat apa adanya", () => {
    expect(fotoUrl("https://x.supabase.co/storage/a.jpg")).toBe("https://x.supabase.co/storage/a.jpg");
    expect(fotoUrl("https://example.com/x.jpg")).toBe("https://example.com/x.jpg");
  });
  it("kosong → string kosong", () => {
    expect(fotoUrl("")).toBe("");
    expect(fotoUrl(null)).toBe("");
  });
});

describe("fotoUrl — dengan CDN aktif", () => {
  it("gambar langsung ke CDN, tidak lewat Vercel", () => {
    setCdn("https://cdn.aclean.id");
    expect(fotoUrl("/api/foto?key=laporan%2FJOB-1%2Fa.jpg")).toBe("https://cdn.aclean.id/laporan/JOB-1/a.jpg");
    expect(fotoUrl("https://pub-e159.r2.dev/wa/b.png")).toBe("https://cdn.aclean.id/wa/b.png");
  });
  it("trailing slash di env tidak bikin dobel slash", () => {
    setCdn("https://cdn.aclean.id/");
    expect(fotoUrl("laporan/a.jpg")).toBe("https://cdn.aclean.id/laporan/a.jpg");
  });
  it("PDF & HTML TETAP lewat proxy (aturan PDF selalu segar)", () => {
    setCdn("https://cdn.aclean.id");
    expect(fotoUrl("/api/foto?key=invoices%2F123_Invoice_A.pdf")).toBe("/api/foto?key=invoices%2F123_Invoice_A.pdf");
    expect(fotoUrl("service-reports/rep.html")).toBe("/api/foto?key=service-reports%2Frep.html");
  });
  it("karakter aneh di key ter-encode, slash tetap utuh", () => {
    setCdn("https://cdn.aclean.id");
    expect(fotoUrl("wa/2026-08/foto a+b.jpg")).toBe("https://cdn.aclean.id/wa/2026-08/foto%20a%2Bb.jpg");
  });
});
