import { describe, expect, it } from "vitest";
import { appendEmergencyRecord } from "../emergencyVault.js";
import {
  buildEmergencyReportPackage, createEmergencyAssignment, ensureEmergencyAssignment,
  openEmergencyReportPackage, reportFieldsFromPackage, validateEmergencyAssignment,
} from "../emergencyHandoff.js";

function incident() {
  const base = { active: true, incidentId: "EMG-20261004-1200-TEST", nextSequence: 1, records: [], events: [] };
  const state = appendEmergencyRecord(base, "order", { customer: "Belfood", date: "2026-10-04", service: "Cleaning", team: "Team A+B", plannedUnits: "14" });
  return ensureEmergencyAssignment(state, state.records[0].id);
}

describe("emergency technician handoff", () => {
  it("exports only the assigned order and validates package shape", () => {
    const state = incident();
    const assignment = createEmergencyAssignment(state, state.records[0].id);
    expect(validateEmergencyAssignment(assignment)).toBe(assignment);
    expect(assignment.order.customer).toBe("Belfood");
    expect(assignment.token).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(assignment)).not.toContain("events");
    expect(createEmergencyAssignment(ensureEmergencyAssignment(state, state.records[0].id), state.records[0].id).token).toBe(assignment.token);
  });

  it("accepts two teams with actual units different from planning, without invoice or stock writes", async () => {
    let state = incident();
    const assignment = createEmergencyAssignment(state, state.records[0].id);
    for (const [tech, units] of [["Rey", "10"], ["Yusuf", "7"]]) {
      const encrypted = await buildEmergencyReportPackage(assignment,
        { technician: tech, team: tech, actualUnits: units, work: `Cleaning ${units} unit`, materials: "Freon 1 kg" },
        [{ name: `${tech}.jpg`, dataUrl: "data:image/jpeg;base64,/9j/" }]);
      expect(JSON.stringify(encrypted)).not.toContain(tech);
      expect(JSON.stringify(encrypted)).not.toContain("Freon");
      const payload = await openEmergencyReportPackage(state, encrypted);
      state = appendEmergencyRecord(state, "report", reportFieldsFromPackage(payload));
      await expect(openEmergencyReportPackage(state, encrypted)).rejects.toThrow("sudah pernah diimpor");
    }
    expect(state.records.filter(row => row.type === "report").map(row => row.fields.actualUnits)).toEqual(["10", "7"]);
    expect(state.records.filter(row => row.type === "report").every(row => row.reconciliation.status === "pending")).toBe(true);
    expect(state.records.some(row => row.type === "invoice")).toBe(false);
  });

  it("rejects wrong assignment, tampering, and malformed field report", async () => {
    const state = incident();
    const assignment = createEmergencyAssignment(state, state.records[0].id);
    await expect(buildEmergencyReportPackage(assignment, { technician: "", team: "A", actualUnits: "1", work: "Cleaning" })).rejects.toThrow("teknisi");
    const encrypted = await buildEmergencyReportPackage(assignment, { technician: "A", team: "A", actualUnits: "1", work: "Cleaning" });
    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + "AAAA" };
    await expect(openEmergencyReportPackage(state, tampered)).rejects.toThrow("gagal dibuka");
    await expect(openEmergencyReportPackage({ ...state, incidentId: "EMG-other" }, encrypted)).rejects.toThrow("insiden lain");
  });
});
