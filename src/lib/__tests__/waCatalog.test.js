import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogCaption, catalogPrice } from "../waCatalog.js";
import { deliverWorkspaceMessage, validateWorkspacePayload, verifyCatalogMedia } from "../../../api/_wa-workspace.js";

const id = "11111111-1111-4111-8111-111111111111";
const item = { id, title: "SOP Cleaning Service", description: "Pembersihan unit indoor dan outdoor", image_key: "catalog/example.jpg", price_source: "price_list", source_id: "24", fixed_price: null, is_active: true };
const originalCdn = process.env.R2_CDN_URL;
const originalPublic = process.env.R2_PUBLIC_URL;
afterEach(() => { process.env.R2_CDN_URL = originalCdn; process.env.R2_PUBLIC_URL = originalPublic; });

function fakeDb(catalog = item, price = { price: 95000, is_active: true }) {
  return { from(table) {
    const query = { select: () => query, eq: () => query, single: async () => ({ data: table === "wa_catalog_items" ? catalog : price }) };
    return query;
  } };
}

describe("Katalog WA", () => {
  it("reads the current price and image from saved records, ignoring client-supplied media", async () => {
    process.env.R2_CDN_URL = "https://cdn.example.test";
    const payload = await validateWorkspacePayload(fakeDb(), { phone: "081234567890", kind: "CATALOG", catalog_id: id, message: "Halo Pak", });
    expect(payload).toMatchObject({ phone: "6281234567890", kind: "CATALOG", url: "https://cdn.example.test/catalog/example.jpg", message: "Halo Pak\n\nSOP Cleaning Service\n\nPembersihan unit indoor dan outdoor\n\nHarga: Rp 95.000" });
    expect(payload).not.toHaveProperty("filename", "example.jpg");
    await expect(validateWorkspacePayload(fakeDb(), { phone: "081234567890", kind: "CATALOG", catalog_id: id, message: "Halo", url: "https://evil.test/image.jpg" })).rejects.toThrow("tersimpan");
  });
  it("blocks inactive items, unavailable prices, and missing public media domain", async () => {
    process.env.R2_CDN_URL = "https://cdn.example.test";
    const body = { phone: "081234567890", kind: "CATALOG", catalog_id: id, message: "Halo" };
    await expect(validateWorkspacePayload(fakeDb({ ...item, is_active: false }), body)).rejects.toThrow("tidak aktif");
    await expect(validateWorkspacePayload(fakeDb(item, { price: 95000, is_active: false }), body)).rejects.toThrow("tidak aktif");
    delete process.env.R2_CDN_URL; delete process.env.R2_PUBLIC_URL;
    await expect(validateWorkspacePayload(fakeDb(), body)).rejects.toThrow("Domain publik R2");
  });
  it("keeps the catalog preview and Fonnte payload aligned", async () => {
    expect(catalogPrice(item, [{ id: 24, price: 95000, is_active: true }])).toBe(95000);
    expect(catalogCaption(item, 95000)).toContain("Rp 95.000");
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true, id: ["fonnte-id"] }) });
    const result = await deliverWorkspaceMessage({ phone: "6281234567890", message: "SOP\n\nHarga: Rp 95.000", url: "https://cdn.example.test/catalog/example.jpg" }, { token: "test", fetchImpl });
    expect(result.status).toBe("ACCEPTED");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ target: "6281234567890", message: "SOP\n\nHarga: Rp 95.000", url: "https://cdn.example.test/catalog/example.jpg" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("checks that a public image can be fetched before spending a Fonnte send", async () => {
    const headers = new Map([["content-type", "image/jpeg"], ["content-length", "12345"]]);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, headers: { get: name => headers.get(name) } });
    await expect(verifyCatalogMedia("https://cdn.example.test/catalog/example.jpg", { fetchImpl })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("https://cdn.example.test/catalog/example.jpg", expect.objectContaining({ method: "HEAD" }));
    headers.set("content-type", "text/html");
    await expect(verifyCatalogMedia("https://cdn.example.test/catalog/example.jpg", { fetchImpl })).rejects.toThrow("Foto katalog");
  });
});
