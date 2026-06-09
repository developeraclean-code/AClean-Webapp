// api/_expense-dedup.js
// Cross-source duplicate guard untuk biaya harian (kasbon / bensin / parkir / petty_cash).
//
// Masalah: 1 biaya bisa masuk dari >1 channel di hari yang sama →
//   - input via dashboard teknisi/helper (api/expense-submit.js)
//   - WA grup text-pattern "Bensin 20k" (api/[route].js)
//   - WA grup AI vision foto struk (api/_ai-vision.js, jalan paralel dgn text-pattern)
//   - WA Finance grup kasbon (api/[route].js)
// → semuanya nyangkut PENDING_AI dan double-count.
//
// Aturan dedup (per arahan Owner): teknisi_name + amount + date sama → dianggap duplikat,
// apa pun sumbernya. Cek dilakukan sebelum INSERT ke tabel `expenses`.
//
// Fail-open: kalau query gagal, kembalikan false (izinkan insert) supaya data tidak hilang.
export async function expenseDuplicateExists({ SU, SK, teknisiName, amount, date }) {
  const name = String(teknisiName || "").trim();
  const amt = Number(amount);
  if (!SU || !SK || !name || !amt || !date) return false;
  try {
    // ilike tanpa wildcard = exact match case-insensitive. Nama teknisi tidak mengandung '*'.
    const url = `${SU}/rest/v1/expenses?select=id`
      + `&date=eq.${encodeURIComponent(date)}`
      + `&amount=eq.${encodeURIComponent(amt)}`
      + `&teknisi_name=ilike.${encodeURIComponent(name)}`
      + `&limit=1`;
    const r = await fetch(url, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    console.error("[EXPENSE_DEDUP]", e?.message || e);
    return false;
  }
}
