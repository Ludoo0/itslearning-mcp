/**
 * itslearning API probe
 *
 * Prompts for username + password (the password is not echoed),
 * fetches an OAuth2 token and checks which REST endpoints return data.
 *
 * Run:   bun run probe            (overview only)
 *        bun run probe --save     (additionally raw data to ./probe-output/)
 *
 * Nothing is stored except with --save (and the password never).
 */

import { BASE, loginWithPassword, promptCredentials } from "./lib";

const SAVE = process.argv.includes("--save");
const OUT_DIR = "probe-output";

// ---------- Probing ----------

// Known (unofficial) endpoints, as used e.g. by the mobile app.
// Not all of them necessarily exist in every version – that is exactly what we test.
const ENDPOINTS: Record<string, string> = {
  "Person (me)": "/restapi/personal/person/v1",
  "Organisations": "/restapi/personal/organisations/v1",
  "Courses": "/restapi/personal/courses/v2?pageSize=50",
  "Courses (v1)": "/restapi/personal/courses/v1?pageSize=50",
  "Notifications": "/restapi/personal/notifications/v1?pageSize=20",
  "Notification-Stream": "/restapi/personal/notifications/stream/v1?pageSize=20",
  "Tasks": "/restapi/personal/tasks/v1?pageSize=50",
  "Calendar (events)": "/restapi/personal/calendar/events/v1?pageSize=50",
  "Message threads": "/restapi/personal/instantmessages/messagethreads/v1?pageSize=20",
  "Light bulletins (course news)": "/restapi/personal/lightbulletins/v1?pageSize=20",
  "Contacts/hierarchy": "/restapi/personal/hierarchies/v1",
  "Parents: children": "/restapi/personal/children/v1",
};

type ProbeResult = {
  name: string;
  path: string;
  status: number;
  auth: "bearer" | "query" | "-";
  summary: string;
};

function describe(json: unknown): string {
  if (Array.isArray(json)) {
    const keys = json[0] && typeof json[0] === "object" ? Object.keys(json[0]).slice(0, 8).join(", ") : "";
    return `Array[${json.length}]${keys ? ` · fields: ${keys}` : ""}`;
  }
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.EntityArray)) {
      const first = obj.EntityArray[0];
      const keys = first && typeof first === "object" ? Object.keys(first).slice(0, 8).join(", ") : "";
      return `${obj.EntityArray.length} of ${obj.Total ?? "?"} entries${keys ? ` · fields: ${keys}` : ""}`;
    }
    return `object · fields: ${Object.keys(obj).slice(0, 10).join(", ")}`;
  }
  return String(json).slice(0, 80);
}

async function probe(name: string, path: string, token: string): Promise<ProbeResult> {
  const url = `${BASE}${path}`;
  // Bearer header first, on 401 fall back to ?access_token= (the app partly does this)
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  let auth: ProbeResult["auth"] = "bearer";
  if (res.status === 401) {
    const sep = path.includes("?") ? "&" : "?";
    res = await fetch(`${url}${sep}access_token=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    });
    auth = "query";
  }
  const text = await res.text();
  let summary: string;
  if (!res.ok) {
    summary = text.slice(0, 120).replace(/\s+/g, " ");
  } else {
    try {
      const json = JSON.parse(text);
      summary = describe(json);
      if (SAVE) {
        const file = `${OUT_DIR}/${name.replace(/[^\w-]+/g, "_")}.json`;
        await Bun.write(file, JSON.stringify(json, null, 2));
      }
    } catch {
      summary = `not JSON (${text.length} bytes)`;
    }
  }
  return { name, path, status: res.status, auth: res.ok ? auth : "-", summary };
}

// ---------- Main ----------

async function main() {
  const { username, password } = await promptCredentials();
  console.log(`\nitslearning API probe → ${BASE}`);

  process.stdout.write("\nFetching token … ");
  const token = await loginWithPassword(username, password);
  console.log(
    `OK (expires in ${token.expires_in ?? "?"}s, refresh token: ${token.refresh_token ? "yes" : "no"})\n`,
  );

  const results: ProbeResult[] = [];
  for (const [name, path] of Object.entries(ENDPOINTS)) {
    const r = await probe(name, path, token.access_token);
    results.push(r);
    const mark = r.status >= 200 && r.status < 300 ? "✅" : "❌";
    console.log(`${mark} ${String(r.status).padEnd(3)} ${r.auth.padEnd(6)} ${r.name}`);
    console.log(`       ${r.path}`);
    console.log(`       ${r.summary}\n`);
    await Bun.sleep(300); // be gentle with the server
  }

  const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
  console.log(`Done: ${ok}/${results.length} endpoints return data.`);
  if (SAVE) console.log(`Raw data stored in ./${OUT_DIR}/ (contains personal data – do not share!)`);
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
