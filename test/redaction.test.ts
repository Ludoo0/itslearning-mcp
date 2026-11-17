import { describe, expect, test } from "bun:test";
import { detectLoginModeFromHtml } from "../src/auth/loginMode";
import { NameDictionary, parseKeepWords, redactContacts } from "../src/redaction/freetext";
import { htmlToText } from "../src/redaction/html";
import { LABELS } from "../src/redaction/labels";
import { Redactor } from "../src/redaction/redactor";
import { isShareableUrl, sanitizeErrorText, stripSecretUrls } from "../src/redaction/secrets";
import { SELF } from "./fixtures";

describe("secrets", () => {
  test("itslearning URLs and URLs with tokens are not shareable", () => {
    expect(isShareableUrl("https://example.org/sheet.pdf")).toBe(true);
    expect(isShareableUrl("https://demo.itslearning.com/main.aspx?CourseID=1")).toBe(false);
    expect(isShareableUrl("https://filerepository.itslearning.com/x?Token=abc")).toBe(false);
    expect(isShareableUrl("https://example.org/x?token=abc")).toBe(false);
    expect(isShareableUrl("https://example.org/x?Signature=abc")).toBe(false);
    expect(isShareableUrl("javascript:alert(1)")).toBe(false);
  });

  test("stripSecretUrls only replaces critical links", () => {
    const out = stripSecretUrls(
      "See https://example.org/a. Internal: https://demo.itslearning.com/x?y=1, file https://cdn.example.org/f?sign=zz",
    );
    expect(out).toContain("https://example.org/a.");
    expect(out).toContain("[itslearning link],");
    expect(out).toContain("[link removed]");
    expect(out).not.toContain("sign=zz");
  });

  test("relative itslearning links and id pairs are removed", () => {
    expect(stripSecretUrls("Profile: /Person/show_person.aspx?PersonId=4711 view")).toBe("Profile: [itslearning link] view");
    expect(stripSecretUrls("see main.aspx?CourseID=12&ElementID=3.")).toBe("see [itslearning link].");
    expect(stripSecretUrls('{"PersonId": 4711, "personid=12", UserId:5}')).toBe("{[ID], [ID], [ID]}");
    // no false positives for normal text, file names and external links
    expect(stripSecretUrls("Chapter 3, page 12, file sheet.pdf, https://example.org/a.aspx")).toBe(
      "Chapter 3, page 12, file sheet.pdf, https://example.org/a.aspx",
    );
  });

  test("URL-encoded data blobs are removed, normal percentages stay", () => {
    expect(stripSecretUrls("Start: %7B%22PersonId%22%3A12345678%2C%22Name%22%3A%22M%C3%BCller%22%7D end")).toBe(
      "Start: [encoded data removed] end",
    );
    expect(stripSecretUrls("launch?data=%7B%22a%22%3A1%7D")).toBe("[encoded data removed]");
    expect(stripSecretUrls("50% off on 20 % of the area, grade 2%")).toBe("50% off on 20 % of the area, grade 2%");
    expect(stripSecretUrls("https://example.org/search?q=Fr%C3%A4ctions%20and%20percent")).toBe(
      "https://example.org/search?q=Fr%C3%A4ctions%20and%20percent",
    );
  });

  test("external links with encoded personal data in parameters are not shareable", () => {
    const blob = "%7B%22sourcename%22%3A%221234%22%2C%22PersonId%22%3A12345678%7D";
    expect(isShareableUrl(`https://tool.example/launch?data=${blob}`)).toBe(false);
    expect(isShareableUrl("https://tool.example/x?ref=userid%3D5")).toBe(false); // id key inside a value → suspicious
    expect(isShareableUrl("https://tool.example/x?q=PersonId")).toBe(false);
    expect(isShareableUrl("https://example.org/search?q=Fr%C3%A4ctions%20and%20percent")).toBe(true);
    expect(isShareableUrl(`https://tool.example/x?long=${"a".repeat(300)}`)).toBe(false);
    expect(isShareableUrl("https://tool.example/x#%7B%22a%22%3A1%7D")).toBe(false);
    expect(isShareableUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toBe(true);

    const r = new Redactor();
    expect(r.text(`Tool: https://tool.example/launch?data=${blob}`)).toBe("Tool: [encoded data removed]");
    expect(r.text(`<a href="https://tool.example/launch?data=${blob}">Open tool</a>`)).toBe("Open tool");
  });

  test("sanitizeErrorText removes ids", () => {
    expect(sanitizeErrorText("CustomerId=1234, PersonId=4711, does not have Read permission")).toBe(
      "CustomerId={n}, PersonId={n}, does not have Read permission",
    );
    expect(sanitizeErrorText("<!DOCTYPE html><html>…</html>")).toBe("HTML error page");
  });

  test("German placeholders with labels=de", () => {
    expect(stripSecretUrls("https://demo.itslearning.com/x und %7B%22a%22%3A1%7D", LABELS.de)).toBe(
      "[itslearning-Link] und [kodierte Daten entfernt]",
    );
  });
});

describe("html", () => {
  test("converts HTML into readable text, links only if shareable", () => {
    const out = htmlToText(
      '<p>Hello&nbsp;class,</p><ul><li>Task&nbsp;1</li><li>Task 2</li></ul><a href="https://example.org/x">Sheet</a> <a href="https://demo.itslearning.com/y">Course</a><img src="x.png">',
    );
    expect(out).toBe("Hello class,\n\n- Task 1\n- Task 2\n[Sheet](https://example.org/x) Course[image]");
    expect(htmlToText('<img src="x.png">', LABELS.de)).toBe("[Bild]");
  });

  test("task-page layout: CRLF, blank lines, empty list items and item content on the next line are cleaned up", () => {
    // structure modelled on a real itslearning task page (content fictional)
    const page =
      "<div>Sample task</div>\r\n\r\n\r\n\r\n<ul><li>\r\n</li><li>\r\n</li></ul>\r\n\r\n\r\n" +
      "<div>Have you completed this task?</div>\r\n<span>Yes</span>\r\n<span>No</span>\r\n" +
      "<ul><li>\r\n</li></ul><h2>Description</h2>\r\n\r\n<p>Watch the film about cells</p>\r\n<img src='x.png'>\r\n\r\n" +
      "<h2>Information</h2><ul><li>\r\nPublished Monday by \r\nTeacher Example\r\n\r\n</li><li>\r\n</li><li>\r\nThis task is mandatory\r\n</li><li>\r\n\r\n</li></ul>";
    const out = htmlToText(page);
    expect(out).not.toMatch(/\r|\n{3,}|^- ?$/m);
    expect(out).toBe(
      "Sample task\n\nHave you completed this task?\n\nYes\nNo\n\n## Description\n\nWatch the film about cells\n\n[image]\n\n## Information\n\n- Published Monday by\nTeacher Example\n\n- This task is mandatory",
    );
  });
});

describe("freetext", () => {
  test("email and phone, but not dates", () => {
    expect(redactContacts("Mail: a.b@school.example, phone 0421 / 123 45 67")).toBe("Mail: [email], phone [phone]");
    expect(redactContacts("Due on 18.11.2026 at 08:00")).toBe("Due on 18.11.2026 at 08:00");
    expect(redactContacts("Page 0123")).toBe("Page 0123");
    expect(redactContacts("Mail: a@b.example", LABELS.de)).toBe("Mail: [E-Mail]");
  });

  test("name dictionary: variants, word boundaries, stopwords", () => {
    const d = new NameDictionary();
    d.addPerson({ firstName: "Anna", lastName: "Klein", fullName: "Anna Klein" }, "Mrs Klein");
    d.addPerson({ firstName: "Lukas", lastName: "Sonnenberg" }, "Student-7F3A");
    expect(d.apply("Anna Klein wrote")).toBe("Mrs Klein wrote");
    expect(d.apply("Regards, Klein, Anna")).toBe("Regards, Mrs Klein");
    expect(d.apply("klein alone is a stopword")).toBe("klein alone is a stopword");
    expect(d.apply("Lukas and SONNENBERG, not Sonnenbergstraße")).toBe("Student-7F3A and Student-7F3A, not Sonnenbergstraße");
  });

  test("salutation variants in both languages for teachers only", () => {
    const d = new NameDictionary();
    d.addPerson({ firstName: "Sabine", lastName: "Lindqvist" }, "Teacher Lindqvist", { withTitles: true });
    d.addPerson({ firstName: "Mia", lastName: "Sonnenfeld" }, "Student-1", {});
    expect(d.apply("Mrs. Lindqvist, Frau Lindqvist, Dr Lindqvist")).toBe("Teacher Lindqvist, Teacher Lindqvist, Teacher Lindqvist");
    expect(d.apply("Mr Sonnenfeld")).toBe("Mr Student-1");
  });

  test("same spelling for two people → neutral", () => {
    const d = new NameDictionary();
    d.addPerson({ firstName: "Mia", lastName: "Sonnenberg" }, "A");
    d.addPerson({ firstName: "Ben", lastName: "Sonnenberg" }, "B");
    expect(d.apply("Sonnenberg")).toBe("[name]");
    expect(d.apply("Mia Sonnenberg")).toBe("A");
    const de = new NameDictionary({ ambiguous: LABELS.de.ambiguousName });
    de.addPerson({ lastName: "Sonnenberg" }, "A");
    de.addPerson({ lastName: "Sonnenberg" }, "B");
    expect(de.apply("Sonnenberg")).toBe("[Name]");
  });

  test("keep words are never replaced as a single name, full names still are", () => {
    const keep = parseKeepWords(" Bergen, ,OSLO");
    expect([...keep]).toEqual(["bergen", "oslo"]);
    const d = new NameDictionary({ keepWords: keep });
    d.addPerson({ firstName: "Ola", lastName: "Bergen", fullName: "Ola Bergen" }, "Student-1");
    expect(d.apply("The Bergen math night")).toBe("The Bergen math night");
    expect(d.apply("Ola Bergen and Ola")).toBe("Student-1 and Student-1");
  });
});

describe("Redactor", () => {
  test("own account becomes 'Me', pipeline order is right", () => {
    const r = new Redactor();
    r.registerSelf(SELF);
    const out = r.text(
      '<p>Hello Jonas Beispielmann, write to jonas.beispielmann@school.example</p><a href="https://demo.itslearning.com/x?Token=abc">here</a>',
    );
    expect(out).toBe("Hello Me, write to [email]\nhere");
    expect(out).not.toMatch(/Jonas|Beispielmann|itslearning|Token/);
  });

  test("truncates with an ellipsis", () => {
    const r = new Redactor();
    expect(r.text("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("loginMode", () => {
  test("detects native and SSO-only login", () => {
    expect(detectLoginModeFromHtml('<li id="ctl00_ContentPlaceHolder1_nativeLogin">')).toBe("native");
    expect(detectLoginModeFromHtml('<div id="ctl00_ContentPlaceHolder1_federatedLogin">')).toBe("federated-only");
    expect(detectLoginModeFromHtml("<html></html>")).toBe("unknown");
  });
});
