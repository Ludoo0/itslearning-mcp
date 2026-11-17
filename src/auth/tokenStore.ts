/**
 * OAuth2 token management (spec 4.1/4.2):
 * - password login, refresh 30 s before expiry
 * - the rotating refresh token is stored atomically in DATA_DIR/state.json after every refresh
 * - at most one refresh at a time
 * - a wrong password is "fatal": no further attempt until restart (avoid account lockout)
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ToolError } from "../errors";
import { log, registerSecret } from "../log";
import { sanitizeErrorText } from "../redaction/secrets";

export type TokenStoreConfig = {
  baseUrl: string;
  username: string;
  password: string;
  clientId: string;
  dataDir: string;
};

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };
type State = { baseUrl: string; username: string; refreshToken: string; updatedAt: string };

const REFRESH_MARGIN_MS = 30_000;
const UA = "itslearning-mcp";

export class TokenStore {
  private access?: { token: string; expiresAt: number };
  private refreshToken?: string;
  private stateLoaded = false;
  private pending?: Promise<string>;
  private fatalError?: ToolError;

  constructor(
    private cfg: TokenStoreConfig,
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {
    registerSecret(cfg.password);
  }

  private get statePath() {
    return join(this.cfg.dataDir, "state.json");
  }

  /** Valid access token; renewed when needed (concurrent calls share one refresh). */
  async getAccessToken(): Promise<string> {
    if (this.fatalError) throw this.fatalError;
    if (this.access && this.now() < this.access.expiresAt - REFRESH_MARGIN_MS) return this.access.token;
    this.pending ??= this.renew().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** Discards the access token (e.g. after a 401); the next call renews it. */
  invalidate() {
    this.access = undefined;
  }

  private async renew(): Promise<string> {
    if (!this.stateLoaded) {
      this.stateLoaded = true;
      this.refreshToken = (await this.loadState())?.refreshToken;
    }
    if (this.refreshToken) {
      try {
        return await this.accept(await this.tokenRequest({ grant_type: "refresh_token", refresh_token: this.refreshToken }));
      } catch (e) {
        if (e instanceof ToolError && e.code === "UPSTREAM_ERROR") throw e; // itslearning down → do not fall back to the password
        log.warn("Refresh failed – logging in with password");
        this.refreshToken = undefined;
      }
    }
    try {
      return await this.accept(
        await this.tokenRequest({ grant_type: "password", username: this.cfg.username, password: this.cfg.password }),
      );
    } catch (e) {
      if (e instanceof ToolError && e.fatal) this.fatalError = e;
      throw e;
    }
  }

  private async accept(t: TokenResponse): Promise<string> {
    registerSecret(t.access_token);
    registerSecret(t.refresh_token);
    this.access = { token: t.access_token, expiresAt: this.now() + (t.expires_in ?? 300) * 1000 };
    if (t.refresh_token && t.refresh_token !== this.refreshToken) {
      this.refreshToken = t.refresh_token;
      await this.saveState();
    }
    return t.access_token;
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}/restapi/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
        body: new URLSearchParams({ client_id: this.cfg.clientId, ...params }),
      });
    } catch {
      throw new ToolError("UPSTREAM_ERROR", "itslearning is not reachable.");
    }
    const text = await res.text();
    if (res.ok) {
      try {
        const json = JSON.parse(text) as TokenResponse;
        if (json.access_token) return json;
      } catch {}
      throw new ToolError("UPSTREAM_ERROR", "Unexpected response during login.");
    }
    if (res.status >= 500) throw new ToolError("UPSTREAM_ERROR", "itslearning is not reachable.", res.status);

    let code = "";
    try {
      code = String(JSON.parse(text)?.ErrorCode ?? JSON.parse(text)?.error ?? "");
    } catch {}
    log.warn("Token request rejected", { grant: params.grant_type, status: res.status, error: sanitizeErrorText(code || text) });

    if (params.grant_type === "refresh_token") throw new ToolError("AUTH_FAILED", "Refresh token invalid.", res.status);
    if (/InvalidUser/i.test(code)) {
      throw new ToolError("AUTH_FAILED", "Login failed: wrong username or password.", res.status, true);
    }
    if (/customer does not exist|disabled/i.test(code)) {
      throw new ToolError("AUTH_FAILED", "itslearning instance not found or disabled – check ITSL_BASE_URL.", res.status, true);
    }
    throw new ToolError("AUTH_FAILED", "Login to itslearning failed.", res.status, true);
  }

  private async loadState(): Promise<State | undefined> {
    try {
      const s = JSON.parse(await readFile(this.statePath, "utf8")) as State;
      if (s.baseUrl !== this.cfg.baseUrl || s.username !== this.cfg.username || !s.refreshToken) {
        log.info("Stored login does not match the configuration – ignoring it");
        return undefined;
      }
      registerSecret(s.refreshToken);
      return s;
    } catch {
      return undefined;
    }
  }

  private async saveState() {
    if (!this.refreshToken) return;
    const state: State = {
      baseUrl: this.cfg.baseUrl,
      username: this.cfg.username,
      refreshToken: this.refreshToken,
      updatedAt: new Date(this.now()).toISOString(),
    };
    try {
      await mkdir(this.cfg.dataDir, { recursive: true });
      const tmp = `${this.statePath}.tmp`;
      await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(tmp, this.statePath);
      await chmod(this.statePath, 0o600).catch(() => {});
    } catch (e) {
      // Not fatal: the server keeps working, just without persistence across restarts
      log.error("Could not write state.json", { error: e instanceof Error ? e.message : String(e) });
    }
  }
}
