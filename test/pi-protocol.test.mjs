// Modified for the subagent-mcp Pi adapter fork.
import assert from "node:assert/strict";
import test from "node:test";
import {
  PI_DIALOG_METHODS,
  PI_FOLLOWUP_REQ,
  PI_PROMPT_REQ,
  PI_STATE_REQ,
  isPiAgentEnd,
  isPiAgentSettled,
  isPiResponse,
  isPiUiRequest,
  parsePiFrame,
  piFollowUpRequest,
  piPromptRequest,
  piStateRequest,
  piStructuredPermissionPayload,
  piTextDelta,
  piUiRequestOf,
  piUiResponseConfirmed,
  piUiResponseDenied,
  piUiResponseCancelled,
} from "../dist/pi-protocol.js";

test("pi frames parse and classify", () => {
  const state = parsePiFrame(JSON.stringify(piStateRequest()));
  assert.equal(state.type, "get_state");
  assert.equal(state.id, PI_STATE_REQ);
  assert.equal(isPiResponse(state), false, "requests are not responses");

  const response = parsePiFrame(JSON.stringify({ type: "response", id: PI_STATE_REQ, success: true, data: { sessionId: "s1" } }));
  assert.equal(isPiResponse(response), true);

  const ui = parsePiFrame(JSON.stringify({ type: "extension_ui_request", id: "ui-1", method: "confirm", title: "permission_request", message: "{}" }));
  assert.equal(isPiUiRequest(ui), true);
  assert.equal(PI_DIALOG_METHODS.has("confirm"), true);

  const settled = parsePiFrame(JSON.stringify({ type: "agent_settled" }));
  assert.equal(isPiAgentSettled(settled), true);
  assert.equal(isPiAgentEnd(parsePiFrame(JSON.stringify({ type: "agent_end" }))), true);

  assert.equal(parsePiFrame("not json"), null);
  assert.equal(parsePiFrame("[1,2]"), null);
});

test("pi text deltas extract only from message_update frames", () => {
  assert.equal(piTextDelta({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } }), "hi");
  assert.equal(piTextDelta({ type: "message_update", assistantMessageEvent: { type: "text_delta" } }), null);
  assert.equal(piTextDelta({ type: "agent_end" }), null);
});

test("pi request builders carry messages", () => {
  assert.equal(piPromptRequest("do it").message, "do it");
  assert.equal(piFollowUpRequest("more").type, "follow_up");
  assert.equal(piFollowUpRequest("more").id, PI_PROMPT_REQ ? PI_FOLLOWUP_REQ : PI_FOLLOWUP_REQ);
});

test("structured permission payload parses; prose fails closed", () => {
  const payload = JSON.stringify({ tool: "write", paths: ["src/a.ts"], irreversible: false });
  const structured = piUiRequestOf(parsePiFrame(JSON.stringify({ type: "extension_ui_request", id: "u1", method: "confirm", title: "permission_request", message: payload })));
  const parsed = piStructuredPermissionPayload(structured);
  assert.deepEqual(parsed, { tool: "write", paths: ["src/a.ts"] });

  const irreversible = piStructuredPermissionPayload(
    piUiRequestOf(parsePiFrame(JSON.stringify({ type: "extension_ui_request", id: "u2", method: "confirm", title: "permission_request", message: JSON.stringify({ tool: "bash", command: "git push --force", irreversible: true }) })))
  );
  assert.equal(irreversible.irreversible, true);
  assert.equal(irreversible.command, "git push --force");

  const prose = piUiRequestOf(parsePiFrame(JSON.stringify({ type: "extension_ui_request", id: "u3", method: "confirm", title: "Can I edit files?", message: "pretty please" })));
  assert.equal(piStructuredPermissionPayload(prose), null, "prose-only request yields no structure");
});

test("ui response builders map decisions", () => {
  assert.deepEqual(piUiResponseConfirmed("u1"), { type: "extension_ui_response", id: "u1", confirmed: true });
  assert.deepEqual(piUiResponseDenied("u1"), { type: "extension_ui_response", id: "u1", confirmed: false });
  assert.deepEqual(piUiResponseCancelled("u1"), { type: "extension_ui_response", id: "u1", cancelled: true });
});
