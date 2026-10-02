// Modified for the subagent-mcp Pi adapter fork.
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export type Provider = "claude" | "codex" | "pi" | "api";

/** Launch model ids for the Pi RPC provider (logical profiles, not wire models). */
export const PI_LAUNCH_MODELS = ["pi-cheap", "pi-balanced"] as const;

export function isPiLaunchModel(model: string): boolean {
  return (PI_LAUNCH_MODELS as readonly string[]).includes(model);
}

export function mapModel(provider: Provider, model: string): string {
  if (provider === "claude") {
    if (model === "opus" || model === "opus-4-8") return "claude-opus-4-8";
    if (model === "sonnet") return "claude-sonnet-4-6";
    if (model === "haiku") return "claude-haiku-4-5";
    if (model === "fable") return "claude-fable-5";
    return model;
  }
  if (provider === "codex") {
    if (model === "gpt-5.6") return "gpt-5.6-sol";
    return model;
  }
  if (provider === "pi") {
    // Logical profiles (pi-cheap / pi-balanced) pass through untouched: the
    // Pi harness owns the concrete provider/model mapping via its own config.
    return model;
  }
  throw new Error("api provider dispatch not implemented");
}

export function resolveEffort(
  provider: Provider,
  model: string,
  effort: string
): { kind: "flag"; value: string } | { kind: "settings" } | { kind: "none" } {
  const isOpus48 = provider === "claude" && (model === "opus" || model === "opus-4-8");

  if (effort === "low") {
    throw new Error(
      `low effort is not supported. Valid efforts: medium, high, xhigh, max, ultracode.`
    );
  }

  if (effort === "ultracode") {
    if (!isOpus48) {
      throw new Error(
        `ultracode effort is only available on Opus 4.8+ (got ${provider}/${model}). Use xhigh for other models.`
      );
    }
    return { kind: "settings" };
  }

  if (provider === "claude" && model === "haiku") {
    return { kind: "none" };
  }

  if (provider === "claude" && ["sonnet", "opus", "opus-4-8", "fable"].includes(model)) {
    if (["medium", "high", "xhigh", "max"].includes(effort)) {
      return { kind: "flag", value: effort };
    }
  }

  if (provider === "codex") {
    if (effort === "max") {
      throw new Error(
        `max effort is not valid for gpt-5.5/gpt-5.6 (Codex). Valid: medium, high, xhigh.`
      );
    }
    if (["medium", "high", "xhigh"].includes(effort)) {
      return { kind: "flag", value: effort };
    }
  }

  if (provider === "pi") {
    // Pi (glm-5.3-flash) selectable thinking levels are low/high/max (pi harness
    // catalog thinkingLevelMap) — xhigh does NOT exist, and max must stay max:
    // never clamp to xhigh. medium maps up to high (Pi's baseline strong tier).
    //
    // ultracode is NOT reachable here: the global guard above already threw for
    // every non-Opus-4.8 target. It is deliberately absent from this list so the
    // three effort paths (resolveEffort / normalizeEffort / effortAllowed) agree
    // — see SSOT §5 and test/effort-parity.test.mjs.
    if (effort === "max" || effort === "xhigh") {
      return { kind: "flag", value: "max" };
    }
    if (effort === "medium" || effort === "high") {
      return { kind: "flag", value: "high" };
    }
  }

  if (provider === "api") {
    throw new Error("api provider dispatch not implemented");
  }

  return { kind: "flag", value: "high" };
}

export function buildCommand(
  provider: Provider,
  model: string,
  effort: string,
  cwd: string,
  agentId?: string
): { args: string[]; ucSettingsPath?: string; ucSettingsDir?: string } {
  const mapped = mapModel(provider, model);
  const er = resolveEffort(provider, model, effort);

  if (provider === "claude") {
    const args = ["--model", mapped];

    if (er.kind === "flag") {
      args.push("--effort", er.value);
    } else if (er.kind === "settings") {
      const safeAgentId = (agentId ?? randomUUID()).replace(/[^a-zA-Z0-9._-]/g, "_");
      // J1-5: keep per-agent settings under the user's temp profile; POSIX modes
      // restrict the scratch dir/file, while Windows applies fs defaults.
      const ucSettingsDir = join(tmpdir(), "subagent-mcp", `perm-${safeAgentId}`);
      mkdirSync(ucSettingsDir, { recursive: true, mode: 0o700 });
      const ucSettingsPath = join(ucSettingsDir, "settings.json");
      writeFileSync(ucSettingsPath, '{"ultracode":true}', { mode: 0o600 });
      args.push("--settings", ucSettingsPath);
      return { args, ucSettingsPath, ucSettingsDir };
    }

    return { args };
  }

  if (provider === "api") {
    throw new Error("api provider dispatch not implemented");
  }

  if (provider === "pi") {
    // Pi RPC baseline args. The concrete provider/model stays inside the Pi
    // harness config (logical profiles only cross this boundary). The
    // permission-bridge extension is attached by createProviderDriver, which
    // owns the dist asset path.
    const args = ["--mode", "rpc", "--no-extensions", "--no-skills", "--no-prompt-templates"];
    if (er.kind === "flag") {
      args.push("--thinking", er.value);
    }
    return { args };
  }

  // codex
  void (er as { kind: "flag"; value: string }).value;
  return {
    args: [
      "app-server",
      "--stdio",
    ],
  };
}
