/**
 * REST-Client für /restapi/personal/… (Spec 2, 7, 9):
 * Bearer-Auth mit automatischem Refresh, Drosselung, TTL-Cache, Retries mit Backoff,
 * Abbildung von HTTP-Fehlern auf ToolError-Codes. Rohe Fehlertexte gehen nur bereinigt ins Log.
 */
import type { TokenStore } from "../auth/tokenStore";
import { ToolError } from "../errors";
import { log } from "../log";
import { sanitizeErrorText } from "../redaction/secrets";
import { TtlCache } from "./cache";
import { Limiter } from "./limiter";

export type ApiClientConfig = {
  baseUrl: string;
  cacheTtlS: number;
  maxConcurrency: number;
  minRequestIntervalMs: number;
};

export type Query = Record<string, string | number | boolean | undefined>;

const MAX_RETRIES = 3;
const UA = "itslearning-mcp";

export class ApiClient {
  private limiter: Limiter;
  private cache: TtlCache;

  constructor(
    private cfg: ApiClientConfig,
    private auth: Pick<TokenStore, "getAccessToken" | "invalidate">,
    private fetchImpl: typeof fetch = fetch,
    private sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
    limiter?: Limiter,
  ) {
    this.limiter = limiter ?? new Limiter(cfg.maxConcurrency, cfg.minRequestIntervalMs, sleep);
    this.cache = new TtlCache();
  }

  /**
   * GET, der einen Redirect erwartet (z. B. Datei-Download): liefert das Ziel aus dem Location-Header,
   * ohne ihm zu folgen. Das Ziel ist ein Geheimnis (signierte URL) und darf nicht geloggt/ausgegeben werden.
   */
  async getRedirectLocation(template: string, params: Record<string, string | number>): Promise<string> {
    const path = template.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(params[k])));
    const url = new URL(this.cfg.baseUrl + path);
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.auth.getAccessToken();
      const res = await this.limiter.run(() =>
        this.fetchImpl(url, { redirect: "manual", headers: { Authorization: `Bearer ${token}`, "User-Agent": UA } }),
      );
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) return new URL(loc, url).toString();
      if (res.status === 401 && attempt === 0) {
        this.auth.invalidate();
        continue;
      }
      log.warn("Redirect erwartet", { endpoint: template, status: res.status });
      throw res.ok ? new ToolError("NOT_A_FILE", "Unter dieser Referenz liegt keine Datei.") : mapStatus(res.status);
    }
    throw new ToolError("AUTH_FAILED", "Anmeldung bei itslearning fehlgeschlagen.");
  }

  /** GET mit JSON-Antwort. `template` (z. B. "/restapi/personal/courses/{courseId}/v1") wird fürs Log verwendet. */
  async get<T>(template: string, params: Record<string, string | number> = {}, query: Query = {}, opts: { ttlS?: number } = {}): Promise<T> {
    const path = template.replace(/\{(\w+)\}/g, (_, k) => {
      if (params[k] === undefined) throw new Error(`Parameter ${k} fehlt für ${template}`);
      return encodeURIComponent(String(params[k]));
    });
    const url = new URL(this.cfg.baseUrl + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const ttlMs = (opts.ttlS ?? this.cfg.cacheTtlS) * 1000;
    return this.cache.get(url.toString(), ttlMs, () => this.request<T>(template, url));
  }

  clearCache() {
    this.cache.clear();
  }

  private async request<T>(template: string, url: URL): Promise<T> {
    let authRetried = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.getAccessToken();
      const t0 = Date.now();
      let res: Response;
      try {
        res = await this.limiter.run(() =>
          this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": UA } }),
        );
      } catch (e) {
        if (attempt < MAX_RETRIES) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        log.warn("Netzwerkfehler", { endpoint: template, error: e instanceof Error ? e.name : "unknown" });
        throw new ToolError("UPSTREAM_ERROR", "itslearning ist nicht erreichbar.");
      }
      log.debug("GET", { endpoint: template, status: res.status, ms: Date.now() - t0 });

      if (res.ok) {
        const text = await res.text();
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ToolError("UPSTREAM_ERROR", "Unerwartete Antwort von itslearning (kein JSON).", res.status);
        }
      }

      if (res.status === 401 && !authRetried) {
        authRetried = true;
        this.auth.invalidate();
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await this.sleep(retryAfterMs(res) ?? backoffMs(attempt));
        continue;
      }

      const body = await res.text().catch(() => "");
      log.warn("API-Fehler", { endpoint: template, status: res.status, error: sanitizeErrorText(body) });
      throw mapStatus(res.status);
    }
  }
}

function backoffMs(attempt: number) {
  return 500 * 2 ** attempt;
}

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const s = Number(h);
  return Number.isFinite(s) ? Math.min(s * 1000, 30_000) : undefined;
}

function mapStatus(status: number): ToolError {
  switch (status) {
    case 401:
      return new ToolError("AUTH_FAILED", "Anmeldung bei itslearning fehlgeschlagen – Zugangsdaten prüfen.", status);
    case 403:
      return new ToolError("FORBIDDEN", "Kein Zugriff auf dieses Element.", status);
    case 404:
      return new ToolError("NOT_FOUND", "Element nicht gefunden.", status);
    case 429:
      return new ToolError("RATE_LIMITED", "itslearning drosselt Anfragen – später erneut versuchen.", status);
    default:
      return status >= 500
        ? new ToolError("UPSTREAM_ERROR", "itslearning ist nicht erreichbar.", status)
        : new ToolError("UPSTREAM_ERROR", `itslearning hat die Anfrage abgelehnt (HTTP ${status}).`, status);
  }
}
