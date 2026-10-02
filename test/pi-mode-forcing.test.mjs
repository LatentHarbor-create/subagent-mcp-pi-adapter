// Modified for the subagent-mcp Pi adapter fork.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name); console.error("        " + e.message); failed++; }
}

// computeEffectiveActive is exported from dist/orchestration/hook-core.js.
// Pi session mode controls delegation eagerness only. Orchestration requires
// an explicit session enable regardless of Pi mode, latch, or metering.
async function main() {
  const { computeEffectiveActive } = await import("../dist/orchestration/hook-core.js");
  const marker = await import("../dist/orchestration/marker.js");
  const latch = await import("../dist/orchestration/latch.js");

  const cwd = "C:/tmp/pimode-force-test";
  const now = Date.now();
  const keys = {
    on: "pimode-force-on-" + Math.random().toString(36).slice(2, 8),
    off: "pimode-force-off-" + Math.random().toString(36).slice(2, 8),
    auto: "pimode-force-auto-" + Math.random().toString(36).slice(2, 8),
  };

  test("baseline (no pi mode, no latch/enable) resolves false", () => {
    const k = "pimode-force-none-" + Math.random().toString(36).slice(2, 8);
    assert.equal(computeEffectiveActive(cwd, k, now, false), false);
  });

  test("pi mode on leaves orchestration OFF without explicit enable", () => {
    marker.writePiSessionMode(keys.on, "on");
    assert.equal(computeEffectiveActive(cwd, keys.on, now, false), false);
  });

  test("pi mode off and a 15% latch leave orchestration OFF", () => {
    marker.writePiSessionMode(keys.off, "off");
    latch.tripLatch(keys.off, now);
    assert.equal(computeEffectiveActive(cwd, keys.off, now, false), false);
  });

  test("pi mode auto leaves orchestration OFF without explicit enable", () => {
    marker.writePiSessionMode(keys.auto, "auto");
    assert.equal(computeEffectiveActive(cwd, keys.auto, now, false), false);
  });

  test("pi mode auto and a 15% latch leave orchestration OFF", () => {
    latch.tripLatch(keys.auto, now);
    assert.equal(computeEffectiveActive(cwd, keys.auto, now, false), false);
  });

  test("only explicit enable turns orchestration ON", () => {
    marker.writeEnable(keys.on);
    assert.equal(computeEffectiveActive(cwd, keys.on, now, true), true);
    marker.writeDisable(keys.on);
    assert.equal(computeEffectiveActive(cwd, keys.on, now, true), false);
  });

  for (const key of Object.values(keys)) {
    marker.removeDisable(key);
    marker.removeEnable(key);
    rmSync(marker.piSessionModePath(key), { force: true });
    latch.clearLatch(key);
  }

  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
