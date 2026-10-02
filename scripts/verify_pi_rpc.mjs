import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { PiRpcDriver } from "../dist/pi-driver.js";
import { pendingPermissionManager } from "../dist/pending-permissions.js";

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const cli = option("--pi-cli") ?? join(homedir(), "AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const output = option("--output");
const modelSmoke = args.includes("--model-smoke");
const settings = JSON.parse(readFileSync(join(homedir(), ".pi/agent/settings.json"), "utf8").replace(/^\uFEFF/, ""));
const expectedModel = { provider: settings.defaultProvider, id: settings.defaultModel, thinkingLevel: "max" };
assert.ok(expectedModel.provider && expectedModel.id, "Verification requires a configured default provider and model");
const report = { version: execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim(), codemode: "disabled", modelSmokeRequested: modelSmoke, checks: [] };
assert.equal(report.version, "1.0.0");
const root = mkdtempSync(join(tmpdir(), "smcp-pi-rpc-verify-"));
const extension = join(root, "probe.ts");
const permissionExtension = fileURLToPath(new URL("../dist/pi-extensions/ask_permission.ts", import.meta.url));
writeFileSync(extension, `
import askPermission from ${JSON.stringify(permissionExtension.replaceAll("\\", "/"))};
export default function(pi) {
  let permissionTool;
  askPermission({ registerTool(tool) { permissionTool = tool; } });
  pi.registerCommand("rpc_permission_probe", {
    handler: async (args, ctx) => {
      const kind = args.trim();
      const params = kind === "safe" ? { tool: "read", paths: ["fixture.txt"] }
        : kind === "danger" ? { tool: "write", paths: [${JSON.stringify(join(homedir(), ".ssh/id_rsa"))}] }
        : { tool: "write", paths: ["probe-only.txt"] };
      const result = await permissionTool.execute("probe", params, undefined, undefined, ctx);
      ctx.ui.notify("PI_PERMISSION_RESULT:" + result.details.granted, "info");
    }
  });
}
`, "utf8");
const child = spawn(process.execPath, [cli, "--mode", "rpc", "--no-session", "--offline", "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-tools", "--thinking", "max", "--extension", extension], {
  cwd: root, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
});
const driver = new PiRpcDriver(child, { provider: "pi", command: cli, args: [], cwd: root, env: process.env, model: "pi-balanced", effort: "max", agentId: "pi-rpc-live-verification" });
const events = [];
let activeCase = "", approve = false, parked = false, rawBuffer = "";
child.stdout.on("data", (chunk) => {
  rawBuffer += chunk.toString();
  const lines = rawBuffer.split("\n"); rawBuffer = lines.pop();
  for (const line of lines) {
    let frame; try { frame = JSON.parse(line); } catch { continue; }
    if (frame.type === "extension_ui_request" && frame.method === "notify" && String(frame.message).startsWith("PI_PERMISSION_RESULT:")) {
      report.checks.push({ case: activeCase, granted: frame.message.endsWith("true"), parked });
    }
  }
});
let visibleBuffer = "";
driver.process.stdout.on("data", (chunk) => {
  visibleBuffer += chunk.toString(); const lines = visibleBuffer.split("\n"); visibleBuffer = lines.pop();
  for (const line of lines) if (line) events.push(JSON.parse(line));
});
const unsubscribe = pendingPermissionManager.onAgentQueueChange((id, count) => {
  if (id !== "pi-rpc-live-verification" || count === 0) return;
  parked = true;
  queueMicrotask(() => { void pendingPermissionManager.respond(id, undefined, approve ? "allow" : "deny", "bounded synthetic permission verification"); });
});
const deadline = setTimeout(() => driver.kill(), modelSmoke ? 120000 : 45000);
async function waitForResult(count) {
  const started = Date.now();
  while (events.filter((event) => event.type === "result").length < count) {
    if (driver.closed || Date.now() - started > 100000) throw new Error("Pi did not complete the verification run");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return events.filter((event) => event.type === "result").at(-1);
}
let failure;
try {
  await once(driver.process, "spawn");
  const state = await driver.getState();
  report.physicalModel = { provider: state.model?.provider, id: state.model?.id, thinkingLevel: state.thinkingLevel };
  report.expectedModel = expectedModel;
  report.physicalModelMatchesSettings = Object.keys(expectedModel).every((key) => report.physicalModel[key] === expectedModel[key]);
  const cases = [["safe", false, true, false], ["danger", false, false, false], ["park-allow", true, true, true], ["park-deny", false, false, true]];
  for (const [name, answer, expected, expectedPark] of cases) {
    activeCase = name; approve = answer; parked = false;
    if (report.checks.length === 0) await driver.start(`/rpc_permission_probe ${name}`);
    else await driver.send(`/rpc_permission_probe ${name}`);
    const check = report.checks.at(-1);
    assert.equal(check?.case, name); assert.equal(check.granted, expected); assert.equal(check.parked, expectedPark);
  }
  report.permissionBridgePassed = true;
  assert.equal(report.physicalModelMatchesSettings, true, "Pi physical model did not match the saved configuration");
  if (modelSmoke) {
    const count = events.filter((event) => event.type === "result").length + 1;
    await driver.send("Reply with exactly PI_RPC_1_0_OK. Do not use tools or access files.");
    const result = await waitForResult(count);
    report.modelSmoke = { passed: result.is_error !== true && result.result.trim() === "PI_RPC_1_0_OK", error: result.is_error ? "Pi reported a model execution error" : undefined };
    assert.equal(report.modelSmoke.passed, true);
  }
  report.passed = true;
} catch (error) {
  failure = error; report.passed = false;
  report.failure = error.code ? `verification error (${error.code})` : String(error.message).slice(0, 500);
} finally {
  clearTimeout(deadline); unsubscribe(); driver.kill();
  if (child.exitCode === null) await Promise.race([once(child, "close"), new Promise((resolve) => setTimeout(resolve, 1500))]);
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep), "cleanup must stay within temp directory");
  rmSync(root, { recursive: true, force: true });
}
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
