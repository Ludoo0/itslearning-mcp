/**
 * itslearning API probe
 *
 * Fragt Benutzername + Passwort interaktiv ab (Passwort wird nicht angezeigt),
 * holt einen OAuth2-Token und testet, welche REST-Endpunkte Daten liefern.
 *
 * Ausführen:   bun run probe            (nur Übersicht)
 *              bun run probe --save     (zusätzlich Rohdaten nach ./probe-output/)
 *
 * Es wird nichts gespeichert außer bei --save (und das Passwort nie).
 */

import { BASE, loginWithPassword, promptCredentials } from "./lib";

const SAVE = process.argv.includes("--save");
const OUT_DIR = "probe-output";

// ---------- Probing ----------

// Bekannte (inoffizielle) Endpunkte, wie sie u. a. die Mobile-App nutzt.
// Nicht alle existieren zwingend in jeder Version – genau das testen wir.
const ENDPOINTS: Record<string, string> = {
  "Person (ich)": "/restapi/personal/person/v1",
  "Organisationen": "/restapi/personal/organisations/v1",
  "Kurse": "/restapi/personal/courses/v2?pageSize=50",
  "Kurse (v1)": "/restapi/personal/courses/v1?pageSize=50",
  "Mitteilungen/Notifications": "/restapi/personal/notifications/v1?pageSize=20",
  "Notification-Stream": "/restapi/personal/notifications/stream/v1?pageSize=20",
  "Aufgaben": "/restapi/personal/tasks/v1?pageSize=50",
  "Kalender (Events)": "/restapi/personal/calendar/events/v1?pageSize=50",
  "Nachrichten-Threads": "/restapi/personal/instantmessages/messagethreads/v1?pageSize=20",
  "Light Bulletins (Kurs-News)": "/restapi/personal/lightbulletins/v1?pageSize=20",
  "Kontakte/Hierarchie": "/restapi/personal/hierarchies/v1",
  "Eltern: Kinder": "/restapi/personal/children/v1",
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
    return `Array[${json.length}]${keys ? ` · Felder: ${keys}` : ""}`;
  }
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.EntityArray)) {
      const first = obj.EntityArray[0];
      const keys = first && typeof first === "object" ? Object.keys(first).slice(0, 8).join(", ") : "";
      return `${obj.EntityArray.length} von ${obj.Total ?? "?"} Einträgen${keys ? ` · Felder: ${keys}` : ""}`;
    }
    return `Objekt · Felder: ${Object.keys(obj).slice(0, 10).join(", ")}`;
  }
  return String(json).slice(0, 80);
}

async function probe(name: string, path: string, token: string): Promise<ProbeResult> {
  const url = `${BASE}${path}`;
  // Erst Bearer-Header, bei 401 Fallback auf ?access_token= (so macht es die App teils)
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
      summary = `Kein JSON (${text.length} Bytes)`;
    }
  }
  return { name, path, status: res.status, auth: res.ok ? auth : "-", summary };
}

// ---------- Main ----------

async function main() {
  const { username, password } = await promptCredentials();
  console.log(`\nitslearning API probe → ${BASE}`);

  process.stdout.write("\nHole Token … ");
  const token = await loginWithPassword(username, password);
  console.log(
    `OK (läuft ab in ${token.expires_in ?? "?"}s, Refresh-Token: ${token.refresh_token ? "ja" : "nein"})\n`,
  );

  const results: ProbeResult[] = [];
  for (const [name, path] of Object.entries(ENDPOINTS)) {
    const r = await probe(name, path, token.access_token);
    results.push(r);
    const mark = r.status >= 200 && r.status < 300 ? "✅" : "❌";
    console.log(`${mark} ${String(r.status).padEnd(3)} ${r.auth.padEnd(6)} ${r.name}`);
    console.log(`       ${r.path}`);
    console.log(`       ${r.summary}\n`);
    await Bun.sleep(300); // freundlich zum Server
  }

  const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
  console.log(`Fertig: ${ok}/${results.length} Endpunkte liefern Daten.`);
  if (SAVE) console.log(`Rohdaten gespeichert in ./${OUT_DIR}/ (enthält persönliche Daten – nicht teilen!)`);
}

main().catch((err) => {
  console.error(`\nFehler: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
