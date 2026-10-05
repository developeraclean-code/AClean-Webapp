import { beforeEach, describe, expect, it } from "vitest";
import {
  activateEmergencyVault, activatePreparedEmergencyVault, appendEmergencyRecord,
  closeEmergencyIncident, emergencyCsv, exportEncryptedEmergencyVault,
  getEmergencyVaultMeta, prepareEmergencyVault, reconcileEmergencyRecord,
  unlockEmergencyVault, updateEmergencyVault,
} from "../emergencyVault.js";

const owner = { id: "owner-1", name: "Dedy", role: "Owner" };
const phrase = "frasa-sandi-darurat-aman-2026";
const local = new Map();

beforeEach(() => {
  local.clear();
  globalThis.window = { localStorage: {
    getItem: key => local.get(key) || null,
    setItem: (key, value) => local.set(key, value),
  } };
});

describe("emergency vault", () => {
  it("only a verified Owner can prepare a device", async () => {
    await expect(prepareEmergencyVault({ owner: { ...owner, role: "Admin" }, passphrase: phrase })).rejects.toThrow("Owner");
    await expect(activateEmergencyVault({ owner: { ...owner, role: "Teknisi" }, passphrase: phrase, reason: "outage" })).rejects.toThrow("Owner");
    expect(getEmergencyVaultMeta()).toBeNull();
  });

  it("prepares online and activates after session loss without Supabase requests", async () => {
    await prepareEmergencyVault({ owner, passphrase: phrase });
    expect(getEmergencyVaultMeta().active).toBe(false);
    await expect(activatePreparedEmergencyVault("wrong-password", "outage")).rejects.toThrow();
    const result = await activatePreparedEmergencyVault(phrase, "Supabase offline");
    expect(result.state.ownerId).toBe(owner.id);
    expect(result.state.active).toBe(true);
    expect((await unlockEmergencyVault(phrase)).state.incidentId).toBe(result.state.incidentId);
    expect(local.get("aclean:emergency:v1")).not.toContain("Supabase offline");
    expect(local.get("aclean:emergency:v1")).not.toContain("Dedy");
    const tampered = JSON.parse(local.get("aclean:emergency:v1"));
    tampered.ownerId = "attacker";
    local.set("aclean:emergency:v1", JSON.stringify(tampered));
    await expect(unlockEmergencyVault(phrase)).rejects.toThrow("rusak");
  });

  it("captures 200 jobs and two team reports each, retaining pending financial status", async () => {
    const active = await activateEmergencyVault({ owner, passphrase: phrase, reason: "test 24 jam" });
    let state = active.state;
    for (let i = 0; i < 200; i++) {
      state = appendEmergencyRecord(state, "order", { customer: `Customer ${i}`, date: "2026-10-04", service: "Cleaning", team: "Team A" });
      const orderRef = state.records.at(-1).id;
      state = appendEmergencyRecord(state, "report", { orderRef, team: "Team A", actualUnits: "2", work: "Cleaning 2 unit" });
      state = appendEmergencyRecord(state, "report", { orderRef, team: "Team B", actualUnits: "1", work: "Cleaning 1 unit" });
      state = appendEmergencyRecord(state, "payment", { orderRef, amount: "100000", proofRef: `bukti-${i}.jpg` });
    }
    expect(state.records).toHaveLength(800);
    expect(state.records.filter(row => row.type === "payment").every(row => row.reconciliation.status === "pending")).toBe(true);
    await expect(updateEmergencyVault(phrase, active.revision, current => appendEmergencyRecord(current, "report", {
      orderRef: "NONEXISTENT", team: "A", actualUnits: "1", work: "Cleaning",
    }))).rejects.toThrow("Pilih ID order");
    const saved = await updateEmergencyVault(phrase, active.revision, () => state);
    expect((await unlockEmergencyVault(phrase)).state.records).toHaveLength(800);
    expect(emergencyCsv(saved.state).split("\r\n")).toHaveLength(802);
    expect(exportEncryptedEmergencyVault()).not.toContain("bukti-199.jpg");
  }, 30_000);

  it("blocks stale writes, rejects closing pending records, and permits closing after reconciliation", async () => {
    const active = await activateEmergencyVault({ owner, passphrase: phrase, reason: "outage" });
    const saved = await updateEmergencyVault(phrase, active.revision, state => appendEmergencyRecord(state, "order", {
      customer: "Bapak Rian", date: "2026-10-04", service: "Install", team: "Rey",
    }));
    await expect(updateEmergencyVault(phrase, active.revision, state => state)).rejects.toThrow("tab lain");
    await expect(updateEmergencyVault(phrase, saved.revision, closeEmergencyIncident)).rejects.toThrow("belum direkonsiliasi");
    const reconciled = await updateEmergencyVault(phrase, saved.revision, state =>
      reconcileEmergencyRecord(state, state.records[0].id, "JOB-REAL-1", "Dicek manual"));
    const closed = await updateEmergencyVault(phrase, reconciled.revision, closeEmergencyIncident);
    expect(closed.state.active).toBe(false);
    await expect(unlockEmergencyVault(phrase)).rejects.toThrow("ditutup");
  });

  it("neutralizes spreadsheet formulas in customer fields", async () => {
    const active = await activateEmergencyVault({ owner, passphrase: phrase, reason: "outage" });
    const state = appendEmergencyRecord(active.state, "order", {
      customer: "=IMPORTXML(\"https://example.invalid\")", date: "2026-10-04", service: "Cleaning", team: "A",
    });
    expect(emergencyCsv(state)).toContain("'=IMPORTXML");
  });

  it("does not fall through to the normal app when the local archive is corrupt", () => {
    local.set("aclean:emergency:v1", "{broken");
    expect(getEmergencyVaultMeta()).toMatchObject({ active: true, corrupt: true });
  });
});
