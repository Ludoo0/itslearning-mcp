/**
 * Gemeinsame Helfer für die itslearning-Probe-Skripte:
 * Terminal-Eingabe, OAuth2-Login, Token-Refresh, API-Client.
 */

/** Instanz-URL, z. B. https://meineschule.itslearning.com – aus ITSL_BASE_URL oder interaktiv (promptCredentials). */
export let BASE = normalizeBase(process.env.ITSL_BASE_URL ?? "");

function normalizeBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
// Öffentliche Client-ID der offiziellen itslearning-Mobile-App
export const CLIENT_ID = "10ae9d30-1853-48ff-81cb-47b58a325685";
export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) itslearning-mcp-probe";

// ---------- Terminal-Eingabe ----------

/** Liest eine Zeile aus dem Terminal; bei hidden=true mit * statt Klartext. */
function readInput(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    if (!stdin.isTTY) {
      reject(new Error("Kein interaktives Terminal – bitte direkt in PowerShell/Terminal starten (oder ITSL_USER/ITSL_PASS setzen)."));
      return;
    }
    let input = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(input);
          return;
        } else if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        } else if (ch === "\u007f" || ch === "\b") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          input += ch;
          process.stdout.write(hidden ? "*" : ch);
        }
      }
    };
    stdin.on("data", onData);
  });
}

export const readLine = (q: string) => readInput(q, false).then((s) => s.trim());
export const readHidden = (q: string) => readInput(q, true);

export async function promptCredentials(): Promise<{ username: string; password: string }> {
  if (!BASE) BASE = normalizeBase(await readLine("itslearning-URL (z. B. meineschule.itslearning.com): "));
  if (!BASE) throw new Error("Keine itslearning-URL angegeben (ITSL_BASE_URL).");
  const username = process.env.ITSL_USER || (await readLine("Benutzername: "));
  const password = process.env.ITSL_PASS || (await readHidden("Passwort:     "));
  if (!username || !password) throw new Error("Benutzername und Passwort werden benötigt.");
  return { username, password };
}

// ---------- OAuth2 ----------

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${BASE}/restapi/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token-Anfrage fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 200)}`);
  const json = JSON.parse(text) as TokenResponse;
  if (!json.access_token) throw new Error(`Kein access_token in Antwort`);
  return json;
}

export const loginWithPassword = (username: string, password: string) =>
  tokenRequest({ grant_type: "password", username, password });

export const refreshToken = (refresh_token: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token });

// ---------- API-Client mit Auto-Refresh ----------

export class ItslearningClient {
  private expiresAt: number;

  constructor(private token: TokenResponse) {
    this.expiresAt = this.computeExpiry(token);
  }

  private computeExpiry(t: TokenResponse) {
    return Date.now() + (t.expires_in ?? 300) * 1000;
  }

  private async ensureFresh() {
    if (Date.now() < this.expiresAt - 30_000) return;
    if (!this.token.refresh_token) throw new Error("Token abgelaufen und kein Refresh-Token vorhanden.");
    this.token = await refreshToken(this.token.refresh_token);
    this.expiresAt = this.computeExpiry(this.token);
  }

  /** GET gegen die REST-API (Pfad relativ zu BASE oder absolute URL). */
  async get(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    await this.ensureFresh();
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : BASE + pathOrUrl;
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token.access_token}`,
        Accept: "application/json",
        "User-Agent": UA,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  }
}
