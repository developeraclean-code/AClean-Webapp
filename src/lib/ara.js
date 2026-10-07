// ARA produces reviewable proposals. All business mutations use the existing modules.
import { parseAraProposals } from "./araPolicy.js";
const pendingChats = new WeakSet();

export async function sendToARA(userMsg, {
  PRICE_LIST, TODAY, _apiHeaders, addAgentLog, araBottomRef,
  araImageData, araImageType, araLoading, araMessages, araSchedulingSuggest,
  buildAraContext, bulanIni, cariSlotKosong, currentUser, customersData,
  inventoryData, invoicesData, laporanReports, llmModel, llmProvider,
  ordersData, paymentSuggestions, priceListData, teknisiData, waConversations,
  setAraImageData, setAraImagePreview, setAraImageType, setAraInput, setAraLoading,
  setAraMessages, setLlmStatus,
}) {
  const input = String(userMsg || "").trim() || (araImageData ? "Tolong bantu tinjau gambar ini. Jangan melakukan perubahan transaksi." : "");
  if (!input || araLoading || pendingChats.has(setAraMessages)) return;
  pendingChats.add(setAraMessages);
  const newMessages = [...araMessages, { role: "user", content: input }];
  setAraMessages(newMessages);
  setAraInput("");
  setAraLoading(true);
  try {
    const bizContext = buildAraContext({
      today: TODAY, bulanIni, ordersData, invoicesData, inventoryData, customersData,
      laporanReports, teknisiData, waConversations, paymentSuggestions, priceListData,
      PRICE_LIST, cariSlotKosong, araSchedulingSuggest,
    });
    const response = await fetch("/api/ara-chat", {
      method: "POST", headers: await _apiHeaders(),
      body: JSON.stringify({
        messages: newMessages.slice(-20).map(m => ({ role: m.role, content: m.content })),
        bizContext, provider: llmProvider, model: llmModel,
        ...(araImageData ? { imageData: araImageData, imageType: araImageType } : {}),
      }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.reply) throw new Error(data.error || `ARA gagal merespons (HTTP ${response.status})`);
    const result = parseAraProposals(data.reply, currentUser?.role);
    setAraMessages(prev => [...prev, { role: "assistant", ...result }]);
    setAraImageData(null); setAraImageType(null); setAraImagePreview(null);
    setLlmStatus?.("connected");
    addAgentLog("ARA_CHAT", "Jawaban ARA diterima; " + result.proposals.length + " usulan menunggu review", "SUCCESS");
  } catch (error) {
    setLlmStatus?.("error");
    setAraMessages(prev => [...prev, { role: "assistant", content: "⚠️ " + (error.name === "TimeoutError" ? "ARA melewati batas waktu. Silakan coba lagi." : error.message) }]);
    addAgentLog("ARA_ERROR", String(error.message).slice(0, 150), "ERROR");
  } finally {
    pendingChats.delete(setAraMessages);
    setAraLoading(false);
    setTimeout(() => araBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }
}
