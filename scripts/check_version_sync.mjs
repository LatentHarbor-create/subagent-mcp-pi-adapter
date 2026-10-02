#!/usr/bin/env node
// Modified for the subagent-mcp Pi adapter fork.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function fail(message) {
  console.error(`VERSION-SYNC: FAIL ${message}`);
  process.exitCode = 1;
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const plugin = readJson(".claude-plugin/plugin.json");
const codexPlugin = readJson(".codex-plugin/plugin.json");
const indexTs = readFileSync(join(root, "src", "index.ts"), "utf8");

const expected = pkg.version;
const checks = [
  ["package.json version", pkg.version],
  ["package-lock.json root version", lock.version],
  ["package-lock.json packages[\"\"] version", lock.packages?.[""]?.version],
  [".claude-plugin/plugin.json version", plugin.version],
  [".codex-plugin/plugin.json version", codexPlugin.version],
];

const serverVersion = indexTs.match(/\bversion:\s*"([^"]+)"/)?.[1];
checks.push(["src/index.ts MCP server version", serverVersion]);

// CHANGELOG.md documents the release a version bump belongs to. Without this
// check a version can be bumped (and tagged) while its notes stay missing, and
// nothing reports the gap.
const changelogPath = join(root, "CHANGELOG.md");
if (existsSync(changelogPath)) {
  const changelog = readFileSync(changelogPath, "utf8");
  const topEntry = changelog.match(/^##\s+(\S+)/m)?.[1];
  checks.push(["CHANGELOG.md top entry", topEntry]);
}

// The declared Node floor must sit inside the supported range. An engines
// range that excludes the version CI and developers actually run turns a
// version mismatch into an install warning nobody reads.
const nvmrcPath = join(root, ".nvmrc");
const enginesRange = pkg.engines?.node;
if (existsSync(nvmrcPath) && typeof enginesRange === "string") {
  const pinnedMajor = Number.parseInt(readFileSync(nvmrcPath, "utf8").trim(), 10);
  if (Number.isNaN(pinnedMajor)) {
    fail(".nvmrc does not contain a numeric major version");
  } else {
    // Only the "<upper>" bound is parsed; the lower bound is the floor the
    // package declares and is checked by comparison against the pin.
    const upper = enginesRange.match(/<\s*(\d+)/)?.[1];
    const lower = enginesRange.match(/>=\s*(\d+)/)?.[1];
    if (lower && pinnedMajor < Number(lower)) {
      fail(`.nvmrc pins Node ${pinnedMajor} but engines requires >=${lower}`);
    }
    if (upper && pinnedMajor >= Number(upper)) {
      fail(`.nvmrc pins Node ${pinnedMajor} but engines excludes <${upper}`);
    }
  }
}

for (const path of [".claude-plugin/marketplace.json", "marketplace.json"]) {
  if (!existsSync(join(root, path))) continue;
  const marketplace = readJson(path);
  for (const [index, plugin] of (marketplace.plugins ?? []).entries()) {
    if (Object.hasOwn(plugin, "version")) {
      checks.push([`${path} plugins[${index}].version`, plugin.version]);
    }
  }
}

for (const [label, actual] of checks) {
  if (typeof actual !== "string" || actual.length === 0) {
    fail(`${label} is missing`);
  } else if (actual !== expected) {
    fail(`${label}=${actual} does not match package.json version=${expected}`);
  }
}

if (process.exitCode) process.exit();
console.log(`VERSION-SYNC: PASS ${expected}`);
