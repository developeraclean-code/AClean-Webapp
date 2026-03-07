// api/test-connection.js
// Vercel Serverless Function — test koneksi WA (Fonnte) dan LLM
// Dipanggil dari Settings → "Test & Simpan Koneksi"

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const { type, provider, token, device } = req.body || {};

  // ════════════════════════════════════════════════════════
  // TEST WA — Fonnte
  // ════════════════════════════════════════════════════════
  if (type === "wa") {
    // Token bisa dari request body (diisi di Settings) atau env var
    const fonnteToken = token || process.env.FONNTE_TOKEN;

    if (!fonnteToken) {
      return res.status(200).json({
        success: false,
        message: "❌ Token Fonnte belum diisi. Masukkan token di kolom API Token."
      });
    }

    try {
      // Endpoint Fonnte untuk cek status device / validasi token
      const r = await fetch("https://api.fonnte.com/get-devices", {
        method: "POST",
        headers: { "Authorization": fonnteToken }
      });

      const data = await r.json();

      // Fonnte mengembalikan status: true jika token valid
      if (data.status === true) {
        const devices = data.data || [];
        const deviceInfo = devices.length > 0
          ? devices.map(d => `${d.name || d.device} (${d.status || "unknown"})`).join(", ")
          : "device terhubung";

        // Jika token valid, simpan ke env (hanya berlaku di runtime ini — untuk server pake Vercel env)
        return res.status(200).json({
          success: true,
          message: `✅ Fonnte terhubung! Device: ${deviceInfo}`,
          devices
        });

      } else {
        return res.status(200).json({
          success: false,
          message: `❌ Token tidak valid: ${data.reason || data.message || "cek token di dashboard Fonnte"}`
        });
      }

    } catch (err) {
      return res.status(200).json({
        success: false,
        message: `❌ Gagal koneksi ke Fonnte: ${err.message}`
      });
    }
  }

  // ════════════════════════════════════════════════════════
  // TEST LLM
  // ════════════════════════════════════════════════════════
  if (type === "llm") {
    const llmProvider = provider || process.env.LLM_PROVIDER || "gemini";
    const llmApiKey   = token    || process.env.LLM_API_KEY;
    const llmModel    = req.body.model || process.env.LLM_MODEL;

    if (!llmApiKey) {
      return res.status(200).json({
        success: false,
        message: "❌ API Key LLM belum diisi."
      });
    }

    try {
      let ok = false;
      let modelUsed = llmModel;

      if (llmProvider === "gemini") {
        const model = llmModel || "gemini-2.5-flash";
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${llmApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: "Balas hanya: OK" }] }],
              generationConfig: { maxOutputTokens: 10 }
            })
          }
        );
        const d = await r.json();
        ok = !!d.candidates?.[0]?.content;
        modelUsed = model;

      } else if (llmProvider === "claude") {
        const model = llmModel || "claude-sonnet-4-6";
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": llmApiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model, max_tokens: 10,
            messages: [{ role: "user", content: "Balas hanya: OK" }]
          })
        });
        const d = await r.json();
        ok = !!d.content?.[0]?.text;
        modelUsed = model;

      } else if (llmProvider === "openai") {
        const model = llmModel || "gpt-4o-mini";
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${llmApiKey}` },
          body: JSON.stringify({
            model, max_tokens: 10,
            messages: [{ role: "user", content: "Balas hanya: OK" }]
          })
        });
        const d = await r.json();
        ok = !!d.choices?.[0]?.message;
        modelUsed = model;

      } else if (llmProvider === "ollama") {
        const baseUrl = req.body.ollamaUrl || "http://localhost:11434";
        const model   = llmModel || "llama3";
        const r = await fetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: "OK", stream: false })
        });
        const d = await r.json();
        ok = !!d.response;
        modelUsed = model;
      }

      if (ok) {
        return res.status(200).json({
          success: true,
          message: `✅ ${llmProvider.charAt(0).toUpperCase()+llmProvider.slice(1)} terhubung! Model: ${modelUsed}`
        });
      } else {
        return res.status(200).json({
          success: false,
          message: `❌ API Key valid tapi model tidak merespons — cek model: ${modelUsed}`
        });
      }

    } catch (err) {
      return res.status(200).json({
        success: false,
        message: `❌ Gagal koneksi ke ${llmProvider}: ${err.message}`
      });
    }
  }

  return res.status(400).json({ success: false, message: "type harus 'wa' atau 'llm'" });
}
