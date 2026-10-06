# Publication privacy

This source distribution uses generic profile paths and relative provenance labels. It excludes credentials, authentication files, model sessions, runtime logs, local backups, captured-session screenshots, and dependency directories.

The publication branch is prepared from the verified public upstream reference with maintainer commits using the generic identity `Pi adapter maintainers <maintainers@example.invalid>`. Earlier local development commits are kept outside the publication directory and are not ancestors of the prepared branch.

Public upstream copyright, attribution, source URLs, and the upstream commit's original identity remain applicable. LICENSE and NOTICE are preserved. Test-only identities, loopback addresses, and illustrative user names are examples.

Removing personal configuration does not supply replacement credentials or change the Pi RPC protocol. Each installation must configure its own Pi provider/model and authentication outside the checkout, replace MCP executable/script paths, and choose its own private-directory restrictions. [CONFIGURATION.md](CONFIGURATION.md) identifies required and optional values. An omitted blocked-roots variable is an empty list; it does not reproduce the original user's private-directory restrictions.

The source archive is the distributable artifact. The review patch compares against public upstream material and can include removed upstream example paths; keep it as a local review artifact rather than uploading it as a release attachment.

Before any later publication, inspect the exact source tree and branch selected for upload. Do not push private backups, unrelated refs, or local configuration. Updating the source tree requires a fresh privacy scan; a pattern scan is not a guarantee against every possible identifier or secret format.
