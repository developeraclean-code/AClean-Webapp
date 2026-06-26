import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @sentry/react sebelum import helper (vi.hoisted krn vi.mock di-hoist ke atas).
const { captureException, addBreadcrumb } = vi.hoisted(() => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
vi.mock("@sentry/react", () => ({ captureException, addBreadcrumb }));

import { reportError, breadcrumb } from "../reportError.js";

describe("reportError", () => {
  beforeEach(() => { captureException.mockClear(); addBreadcrumb.mockClear(); });

  it("meneruskan Error ke Sentry dgn tag lokasi + extra", () => {
    const err = new Error("simpan gagal");
    reportError("project.guard.persist", err, { id: "a1" });
    expect(captureException).toHaveBeenCalledTimes(1);
    const [passedErr, opts] = captureException.mock.calls[0];
    expect(passedErr).toBe(err);
    expect(opts.tags.silent_sink).toBe("project.guard.persist");
    expect(opts.extra).toEqual({ id: "a1" });
  });

  it("membungkus non-Error (string) jadi Error", () => {
    reportError("x.y", "boom");
    const [passedErr] = captureException.mock.calls[0];
    expect(passedErr).toBeInstanceOf(Error);
    expect(passedErr.message).toBe("boom");
  });

  it("tidak pernah throw walau Sentry melempar", () => {
    captureException.mockImplementationOnce(() => { throw new Error("sentry down"); });
    expect(() => reportError("z", new Error("e"))).not.toThrow();
  });

  it("breadcrumb dicatat sbg warning", () => {
    breadcrumb("0 baris kena", { op: "allocate" });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warning", message: "0 baris kena", data: { op: "allocate" } })
    );
  });
});
