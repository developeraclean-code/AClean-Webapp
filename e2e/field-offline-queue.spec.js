import { test, expect } from "@playwright/test";

test.describe("Antrean lapangan offline — lokal saja", () => {
  test("manifest dan service worker lapangan terdaftar", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const manifest = document.querySelector('link[rel="manifest"]')?.getAttribute("href");
      const registration = await navigator.serviceWorker.ready;
      return { manifest, script: registration.active?.scriptURL || registration.installing?.scriptURL || "" };
    });
    expect(result.manifest).toBe("/manifest.webmanifest");
    expect(result.script).toContain("/field-sw.js");
  });

  test("status dan foto bertahan di IndexedDB lalu dapat dibersihkan", async ({ page, context }) => {
    await page.goto("/");
    await context.setOffline(true);
    const result = await page.evaluate(async () => {
      const queue = await import("/src/lib/fieldOfflineQueue.js");
      const userKey = "e2e-tech";
      await queue.enqueueFieldStatus({ orderId: "E2E-OFFLINE", status: "ON_SITE", actorName: "E2E", userKey });
      await queue.enqueueFieldStatus({ orderId: "E2E-OFFLINE", status: "WORKING", actorName: "E2E", userKey });
      await queue.enqueueFieldPhoto({
        jobId: "E2E-OFFLINE", id: "foto-1", hash: "hash-1",
        dataUrl: "data:image/jpeg;base64,eDI=", label: "Tes", unitNo: 1, role: "Teknisi", userKey,
      });
      await queue.enqueueFieldReportSubmit({
        jobId: "E2E-OFFLINE", actorName: "E2E", userKey,
        orderSnapshot: { customer: "Customer E2E" },
      });
      const rows = await queue.listFieldActions();
      const snapshot = rows.map(row => ({ id: row.id, type: row.type, status: row.status }));
      await Promise.all(rows.map(row => queue.removeFieldAction(row.id)));
      return { snapshot, remaining: (await queue.listFieldActions()).length };
    });

    expect(result.snapshot).toEqual(expect.arrayContaining([
      { id: "status:e2e-tech:E2E-OFFLINE:ON_SITE", type: "status", status: "ON_SITE" },
      { id: "status:e2e-tech:E2E-OFFLINE:WORKING", type: "status", status: "WORKING" },
      { id: "photo:e2e-tech:E2E-OFFLINE:hash-1", type: "photo", status: undefined },
      { id: "report:e2e-tech:E2E-OFFLINE", type: "report", status: undefined },
    ]));
    expect(result.snapshot).toHaveLength(4);
    expect(result.remaining).toBe(0);
  });

  test("antrean dan paket job terisolasi antar akun", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const queue = await import("/src/lib/fieldOfflineQueue.js");
      await queue.enqueueFieldStatus({ orderId: "JOB-A", status: "DISPATCHED", userKey: "tech-a" });
      await queue.enqueueFieldStatus({ orderId: "JOB-B", status: "ON_SITE", userKey: "tech-b" });
      await queue.cacheFieldJobPackage("tech-a", [{ id: "JOB-A", customer: "Alpha", date: "2026-09-27" }]);
      await queue.cacheFieldJobPackage("tech-b", [{ id: "JOB-B", customer: "Beta", date: "2026-09-27" }]);
      const a = await queue.listFieldActionsForUser("tech-a");
      const b = await queue.listFieldActionsForUser("tech-b");
      const pkgA = await queue.loadFieldJobPackage("tech-a");
      const pkgB = await queue.loadFieldJobPackage("tech-b");
      await Promise.all([...a, ...b].map(row => queue.removeFieldAction(row.id)));
      return {
        a: a.map(row => row.orderId), b: b.map(row => row.orderId),
        pkgA: pkgA.jobs.map(job => job.customer), pkgB: pkgB.jobs.map(job => job.customer),
      };
    });
    expect(result).toEqual({ a: ["JOB-A"], b: ["JOB-B"], pkgA: ["Alpha"], pkgB: ["Beta"] });
  });
});
