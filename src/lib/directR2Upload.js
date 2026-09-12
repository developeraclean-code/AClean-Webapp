// Direct upload helper. Mengirim byte langsung browser -> Cloudflare R2 memakai
// presigned PUT URL. Return null berarti caller harus menjalankan fallback base64.

const jsonBody = (body) => {
  if (!body || typeof body !== "string") return null;
  try { return JSON.parse(body); } catch { return null; }
};

const dataToBlob = async (raw, mimeType) => {
  if (typeof raw !== "string" || !raw) return null;
  const dataUrl = raw.startsWith("data:") ? raw : `data:${mimeType};base64,${raw}`;
  const response = await fetch(dataUrl);
  return response.blob();
};

export async function tryDirectR2Upload(url, opts, headers) {
  // Opt-in selama trial: deployment tanpa env ini tetap 100% memakai jalur lama.
  if (import.meta.env.VITE_R2_DIRECT_UPLOAD !== "true") return null;
  if (!String(url || "").includes("/api/upload-foto")) return null;

  const payload = jsonBody(opts?.body);
  if (!payload?.base64 && !payload?.fileData) return null;

  try {
    const mimeType = payload.mimeType || payload.fileType || "application/octet-stream";
    const blob = await dataToBlob(payload.base64 || payload.fileData, mimeType);
    if (!blob?.size) return null;

    const presignResponse = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "presign",
        filename: payload.filename || payload.fileName,
        reportId: payload.reportId,
        folder: payload.folder,
        mimeType,
        hash: payload.hash,
        size: blob.size,
      }),
    });
    if (!presignResponse.ok) return null;
    const signed = await presignResponse.json().catch(() => null);
    if (!signed?.uploadUrl || !signed?.key) return null;

    const put = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: blob,
    });
    if (!put.ok) return null;

    return new Response(JSON.stringify({
      success: true,
      direct: true,
      url: signed.url,
      key: signed.key,
      bucket: signed.bucket,
      size: blob.size,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.warn("[R2_DIRECT_UPLOAD] fallback ke proxy:", err?.message || err);
    return null;
  }
}
