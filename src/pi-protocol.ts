// Modified for the subagent-mcp Pi adapter fork.
/**
 * Pi RPC wire protocol helpers — pure frame parsing/building, no I/O.
 *
 * Wire contract (newline-delimited JSON over stdio, `pi --mode rpc`):
 * - parent -> pi:  { id, type: "get_state" | "prompt" | "steer" | "follow_up", message? }
 * - pi -> parent:  { type: "response", id, success, data? , error? }
 * - pi -> parent:  { type: "extension_ui_request", id, method: "confirm" | "select"
 *                    | "input" | "editor" | "notify" | ..., title, message }
 * - parent -> pi:  { type: "extension_ui_response", id, confirmed?: boolean,
 *                    cancelled?: boolean }
 * - events:        agent_start / agent_end / agent_settled / message_start /
 *                  message_update (assistantMessageEvent.text_delta) /
 *                  message_end / tool_execution_start / tool_execution_end
 *
 * The permission bridge (ask-permission extension) embeds a structured JSON
 * payload in the ui request so the shared permission engine can classify the
 * op — natural-language questions alone are never granted on.
 */

export type PiFrame = Record<string, unknown>;

export const PI_STATE_REQ = "pi-state-1";
export const PI_PROMPT_REQ = "pi-prompt-1";
export const PI_FOLLOWUP_REQ = "pi-followup-1";

/** Dialog ui methods that block until an extension_ui_response arrives. */
export const PI_DIALOG_METHODS = new Set(["confirm", "select", "input", "editor"]);

/** Fire-and-forget ui methods: record only, never respond. */
export const PI_FIRE_AND_FORGET = new Set([
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
]);

export function parsePiFrame(line: string): PiFrame | null {
  try {
    const obj = JSON.parse(line) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return obj as PiFrame;
    }
    return null;
  } catch {
    return null;
  }
}

export function isPiResponse(frame: PiFrame): boolean {
  return frame.type === "response" && typeof frame.id === "string";
}

export function isPiUiRequest(frame: PiFrame): boolean {
  return frame.type === "extension_ui_request" && typeof frame.id === "string";
}

export function isPiAgentSettled(frame: PiFrame): boolean {
  return frame.type === "agent_settled";
}

export function isPiAgentEnd(frame: PiFrame): boolean {
  return frame.type === "agent_end";
}

/** Extract the text delta of a message_update frame, or null when absent. */
export function piTextDelta(frame: PiFrame): string | null {
  if (frame.type !== "message_update") return null;
  const update = frame.assistantMessageEvent;
  if (!update || typeof update !== "object") return null;
  const upd = update as PiFrame;
  if (upd.type !== "text_delta") return null;
  return typeof upd.delta === "string" && upd.delta.length > 0 ? upd.delta : null;
}

export function piStateRequest(): PiFrame {
  return { id: PI_STATE_REQ, type: "get_state" };
}

export function piPromptRequest(message: string): PiFrame {
  return { id: PI_PROMPT_REQ, type: "prompt", message };
}

export function piFollowUpRequest(message: string): PiFrame {
  return { id: PI_FOLLOWUP_REQ, type: "follow_up", message };
}

export function piUiResponseConfirmed(uiId: string): PiFrame {
  return { type: "extension_ui_response", id: uiId, confirmed: true };
}

export function piUiResponseDenied(uiId: string): PiFrame {
  return { type: "extension_ui_response", id: uiId, confirmed: false };
}

export function piUiResponseCancelled(uiId: string): PiFrame {
  return { type: "extension_ui_response", id: uiId, cancelled: true };
}

export interface PiUiRequest {
  uiId: string;
  method: string;
  title: string;
  message: string;
}

export function piUiRequestOf(frame: PiFrame): PiUiRequest | null {
  if (!isPiUiRequest(frame)) return null;
  return {
    uiId: frame.id as string,
    method: typeof frame.method === "string" ? frame.method : "",
    title: typeof frame.title === "string" ? frame.title : "",
    message: typeof frame.message === "string" ? frame.message : "",
  };
}

/**
 * Extract the structured permission payload from an ask-permission ui
 * request. The extension embeds JSON in the message body (title is a stable
 * marker). Returns null when the request carries no parseable structure —
 * callers treat that as low-confidence and fail closed to the park/deny path.
 */
export interface PiStructuredPermissionPayload {
  tool?: string;
  command?: string;
  paths?: string[];
  irreversible?: boolean;
}

export function piStructuredPermissionPayload(ui: PiUiRequest): PiStructuredPermissionPayload | null {
  const candidates = [ui.message, ui.title];
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
      const rec = obj as PiFrame;
      const tool = typeof rec.tool === "string" ? rec.tool : undefined;
      if (!tool) continue;
      const payload: PiStructuredPermissionPayload = { tool };
      if (typeof rec.command === "string" && rec.command.length > 0) payload.command = rec.command;
      if (Array.isArray(rec.paths)) {
        const paths = rec.paths.filter((p): p is string => typeof p === "string" && p.length > 0);
        if (paths.length > 0) payload.paths = paths;
      }
      if (rec.irreversible === true) payload.irreversible = true;
      return payload;
    } catch {
      continue;
    }
  }
  return null;
}
