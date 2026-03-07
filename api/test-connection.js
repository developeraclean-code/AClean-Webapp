// api/test-connection.js
// Vercel Serverless Function — test koneksi WA (Fonnte) dan LLM

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const { type, provider, token, device, model, ollamaUrl } = req.body || {};

  // ════════════════════════════════════════════════════════
  // TEST WA — Fonnte
  // ════════════════════════════════════════════════════════
  if (type === "wa") {
    // Token = DEVICE TOKEN dari Fonnte dashboard (bukan account token)
    const fonnteToken = (token || "").trim() || (process.env.FONNTE_TOKEN || "").trim();

    if (!fonnteToken) {
      return res.status(200).json({
        success: false,
        message: "❌ Token belum diisi. Masukkan Device Token dari Fonnte Dashboard → Device → klik device kamu → copy token."
      });
    }

    // ── Coba endpoint /device (pakai DEVICE TOKEN) ──────────────────────────
    // Ini endpoint yang benar untuk token per-device, bukan /get-devices
    try {
      const r = await fetch("https://api.fonnte.com/device", {
        method: "POST",
        headers: {
          "Authorization": fonnteToken,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      });

      const data = await r.json();

      if (data.status === true) {
        const d   = data.data || {};
        const name   = d.name   || d.device || "device";
        const status = d.status || "connected";
        const quota  = d.quota  !== undefined ? ` · Kuota: ${d.quota}` : "";
        return res.status(200).json({
          success: true,
          message: `✅ Fonnte terhubung! Device: ${name} (${status})${quota}`
        });
      }

      // status false — cek reason
      const reason = data.reason || data.message || "";

      // "unknown user" = token salah / token account dipakai di sini
      if (reason.includes("unknown") || reason.includes("invalid") || reason.includes("unauthorized")) {
        return res.status(200).json({
          success: false,
          message: `❌ Token tidak dikenali. Pastikan kamu copy DEVICE TOKEN (bukan account token):\n1. Login fonnte.com\n2. Menu Device → pilih device kamu\n3. Klik device → copy token di halaman itu`
        });
      }

      // Device belum scan QR / offline
      if (reason.includes("disconnect") || status === "disconnect") {
        return res.status(200).json({
          success: false,
          message: `⚠️ Device ditemukan tapi offline. Scan ulang QR di Fonnte Dashboard.`
        });
      }

      return res.status(200).json({
        success: false,
        message: `❌ Fonnte: ${reason || "token tidak valid"}`
      });

    } catch (err) {
      return res.status(200).json({
        success: false,
        message: `❌ Tidak bisa koneksi ke Fonnte: ${err.message}`
      });
    }
  }

  // ════════════════════════════════════════════════════════
  // TEST LLM
  // ════════════════════════════════════════════════════════
  if (type === "llm") {
    const llmProvider = provider || process.env.LLM_PROVIDER || "gemini";
    const llmApiKey   = (token || "").trim() || (process.env.LLM_API_KEY || "").trim();
    const llmModel    = model || process.env.LLM_MODEL;

    if (!llmApiKey && llmProvider !== "ollama") {
      return res.status(200).json({
        success: false,
        message: "❌ API Key LLM belum diisi."
      });
    }

    try {
      if (llmProvider === "gemini") {
        const m = llmModel || "gemini-2.5-flash";
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${llmApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: "Balas satu kata: OK" }] }],
              generationConfig: { maxOutputTokens: 5 }
            })
          }
        );
        const d = await r.json();
        if (d.error) throw new Error(d.error.message);
        const ok = !!d.candidates?.[0]?.content;
        return res.status(200).json({
          success: ok,
          message: ok ? `✅ Gemini terhubung! Model: ${m}` : `❌ Gemini tidak merespons`
        });

      } else if (llmProvider === "claude") {
        const m = llmModel || "claude-sonnet-4-6";
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": llmApiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({ model: m, max_tokens: 5, messages: [{ role: "user", content: "OK" }] })
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
        const ok = !!d.content?.[0]?.text;
        return res.status(200).json({
          success: ok,
          message: ok ? `✅ Claude terhubung! Model: ${m}` : `❌ Claude tidak merespons`
        });

      } else if (llmProvider === "openai") {
        const m = llmModel || "gpt-4o-mini";
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${llmApiKey}` },
          body: JSON.stringify({ model: m, max_tokens: 5, messages: [{ role: "user", content: "OK" }] })
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error.message);
        const ok = !!d.choices?.[0]?.message;
        return res.status(200).json({
          success: ok,
          message: ok ? `✅ OpenAI terhubung! Model: ${m}` : `❌ OpenAI tidak merespons`
        });

      } else if (llmProvider === "ollama") {
        const base = (ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
        const r = await fetch(`${base}/api/tags`, { method: "GET" }).catch(e => { throw new Error("Tidak bisa koneksi ke " + base + " — " + e.message); });
        const d = await r.json().catch(() => ({}));
        const models = (d.models || []).map(m => m.name || m.model).join(", ");
        return res.status(200).json({
          success: r.ok,
          message: r.ok
            ? `✅ Ollama terhubung! Model tersedia: ${models || "(kosong — jalankan: ollama pull llama3)"}`
            : `❌ Ollama error ${r.status}`
        });
      }

    } catch (err) {
      return res.status(200).json({
        success: false,
        message: `❌ ${llmProvider}: ${err.message}`
      });
    }
  }

  return res.status(400).json({ success: false, message: "type harus 'wa' atau 'llm'" });
}
