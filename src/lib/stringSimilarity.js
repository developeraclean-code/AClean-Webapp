// Levenshtein distance + similarity score (0-1) — dipakai untuk membedakan "typo kecil"
// (masih dianggap sama) dari "beda sungguhan" (harus diblok/diwarn), tanpa exact-match
// yang terlalu ketat. Diekstrak dari approveInvoiceCore.js (dulu private di sana) supaya
// dipakai bareng oleh guard lain (mis. deteksi ruangan/unit mirip yang sudah terdaftar).
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => { const row = [i]; row.length = n + 1; return row; });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// similarity("IBU OLIVIA", "IBU OLIVA") → ~0.9 (0 = beda total, 1 = identik)
export function similarity(a, b) {
  const s1 = a || "", s2 = b || "";
  const maxLen = Math.max(s1.length, s2.length) || 1;
  return 1 - levenshtein(s1, s2) / maxLen;
}
