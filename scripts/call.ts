/**
 * Dev tool: starts the MCP server via stdio (like a real MCP client) and calls a tool.
 *
 *   bun run call                                   → list tools
 *   bun run call itslearning_list_tasks limit=5
 *   bun run call itslearning_get_task elementId=123
 *   (JSON works too: '{"limit":5}')
 *
 * Credentials: ITSL_BASE_URL / ITSL_USERNAME / ITSL_PASSWORD from the environment, otherwise interactive prompt.
 * The login state is stored in ./.data (DATA_DIR) so the password is not needed every time.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BASE, promptCredentials } from "./lib";

const [toolName, ...argTokens] = process.argv.slice(2);

/** Arguments as JSON ('{"limit":5}') or as key=value pairs (limit=5 status=all) – the latter is PowerShell-friendly. */
function parseArgs(tokens: string[]): Record<string, unknown> {
  const joined = tokens.join(" ").trim();
  if (!joined) return {};
  if (joined.startsWith("{")) return JSON.parse(joined);
  const out: Record<string, unknown> = {};
  for (const t of tokens) {
    const i = t.indexOf("=");
    if (i <= 0) throw new Error(`Invalid argument "${t}" – expected key=value`);
    const v = t.slice(i + 1);
    out[t.slice(0, i)] = v === "true" ? true : v === "false" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return out;
}

async function main() {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  if (toolName) {
    const username = process.env.ITSL_USERNAME ?? process.env.ITSL_USER;
    const password = process.env.ITSL_PASSWORD ?? process.env.ITSL_PASS;
    if (!username || !password || !BASE) {
      if (username) env.ITSL_USER = username;
      if (password) env.ITSL_PASS = password;
      Object.assign(process.env, env);
      const creds = await promptCredentials();
      env.ITSL_USERNAME = creds.username;
      env.ITSL_PASSWORD = creds.password;
    } else {
      env.ITSL_USERNAME = username;
      env.ITSL_PASSWORD = password;
    }
    env.ITSL_BASE_URL = BASE;
  } else {
    // Only listing tools: no real login needed
    env.ITSL_BASE_URL ??= "https://example.itslearning.com";
    env.ITSL_USERNAME ??= "-";
    env.ITSL_PASSWORD ??= "-";
  }
  env.DATA_DIR ??= ".data";
  env.MCP_TRANSPORT = "stdio";
  env.LOG_LEVEL ??= "warn";

  const transport = new StdioClientTransport({ command: process.execPath, args: ["src/server.ts"], env, stderr: "inherit" });
  const client = new Client({ name: "itslearning-mcp-call", version: "0" });
  await client.connect(transport);

  if (!toolName) {
    const { tools } = await client.listTools();
    for (const t of tools) console.log(`${t.name}\n  ${t.description}\n  Input: ${JSON.stringify(t.inputSchema.properties ?? {})}\n`);
  } else {
    const args = parseArgs(argTokens);
    const res = await client.callTool({ name: toolName, arguments: args });
    const savedTo = (res.structuredContent as { savedTo?: string } | undefined)?.savedTo;
    for (const c of res.content as {
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
      resource?: { blob?: string; mimeType?: string };
    }[]) {
      if (c.type === "text") console.log(c.text);
      else if (c.type === "image")
        console.log(`[image: ${c.mimeType}, ${Math.round(((c.data?.length ?? 0) * 3) / 4 / 1024)} KB – content not shown]`);
      else if (c.type === "resource") {
        const kb = Math.round(((c.resource?.blob?.length ?? 0) * 3) / 4 / 1024);
        console.log(
          `[file: ${c.resource?.mimeType}, ${kb} KB – ${savedTo ? `saved to ${savedTo}` : "content not shown; set DOWNLOAD_DIR=… to save it"}]`,
        );
      }
    }
    if (res.isError) process.exitCode = 1;
  }
  await client.close();
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
