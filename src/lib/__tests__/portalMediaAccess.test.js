import { describe, expect, it } from "vitest";
import { authorizePortalMedia, portalTokenKind } from "../../../api/_portal-media-access.js";

const customerToken = "a".repeat(48);
const maintenanceToken = `mtk_${"b".repeat(40)}`;
const projectToken = `ptk_${"c".repeat(40)}`;
const ownKey = "laporan/JOB-1/one.jpg";
const otherKey = "laporan/JOB-2/other.jpg";
const env = { SUPABASE_URL: "https://db.example.test", SUPABASE_SERVICE_KEY: "test-only" };

function apiFixture(data) {
  const requests = [];
  const fetchImpl = async url => {
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    requests.push({ table, query: parsed.searchParams });
    return { ok: true, json: async () => data[table] || [] };
  };
  return { fetchImpl, requests };
}

describe("portal media access", () => {
  it("mengenali hanya token portal yang valid", () => {
    expect(portalTokenKind(customerToken)).toBe("customer");
    expect(portalTokenKind(maintenanceToken)).toBe("maintenance");
    expect(portalTokenKind(projectToken)).toBe("project");
    expect(portalTokenKind("invalid")).toBeNull();
  });

  it("customer hanya dapat foto di laporan VERIFIED milik order nomornya", async () => {
    const fixture = apiFixture({
      customer_tokens: [{ phone: "628123456789", expires_at: "2099-01-01T00:00:00Z" }],
      orders: [{ id: "JOB-1" }],
      service_reports: [{ foto_urls: ["https://pub-test.r2.dev/laporan/JOB-1/one.jpg"], fotos: [] }],
    });
    expect(await authorizePortalMedia(customerToken, ownKey, { ...fixture, env })).toEqual({ status: 200, allowed: true });
    expect(await authorizePortalMedia(customerToken, otherKey, { ...fixture, env })).toEqual({ status: 404, allowed: false });
    expect(fixture.requests.find(request => request.table === "service_reports").query.get("status")).toBe("eq.VERIFIED");
  });

  it("token customer kedaluwarsa berhenti sebelum query foto", async () => {
    const fixture = apiFixture({ customer_tokens: [{ phone: "628123456789", expires_at: "2020-01-01T00:00:00Z" }] });
    expect(await authorizePortalMedia(customerToken, ownKey, { ...fixture, env })).toEqual({ status: 401, allowed: false });
    expect(fixture.requests).toHaveLength(1);
  });

  it("metadata foto JSON lama tetap diperiksa dan tanggal kedaluwarsa rusak ditolak", async () => {
    const fixture = apiFixture({
      customer_tokens: [{ phone: "628123456789", expires_at: "2099-01-01T00:00:00Z" }],
      orders: [{ id: "JOB-1" }],
      service_reports: [{ foto_urls: [], fotos: JSON.stringify([{ url: ownKey, unit_no: 1 }]) }],
    });
    expect(await authorizePortalMedia(customerToken, ownKey, { ...fixture, env })).toEqual({ status: 200, allowed: true });
    const invalid = apiFixture({ customer_tokens: [{ phone: "628123456789", expires_at: "invalid-date" }] });
    expect(await authorizePortalMedia(customerToken, ownKey, { ...invalid, env })).toEqual({ status: 401, allowed: false });
  });

  it("maintenance memeriksa token aktif dan foto dari client yang sama", async () => {
    const fixture = apiFixture({
      maintenance_clients: [{ id: "CLIENT-1", token_active: true, token_expires_at: null }],
      maintenance_logs: [{ photos: ["maintenance/CLIENT-1/one.jpg"] }],
    });
    expect(await authorizePortalMedia(maintenanceToken, "maintenance/CLIENT-1/one.jpg", { ...fixture, env }))
      .toEqual({ status: 200, allowed: true });
    expect(await authorizePortalMedia(maintenanceToken, "maintenance/CLIENT-2/one.jpg", { ...fixture, env }))
      .toEqual({ status: 404, allowed: false });
    expect(fixture.requests.find(request => request.table === "maintenance_logs").query.get("client_id")).toBe("eq.CLIENT-1");
  });

  it("project hanya dapat foto laporan terverifikasi dan token aktif", async () => {
    const fixture = apiFixture({
      project_projects: [{ id: "PROJECT-1", token_active: true }],
      project_daily_reports: [{ foto_urls: ["projects/PROJECT-1/one.jpg"] }],
    });
    expect(await authorizePortalMedia(projectToken, "projects/PROJECT-1/one.jpg", { ...fixture, env }))
      .toEqual({ status: 200, allowed: true });
    expect(await authorizePortalMedia(projectToken, otherKey, { ...fixture, env }))
      .toEqual({ status: 404, allowed: false });
    expect(fixture.requests.find(request => request.table === "project_daily_reports").query.get("status")).toBe("eq.VERIFIED");
  });

  it("kegagalan database ditutup dengan 503, tidak membuka media", async () => {
    const fetchImpl = async () => { throw new Error("database offline"); };
    expect(await authorizePortalMedia(customerToken, ownKey, { fetchImpl, env }))
      .toEqual({ status: 503, allowed: false });
  });
});
