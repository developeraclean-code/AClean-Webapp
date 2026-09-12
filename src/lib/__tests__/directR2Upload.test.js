import { afterEach, describe, expect, it, vi } from "vitest";
import { tryDirectR2Upload } from "../directR2Upload.js";

describe("tryDirectR2Upload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete import.meta.env.VITE_R2_DIRECT_UPLOAD;
  });

  it("mengirim metadata kecil lalu PUT byte langsung ke R2", async () => {
    import.meta.env.VITE_R2_DIRECT_UPLOAD = "true";
    const blob = new Blob(["image-bytes"], { type: "image/jpeg" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ blob: async () => blob })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uploadUrl: "https://r2.test/signed", key: "laporan/JOB/a.jpg", url: "https://public.test/laporan/JOB/a.jpg", bucket: "aclean-files" }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const response = await tryDirectR2Upload("/api/upload-foto", {
      body: JSON.stringify({ base64: "data:image/jpeg;base64,aW1hZ2UtYnl0ZXM=", filename: "a.jpg", reportId: "JOB", mimeType: "image/jpeg" }),
    }, { "X-Internal-Token": "test" });

    expect(response).toBeInstanceOf(Response);
    expect((await response.json()).direct).toBe(true);
    const presignBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(presignBody).toMatchObject({ action: "presign", filename: "a.jpg", reportId: "JOB", size: blob.size });
    expect(presignBody.base64).toBeUndefined();
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "PUT", body: blob });
  });

  it("mengembalikan null supaya caller memakai fallback bila PUT gagal", async () => {
    import.meta.env.VITE_R2_DIRECT_UPLOAD = "true";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ blob: async () => new Blob(["x"], { type: "image/jpeg" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ uploadUrl: "https://r2.test/signed", key: "laporan/a.jpg" }) })
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    const result = await tryDirectR2Upload("/api/upload-foto", {
      body: JSON.stringify({ base64: "eA==", filename: "a.jpg", mimeType: "image/jpeg" }),
    }, {});
    expect(result).toBeNull();
  });

  it("tetap memakai jalur lama bila feature flag belum diaktifkan", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await tryDirectR2Upload("/api/upload-foto", {
      body: JSON.stringify({ base64: "eA==", filename: "a.jpg", mimeType: "image/jpeg" }),
    }, {});
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
