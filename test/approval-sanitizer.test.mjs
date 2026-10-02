// Modified for the subagent-mcp Pi adapter fork.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Approval-context sanitizer guard.
//
// poll_agent exposes a parked request's FULL structured action to the parent as
// `action_summary`. Two properties must hold:
//
//   1. It goes through THE single sanitizer (configure.ts redactPayload) — no
//      second redactor is introduced.
//   2. Because redactPayload masks by KEY NAME only, a credential pasted inline
//      into a command/message would survive it. A narrow VALUE scan on this
//      path closes that gap. Order must be redact -> scan -> truncate, so a
//      masked token is never truncated into a partial leak.
//
// This guard pins both by inspecting the source (the values themselves are
// covered by the runtime path; this is the static contract).

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name); console.error("        " + e.message); failed++; }
}

const src = readFileSync("src/index.ts", "utf8");

function fnBody(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `${name} not found`);
  // Skip to the opening brace so JSDoc prose above cannot skew index ordering.
  const braceStart = src.indexOf("{", start);
  assert.ok(braceStart !== -1, `${name} has no body`);
  const rest = src.slice(braceStart);
  const m = rest.match(/\n}/);
  assert.ok(m, `${name} body has no terminator`);
  return rest.slice(0, m.index);
}

test("action_summary routes through redactPayload (the single sanitizer)", () => {
  const body = fnBody("pendingPermissionSummary");
  assert.ok(/redactPayload/.test(body) || /redactApprovalText/.test(body),
    "action_summary must be produced via redactPayload / redactApprovalText");
});

test("redactApprovalText nests redact -> scan -> truncate in that order", () => {
  const body = fnBody("redactApprovalText");
  // The expression is written as nested calls:
  //   truncateApprovalText(scanSecretValues(JSON.stringify(redactPayload(v))))
  // so assert the NESTING (inner-to-outer), not left-to-right text position.
  const iRedact = body.indexOf("redactPayload");
  const iScan = body.indexOf("scanSecretValues");
  const iTrunc = body.indexOf("truncateApprovalText");
  assert.ok(iRedact !== -1, "redactPayload must be applied");
  assert.ok(iScan !== -1, "scanSecretValues must be applied");
  assert.ok(iTrunc !== -1, "truncateApprovalText must be applied");
  // redactPayload must be INSIDE scanSecretValues (i.e. run first).
  const scanOpen = body.indexOf("scanSecretValues(");
  const scanClose = body.indexOf(")", body.indexOf("redactPayload"));
  assert.ok(body.slice(scanOpen, scanClose).includes("redactPayload"),
    "redactPayload must be nested inside scanSecretValues (runs first)");
  // and scanSecretValues must be INSIDE truncateApprovalText (i.e. truncate last).
  const truncOpen = body.indexOf("truncateApprovalText(");
  assert.ok(body.slice(truncOpen).includes("scanSecretValues"),
    "scanSecretValues must be nested inside truncateApprovalText (truncate last)");
});

test("no second general-purpose redactor is introduced", () => {
  // The only sanitizer is configure.ts redactPayload. A function NAMED like a
  // redactor other than the narrow value-scan would be a second redactor.
  const redactorNames = [...src.matchAll(/function\s+(\w*[Rr]edact\w*)\s*\(/g)].map((m) => m[1]);
  for (const n of redactorNames) {
    assert.ok(n === "redactApprovalText" || n === "redactPayload",
      `unexpected redactor-like function: ${n} (would be a second redactor)`);
  }
});

test("value scan covers the documented credential shapes", () => {
  const body = fnBody("scanSecretValues");
  assert.ok(body.length > 0, "scanSecretValues must have a body");
  const consts = src.slice(src.indexOf("const SECRET_VALUE_RES"));
  for (const shape of ["Bearer", "sk-", "gh[pousr]_", "AKIA", "xox", "PRIVATE KEY"]) {
    assert.ok(consts.includes(shape), `value scan must cover ${shape}`);
  }
});

test("value scan masks rather than deletes (no silent data loss beyond the token)", () => {
  const consts = src.slice(src.indexOf("const SECRET_VALUE_RES"));
  assert.ok(/\*\*\*\*\*\*/.test(consts) || /\*\*\*\*\*\*/.test(src),
    "replacement must be an explicit mask marker");
});

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);