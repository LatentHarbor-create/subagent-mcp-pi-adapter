// Modified for the subagent-mcp Pi adapter fork.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";

const source = new URL("../src/routing-table.json", import.meta.url);
const target = new URL("../dist/routing-table.json", import.meta.url);
const contextWindowsSource = new URL("../src/context-windows.json", import.meta.url);
const contextWindowsTarget = new URL("../dist/context-windows.json", import.meta.url);
const scaffoldSource = new URL("../src/advanced-ruleset.py", import.meta.url);
const scaffoldTarget = new URL("../dist/advanced-ruleset.py", import.meta.url);
const concurrencySource = new URL("../src/global-subagent-mcp-config.jsonc", import.meta.url);
const concurrencyTarget = new URL("../dist/global-subagent-mcp-config.jsonc", import.meta.url);
const legacyConcurrencyTarget = new URL("../dist/global-concurrency.jsonc", import.meta.url);
const piExtensionsSource = new URL("../src/pi-extensions/", import.meta.url);
const piExtensionsTarget = new URL("../dist/pi-extensions/", import.meta.url);

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });

if (!existsSync(source)) {
  console.error("ERROR src/routing-table.json is absent; refusing to build without the routing table");
  process.exit(1);
}
copyFileSync(source, target);
console.log("Copied src/routing-table.json to dist/routing-table.json");

if (!existsSync(contextWindowsSource)) {
  console.error("ERROR src/context-windows.json is absent; refusing to build without context windows");
  process.exit(1);
}
copyFileSync(contextWindowsSource, contextWindowsTarget);
console.log("Copied src/context-windows.json to dist/context-windows.json");

// The ruleset scaffold is a verified shipped part (deploy/setup verify lists
// include dist/advanced-ruleset.py), so a missing source HARD-FAILS the build:
// a silent skip would ship an incomplete tarball.
if (!existsSync(scaffoldSource)) {
  console.error("ERROR src/advanced-ruleset.py is absent; refusing to build without the ruleset scaffold");
  process.exit(1);
}
copyFileSync(scaffoldSource, scaffoldTarget);
console.log("Copied src/advanced-ruleset.py to dist/advanced-ruleset.py");

if (!existsSync(concurrencySource)) {
  console.error("ERROR src/global-subagent-mcp-config.jsonc is absent; refusing to build without the concurrency config");
  process.exit(1);
}
copyFileSync(concurrencySource, concurrencyTarget);
console.log("Copied src/global-subagent-mcp-config.jsonc to dist/global-subagent-mcp-config.jsonc");
copyFileSync(concurrencySource, legacyConcurrencyTarget);
console.log("Copied src/global-subagent-mcp-config.jsonc to dist/global-concurrency.jsonc");

// Pi extension assets load inside the Pi harness runtime (never compiled by
// tsc); a missing source HARD-FAILS the build so no incomplete tarball ships.
if (!existsSync(piExtensionsSource)) {
  console.error("ERROR src/pi-extensions/ is absent; refusing to build without the Pi extension assets");
  process.exit(1);
}
mkdirSync(piExtensionsTarget, { recursive: true });
for (const name of readdirSync(piExtensionsSource)) {
  copyFileSync(new URL(name, piExtensionsSource), new URL(name, piExtensionsTarget));
}
console.log("Copied src/pi-extensions/ to dist/pi-extensions/");
