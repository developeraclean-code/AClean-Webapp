// api/ara-chat.js
// Vercel Serverless Function — proxy LLM untuk ARA Internal (Owner/Admin)
// API key AMAN di server, tidak terekspos ke browser

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, bizContext, brainMd, provider, model, ollamaUrl } = req.body || {};
  if (!messages?.length) return res.status(400).json({ error: "messages required" });

  // Ambil API key dari environment (aman di server)
  const apiKey   = process.env.LLM_API_KEY;
  const llmProv  = provider  || process.env.LLM_PROVIDER || "gemini";
  const llmModel = model     || process.env.LLM_MODEL    || "gemini-2.5-flash";

  // Build system prompt dari brainMd + bizContext
  const sysP = (typeof brainMd === "string" ? brainMd : "") +
    `\n\n## DATA BISNIS LIVE\n${JSON.stringify(bizContext || {})}\n\n` +
    `## TOOL — ACTIONS TERSEDIA\nGunakan [ACTION]{...}[/ACTION] untuk eksekusi operasi. Format JSON:\n` +
    `- {"type":"CREATE_ORDER","customer":"...","service":"...","units":1,"date":"YYYY-MM-DD","time":"HH:MM","teknisi":"...","phone":"...","address":"..."}\n` +
    `- {"type":"UPDATE_ORDER_STATUS","id":"ORD-xxx","status":"COMPLETED"}\n` +
    `- {"type":"RESCHEDULE_ORDER","id":"ORD-xxx","date":"YYYY-MM-DD","time":"HH:MM","teknisi":"..."}\n` +
    `- {"type":"CANCEL_ORDER","id":"ORD-xxx","reason":"..."}\n` +
    `- {"type":"CREATE_INVOICE","order_id":"ORD-xxx"}\n` +
    `- {"type":"APPROVE_INVOICE","id":"INV-xxx"}\n` +
    `- {"type":"MARK_PAID","id":"INV-xxx"}\n` +
    `- {"type":"UPDATE_INVOICE","id":"INV-xxx","field":"labor","value":100000}\n` +
    `- {"type":"SEND_REMINDER","invoice_id":"INV-xxx"}\n` +
    `- {"type":"MARK_INVOICE_OVERDUE"}\n` +
    `- {"type":"DISPATCH_WA","order_id":"ORD-xxx"}\n` +
    `- {"type":"SEND_WA","phone":"628xxx","message":"..."}\n` +
    `- {"type":"UPDATE_STOCK","code":"MAT001","delta":5,"reason":"..."}\n` +
    `Hanya gunakan 1 ACTION per response. Konfirmasi ke user setelah eksekusi.`;

  try {
    let reply = "";

    if (llmProv === "gemini") {
      if (!apiKey) return res.status(503).json({ error: "LLM_API_KEY not configured" });

      const geminiTools = [{
        functionDeclarations: [
          { name:"create_order", description:"Buat order baru",
            parameters:{ type:"OBJECT", properties:{
              customer:{type:"STRING"}, phone:{type:"STRING"}, address:{type:"STRING"},
              service:{type:"STRING"}, units:{type:"NUMBER"}, teknisi:{type:"STRING"},
              helper:{type:"STRING"}, date:{type:"STRING"}, time:{type:"STRING"}, notes:{type:"STRING"}
            }, required:["customer","service","date"]}},
          { name:"update_order_status", description:"Update status order",
            parameters:{ type:"OBJECT", properties:{ id:{type:"STRING"}, status:{type:"STRING"} }, required:["id","status"]}},
          { name:"reschedule_order", description:"Jadwal ulang order",
            parameters:{ type:"OBJECT", properties:{ id:{type:"STRING"}, date:{type:"STRING"}, time:{type:"STRING"}, teknisi:{type:"STRING"} }, required:["id","date"]}},
          { name:"cancel_order", description:"Batalkan order",
            parameters:{ type:"OBJECT", properties:{ id:{type:"STRING"}, reason:{type:"STRING"} }, required:["id"]}},
          { name:"create_invoice", description:"Buat invoice dari order selesai",
            parameters:{ type:"OBJECT", properties:{ order_id:{type:"STRING"} }, required:["order_id"]}},
          { name:"approve_invoice", description:"Approve invoice",
            parameters:{ type:"OBJECT", properties:{ id:{type:"STRING"} }, required:["id"]}},
          { name:"mark_invoice_paid", description:"Tandai invoice lunas",
            parameters:{ type:"OBJECT", properties:{ id:{type:"STRING"} }, required:["id"]}},
          { name:"update_invoice", description:"Edit field invoice",
            parameters:{ type:"OBJECT", properties:{ id:{type:"STRING"}, field:{type:"STRING"}, value:{type:"STRING"} }, required:["id","field","value"]}},
          { name:"send_reminder", description:"Kirim reminder WA invoice",
            parameters:{ type:"OBJECT", properties:{ invoice_id:{type:"STRING"} }, required:["invoice_id"]}},
          { name:"mark_invoice_overdue", description:"Tandai semua invoice overdue",
            parameters:{ type:"OBJECT", properties:{}}},
          { name:"dispatch_wa", description:"Kirim dispatch WA ke teknisi",
            parameters:{ type:"OBJECT", properties:{ order_id:{type:"STRING"} }, required:["order_id"]}},
          { name:"send_wa", description:"Kirim WA ke nomor tertentu",
            parameters:{ type:"OBJECT", properties:{ phone:{type:"STRING"}, message:{type:"STRING"} }, required:["phone","message"]}},
          { name:"update_stock", description:"Update stok material",
            parameters:{ type:"OBJECT", properties:{ code:{type:"STRING"}, name:{type:"STRING"}, delta:{type:"NUMBER"}, reason:{type:"STRING"} }, required:["delta"]}},
        ]
      }];

      const rawMsgs = messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));
      const contents = rawMsgs.reduce((acc, msg) => {
        if (acc.length === 0 && msg.role !== "user") return acc;
        const prev = acc[acc.length-1];
        if (prev && prev.role === msg.role)
          return [...acc.slice(0,-1), { role:prev.role, parts:[...prev.parts, ...msg.parts] }];
        return [...acc, msg];
      }, []);

      const fr = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${llmModel}:generateContent?key=${apiKey}`,
        { method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            system_instruction: { parts:[{ text:sysP }] },
            contents,
            tools: geminiTools,
            generationConfig: { maxOutputTokens:1500 }
          })
        }
      );
      const fd = await fr.json();
      if (!fr.ok) throw new Error(fd.error?.message || "Gemini error " + fr.status);

      const parts = fd.candidates?.[0]?.content?.parts || [];
      const funcCall = parts.find(p => p.functionCall);
      const textPart = parts.find(p => p.text)?.text || "";

      if (funcCall) {
        const fn = funcCall.functionCall;
        const args = fn.args || {};
        const actionMap = {
          create_order:         { type:"CREATE_ORDER",          ...args },
          update_order_status:  { type:"UPDATE_ORDER_STATUS",   ...args },
          reschedule_order:     { type:"RESCHEDULE_ORDER",      ...args },
          cancel_order:         { type:"CANCEL_ORDER",          ...args },
          create_invoice:       { type:"CREATE_INVOICE",        ...args },
          approve_invoice:      { type:"APPROVE_INVOICE",       ...args },
          mark_invoice_paid:    { type:"MARK_PAID",             ...args },
          update_invoice:       { type:"UPDATE_INVOICE",        ...args },
          send_reminder:        { type:"SEND_REMINDER",         ...args },
          mark_invoice_overdue: { type:"MARK_INVOICE_OVERDUE"           },
          dispatch_wa:          { type:"DISPATCH_WA",           ...args },
          send_wa:              { type:"SEND_WA",               ...args },
          update_stock:         { type:"UPDATE_STOCK",          ...args },
        };
        const action = actionMap[fn.name];
        reply = (textPart ? textPart + "\n" : "") +
                (action ? "[ACTION]" + JSON.stringify(action) + "[/ACTION]" : "Aksi tidak dikenali: " + fn.name);
      } else {
        reply = textPart;
      }

    } else if (llmProv === "ollama") {
      const baseUrl = (ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
      const fr = await fetch(baseUrl + "/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model: llmModel || "llama3", stream:false,
          messages: [{ role:"system", content:sysP }, ...messages] })
      });
      if (!fr.ok) throw new Error("Ollama error " + fr.status);
      const fd = await fr.json();
      reply = fd.message?.content || fd.response || "";

    } else if (llmProv === "openai") {
      if (!apiKey) return res.status(503).json({ error: "LLM_API_KEY not configured" });
      const fr = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+apiKey},
        body: JSON.stringify({ model: llmModel || "gpt-4o-mini", max_tokens:1500,
          messages: [{ role:"system", content:sysP }, ...messages] })
      });
      const fd = await fr.json();
      if (!fr.ok) throw new Error(fd.error?.message || "OpenAI error " + fr.status);
      reply = fd.choices?.[0]?.message?.content || "";

    } else {
      // Claude / Anthropic (default)
      if (!apiKey) return res.status(503).json({ error: "LLM_API_KEY not configured" });
      const fr = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":apiKey,
                 "anthropic-version":"2023-06-01","anthropic-beta":"messages-2023-06-01"},
        body: JSON.stringify({ model: llmModel || "claude-sonnet-4-6",
          max_tokens:1500, system:sysP, messages })
      });
      const fd = await fr.json();
      if (!fr.ok) throw new Error(fd.error?.message || "Claude error " + fr.status);
      reply = fd.content?.map(c => c.text || "").join("") || "";
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("ara-chat error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
