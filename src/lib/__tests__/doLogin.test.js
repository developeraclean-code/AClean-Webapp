import { describe, expect, it, vi } from "vitest";
import { doLogin } from "../doLogin.js";
function context(error, extra = {}) {
  const calls = Object.fromEntries(["_lsSave", "addAgentLog", "requestPushPermission", "setActiveMenu", "setActiveRole", "setCurrentUser", "setIsLoggedIn", "setLockoutUntil", "setLoginAttempts", "setLoginError", "showNotif"].map(key => [key, vi.fn()]));
  return { ...calls, _ls: (_key, fallback) => fallback, loginAttempts: 2,
    supabase: { auth: { signInWithPassword: vi.fn(async () => ({ error })), signOut: vi.fn() }, from: vi.fn() }, ...extra };
}
describe("login failure classification", () => {
  it.each([
    { status: 504, message: "Gateway timeout" },
    { status: 503, message: "Service unavailable" },
    { status: 500, message: "Database error querying schema" },
    { status: 429, message: "Rate limit" },
    { status: 400, code: "unexpected_failure", message: "Database unavailable" },
    { status: 0, message: "Network failed" },
  ])("does not count infrastructure errors as a bad password: $status", async error => {
    const ctx = context(error); await doLogin("synthetic@example.test", "SIMULATED", ctx);
    expect(ctx.setLoginAttempts).not.toHaveBeenCalled(); expect(ctx.setLockoutUntil).not.toHaveBeenCalled();
    expect(ctx.setIsLoggedIn).not.toHaveBeenCalled();
    expect(ctx.setLoginError).toHaveBeenLastCalledWith(expect.stringMatching(/layanan|koneksi/i));
  });
  it("retains the real invalid-password lockout", async () => {
    const ctx = context({ code: "invalid_credentials", status: 400, message: "Invalid login credentials" }, { loginAttempts: 4 });
    await doLogin("synthetic@example.test", "SIMULATED", ctx);
    expect(ctx.setLoginAttempts).toHaveBeenCalledWith(5);
    expect(ctx.setLockoutUntil).toHaveBeenCalledWith(expect.any(Number));
    expect(ctx.setLoginError).toHaveBeenLastCalledWith(expect.stringContaining("dikunci 5 menit"));
  });
  it("handles thrown network failures without consuming attempts", async () => {
    const ctx = context(null); ctx.supabase.auth.signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    await doLogin("synthetic@example.test", "SIMULATED", ctx);
    expect(ctx.setLoginAttempts).not.toHaveBeenCalled(); expect(ctx.setIsLoggedIn).not.toHaveBeenCalled();
  });
  it("does not mistake an unavailable profile for an inactive account or wrong password", async () => {
    const ctx = context(null);
    ctx.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "SIMULATED-USER" } }, error: null });
    ctx.supabase.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ error: { code: "APP_READ_PAUSED", message: "paused" } }) }) }) });
    await doLogin("synthetic@example.test", "SIMULATED", ctx);
    expect(ctx.setLoginError).toHaveBeenLastCalledWith(expect.stringContaining("profil belum dapat dimuat"));
    expect(ctx.setLoginAttempts).not.toHaveBeenCalled(); expect(ctx.setIsLoggedIn).not.toHaveBeenCalled();
    expect(ctx.supabase.auth.signOut).toHaveBeenCalledOnce();
  });
  it("keeps existing local lockout enforcement before sending Auth requests", async () => {
    const ctx = context(null, { _ls: () => Date.now() + 100_000 });
    await doLogin("synthetic@example.test", "SIMULATED", ctx);
    expect(ctx.supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
