// Modified for the subagent-mcp Pi adapter fork.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import * as marker from "../dist/orchestration/marker.js";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name); console.error("        " + e.message); failed++; }
}

const sessionKey = "pimode-unit-" + Math.random().toString(36).slice(2, 8);

test("pi session mode: unset by default", () => {
  assert.equal(marker.readPiSessionMode(sessionKey), undefined);
  assert.equal(marker.piSessionAsked(sessionKey), false);
});

test("pi session mode: write/read round-trip for auto / on / off", () => {
  for (const m of ["auto", "on", "off"]) {
    marker.writePiSessionMode(sessionKey, m);
    assert.equal(marker.readPiSessionMode(sessionKey), m);
  }
});

test("pi session mode: asked flag marks session (no re-ask)", () => {
  marker.markPiSessionAsked(sessionKey);
  assert.equal(marker.piSessionAsked(sessionKey), true);
});

test("pi session mode: anonymous keys are refused (global masquerade guard)", () => {
  const anon = marker.anonKey("C:/tmp", "pi");
  assert.equal(marker.isSessionScopedKey(anon), false);
  marker.writePiSessionMode(anon, "on");
  assert.equal(marker.readPiSessionMode(anon), undefined);
});

test("pi session mode: different session keys are isolated", () => {
  const k2 = "pimode-other-" + Math.random().toString(36).slice(2, 8);
  marker.writePiSessionMode(k2, "off");
  assert.equal(marker.readPiSessionMode(k2), "off");
  marker.writePiSessionMode(sessionKey, "auto");
  assert.equal(marker.readPiSessionMode(sessionKey), "auto");
  assert.notEqual(marker.readPiSessionMode(k2), marker.readPiSessionMode(sessionKey));
});

test("orchestration-mode tool schema carries pi_session_mode enum", () => {
  const src = readFileSync("dist/index.js", "utf8");
  assert.ok(src.includes('pi_session_mode: z.enum(["auto", "on", "off"])'), "dist schema must expose pi_session_mode");
});

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
