// Foto dedup helper — Phase 2
// Cegah double-entry kalau foto yang sama dikirim ke beberapa grup oleh sender sama
// dalam window ±1 jam (lihat MEMORY → project_wa_ai_phase2_roadmap).
//
// Rule (sesuai konfirmasi Owner):
//  - Window: ±1 jam, semua grup, sender HARUS sama
//  - First-come wins. Yang duluan masuk DB jadi "kanonik", yang nyusul → marked duplicate, skip persist
//  - Deteksi via MD5 hash buffer R2 (foto sudah download saat R2 mirror)

import crypto from "node:crypto";

export function md5Buffer(buf) {
  if (!buf || !buf.length) return null;
  return crypto.createHash("md5").update(buf).digest("hex");
}

// Returns: { isDuplicate, refLogId, refGroupId } | { isDuplicate: false }
// Query: wa_group_logs WHERE sender_phone=X AND metadata->>'img_md5'=Y AND created_at within ±1h
export async function checkImageDuplicate({ SU, SK, md5, senderPhone, nowMs = Date.now() }) {
  if (!SU || !SK || !md5 || !senderPhone) return { isDuplicate: false };
  const fromIso = new Date(nowMs - 3600_000).toISOString();
  const toIso   = new Date(nowMs + 3600_000).toISOString();
  const url = SU + "/rest/v1/wa_group_logs?select=id,group_id,group_name,created_at"
    + "&sender_phone=eq." + encodeURIComponent(senderPhone)
    + "&metadata->>img_md5=eq." + encodeURIComponent(md5)
    + "&created_at=gte." + encodeURIComponent(fromIso)
    + "&created_at=lte." + encodeURIComponent(toIso)
    + "&order=created_at.asc&limit=1";
  try {
    const r = await fetch(url, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    if (!r.ok) return { isDuplicate: false };
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) {
      return { isDuplicate: true, refLogId: rows[0].id, refGroupId: rows[0].group_id, refGroupName: rows[0].group_name };
    }
    return { isDuplicate: false };
  } catch (_) {
    return { isDuplicate: false };
  }
}
