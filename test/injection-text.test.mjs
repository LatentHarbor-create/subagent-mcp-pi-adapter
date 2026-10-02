// Modified for the subagent-mcp Pi adapter fork.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Injection-text governance guard.
//
// The per-turn hook injection is read by the model as operating instructions.
// One rule from the orchestration directive is load-bearing: a session's
// orchestration STATE comes ONLY from the harness-verified
// <subagent-mcp state="..."> hook tag. No other injected text may assert it,
// because a mode line claiming "orchestration is ON" contradicts the tag on
// the same turn (AUTO in particular follows latch/metering, so it is OFF on an
// unlatched session).
//
// This guard pins that: the pi session-mode texts may DESCRIBE delegation
// policy, but must never CLAIM the orchestration state.

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name); console.error("        " + e.message); failed++; }
}

const SRC = "src/hooks/orchestration-codex.ts";
const src = readFileSync(SRC, "utf8");

// Isolate the three PI_MODE_*_TEXT constants. They are declared as
//   const NAME =
//     "..." +
//     "...";
// so match from the declaration to the first line that ends the statement.
function extractConst(name) {
  const start = src.indexOf(`const ${name} =`);
  assert.ok(start !== -1, `${name} not found in ${SRC}`);
  const rest = src.slice(start);
  // Statement ends at the first semicolon terminating the initializer. Match
  // either LF or CRLF (the repo checkout may use either).
  const m = rest.match(/;(\r?\n)/);
  assert.ok(m, `${name} initializer has no terminator`);
  return rest.slice(0, m.index);
}

const TEXTS = {
  PI_MODE_AUTO_TEXT: extractConst("PI_MODE_AUTO_TEXT"),
  PI_MODE_ON_TEXT: extractConst("PI_MODE_ON_TEXT"),
  PI_MODE_OFF_TEXT: extractConst("PI_MODE_OFF_TEXT"),
};

test("mode texts are present and non-trivial", () => {
  for (const [name, body] of Object.entries(TEXTS)) {
    assert.ok(body.length > 40, `${name} looks empty`);
  }
});

test("no mode text asserts the orchestration state as ON", () => {
  // The specific regression: "Orchestration is ON for this session."
  for (const [name, body] of Object.entries(TEXTS)) {
    assert.ok(
      !/orchestration\s+is\s+on/i.test(body),
      `${name} must not claim "orchestration is ON" — only the hook tag is authoritative`
    );
  }
});

test("no mode text asserts the orchestration state as OFF", () => {
  for (const [name, body] of Object.entries(TEXTS)) {
    assert.ok(
      !/orchestration\s+is\s+off/i.test(body),
      `${name} must not claim "orchestration is OFF"`
    );
  }
});

test("AUTO text defers state authority to the hook tag", () => {
  const auto = TEXTS.PI_MODE_AUTO_TEXT;
  assert.ok(
    /hook tag/i.test(auto),
    "AUTO text must point at the hook tag as the state authority"
  );
  assert.ok(
    /do not infer/i.test(auto),
    "AUTO text must tell the model not to infer state from the mode line"
  );
});

test("mode texts keep the fixed triple pinned (pi / pi-balanced / max)", () => {
  for (const name of ["PI_MODE_AUTO_TEXT", "PI_MODE_ON_TEXT"]) {
    const body = TEXTS[name];
    assert.ok(/pi-balanced/.test(body), `${name} must pin model=pi-balanced`);
    assert.ok(/max/.test(body), `${name} must pin effort=max`);
    assert.ok(/provider=pi/.test(body), `${name} must pin provider=pi`);
  }
});

test("no mode text mentions pi-cheap (production delegation bans it)", () => {
  for (const [name, body] of Object.entries(TEXTS)) {
    assert.ok(!/pi-cheap/.test(body), `${name} must never advertise pi-cheap`);
  }
});

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);