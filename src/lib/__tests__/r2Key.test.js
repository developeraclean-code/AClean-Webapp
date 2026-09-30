import { describe, expect, it } from "vitest";
import { encodeR2CanonicalPath, extractR2Key, mapWithConcurrency } from "../../../api/_r2-key.js";

describe("extractR2Key", () => {
  it("membaca proxy foto relatif yang dipakai database", () => {
    expect(extractR2Key("/api/foto?key=wa-group%2F2026-06%2Ffoto%201.jpg"))
      .toBe("wa-group/2026-06/foto 1.jpg");
  });

  it("membaca proxy foto absolut", () => {
    expect(extractR2Key("https://a-clean-webapp.vercel.app/api/foto?key=expenses%2Fa.jpg"))
      .toBe("expenses/a.jpg");
  });

  it("membaca endpoint S3 R2 dengan nama bucket", () => {
    expect(extractR2Key("https://abc.r2.cloudflarestorage.com/aclean-files/backup/2026-09-01/orders.json"))
      .toBe("backup/2026-09-01/orders.json");
  });

  it("membaca public R2 URL dan key polos", () => {
    expect(extractR2Key("https://pub-test.r2.dev/laporan/JOB-1/a.jpg")).toBe("laporan/JOB-1/a.jpg");
    expect(extractR2Key("laporan/JOB-1/a.jpg")).toBe("laporan/JOB-1/a.jpg");
  });

  it("menolak traversal dan input kosong", () => {
    expect(extractR2Key("../secret")).toBeNull();
    expect(extractR2Key("")).toBeNull();
  });
});

describe("encodeR2CanonicalPath", () => {
  it("meng-encode karakter khusus tanpa merusak separator folder", () => {
    expect(encodeR2CanonicalPath("aclean-files", "laporan/JOB 1/foto #1.jpg"))
      .toBe("/aclean-files/laporan/JOB%201/foto%20%231.jpg");
  });
});

describe("mapWithConcurrency", () => {
  it("menjaga urutan hasil dan mengisolasi kegagalan item", async () => {
    const result = await mapWithConcurrency([1, 2, 3], 2, async value => {
      if (value === 2) throw new Error("gagal");
      return value * 2;
    });
    expect(result[0]).toEqual({ status: "fulfilled", value: 2 });
    expect(result[1].status).toBe("rejected");
    expect(result[2]).toEqual({ status: "fulfilled", value: 6 });
  });
});
