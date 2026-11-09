// POST /mcp — the website's MCP server for AI assistants (Streamable HTTP, stateless). See edge/mcp.js.
import { handleMcp, onGetOrDelete } from "../../edge/mcp.js";
import { preflight } from "../../edge/agent.js";

export const onRequestPost = ({ request, env }) => handleMcp(request, env);
export const onRequestGet = onGetOrDelete;
export const onRequestDelete = onGetOrDelete;
export const onRequestOptions = preflight;
