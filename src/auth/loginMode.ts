/**
 * Erkennt anhand der öffentlichen Login-Seite, ob eine Instanz den nativen Login anbietet
 * oder nur Login über einen fremden Anbieter (SSO) – Spec 4.1.
 */
export type LoginMode = "native" | "federated-only" | "unknown";

export function detectLoginModeFromHtml(html: string): LoginMode {
  const native = /ctl00_ContentPlaceHolder1_nativeLogin\b/.test(html);
  const federated = /ctl00_ContentPlaceHolder1_federatedLogin\b/.test(html);
  if (native) return "native";
  if (federated) return "federated-only";
  return "unknown";
}

export async function detectLoginMode(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<LoginMode> {
  try {
    const res = await fetchImpl(`${baseUrl}/`, { headers: { "User-Agent": "itslearning-mcp" } });
    if (!res.ok) return "unknown";
    return detectLoginModeFromHtml(await res.text());
  } catch {
    return "unknown";
  }
}
