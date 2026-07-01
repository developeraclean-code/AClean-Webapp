// uploadMergedInvoicePDFForWA — generate PDF invoice gabungan + upload R2 (cache DB).
// Diekstrak dari App.jsx (Fase 3, pola ctx). Return {url, filename} atau null.
export async function uploadMergedInvoicePDFForWA(invList, portalLink = null, {
  _apiFetch, _apiHeaders, computeMergedCacheKey, generateMergedInvoicePDFBlob, supabase,
} = {}) {
    try {
      if (!Array.isArray(invList) || invList.length === 0) return null;
      const { sortedIds, cacheKey } = computeMergedCacheKey(invList, portalLink);
      const first = sortedIds[0] || "merge";
      const filename = `Invoice_Gabungan_${first}_x${sortedIds.length}.pdf`;

      // Fast path: DB cache lookup (hanya variant nopl)
      if (!portalLink) {
        try {
          const { data } = await supabase
            .from("merged_pdf_cache")
            .select("pdf_url")
            .eq("cache_key", cacheKey)
            .maybeSingle();
          if (data?.pdf_url) {
            // Touch last_used (non-blocking)
            supabase.from("merged_pdf_cache")
              .update({ last_used: new Date().toISOString() })
              .eq("cache_key", cacheKey)
              .then(() => {});
            return { url: data.pdf_url, filename };
          }
        } catch (err) {
          console.warn("[uploadMergedInvoicePDFForWA] DB cache lookup failed:", err.message);
        }
      }

      // Generate + upload sync (return URL synchronously untuk WA send)
      const blob = await generateMergedInvoicePDFBlob(invList, portalLink);
      if (!blob) return null;
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await _apiFetch("/api/upload-foto", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({
          base64, filename,
          folder: "invoices", mimeType: "application/pdf"
        })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success || !d.key) {
        console.warn("[uploadMergedInvoicePDFForWA] upload response:", d);
        return null;
      }
      const pdfUrl = `${window.location.origin}/api/foto?key=${encodeURIComponent(d.key)}`;

      // Save ke DB cache (hanya variant nopl) — non-blocking
      if (!portalLink) {
        supabase.from("merged_pdf_cache")
          .upsert(
            {
              cache_key: cacheKey,
              invoice_ids: sortedIds,
              pdf_url: pdfUrl,
              generated_at: new Date().toISOString(),
              last_used: new Date().toISOString(),
            },
            { onConflict: "cache_key" }
          )
          .then(({ error }) => error && console.warn("[uploadMergedInvoicePDFForWA] DB cache upsert failed:", error.message));
      }
      return { url: pdfUrl, filename };
    } catch (err) {
      console.warn("[uploadMergedInvoicePDFForWA] gagal:", err.message);
      return null;
    }
}
