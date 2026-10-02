/** Keep the fork's file notice on disk without injecting it as instructions. */
export function stripDirectiveModificationNotice(content: string): string {
  return content.replace(
    /^<!-- Modified for the subagent-mcp Pi adapter fork\. -->\r?\n/,
    ""
  );
}
