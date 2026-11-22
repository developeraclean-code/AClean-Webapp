import { normalizePhone } from "./phone.js";

const SERVICES = new Set(["Cleaning", "Repair", "Install", "Complain", "Maintenance"]);
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function scheduleNoteJobErrors(job) {
  const errors = [];
  if (String(job?.customer || "").trim().length < 2) errors.push("Nama pelanggan belum lengkap");
  if (!/^\d{8,15}$/.test(normalizePhone(job?.phone))) errors.push("Nomor WhatsApp belum valid");
  if (String(job?.address || "").trim().length < 5) errors.push("Alamat belum lengkap");
  if (!SERVICES.has(job?.service)) errors.push("Layanan belum valid");
  if (!TIME.test(String(job?.time || "")) || !TIME.test(String(job?.time_end || ""))) errors.push("Jam mulai/selesai belum valid");
  if (!Number.isInteger(Number(job?.units)) || Number(job.units) < 1 || Number(job.units) > 100) errors.push("Jumlah unit belum valid");
  if (!String(job?.team_slot || "").trim()) errors.push("Tim Planning belum dipilih");
  if (!String(job?.teknisi || "").trim()) errors.push("Teknisi belum dipilih");
  return errors;
}

export function scheduleNoteJobsPayload(jobs) {
  return jobs.map(job => ({
    id: job.orderDraftId,
    customer: String(job.customer || "").trim(),
    phone: normalizePhone(job.phone),
    address: String(job.address || "").trim(),
    area: String(job.area || "").trim(),
    service: job.service,
    type: String(job.type || "AC Split 0.5-1PK"),
    units: Number(job.units),
    teknisi: String(job.teknisi || "").trim(),
    helper: String(job.helper || "").trim() || null,
    date: job.date,
    time: job.time,
    time_end: job.time_end,
    team_slot: String(job.team_slot || "").trim(),
    notes: String(job.raw || job.notes || "").trim(),
  }));
}
