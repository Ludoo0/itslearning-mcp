#!/usr/bin/env bun
/**
 * Compatibility check CLI.
 *
 *   bun run check https://yourschool.itslearning.com            public checks, asks whether to test a login
 *   bun run check https://yourschool.itslearning.com --login    also test with your credentials (prompted)
 *   bun run check https://yourschool.itslearning.com --no-login public checks only
 *   bun run check … --json                                      machine-readable report
 *
 * In Docker:  docker run --rm -it ghcr.io/ludoo0/itslearning-mcp bun src/check/cli.ts https://yourschool.itslearning.com
 *
 * Credentials are taken from ITSL_USERNAME / ITSL_PASSWORD only if ITSL_BASE_URL points to the checked instance
 * (note: Bun loads .env automatically), otherwise prompted (password hidden). They are only sent after all
 * public checks passed and only to *.itslearning.com hosts. Nothing is stored. The output contains no names or content.
 */
import { normalizeBaseUrl } from "../config";
import { readHidden, readLine } from "../cli/prompt";
import { type CheckResult, type CheckStatus, runCheck } from "./core";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

if (flags.has("--help") || flags.has("-h")) {
  console.log(`Usage: bun run check <itslearning-url> [--login | --no-login] [--json]

Checks whether itslearning-mcp can work with an itslearning instance.
Without credentials: reachability, login method, REST API, mobile-app login.
With --login (or ITSL_USERNAME/ITSL_PASSWORD set): login, token refresh, account type,
core endpoints, course content and file download path. Output contains no names or content.`);
  process.exit(0);
}

const ICON: Record<CheckStatus, string> = { ok: "✅", warn: "⚠️ ", fail: "❌", skip: "➖" };
const json = flags.has("--json");
const interactive = Boolean(process.stdin.isTTY) && !json;

async function main() {
  const rawUrl = positional[0] ?? process.env.ITSL_BASE_URL ?? (interactive ? await readLine("itslearning URL (e.g. yourschool.itslearning.com): ") : "");
  if (!rawUrl) throw new Error("No itslearning URL given. Usage: bun run check <itslearning-url>");
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(rawUrl);
  } catch (e) {
    throw new Error(`Invalid URL "${rawUrl}" (${e instanceof Error ? e.message : e}) – use just the instance, e.g. https://yourschool.itslearning.com`);
  }

  let credentials: { username: string; password: string } | undefined;
  if (!flags.has("--no-login")) {
    // Credentials from the environment (e.g. a .env loaded by Bun) are only used for the instance they belong to –
    // never for another URL that happens to be checked.
    const envUser = process.env.ITSL_USERNAME;
    const envPass = process.env.ITSL_PASSWORD;
    let envMatches = false;
    try {
      envMatches = Boolean(process.env.ITSL_BASE_URL) && normalizeBaseUrl(process.env.ITSL_BASE_URL!) === baseUrl;
    } catch {}
    if (envUser && envPass && envMatches) {
      credentials = { username: envUser, password: envPass };
      if (!json) console.log("Using ITSL_USERNAME / ITSL_PASSWORD from the environment (ITSL_BASE_URL matches) for the login checks.");
    } else if (interactive) {
      if (envUser && envPass && !json) console.log("Note: ITSL_USERNAME / ITSL_PASSWORD are set for a different instance and are not used.");
      const want = flags.has("--login") || /^(y|yes|j|ja)$/i.test(await readLine("Also test a login with your itslearning account? [y/N] "));
      if (want) {
        const username = await readLine("User name: ");
        const password = await readHidden("Password: ");
        if (username && password) credentials = { username, password };
      }
    } else if (flags.has("--login")) {
      throw new Error("--login needs an interactive terminal or ITSL_USERNAME/ITSL_PASSWORD.");
    }
  }

  if (!json) console.log(`\nChecking ${baseUrl}\n`);
  const print = (r: CheckResult) => {
    if (!json) console.log(`${ICON[r.status]} ${r.title.padEnd(38)} ${r.detail}`);
  };
  const report = await runCheck({ baseUrl, credentials, onResult: print });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const fails = report.results.filter((r) => r.status === "fail");
    console.log("");
    if (report.verdict === "compatible") {
      console.log(report.loginTested ? "✅ Compatible – itslearning-mcp should work with this instance and account." : "✅ Looks compatible. Run with --login to also test your account.");
    } else if (report.verdict === "partial") {
      console.log("⚠️  Partially compatible – it should work, with the limitations marked above.");
      if (!report.loginTested) console.log("   Run with --login to also test your account.");
    } else {
      console.log("❌ Not compatible – see the failed checks above.");
      if (fails.some((r) => r.id === "login-mode")) console.log("   Instances with single sign-on only are on the roadmap (docs/roadmap.md).");
    }
    console.log("\nThis output contains no names or content and can be shared, e.g. in a GitHub issue.");
  }
  process.exit(report.verdict === "incompatible" ? 1 : 0);
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});
