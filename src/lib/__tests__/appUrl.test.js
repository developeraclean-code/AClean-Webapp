import { describe, expect, it } from "vitest";
import { APP_BASE_URL, normalizeAppBaseUrl } from "../appUrl.js";

describe("app URL cutover", () => {
  it.each([
    "https://a-clean-webapp.vercel.app",
    "https://a-clean-webapp.vercel.app/",
    "https://aclean.vercel.app/status/token",
    "https://status.aclean.id",
  ])("maps legacy host %s to Coolify", legacy => {
    expect(normalizeAppBaseUrl(legacy)).toBe(APP_BASE_URL);
  });

  it("preserves explicit non-legacy development origins", () => {
    expect(normalizeAppBaseUrl("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("fails closed to the Coolify app for invalid values", () => {
    expect(normalizeAppBaseUrl("not a URL")).toBe(APP_BASE_URL);
  });
});
