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
      // Inti Plan 1: catch kosong = error senyap. Warn dulu (25 existing belum
      // dibersihkan) — pakai reportError() atau beri komentar alasan utk lolos.
      // Naikkan ke "error" setelah backlog dibersihkan agar jadi gate CI.
      "no-empty": ["warn", { allowEmptyCatch: false }],
      // Promise yang di-await tapi error tak ditangani gampang jadi senyap juga.
      "no-unsafe-finally": "warn",
      // Belum di-enforce (codebase belum bersih) — daftarkan saja supaya komentar
      // `eslint-disable react-hooks/*` yang sudah ada di kode tidak jadi error.
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "off",
    },
  },
];
