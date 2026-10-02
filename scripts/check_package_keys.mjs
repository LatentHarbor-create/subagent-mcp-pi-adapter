#!/usr/bin/env node
// Modified for the subagent-mcp Pi adapter fork.
/**
 * package.json duplicate-key check.
 *
 * WHY THIS EXISTS
 * JSON.parse silently keeps the LAST value for a duplicated object key. A
 * package.json that has drifted through several append-style merges can end up
 * with the same script declared twice: the file still parses, the build still
 * runs, and the FIRST definition is dead. Nothing reports it.
 *
 * WHAT IT ENFORCES
 * package.json contains no duplicate keys within any single object.
 *
 * HOW
 * A real tokenizer over the raw text, tracking a stack of objects. Each object
 * gets its own key set, so the same key name in two SIBLING objects (e.g.
 * repository.url and bugs.url) is correctly NOT a duplicate.
 *
 * JSON.parse cannot be used: by the time it returns, the duplicate is already
 * collapsed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const FILE = "package.json";
const raw = readFileSync(join(root, FILE), "utf8");

/**
 * Minimal JSON tokenizer. Yields structural tokens and object keys with the
 * path of enclosing keys, so duplicates are detected per-object.
 */
function scanKeys(text) {
  const duplicates = [];
  const stack = []; // { keys: Map<string, number>, path: string }
  let i = 0;

  const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";

  function readString() {
    // text[i] === '"'
    let out = "";
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return out;
      }
      out += c;
      i++;
    }
    return out;
  }

  function currentPath() {
    // The enclosing path is the chain of keys of the FRAMES BELOW the top.
    // A frame's own pendingKey names the key that OPENED it, so the top
    // frame's pendingKey must be excluded from its children's path.
    return stack
      .slice(0, -1)
      .map((s) => s.pendingKey ?? "?")
      .filter((k) => k !== "?")
      .join(".");
  }

  // Track whether the next string is a key: it is a key when the last
  // significant token was '{' or ',' AND we are inside an object.
  let expectKey = false;

  while (i < text.length) {
    const c = text[i];
    if (isWs(c)) {
      i++;
      continue;
    }
    if (c === "{") {
      stack.push({ keys: new Map(), path: currentPath() });
      expectKey = true;
      i++;
      continue;
    }
    if (c === "}") {
      stack.pop();
      expectKey = false;
      i++;
      continue;
    }
    if (c === "[") {
      // Arrays: keys inside are not object keys. Push a marker frame.
      stack.push({ keys: null, path: currentPath() });
      expectKey = false;
      i++;
      continue;
    }
    if (c === "]") {
      stack.pop();
      expectKey = false;
      i++;
      continue;
    }
    if (c === ",") {
      expectKey = stack.length > 0 && stack[stack.length - 1].keys !== null;
      i++;
      continue;
    }
    if (c === ":") {
      expectKey = false;
      i++;
      continue;
    }
    if (c === '"') {
      const at = i;
      const value = readString();
      const top = stack[stack.length - 1];
      if (expectKey && top && top.keys) {
        const path = currentPath();
        if (top.keys.has(value)) {
          duplicates.push(
            `${path ? path + "." : ""}${value} (first at char ${top.keys.get(value)})`
          );
        } else {
          top.keys.set(value, at);
        }
        top.pendingKey = value;
        expectKey = false;
      }
      continue;
    }
    // Numbers, literals, etc.
    i++;
  }
  return duplicates;
}

const duplicates = scanKeys(raw);

if (duplicates.length > 0) {
  for (const dup of duplicates) {
    console.error(`PKG-KEYS: FAIL duplicate key in ${FILE} — ${dup}`);
  }
  console.error(
    "PKG-KEYS: a duplicated key silently keeps the last value; remove the dead definition."
  );
  process.exit(1);
}

console.log(`PKG-KEYS: PASS ${FILE} has no duplicate keys`);