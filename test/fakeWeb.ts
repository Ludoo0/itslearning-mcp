/**
 * Fake of the itslearning web interface for the file download flow – reproduces the chain
 * verified in docs/itslearning-api.md:
 *   SSO URL → ProcessLogin (cookie) → ViewLearningToolElement (iframe) → platform LoginSSO
 *   → resource File/View (DownloadRedirect link) → filerepository (token) → filecache → file
 * All names are fictional.
 */

export const SECRET_MARKERS = ["SIG-SECRET", "FILETOKEN", "ATTSECRET", "IMGSECRET", "ASGSECRET", "sign=S3CR3T", "FirstName=Jonas"];

/** Minimal valid PDF with one line of text (offsets are computed). */
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
    new Response(`<!DOCTYPE html><html><body>${body}</body></html>`, {
      headers: { "content-type": "text/html; charset=utf-8", ...headers },
    });
  const redirect = (to: string, headers: Record<string, string> = {}) =>
    new Response(null, { status: 302, headers: { location: to, ...headers } });
  const file = (data: Uint8Array | string, type: string, disposition?: string) =>
    new Response(data as unknown as BodyInit, {
      headers: { "content-type": type, ...(disposition ? { "content-disposition": disposition } : {}) },
    });

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    stats.requests.push(`${url.host}${url.pathname}`);

    // --- main instance ---
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
          return html('<li id="ctl00_ContentPlaceHolder1_nativeLogin">Log in</li>');
        }
        const id = url.searchParams.get("LearningToolElementId");
        if (id === "7202") return html("<h1>Note</h1><p>Hello Mia Sonnenfeld, see https://demo.itslearning.com/x?Token=FILETOKEN</p>");
        return html(
          `<iframe src="https://platform.itslearning.com/LoginSSO.aspx?FirstName=Jonas&amp;ElementId=${id}&amp;Signature=SIG-SECRET"></iframe>`,
        );
      }
      // Task page of a CustomActivity (fallback for task details): page chrome + instructions with names
      if (url.pathname === "/CustomActivity/CustomActivityOverview.aspx") {
        if (!cookie.includes("ASP.NET_SessionId=sess1")) return html('<li id="ctl00_ContentPlaceHolder1_nativeLogin">Log in</li>');
        return html(
          '<header>Logged in as Jonas Beispielmann</header><nav><a href="/Course/Course.aspx?CourseID=12">Courses</a></nav>' +
            "<h1>Reading log</h1><p>Please read chapter 3 by Friday and write half a page about it. " +
            "Questions to Sabine Lindqvist (lindqvist@school.example) or ask Mia Sonnenfeld.</p>" +
            '<div data-cfg="x">launch %7B%22PersonId%22%3A3001%7D</div>' +
            "<footer>Imprint · Privacy</footer>",
        );
      }
    }
    // --- platform / resource server ---
    if (url.host === "platform.itslearning.com" && url.pathname === "/LoginSSO.aspx") {
      return redirect(`https://resource.itslearning.com/File/View.aspx?ElementId=${url.searchParams.get("ElementId")}`, {
        "set-cookie": "res=1; path=/",
      });
    }
    if (url.host === "resource.itslearning.com") {
      if (url.pathname === "/File/View.aspx") {
        return html(
          '<img src="/App_Themes/Default/images/file.gif"><a href="/Proxy/DownloadRedirect.ashx?LearningObjectId=1&amp;LearningObjectInstanceId=2">Download</a>',
        );
      }
      if (url.pathname === "/Proxy/DownloadRedirect.ashx")
        return redirect("https://filerepository.itslearning.com/f1?Token=FILETOKEN&Download=1");
    }
    // --- file storage ---
    if (url.host === "filerepository.itslearning.com") {
      const token = url.searchParams.get("Token");
      if (url.pathname === "/f1" && token === "FILETOKEN") return redirect("https://filecache.itslearning.com/c/f1?sign=S3CR3T");
      if (url.pathname === "/def" && token === "ATTSECRET") return redirect("https://filecache.itslearning.com/c/def?sign=S3CR3T");
      if (url.pathname === "/abc" && token === "IMGSECRET") return file(PNG, "image/png", "inline");
      if (url.pathname === "/asg1" && token === "ASGSECRET") {
        return file(
          "Task from Sabine Lindqvist for Jonas Beispielmann",
          "application/octet-stream",
          "attachment; filename*=UTF-8''Caf%C3%A9_Jonas.txt",
        );
      }
      return new Response("nope", { status: 403 });
    }
    if (url.host === "filecache.itslearning.com") {
      if (url.pathname === "/c/f1") {
        return file(
          "Worksheet for Jonas Beispielmann\nQuestions to lindqvist@school.example\nTask 1: 3/4 + 1/8",
          "text/plain; charset=utf-8",
          'attachment; filename="Worksheet_Jonas_Beispielmann.txt"',
        );
      }
      if (url.pathname === "/c/def") {
        return file(
          makePdf("Notes by Jonas Beispielmann and Mia Sonnenfeld"),
          "application/pdf",
          'attachment; filename="Notes_Jonas_Beispielmann.pdf"',
        );
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
