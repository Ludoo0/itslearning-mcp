/**
 * Fake der itslearning-Web-Oberfläche für den Datei-Download-Flow – bildet die in
 * docs/itslearning-api.md verifizierte Kette nach:
 *   SSO-URL → ProcessLogin (Cookie) → ViewLearningToolElement (iframe) → platform LoginSSO
 *   → resource File/View (DownloadRedirect-Link) → filerepository (Token) → filecache → Datei
 * Alle Namen erfunden.
 */

export const SECRET_MARKERS = ["SIG-SECRET", "FILETOKEN", "ATTSECRET", "IMGSECRET", "ASGSECRET", "sign=S3CR3T", "FirstName=Jonas"];

/** Minimales, gültiges PDF mit einer Textzeile (Offsets werden berechnet). */
export function makePdf(text: string): Uint8Array {
  const esc = text.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 12 Tf 72 720 Td (${esc}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

export type FakeWeb = { fetch: typeof fetch; stats: { requests: string[]; loginPagesServed: number }; expireSessionOnce(): void };

export function createFakeWeb(): FakeWeb {
  const stats = { requests: [] as string[], loginPagesServed: 0 };
  let expireNext = false;
  const html = (body: string, headers: Record<string, string> = {}) =>
    new Response(`<!DOCTYPE html><html><body>${body}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });
  const redirect = (to: string, headers: Record<string, string> = {}) => new Response(null, { status: 302, headers: { location: to, ...headers } });
  const file = (data: Uint8Array | string, type: string, disposition?: string) =>
    new Response(data as unknown as BodyInit, { headers: { "content-type": type, ...(disposition ? { "content-disposition": disposition } : {}) } });

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    stats.requests.push(`${url.host}${url.pathname}`);

    // --- Haupt-Instanz ---
    if (url.host === "demo.itslearning.com") {
      if (url.pathname === "/SSO/MobileAppLoginSso.aspx") {
        return redirect(`/ProcessLogin.aspx?Hash=SIG-SECRET&ReturnUrl=${encodeURIComponent(url.searchParams.get("ReturnUrl") ?? "/")}`);
      }
      if (url.pathname === "/ProcessLogin.aspx") {
        return redirect(url.searchParams.get("ReturnUrl") ?? "/", { "set-cookie": "ASP.NET_SessionId=sess1; path=/; HttpOnly" });
      }
      if (url.pathname === "/LearningToolElement/ViewLearningToolElement.aspx") {
        if (!cookie.includes("ASP.NET_SessionId=sess1") || expireNext) {
          expireNext = false;
          stats.loginPagesServed++;
          return html('<li id="ctl00_ContentPlaceHolder1_nativeLogin">Anmelden</li>');
        }
        const id = url.searchParams.get("LearningToolElementId");
        if (id === "7202") return html("<h1>Notiz</h1><p>Hallo Mia Sonnenfeld, siehe https://demo.itslearning.com/x?Token=FILETOKEN</p>");
        return html(`<iframe src="https://platform.itslearning.com/LoginSSO.aspx?FirstName=Jonas&amp;ElementId=${id}&amp;Signature=SIG-SECRET"></iframe>`);
      }
    }
    // --- Plattform / Ressourcen-Server ---
    if (url.host === "platform.itslearning.com" && url.pathname === "/LoginSSO.aspx") {
      return redirect(`https://resource.itslearning.com/File/View.aspx?ElementId=${url.searchParams.get("ElementId")}`, { "set-cookie": "res=1; path=/" });
    }
    if (url.host === "resource.itslearning.com") {
      if (url.pathname === "/File/View.aspx") {
        return html(
          '<img src="/App_Themes/Default/images/file.gif"><a href="/Proxy/DownloadRedirect.ashx?LearningObjectId=1&amp;LearningObjectInstanceId=2">Herunterladen</a>',
        );
      }
      if (url.pathname === "/Proxy/DownloadRedirect.ashx") return redirect("https://filerepository.itslearning.com/f1?Token=FILETOKEN&Download=1");
    }
    // --- Datei-Ablage ---
    if (url.host === "filerepository.itslearning.com") {
      const token = url.searchParams.get("Token");
      if (url.pathname === "/f1" && token === "FILETOKEN") return redirect("https://filecache.itslearning.com/c/f1?sign=S3CR3T");
      if (url.pathname === "/def" && token === "ATTSECRET") return redirect("https://filecache.itslearning.com/c/def?sign=S3CR3T");
      if (url.pathname === "/abc" && token === "IMGSECRET") return file(PNG, "image/png", "inline");
      if (url.pathname === "/asg1" && token === "ASGSECRET") {
        return file("Aufgabe von Sabine Lindqvist für Jonas Beispielmann", "application/octet-stream", "attachment; filename*=UTF-8''Br%C3%BCche_Jonas.txt");
      }
      return new Response("nope", { status: 403 });
    }
    if (url.host === "filecache.itslearning.com") {
      if (url.pathname === "/c/f1") {
        return file(
          "Arbeitsblatt für Jonas Beispielmann\nFragen an lindqvist@schule.example\nAufgabe 1: 3/4 + 1/8",
          "text/plain; charset=utf-8",
          'attachment; filename="Arbeitsblatt_Jonas_Beispielmann.txt"',
        );
      }
      if (url.pathname === "/c/def") {
        return file(makePdf("Notizen von Jonas Beispielmann und Mia Sonnenfeld"), "application/pdf", 'attachment; filename="Notizen_Jonas_Beispielmann.pdf"');
      }
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  return {
    fetch: fetchImpl,
    stats,
    expireSessionOnce: () => {
      expireNext = true;
    },
  };
}
