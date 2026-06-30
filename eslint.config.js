// Konfigurasi ESLint minimal — fokus mencegah ERROR SENYAP, bukan gaya kode.
// Sengaja ramping: tanpa plugin React/hooks (terlalu berisik utk codebase ini).
// Aturan utama: catch kosong dilarang → error tidak boleh ditelan diam-diam.
//
// Jalankan: npm run lint
import js from "@eslint/js";
import globals from "globals";
import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "e2e/**", "api/**", "scripts/**", "*.config.js"],
  },
  {
    files: ["src/**/*.{js,jsx}"],
    // Jangan ribut soal `eslint-disable` yg "tak terpakai" (react-hooks sengaja
    // off) — fokus warning ke yg penting (catch kosong).
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      // Pakai parser Babel (sama dgn Vite/@vitejs/plugin-react) supaya JSX +
      // sintaks modern di App.jsx dkk ter-parse (espree gagal di beberapa file).
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { presets: ["@babel/preset-react"] },
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Inti Plan 1: blok kosong (termasuk catch) = error senyap → GATE.
      // Backlog 26 existing sudah dibersihkan (reportError / komentar alasan).
      // Catch kosong baru = build merah. Untuk sengaja abaikan: beri komentar
      // alasan di dalam blok, atau panggil reportError().
      "no-empty": ["error", { allowEmptyCatch: false }],
      // Promise yang di-await tapi error tak ditangani gampang jadi senyap juga.
      "no-unsafe-finally": "warn",
      // rules-of-hooks = ERROR (gate): tangkap hook kondisional / hook setelah
      // early-return — persis kelas bug yang bikin outage React #310 (useMemo di
      // bawah `if (!isLoggedIn) return`). Hook WAJIB unconditional di top-level.
      "react-hooks/rules-of-hooks": "error",
      // exhaustive-deps tetap off — terlalu berisik utk codebase ini, dan salah
      // dep ≠ crash (beda kelas dgn rules-of-hooks). Bisa dinaikkan nanti.
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
