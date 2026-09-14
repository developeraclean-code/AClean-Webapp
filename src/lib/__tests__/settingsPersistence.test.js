import { describe, expect, it, vi } from "vitest";
import { normalizeAutomationJob, requireAppSettingsResult, saveAutomationToggle } from "../settingsPersistence.js";

describe("settingsPersistence", () => {
  it("menyamakan backendKey dan status job dengan toggle", () => {
    expect(normalizeAutomationJob({ name: "Cleanup", active: false }, "r2_cleanup_enabled", true))
      .toEqual({ name: "Cleanup", backendKey: "r2_cleanup_enabled", active: true });
  });

  it("mendeteksi app_settings yang gagal atau responsnya tidak valid", () => {
    expect(() => requireAppSettingsResult({ data: null, error: { message: "timeout" } })).toThrow("timeout");
    expect(() => requireAppSettingsResult({ data: null, error: null })).toThrow("Respons app_settings");
    expect(requireAppSettingsResult({ data: [], error: null })).toEqual([]);
  });

  it("mengembalikan cron_jobs kanonik dari RPC transaksional", async () => {
    const jobs = [{ backendKey: "r2_cleanup_enabled", active: true }];
    const rpc = vi.fn().mockResolvedValue({ data: jobs, error: null });

    await expect(saveAutomationToggle({ rpc }, {
      key: "r2_cleanup_enabled",
      enabled: true,
      job: { name: "Cleanup" },
    })).resolves.toEqual(jobs);

    expect(rpc).toHaveBeenCalledWith("set_automation_setting", {
      p_key: "r2_cleanup_enabled",
      p_enabled: true,
      p_job: { name: "Cleanup", backendKey: "r2_cleanup_enabled", active: true },
    });
  });

  it("melempar error dan tidak menganggap simpan berhasil saat RPC gagal", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(saveAutomationToggle({ rpc }, {
      key: "r2_cleanup_enabled",
      enabled: false,
      job: {},
    })).rejects.toThrow("database unavailable");
  });

  it("menolak respons cron_jobs yang rusak", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    await expect(saveAutomationToggle({ rpc }, {
      key: "r2_cleanup_enabled",
      enabled: true,
      job: {},
    })).rejects.toThrow("Respons cron_jobs");
  });
});
