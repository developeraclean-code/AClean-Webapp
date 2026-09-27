import { describe, expect, it, vi } from "vitest";
import { captureOptionalCheckin } from "../fieldCheckin.js";

const fixedNow = () => new Date("2026-09-27T08:00:00.000Z");

describe("optional field check-in", () => {
  it("records one precise snapshot when permission succeeds", async () => {
    const getCurrentPosition = vi.fn(success => success({
      coords: { latitude: -6.278944444, longitude: 106.670172222, accuracy: 12.6 },
    }));
    const result = await captureOptionalCheckin({ geolocation: { getCurrentPosition } }, fixedNow);
    expect(result).toEqual({
      on_site_at: "2026-09-27T08:00:00.000Z",
      on_site_latitude: -6.2789444,
      on_site_longitude: 106.6701722,
      on_site_accuracy_m: 13,
      on_site_location_captured_at: "2026-09-27T08:00:00.000Z",
    });
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000,
    });
  });

  it("still checks in without coordinates when permission is denied", async () => {
    const navigatorLike = { geolocation: { getCurrentPosition: (_ok, denied) => denied(new Error("denied")) } };
    await expect(captureOptionalCheckin(navigatorLike, fixedNow)).resolves.toEqual({
      on_site_at: "2026-09-27T08:00:00.000Z",
    });
  });

  it("still checks in when geolocation is unavailable", async () => {
    await expect(captureOptionalCheckin({}, fixedNow)).resolves.toEqual({
      on_site_at: "2026-09-27T08:00:00.000Z",
    });
  });
});
