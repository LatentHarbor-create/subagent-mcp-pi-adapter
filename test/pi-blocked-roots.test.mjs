import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../src/advanced-ruleset.py", import.meta.url));
const candidates = process.platform === "win32" ? ["py", "python3", "python"] : ["python3", "python"];
const python = process.env.SUBAGENT_RULESET_PYTHON || candidates.find(p => {
  const r = spawnSync(p, ["-c", "print('ok')"], { encoding: "utf8", windowsHide: true });
  return r.status === 0 && r.stdout.trim() === "ok";
});
assert.ok(python, "Python 3 is required by the active routing ruleset");
const root = mkdtempSync(join(tmpdir(), "pi-blocked-roots-"));
const blocked = join(root, "private");
const child = join(blocked, "child");
const sibling = join(root, "private-sibling");
mkdirSync(child, { recursive: true });
mkdirSync(sibling);
const triple = { provider: "pi", model: "pi-balanced", effort: "max" };
function route(cwd, setting) {
  const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
  if (setting === undefined) delete env.SUBAGENT_PI_BLOCKED_ROOTS;
  else env.SUBAGENT_PI_BLOCKED_ROOTS = setting;
  const r = spawnSync(python, [script, "route"], { input: JSON.stringify({ candidates: [], context: { cwd, selection_mode: "auto" } }), env, encoding: "utf8", windowsHide: true });
  return r;
}
test("configured blocked roots veto their roots and descendants, not prefix siblings", () => {
  for (const cwd of [blocked, child]) {
    const r = route(cwd, JSON.stringify([blocked]));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), []);
  }
  const r = route(sibling, JSON.stringify([blocked]));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [triple]);
});
test("an absent blocked-root setting leaves ordinary Pi-only routing enabled", () => {
  const r = route(sibling);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [triple]);
});
test("malformed JSON, wrong types, empty paths and relative roots fail closed", () => {
  for (const raw of ["{", "{}", '["relative/path"]', '[""]', '[42]']) {
    const r = route(sibling, raw);
    assert.notEqual(r.status, 0, raw);
    assert.equal(r.stdout, "");
  }
});
test("env check validates blocked-root configuration before loading rules", () => {
  const r = spawnSync(python, [script], { env: { ...process.env, SUBAGENT_PI_BLOCKED_ROOTS: "{}" }, encoding: "utf8", windowsHide: true });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "");
});
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
