import { test, expect } from "@playwright/test";

test.describe("Antrean lapangan offline — lokal saja", () => {
  test("status dan foto bertahan di IndexedDB lalu dapat dibersihkan", async ({ page, context }) => {
    await page.goto("/");
    await context.setOffline(true);
    const result = await page.evaluate(async () => {
      const queue = await import("/src/lib/fieldOfflineQueue.js");
      await queue.enqueueFieldStatus({ orderId: "E2E-OFFLINE", status: "ON_SITE", actorName: "E2E" });
      await queue.enqueueFieldStatus({ orderId: "E2E-OFFLINE", status: "WORKING", actorName: "E2E" });
      await queue.enqueueFieldPhoto({
        jobId: "E2E-OFFLINE", id: "foto-1", hash: "hash-1",
        dataUrl: "data:image/jpeg;base64,eDI=", label: "Tes", unitNo: 1, role: "Teknisi",
      });
      const rows = await queue.listFieldActions();
      const snapshot = rows.map(row => ({ id: row.id, type: row.type, status: row.status }));
      await Promise.all(rows.map(row => queue.removeFieldAction(row.id)));
      return { snapshot, remaining: (await queue.listFieldActions()).length };
    });

    expect(result.snapshot).toEqual(expect.arrayContaining([
      { id: "status:E2E-OFFLINE:ON_SITE", type: "status", status: "ON_SITE" },
      { id: "status:E2E-OFFLINE:WORKING", type: "status", status: "WORKING" },
      { id: "photo:E2E-OFFLINE:hash-1", type: "photo", status: undefined },
    ]));
    expect(result.snapshot).toHaveLength(3);
    expect(result.remaining).toBe(0);
  });
});
