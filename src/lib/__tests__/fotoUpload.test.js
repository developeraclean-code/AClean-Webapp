import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { handleFotoUpload } from "../fotoUpload.js";

afterEach(() => vi.unstubAllGlobals());

describe("technician photo upload", () => {
  it("tries the server even when the browser reports offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("crypto", webcrypto);
    const file = { name: "foto.jpg", size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    const input = { files: [file], value: "foto.jpg" };
    let photos = [];
    const apiFetch = vi.fn(async () => new Response(JSON.stringify({
      success: true, url: "https://example.test/foto.jpg",
    }), { status: 200 }));

    await handleFotoUpload({ target: input }, {
      _apiFetch: apiFetch,
      appSettings: {},
      compressImg: async () => "data:image/jpeg;base64,AQIDBA==",
      currentUser: { id: "tech-1", role: "Technician" },
      fotoTargetUnitRef: { current: null },
      fotoUnitInputRef: { current: null },
      laporanFotos: [],
      laporanModal: { id: "JOB-1" },
      setLaporanFotos: update => { photos = update(photos); },
      showNotif: vi.fn(),
    });

    expect(apiFetch).toHaveBeenCalledOnce();
    expect(photos).toEqual([expect.objectContaining({
      url: "https://example.test/foto.jpg", uploading: false,
    })]);
    expect(photos[0].queued).toBeUndefined();
    expect(input.value).toBe("");
  });
});
