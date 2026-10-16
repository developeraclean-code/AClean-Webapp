// Upgrade kunjungan Complain pada order yang sama. Jangan membuat child Repair:
// satu kunjungan harus tetap punya satu ID job, laporan, dan alur invoice.
export const COMPLAIN_REPAIR_MARKER = "[UPGRADED_FROM_COMPLAIN]";

export const isUpgradedComplainRepair = order =>
  order?.service === "Repair" && !order?.parent_job_id &&
  String(order?.notes || "").includes(COMPLAIN_REPAIR_MARKER);

export const isComplainWarrantyFlow = order =>
  order?.service === "Complain" || isUpgradedComplainRepair(order);

export const preserveComplainRepairNotes = (originalOrder, editedNotes) => {
  const notes = String(editedNotes || "").trim();
  if (!isUpgradedComplainRepair(originalOrder) || notes.includes(COMPLAIN_REPAIR_MARKER)) return notes;
  return [notes, COMPLAIN_REPAIR_MARKER].filter(Boolean).join("\n");
};

const REPORTABLE_STATUSES = [
  "PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "WORKING", "IN_PROGRESS", "CONTINUED", "COMPLETED",
];

export async function upgradeComplainToRepair(supabase, order, actorName) {
  if (!order?.id) throw new Error("ID job Complain tidak tersedia.");

  // Order lama yang sudah punya Repair terpisah tidak boleh ikut dikonversi:
  // laporan/invoice anaknya harus direkonsiliasi oleh admin lebih dulu.
  const [children, reports, invoices, currentResult] = await Promise.all([
    supabase.from("orders").select("id").eq("parent_job_id", order.id).eq("service", "Repair").neq("status", "CANCELLED").limit(1),
    supabase.from("service_reports").select("id").eq("job_id", order.id).limit(1),
    supabase.from("invoices").select("id").eq("job_id", order.id).neq("status", "CANCELLED").limit(1),
    supabase.from("orders").select("*").eq("id", order.id).maybeSingle(),
  ]);
  for (const result of [children, reports, invoices, currentResult]) {
    if (result.error) throw result.error;
  }
  if (children.data?.length) return { status: "blocked", reason: `Job ini sudah punya Repair terpisah (${children.data[0].id}). Minta admin menyatukan data lama.` };
  const current = currentResult.data;
  if (!current) return { status: "blocked", reason: "Job Complain tidak ditemukan lagi." };
  if (isUpgradedComplainRepair(current)) return { status: "already-upgraded", order: current };
  if (current.service !== "Complain") return { status: "blocked", reason: `Job sudah berjenis ${current.service}.` };
  if (reports.data?.length || invoices.data?.length) {
    return { status: "blocked", reason: "Job sudah mempunyai laporan atau invoice. Minta admin memeriksa sebelum mengubah layanan." };
  }
  if (!REPORTABLE_STATUSES.includes(current.status)) {
    return { status: "blocked", reason: `Status ${current.status} tidak dapat di-upgrade.` };
  }

  const notes = [String(current.notes || "").trim(), COMPLAIN_REPAIR_MARKER].filter(Boolean).join("\n");
  // Compare-and-swap di DB: hanya satu pemanggil dapat mengubah Complain menjadi Repair.
  // updated_at juga mencegah kita menimpa notes yang baru diedit oleh pengguna lain.
  let mutation = supabase.from("orders")
    .update({ service: "Repair", notes, last_changed_by: actorName || null })
    .eq("id", order.id).eq("service", "Complain")
    .in("status", REPORTABLE_STATUSES);
  if (current.updated_at) mutation = mutation.eq("updated_at", current.updated_at);
  const { data: updated, error } = await mutation.select("*").maybeSingle();
  if (error) throw error;
  if (updated) return { status: "upgraded", order: updated };

  // Klik kedua / perangkat lain kalah CAS. Ambil hasil pemenang tanpa membuat job baru.
  const latest = await supabase.from("orders").select("*").eq("id", order.id).maybeSingle();
  if (latest.error) throw latest.error;
  if (isUpgradedComplainRepair(latest.data)) return { status: "already-upgraded", order: latest.data };
  return { status: "blocked", reason: "Job berubah saat diproses. Muat ulang dan periksa statusnya." };
}
