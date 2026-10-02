<!-- Modified for the subagent-mcp Pi adapter fork. -->
# Contributing

Use Node.js 24 and Python 3. Install dependencies with `npm ci`, build with `npm run build`, and validate with `npm test`. `npm run test:pi` runs the focused RPC tests after a build. Test fixtures must not use credentials or call real model APIs.

Keep changes on a topic branch. Preserve unrelated files and inspect the exact diff. Keep LICENSE and NOTICE intact and mark modified upstream files. Do not add personal paths, auth files, logs, or model session transcripts. The package is private until the owner selects publishing metadata and authorizes publication.

The fork's local CI uses Node tests. GitHub upload and release actions require explicit owner authorization.
