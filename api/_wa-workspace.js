import { validateAndNormalizePhone } from "./_validate.js";

export async function dispatchWorkspaceMessage(db, id, payload, actor, deliver) {
  const { data: claim, error } = await db.rpc("claim_wa_send", { p_id: id, p_payload: payload, p_actor: actor });
  if (error) throw new Error(error.message);
  if (!claim.claimed) return { ...claim.row, replayed: true };
  let outcome;
  try { outcome = await deliver(payload); }
  catch (error) { outcome = { status: "UNCERTAIN", error: error.message || "Koneksi terputus" }; }
  const { data: row, error: finishError } = await db.rpc("finish_wa_send", {
    p_id: id, p_status: outcome.status, p_error: outcome.error || null, p_provider_id: outcome.provider_id || null,
  });
  // Provider may already have accepted it. Never resend when audit fails.
  if (finishError) return { ...claim.row, status: outcome.status, audit_pending: true, error: `Audit belum tersimpan: ${finishError.message}` };
  return row;
}

export async function deliverWorkspaceMessage(payload, { token = process.env.FONNTE_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) return { status: "FAILED", error: "Gateway WhatsApp belum dikonfigurasi" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    // Exactly one attempt. A timeout must not trigger a fallback text or duplicate document.
    const response = await fetchImpl("https://api.fonnte.com/send", {
      method: "POST", headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ target: payload.phone, message: payload.message, ...(payload.url ? { url: payload.url, filename: payload.filename } : {}), countryCode: "62" }), signal: controller.signal,
    });
    const body = await response.json();
    if (response.ok && body.status === true) return { status: "ACCEPTED", provider_id: Array.isArray(body.id) ? body.id.join(",") : String(body.id || "") };
    if (body.status === false) return { status: "FAILED", error: String(body.reason || "Gateway menolak pesan") };
    return { status: "UNCERTAIN", error: "Respons gateway tidak memastikan hasil pengiriman" };
  } catch (error) { return { status: "UNCERTAIN", error: error.name === "AbortError" ? "Gateway melewati batas waktu; periksa WhatsApp sebelum mengirim lagi" : "Koneksi gateway terputus; status pengiriman belum pasti" }; }
  finally { clearTimeout(timer); }
}

export async function validateWorkspacePayload(db, body) {
  const phone = validateAndNormalizePhone(body.phone);
  const kind = body.kind || "TEXT";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!phone || !message || message.length > 4096 || !["TEXT", "INVOICE", "REPORT", "SERVICE_REMINDER"].includes(kind)) throw new Error("Nomor, pesan, atau jenis pengiriman tidak valid");
  const payload = { phone, kind, message, customer_id: body.customer_id || null, document_id: body.document_id || null, url: body.url || null, filename: body.filename || null };
  const same = value => validateAndNormalizePhone(value) === phone;
  if (kind === "SERVICE_REMINDER") {
    const { data, error } = await db.from("customers").select("id,phone").eq("id", payload.customer_id).single();
    if (error || !data || !same(data.phone)) throw new Error("Lokasi pelanggan tidak sesuai nomor tujuan");
  }
  if (["INVOICE", "REPORT"].includes(kind)) {
    if (!payload.document_id || !/^https:\/\//i.test(payload.url || "") || !payload.filename?.toLowerCase().endsWith(".pdf")) throw new Error("PDF dan identitas dokumen wajib tersedia");
    if (kind === "INVOICE") {
      const { data, error } = await db.from("invoices").select("id,phone,status").eq("id", payload.document_id).single();
      if (error || !data || !same(data.phone) || !["APPROVED","UNPAID","OVERDUE","PARTIAL_PAID","PAID"].includes(data.status)) throw new Error("Invoice belum disetujui atau bukan milik nomor ini");
    } else {
      const { data, error } = await db.from("service_reports").select("id,job_id,status").eq("id", payload.document_id).single();
      if (error || data?.status !== "VERIFIED") throw new Error("Laporan belum diverifikasi");
      const { data: order, error: orderError } = await db.from("orders").select("phone").eq("id", data.job_id).single();
      if (orderError || !order || !same(order.phone)) throw new Error("Laporan bukan milik nomor ini");
    }
  } else if (payload.url || payload.document_id) throw new Error("Lampiran hanya untuk invoice atau laporan terverifikasi");
  return payload;
}
