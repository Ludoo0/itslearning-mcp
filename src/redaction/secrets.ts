/**
 * Detection and removal of secrets and itslearning-internal URLs.
 * See docs/mcp-server-spec.md, section 6.5.
 */
import { LABELS, type Labels } from "./labels";

const ITSL_HOST_RE = /(^|\.)itslearning\.com$/i;
const SECRET_PARAM_RE = /^(token|signature|hash|sign|apisessionid|guid|access_token|refresh_token|password|username|email|firstname|lastname|personid|userid)$/i;
const URL_IN_TEXT_RE = /\b(?:https?|webcal):\/\/[^\s<>"'`)\]]+/gi;

export function isItslearningUrl(url: string): boolean {
  try {
    return ITSL_HOST_RE.test(new URL(url.replace(/^webcal:/i, "https:")).hostname);
  } catch {
    return false;
  }
}

const ID_KEY_RE = /\b(?:Person|User|Customer|Child|Student|Member)_?Id\b/i;
const MAX_PARAM_VALUE_LEN = 200;

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Secret parameter NAMES or suspicious VALUES: JSON/markup, person ids, unusually long values
 * (e.g. launch parameters of external learning tools: ?data=%7B%22PersonId%22%3A…%7D).
 */
function hasSecretParams(u: URL): boolean {
  for (const [k, v] of u.searchParams) {
    if (SECRET_PARAM_RE.test(k)) return true;
    if (v.length > MAX_PARAM_VALUE_LEN || /[{}"<>]/.test(v) || ID_KEY_RE.test(v)) return true;
  }
  const hash = safeDecode(u.hash);
  return hash.length > MAX_PARAM_VALUE_LEN || /[{}"<>]/.test(hash) || ID_KEY_RE.test(hash);
}

/**
 * May this URL be passed to an agent?
 * Allowed: external http(s) links without secret/suspicious query parameters. Never: anything on *.itslearning.com.
 */
export function isShareableUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (ITSL_HOST_RE.test(u.hostname)) return false;
  if (u.username || u.password) return false;
  return !hasSecretParams(u);
}

/** Relative itslearning links in text, e.g. "/Person/show_person.aspx?PersonId=123". */
const RELATIVE_ITSL_PATH_RE = /(?<![\w/.:-])\/?(?:[\w.-]+\/)*[\w.-]+\.(?:aspx|ashx|asmx)(?:\?[^\s<>"'`)\]]*)?/gi;
/** Internal ids as key/value pairs, e.g. "PersonId=123", "personid: 123", "\"PersonId\":123". */
const ID_PAIR_RE = /["']?\b(?:Person|User|Customer|Child|Student|Member)_?Id["']?\s*[=:]\s*["']?\d+["']?/gi;

/**
 * URL-encoded data blobs (e.g. launch parameters of embedded learning tools: "%22PersonId%22%3A123…").
 * Useless for agents and potentially sensitive – names encoded inside (%C3%BC …) are invisible to the name dictionary.
 */
const ENCODED_BLOB_RE = /[^\s<>"']*(?:%[0-9a-f]{2}[^\s<>"'%]*){3,}/gi;

/**
 * Replaces non-shareable URLs (absolute and relative), encoded data blobs and internal id pairs.
 * External, harmless links are kept.
 */
export function stripSecretUrls(text: string, labels: Labels = LABELS.en): string {
  return text
    .replace(ENCODED_BLOB_RE, (raw) => (isShareableUrl(raw) ? raw : labels.encodedData))
    .replace(URL_IN_TEXT_RE, (raw) => {
      const url = raw.replace(/[.,;:!?]+$/, "");
      const tail = raw.slice(url.length);
      if (isShareableUrl(url)) return raw;
      return (isItslearningUrl(url) ? labels.itslearningLink : labels.linkRemoved) + tail;
    })
    .replace(RELATIVE_ITSL_PATH_RE, (raw) => labels.itslearningLink + (raw.match(/[.,;:!?]+$/)?.[0] ?? ""))
    .replace(ID_PAIR_RE, labels.idPair);
}

function redactSegment(seg: string): string {
  if (!seg) return seg;
  let s = seg;
  try {
    s = decodeURIComponent(seg);
  } catch {}
  if (/^\d+$/.test(s)) return "{n}";
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(s)) return "{guid}";
  if (/^[\w-]+\.(aspx|ashx|asmx|html?|php)$/i.test(s)) return s;
  const ext = s.match(/\.([a-z0-9]{1,5})$/i);
  if (ext) return `{file}.${ext[1]!.toLowerCase()}`;
  if (s.length > 24 || /[^\w.-]/.test(s) || (/\d/.test(s) && /[a-z]/i.test(s))) return "{token}";
  return s;
}

/** URL pattern for logs: ids, tokens, file names and all query values replaced; external URLs entirely. */
export function redactUrlForLog(raw: string, base?: string): string {
  let u: URL;
  try {
    u = new URL(raw.replace(/^webcal:/i, "https:"), base);
  } catch {
    return "{unparseable}";
  }
  if (!ITSL_HOST_RE.test(u.hostname)) return "{external-url}";
  const path = u.pathname.split("/").map(redactSegment).join("/");
  const keys = [...new Set(u.searchParams.keys())];
  const qs = keys.length ? "?" + keys.map((k) => `${k}={${/^\d+$/.test(u.searchParams.get(k) ?? "") ? "n" : "v"}}`).join("&") : "";
  return `${u.protocol}//${u.host}${path}${qs}`;
}

/** Cleans API error texts for logs (they contain e.g. PersonId/CustomerId). */
export function sanitizeErrorText(text: string): string {
  if (/<html|<!DOCTYPE/i.test(text)) return "HTML error page";
  return text
    .replace(URL_IN_TEXT_RE, (u) => redactUrlForLog(u))
    .replace(/\d+/g, "{n}")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}
