// Helpers for the /api/agent/* Functions. See edge/agent.js.
import { loadData, readLimit, out, OFF } from "./agent.js";

/** Load the agent data and apply the read limit → { d, origin } or { res } (a Response to return). */
export async function ready(request, env, bucket) {
  const d = await loadData(env, request);
  if (!d) return { res: out(OFF, 404) };
  const lim = await readLimit(env, request, bucket);
  if (lim) return { res: lim };
  return { d, origin: new URL(request.url).origin, q: new URL(request.url).searchParams };
}
