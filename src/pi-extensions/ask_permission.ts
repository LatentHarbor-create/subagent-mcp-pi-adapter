// Modified for the subagent-mcp Pi adapter fork.
/**
 * ask-permission — structured permission bridge for the subagent-mcp Pi driver.
 *
 * Loaded explicitly via `pi --extension <this file>` (discovery stays off via
 * --no-extensions). Emits a dialog ui request whose message body embeds the
 * structured permission payload as JSON; the parent-side driver parses it,
 * classifies it through the shared permission engine, and answers with
 * extension_ui_response. Natural-language-only requests parse as null on the
 * parent and fail closed to the park path.
 */

const STRUCTURED_MARKER = "permission_request";

function askPermission(pi) {
	pi.registerTool({
		name: "request_permission",
		label: "Request Permission",
		description:
			"Ask the parent orchestrator for permission before a sensitive action. Provide the tool name plus any structured detail (paths, command, irreversibility). Do not guess instead of asking.",
		parameters: {
			type: "object",
			properties: {
				tool: { type: "string", description: "Tool name requesting permission, e.g. write, edit, safe_shell." },
				command: { type: "string", description: "Exact command line, when the action runs one." },
				paths: {
					type: "array",
					items: { type: "string" },
					description: "Filesystem paths the action touches.",
				},
				irreversible: { type: "boolean", description: "True when the action cannot be undone." },
			},
			required: ["tool"],
		},
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const payload = {
				type: STRUCTURED_MARKER,
				tool: String(params.tool ?? "unknown"),
				action: params ?? {},
				paths: Array.isArray(params.paths) ? params.paths : [],
				command: typeof params.command === "string" ? params.command : "",
				irreversible: params.irreversible === true,
			};
			const answer = await ctx.ui.confirm(STRUCTURED_MARKER, JSON.stringify(payload));
			if (answer === true) {
				return {
					content: [{ type: "text", text: "Permission granted by the parent. Proceed exactly as requested." }],
					details: { payload, granted: true },
				};
			}
			return {
				content: [
					{
						type: "text",
						text: "Permission denied by the parent. Do not retry the action; adjust the approach and continue.",
					},
				],
				details: { payload, granted: false },
			};
		},
	});
}

export default askPermission;
