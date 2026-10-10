import { describe, expect, it } from "vitest";
import {
  buildOrderTeamAssignment,
  emptyOrderTeamAssignment,
  resolveRegularOrderTeam,
} from "../teamAssignment.js";

describe("team assignment order reguler", () => {
  it("mengganti seluruh personel lama ketika pindah slot", () => {
    const result = resolveRegularOrderTeam({
      teamSlot: "Team 06",
      members: [
        { name: "Rey", role: "teknisi" },
        { name: "Boim", role: "helper" },
      ],
      presetTeknisi: "Putra",
    });

    expect(result).toEqual({
      teknisi: "Rey",
      teknisi2: null,
      teknisi3: null,
      helper: "Boim",
      helper2: null,
      helper3: null,
      assigned_members: ["Rey", "Boim"],
    });
  });

  it("memetakan beberapa teknisi/helper sesuai role dan membersihkan sisa kolom", () => {
    expect(buildOrderTeamAssignment([
      { name: "Aji", role: "teknisi" },
      { name: "Dedi", role: "teknisi" },
      { name: "Ari", role: "helper" },
      { name: "Boim", role: "helper" },
    ])).toEqual({
      teknisi: "Aji",
      teknisi2: "Dedi",
      teknisi3: null,
      helper: "Ari",
      helper2: "Boim",
      helper3: null,
      assigned_members: ["Aji", "Dedi", "Ari", "Boim"],
    });
  });

  it("mengosongkan seluruh personel saat slot dilepas", () => {
    expect(resolveRegularOrderTeam({ teamSlot: "" })).toEqual(emptyOrderTeamAssignment());
  });

  it("menahan save bila slot terpilih belum memiliki roster atau preset", () => {
    expect(resolveRegularOrderTeam({
      teamSlot: "Team 09",
      members: [],
      presetTeknisi: "",
    })).toBeNull();
  });

  it("memakai preset sebagai fallback sambil membersihkan anggota slot lama", () => {
    expect(resolveRegularOrderTeam({
      teamSlot: "Team 09",
      members: [],
      presetTeknisi: "Samsul",
    })).toEqual({
      ...emptyOrderTeamAssignment(),
      teknisi: "Samsul",
      assigned_members: ["Samsul"],
    });
  });

  it("menyimpan anggota ke-4 per peran walau enam kolom legacy penuh", () => {
    const result = buildOrderTeamAssignment([
      { name: "Dedi", role: "teknisi" }, { name: "Rey", role: "teknisi" },
      { name: "Angga", role: "teknisi" }, { name: "Fikri", role: "teknisi" },
      { name: "Aji", role: "helper" }, { name: "Rizal", role: "helper" },
      { name: "Ezra", role: "helper" }, { name: "Boim", role: "helper" },
    ]);
    expect(result.teknisi3).toBe("Angga");
    expect(result.helper3).toBe("Ezra");
    expect(result.assigned_members).toEqual(["Dedi", "Rey", "Angga", "Fikri", "Aji", "Rizal", "Ezra", "Boim"]);
  });
});
