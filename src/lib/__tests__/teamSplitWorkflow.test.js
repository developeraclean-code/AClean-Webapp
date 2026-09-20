import { describe, expect, it } from "vitest";
import {
  getTeamFinalizationOutcome,
  getTeamSplitProgress,
  isTeamSplitOrder,
  teamSplitGroupId,
} from "../teamSplitWorkflow.js";

describe("team split workflow", () => {
  const orders = [
    { id: "G-1", is_team_split: true, job_group_id: "G-1" },
    { id: "G-2", is_team_split: true, job_group_id: "G-1" },
    { id: "NORMAL", is_team_split: false, job_group_id: null },
  ];

  it("mengenali order dan group id secara eksplisit", () => {
    expect(isTeamSplitOrder(orders[0])).toBe(true);
    expect(teamSplitGroupId(orders[1])).toBe("G-1");
    expect(isTeamSplitOrder(orders[2])).toBe(false);
  });

  it("belum siap selama laporan semua tim belum masuk", () => {
    const state = getTeamSplitProgress(orders[0], orders, [
      { id: "R-1", job_id: "G-1", status: "SUBMITTED" },
    ]);
    expect(state).toMatchObject({ teamCount: 2, submittedCount: 1, verifiedCount: 0 });
    expect(state.allSubmitted).toBe(false);
    expect(state.allVerified).toBe(false);
  });

  it("siap hanya jika setiap order grup mempunyai laporan VERIFIED", () => {
    const state = getTeamSplitProgress(orders[0], orders, [
      { id: "R-1", job_id: "G-1", status: "VERIFIED" },
      { id: "R-2", job_id: "G-2", status: "VERIFIED" },
    ]);
    expect(state).toMatchObject({ teamCount: 2, submittedCount: 2, verifiedCount: 2 });
    expect(state.allSubmitted).toBe(true);
    expect(state.allVerified).toBe(true);
  });

  it("menerjemahkan hasil RPC tanpa menebak status dari UI", () => {
    expect(getTeamFinalizationOutcome({
      group: { id: "G-1", team_count: 3, verified_count: 2, ready: false },
      invoice: null,
    })).toEqual({
      groupId: "G-1", teamCount: 3, verifiedCount: 2,
      ready: false, waitingCount: 1, invoice: null,
    });
  });
});

