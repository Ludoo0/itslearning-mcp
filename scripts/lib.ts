/**
 * Shared helpers for the developer scripts (scripts/):
 * terminal input, OAuth2 login, token refresh, API client.
 */

/** Instance URL, e.g. https://yourschool.itslearning.com – from ITSL_BASE_URL or interactively (promptCredentials). */
export let BASE = normalizeBase(process.env.ITSL_BASE_URL ?? "");

function normalizeBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
// Public client id of the official itslearning mobile app
export const CLIENT_ID = "10ae9d30-1853-48ff-81cb-47b58a325685";
export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) itslearning-mcp-probe";

// ---------- Terminal input ----------

import { readHidden, readLine } from "../src/cli/prompt";
export { readHidden, readLine };

export async function promptCredentials(): Promise<{ username: string; password: string }> {
  if (!BASE) BASE = normalizeBase(await readLine("itslearning URL (e.g. yourschool.itslearning.com): "));
  if (!BASE) throw new Error("No itslearning URL given (ITSL_BASE_URL).");
  const username = process.env.ITSL_USERNAME || process.env.ITSL_USER || (await readLine("Username: "));
  const password = process.env.ITSL_PASSWORD || process.env.ITSL_PASS || (await readHidden("Password: "));
  if (!username || !password) throw new Error("Username and password are required.");
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
  if (!res.ok) throw new Error(`Token request failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  const json = JSON.parse(text) as TokenResponse;
  if (!json.access_token) throw new Error(`No access_token in response`);
  return json;
}

export const loginWithPassword = (username: string, password: string) =>
  tokenRequest({ grant_type: "password", username, password });

export const refreshToken = (refresh_token: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token });

// ---------- API client with auto refresh ----------

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
    if (!this.token.refresh_token) throw new Error("Token expired and no refresh token available.");
    this.token = await refreshToken(this.token.refresh_token);
    this.expiresAt = this.computeExpiry(this.token);
  }

  /** GET against the REST API (path relative to BASE or absolute URL). */
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
