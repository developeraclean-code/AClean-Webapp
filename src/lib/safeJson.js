// Parse JSON dengan error logging — tidak silent fail.
export const safeJsonParse = (jsonStr, context = "", defaultValue = null) => {
  if (!jsonStr) return defaultValue;
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error(`[JSON_PARSE_ERROR] ${context}:`, {
      error: err.message,
      inputLength: String(jsonStr).length,
      inputPreview: String(jsonStr).slice(0, 100),
    });
    if (typeof window !== "undefined" && window.addAgentLog) {
      window.addAgentLog("JSON_PARSE_ERROR", `${context}: ${err.message}`, "ERROR");
    }
    return defaultValue;
  }
};
