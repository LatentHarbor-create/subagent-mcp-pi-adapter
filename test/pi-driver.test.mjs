// Modified for the subagent-mcp Pi adapter fork.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { pendingPermissionManager } from "../dist/pending-permissions.js";
import { PiRpcDriver } from "../dist/pi-driver.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

async function waitFor(predicate, label, timeoutMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function collect(stream) {
  let text = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    text += chunk;
  });
  return () => text;
}

function readLog(logFile) {
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function options(overrides = {}) {
  return {
    provider: "pi",
    command: "pi",
    args: [],
    cwd: process.cwd(),
    env: process.env,
    model: "pi-cheap",
    effort: "high",
    ...overrides,
  };
}

// Fake Pi RPC child: speaks the verified wire contract. Behavior is env-gated.
function writeFakePi(tempRoot, logFile) {
  const script = join(tempRoot, "fake-pi.mjs");
  writeFileSync(
    script,
    `
import fs from "node:fs";
import readline from "node:readline";

const logFile = process.env.PI_LOG;
const failPrompt = process.env.PI_FAIL_PROMPT === "1";
const safeAllow = process.env.PI_STRUCTURED_SAFE === "1";
const dangerAsk = process.env.PI_STRUCTURED_DANGER === "1";
const neutralAsk = process.env.PI_STRUCTURED_NEUTRAL === "1";

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }
function log(obj) { if (logFile) fs.appendFileSync(logFile, JSON.stringify(obj) + "\\n"); }

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  log(msg);
  if (msg.type === "extension_ui_response") {
    if (process.env.PI_STRUCTURED_NEUTRAL === "1") {
      send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "decision:" + JSON.stringify(msg) } });
      send({ type: "message_end" });
      send({ type: "agent_end" });
      send({ type: "agent_settled" });
    }
    return;
  }
  if (msg.type === "get_state") {
    send({ type: "response", id: msg.id, success: true, data: { sessionId: "sess-1" } });
    return;
  }
  if (msg.type === "prompt" || msg.type === "follow_up") {
    if (failPrompt) {
      send({ type: "response", id: msg.id, success: false, error: "provider auth failed" });
      return;
    }
    send({ type: "response", id: msg.id, success: true });
    if (safeAllow) {
      send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "reading" } });
      send({ type: "message_end" });
      send({ type: "agent_end" });
      send({ type: "agent_settled" });
      return;
    }
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ack:" + msg.message } });
    send({ type: "message_end" });
    if (dangerAsk) {
      send({ type: "extension_ui_request", id: "ui-d1", method: "confirm", title: "permission_request",
             message: JSON.stringify({ tool: "write", paths: ["C:/Users/x/.ssh/id_rsa"], irreversible: false }) });
      return;
    }
    if (process.env.PI_STRUCTURED_NEUTRAL === "1") {
      send({ type: "extension_ui_request", id: "ui-n1", method: "confirm", title: "permission_request",
             message: JSON.stringify({ tool: "write", paths: ["notes.txt"], irreversible: false }) });
      return;
    }
    send({ type: "agent_end" });
    send({ type: "agent_settled" });
  }
});
`,
    "utf8"
  );
  writeFileSync(logFile, "");
  return script;
}

function spawnFakePi(script, env = {}) {
  return spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

await test("Pi driver establishes session, prompts, streams normalized output, and kills", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-pi-driver-"));
  try {
    const logFile = join(tempRoot, "pi.log");
    const script = writeFakePi(tempRoot, logFile);
    const child = spawnFakePi(script, { PI_LOG: logFile });
    const driver = new PiRpcDriver(child, options());
    const stdout = collect(driver.process.stdout);
    await once(driver.process, "spawn");

    await driver.start("first");
    await waitFor(() => /"type":"result"/.test(stdout()), "first pi result frame");
    assert.match(stdout(), /"type":"assistant"/);
    assert.match(stdout(), /ack:first/);
    assert.equal(driver.closed, false);

    await driver.send("second");
    await waitFor(() => stdout().includes("ack:second"), "follow-up completion");

    driver.kill();
    assert.equal(driver.closed, true);
    assert.equal(driver.process.killed, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("Pi driver SAFE structured request auto-allows without parking", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-pi-safe-"));
  try {
    const logFile = join(tempRoot, "pi.log");
    const script = writeFakePi(tempRoot, logFile);
    const child = spawnFakePi(script, { PI_LOG: logFile, PI_STRUCTURED_SAFE: "1" });
    const driver = new PiRpcDriver(child, options());
    const stdout = collect(driver.process.stdout);
    await once(driver.process, "spawn");

    await driver.start("read stuff");
    await waitFor(() => stdout().includes('"type":"result"'), "safe result");
    const frames = readLog(logFile);
    assert.ok(
      !frames.some((f) => f.type === "extension_ui_response"),
      "SAFE structured request must be answered inline by the engine, not parked"
    );
    driver.kill();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("Pi driver DANGER structured request auto-denies", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-pi-danger-"));
  try {
    const logFile = join(tempRoot, "pi.log");
    const script = writeFakePi(tempRoot, logFile);
    const child = spawnFakePi(script, { PI_LOG: logFile, PI_STRUCTURED_DANGER: "1" });
    const driver = new PiRpcDriver(child, options());
    const stdout = collect(driver.process.stdout);
    await once(driver.process, "spawn");

    await driver.start("touch protected path");
    await waitFor(
      () => readLog(logFile).some((f) => f.type === "extension_ui_response" && f.confirmed === false),
      "danger deny reply"
    );
    driver.kill();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("Pi driver NEUTRAL parks, honors respond_permission allow, and keeps the session", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-pi-neutral-"));
  try {
    const logFile = join(tempRoot, "pi.log");
    const script = writeFakePi(tempRoot, logFile);
    const child = spawnFakePi(script, { PI_LOG: logFile, PI_STRUCTURED_NEUTRAL: "1" });
    const driver = new PiRpcDriver(child, options({ agentId: "agent-pi-neutral" }));
    const stdout = collect(driver.process.stdout);
    await once(driver.process, "spawn");

    await driver.start("write notes");
    await waitFor(() => pendingPermissionManager.pendingCount("agent-pi-neutral") === 1, "parked neutral request");

    const responded = pendingPermissionManager.respond("agent-pi-neutral", undefined, "allow", "fine");
    await responded;
    await waitFor(() => stdout().includes("decision:"), "extension answer relayed");
    await waitFor(
      () => readLog(logFile).some((f) => f.type === "extension_ui_response" && f.confirmed === true),
      "allow reply reached pi"
    );
    driver.kill();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("Pi driver prompt rejection surfaces a transient launch failure", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-pi-fail-"));
  try {
    const logFile = join(tempRoot, "pi.log");
    const script = writeFakePi(tempRoot, logFile);
    const child = spawnFakePi(script, { PI_LOG: logFile, PI_FAIL_PROMPT: "1" });
    const driver = new PiRpcDriver(child, options());
    await once(driver.process, "spawn");

    await assert.rejects(
      () => driver.start("go"),
      (e) => e.name === "ProviderTransientError" && /provider auth failed/.test(e.message)
    );
    driver.kill();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
