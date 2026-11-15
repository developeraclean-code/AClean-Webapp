// Bound the wait, without replaying a mutation. A timeout can still mean the
// database committed; callers must reconcile or retry their original intent ID.
export function fsmCommand(supabase, name, args) {
  const request = supabase.rpc(name, args);
  if (typeof request?.abortSignal === "function" && globalThis.AbortSignal?.timeout) {
    return request.abortSignal(AbortSignal.timeout(15_000));
  }
  return request;
}
