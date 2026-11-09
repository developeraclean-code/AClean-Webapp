import { describe, expect, it } from "vitest";
import { projectCrewMembers, projectReportCrew } from "../projectCrew.js";

describe("project crew attribution", () => {
  it("combines assigned roster members with named project roles without duplicates", () => {
    expect(projectCrewMembers({
      teknisi: "Rev", helper: "Fikri", assigned_members: ["Rev", "Fikri", "Yusuf"],
    }, ["Yusuf", "Ardi"])).toEqual(["Rev", "Fikri", "Yusuf", "Ardi"]);
  });

  it("stores all project crew names on the shared daily report", () => {
    expect(projectReportCrew({
      teknisi: "Rev", teknisi2: "Yusuf", helper: "Fikri", assigned_members: ["Rev", "Fikri", "Yusuf", "Ardi"],
    }, "Fikri")).toEqual({ teknisiName: "Rev", helperNames: ["Fikri", "Yusuf", "Ardi"] });
  });

  it("uses the submitting member as report lead only when no lead is assigned", () => {
    expect(projectReportCrew({ assigned_members: ["Fikri", "Yusuf"] }, "Fikri"))
      .toEqual({ teknisiName: "Fikri", helperNames: ["Yusuf"] });
  });
});
