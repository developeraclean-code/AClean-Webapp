import { describe, expect, it } from "vitest";
import { scheduleNoteJobErrors, scheduleNoteJobsPayload } from "../scheduleNotePlanning.js";

const validJob = {
  customer: "Pelanggan QA", phone: "081234567890", address: "Alamat QA blok A",
  service: "Cleaning", time: "09:00", time_end: "10:30", units: 2,
  team_slot: "Team 01", teknisi: "Teknisi QA", date: "2026-11-23", raw: "Job QA",
};

describe("schedule note Planning Order confirmation", () => {
  it("requires every field the Planning Order transaction needs", () => {
    expect(scheduleNoteJobErrors(validJob)).toEqual([]);
    expect(scheduleNoteJobErrors({ ...validJob, customer: "", phone: "", address: "", team_slot: "", teknisi: "" }))
      .toEqual(expect.arrayContaining([
        "Nama pelanggan belum lengkap", "Nomor WhatsApp belum valid", "Alamat belum lengkap",
        "Tim Planning belum dipilih", "Teknisi belum dipilih",
      ]));
  });

  it("normalizes Indonesian phones and emits only order fields", () => {
    const [payload] = scheduleNoteJobsPayload([{ ...validJob, orderDraftId: "JOB-SN-test", phone: "+62 812-3456-7890" }]);
    expect(payload).toMatchObject({
      id: "JOB-SN-test", customer: "Pelanggan QA", phone: "6281234567890",
      date: "2026-11-23", service: "Cleaning", units: 2, team_slot: "Team 01",
      teknisi: "Teknisi QA", notes: "Job QA",
    });
    expect(payload).not.toHaveProperty("requestId");
  });
});
