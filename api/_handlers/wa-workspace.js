import { createClient } from "@supabase/supabase-js";
import { deliverWorkspaceMessage, dispatchWorkspaceMessage, validateWorkspacePayload, verifyCatalogMedia } from "../_wa-workspace.js";

// Router authenticates first; role comes from signed claims or the verified Supabase user.
export async function waWorkspaceSend(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const db = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  let role = req.appClaims?.role, actor = req.appClaims?.name;
  if (!role && req.authUser?.id) {
    const { data, error } = await db.from("user_profiles").select("name,role").eq("id", req.authUser.id).single();
    if (!error) { role = data?.role; actor = data?.name; }
  }
  if (!["Owner", "Admin"].includes(role)) return res.status(403).json({ error: "Hanya Owner/Admin" });
  const body = req.body || {};
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id || "")) return res.status(400).json({ error: "ID pengiriman tidak valid" });
  try {
    const payload = await validateWorkspacePayload(db, body);
    const deliver = payload.kind === "CATALOG" ? async value => {
      try { await verifyCatalogMedia(value.url); }
      catch (error) { return { status: "FAILED", error: error.message }; }
      return deliverWorkspaceMessage(value);
    } : deliverWorkspaceMessage;
    const row = await dispatchWorkspaceMessage(db, body.id, payload, actor || role, deliver);
    return res.status(200).json({ row });
  } catch (error) { return res.status(400).json({ error: error.message }); }
}
