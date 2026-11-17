/**
 * Minimal "browser" for the itslearning web interface (spec 4.3):
 * follows redirects manually, keeps cookies (only *.itslearning.com), limits sizes.
 * All URLs here are potentially secret (signatures, tokens, names in the query) → never log/return them.
 */
import type { Limiter } from "../api/limiter";
import { ToolError } from "../errors";

const UA = "Mozilla/5.0 (compatible; itslearning-mcp)";
const MAX_HOPS = 12;
const ITSL_HOST_RE = /(^|\.)itslearning\.com$/i;

export class CookieJar {
  private cookies = new Map<string, string>();

  store(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      const pair = sc.split(";")[0] ?? "";
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get size() {
    return this.cookies.size;
  }
}

export type BrowseResult = { res: Response; finalUrl: string; hops: number };

export class WebBrowser {
  constructor(
    private limiter: Limiter,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  /** GET with manual redirect following; cookies only for itslearning hosts. */
  async get(url: string, jar?: CookieJar): Promise<BrowseResult> {
    let current = url;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const itsl = isItslHost(current);
      const headers: Record<string, string> = { "User-Agent": UA, Accept: "*/*" };
      const cookie = itsl ? jar?.header() : undefined;
      if (cookie) headers.Cookie = cookie;
      let res: Response;
      try {
        res = await this.limiter.run(() => this.fetchImpl(current, { redirect: "manual", headers }));
      } catch {
        throw new ToolError("UPSTREAM_ERROR", "itslearning file server not reachable.");
      }
      if (itsl) jar?.store(res);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel().catch(() => {});
        current = new URL(loc, current).toString();
        continue;
      }
      return { res, finalUrl: current, hops: hop };
    }
    throw new ToolError("UPSTREAM_ERROR", "Too many redirects while fetching the file.");
  }
}

export function isItslHost(url: string): boolean {
  try {
    return ITSL_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isHtml(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}

/** Is the response a file (and not an HTML page)? */
export function isFileResponse(res: Response): boolean {
  const cd = (res.headers.get("content-disposition") ?? "").toLowerCase();
  return cd.startsWith("attachment") || !isHtml(res);
}

/** Reads the body with a size limit (checks Content-Length up front and counts while streaming). */
export async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(len) && len > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new ToolError("FILE_TOO_LARGE", `File is too large (${mb(len)} MB, limit ${mb(maxBytes)} MB).`);
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ToolError("FILE_TOO_LARGE", `File is too large (> ${mb(maxBytes)} MB).`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

const mb = (bytes: number) => Math.round((bytes / 1_048_576) * 10) / 10;

// &amp; last – otherwise "&amp;quot;" would be decoded twice (to '"' instead of "&quot;")
const decodeHtml = (s: string) =>
  s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/** iframes and download links of an HTML page (absolute URLs). */
export function extractLinks(html: string, baseUrl: string): { iframes: string[]; downloads: string[] } {
  const abs = (raw: string) => {
    try {
      return new URL(decodeHtml(raw), baseUrl).toString();
    } catch {
      return undefined;
    }
  };
  const iframes = [...html.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => abs(m[1]!)).filter((u): u is string => !!u);
  const downloads: string[] = [];
  for (const m of html.matchAll(/\b(?:href|src|data-[\w-]+)=["']([^"']+)["']/gi)) {
    const u = abs(m[1]!);
    if (!u) continue;
    if (/\.(css|js)(\?|$)|cdn\.itslearning\.com|\/App_Themes\/|\/images\/|\/icons\//i.test(u)) continue;
    if (/DownloadRedirect\.ashx|[?&]Download=1|filerepository\.itslearning\.com|\/file\/download/i.test(u)) downloads.push(u);
  }
  // DownloadRedirect first – this is the verified path for course files
  const uniq = [...new Set(downloads)].sort((a, b) => Number(/DownloadRedirect/i.test(b)) - Number(/DownloadRedirect/i.test(a)));
  return { iframes: [...new Set(iframes)], downloads: uniq };
}

/** Does the page look like the itslearning login page? (→ web session expired) */
export function looksLikeLoginPage(html: string): boolean {
  return /ctl00_ContentPlaceHolder1_(nativeLogin|federatedLogin|Username)\b/.test(html);
}

/** File name from Content-Disposition (RFC 5987 filename* preferred). */
export function filenameFromDisposition(cd: string | null): string | undefined {
  if (!cd) return undefined;
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (star) {
    try {
      return decodeURIComponent(star[1]!.trim().replace(/^"|"$/g, ""));
    } catch {}
  }
  const plain = cd.match(/filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i);
  const v = (plain?.[1] ?? plain?.[2])?.trim();
  return v || undefined;
}
