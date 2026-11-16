/**
 * Erkennen und Entfernen von Geheimnissen und itslearning-internen URLs.
 * Siehe docs/mcp-server-spec.md, Abschnitt 6.5.
 */

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

function hasSecretParams(u: URL): boolean {
  for (const k of u.searchParams.keys()) if (SECRET_PARAM_RE.test(k)) return true;
  return false;
}

/**
 * Darf diese URL an einen Agenten gehen?
 * Erlaubt: externe http(s)-Links ohne geheime Query-Parameter. Verboten: alles von *.itslearning.com.
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

/** Ersetzt nicht teilbare URLs in einem Text. Externe, unkritische Links bleiben stehen. */
export function stripSecretUrls(text: string): string {
  return text.replace(URL_IN_TEXT_RE, (raw) => {
    const url = raw.replace(/[.,;:!?]+$/, "");
    const tail = raw.slice(url.length);
    if (isShareableUrl(url)) return raw;
    return (isItslearningUrl(url) ? "[itslearning-Link]" : "[Link entfernt]") + tail;
  });
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

/** URL-Muster für Logs: IDs, Tokens, Dateinamen und alle Query-Werte ersetzt; externe URLs komplett. */
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

/** Bereinigt Fehlertexte der API für Logs (dort stehen z. B. PersonId/CustomerId drin). */
export function sanitizeErrorText(text: string): string {
  if (/<html|<!DOCTYPE/i.test(text)) return "HTML-Fehlerseite";
  return text
    .replace(URL_IN_TEXT_RE, (u) => redactUrlForLog(u))
    .replace(/\d+/g, "{n}")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}
