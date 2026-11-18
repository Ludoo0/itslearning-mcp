import { describe, expect, test } from "bun:test";
import { detectLoginModeFromHtml } from "../src/auth/loginMode";
import { NameDictionary, parseKeepWords, redactContacts } from "../src/redaction/freetext";
import { htmlToText } from "../src/redaction/html";
import { getLabels, LABELS, LANGUAGES } from "../src/redaction/labels";
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

  test("nested/overlapping markup cannot survive (CodeQL: incomplete multi-character sanitization)", () => {
    expect(htmlToText("a<scr<script>x</script>ipt>alert(1)</script>b")).not.toMatch(/<script|<\/?[a-z]/i);
    expect(htmlToText("<<b>i>text</i>")).not.toMatch(/<\/?[a-z]/i);
    expect(htmlToText('<a href="/x"><<b>i>link</a>')).not.toMatch(/<\/?[a-z]/i);
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

  test("nb/sv/nl/fr salutations are replaced for teachers only", () => {
    const d = new NameDictionary();
    d.addPerson({ firstName: "Sabine", lastName: "Lindqvist" }, "T", { withTitles: true });
    d.addPerson({ firstName: "Mia", lastName: "Sonnenfeld" }, "S", {});
    const variants = ["Fru", "Fröken", "Herr", "Mevrouw", "Mevr.", "Mw.", "Meneer", "Dhr.", "Juf", "Meester"];
    variants.push("Madame", "Mme", "Mme.", "Mademoiselle", "Mlle", "Monsieur", "M.");
    for (const sal of variants) {
      expect(d.apply(`${sal} Lindqvist`)).toBe("T");
      expect(d.apply(`${sal.toLowerCase()} lindqvist`)).toBe("T");
    }
    expect(d.apply("Mevrouw Sonnenfeld, Mme Sonnenfeld")).toBe("Mevrouw S, Mme S");
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

  test("spellings without diacritics or with transliteration are replaced (GHSA-mjg7-6rhp-q6c9)", () => {
    const d = new NameDictionary();
    d.addPerson({ firstName: "Andrés", lastName: "Ibáñez Olmedo" }, "Teacher Ibáñez Olmedo", { withTitles: true });
    d.addPerson({ firstName: "Jörg", lastName: "Müßig" }, "Student-1");
    d.addPerson({ firstName: "Marten", lastName: "Kovac" }, "Student-2");
    // Sign-off with first name + first part of the surname, without diacritics
    expect(d.apply("Herzliche Grüße,\nAndres Ibanez")).toBe("Herzliche Grüße,\nTeacher Ibáñez Olmedo");
    expect(d.apply("ANDRÉS IBÁÑEZ OLMEDO")).toBe("Teacher Ibáñez Olmedo");
    expect(d.apply("Frau Olmedo / Herr Ibanez")).toBe("Teacher Ibáñez Olmedo / Teacher Ibáñez Olmedo");
    // German transliteration and plain folding
    expect(d.apply("Joerg Muessig, Jorg Mussig")).toBe("Student-1, Student-1");
    // Diacritics in the text, none in the profile
    expect(d.apply("Mårten Kováč")).toBe("Student-2");
    // Decomposed input (combining marks) is replaced completely
    expect(d.apply("Andrés.")).toBe("Teacher Ibáñez Olmedo.");
    // Surrounding text keeps its own diacritics
    expect(d.apply("Grüße an Kovac, schön!")).toBe("Grüße an Student-2, schön!");
  });

  test("parts of compound last names count as names, particles do not", () => {
    const d = new NameDictionary();
    d.addPerson({ firstName: "Sabine", lastName: "Lindqvist-Ødegård" }, "T", { withTitles: true });
    d.addPerson({ firstName: "Pieter", lastName: "van der Velde" }, "S");
    expect(d.apply("Sabine Odegard, S. Lindqvist, Frau Lindqvist")).toBe("T, T, T");
    expect(d.apply("Pieter Velde")).toBe("S");
    expect(d.apply("die Zeit von der Mitte")).toBe("die Zeit von der Mitte");
    // Short parts and prepositions of compound names are never replaced on their own
    d.addPerson({ firstName: "Lena", lastName: "Auf der Heidbrede" }, "S3");
    d.addPerson({ firstName: "Tomás", lastName: "Paz Ruiz" }, "S4");
    expect(d.apply("Ich freue mich auf euch, Lena Heidbrede")).toBe("Ich freue mich auf euch, S3");
    expect(d.apply("Auf Wiedersehen, Frieden und Paz")).toBe("Auf Wiedersehen, Frieden und Paz");
    expect(d.apply("Tomas Ruiz")).toBe("S4");
    // a part shared by two people becomes neutral
    d.addPerson({ firstName: "Mia", lastName: "Lindqvist" }, "S2");
    expect(d.apply("Lindqvist")).toBe("[name]");
    expect(d.apply("Sabine Lindqvist")).toBe("T");
  });

  test("a teacher's first name alone becomes neutral – it must not reveal the teacher's full name", () => {
    const d = new NameDictionary();
    d.addPerson({ firstName: "Sabine", lastName: "Lindqvist" }, "Teacher Lindqvist", { withTitles: true, neutralFirstName: true });
    // A different person with the same first name (e.g. a public figure quoted in course material)
    const out = d.apply("Association president Sabine Rasmussen said the vote at 16 is premature.");
    expect(out).toBe("Association president [name] Rasmussen said the vote at 16 is premature.");
    expect(out).not.toContain("Lindqvist");
    // Everything that identifies the teacher still maps to the teacher
    expect(d.apply("Sabine Lindqvist, Frau Lindqvist, S. Lindqvist, Lindqvist")).toBe(
      "Teacher Lindqvist, Teacher Lindqvist, Teacher Lindqvist, Teacher Lindqvist",
    );
    // First names of students keep their pseudonym (it reveals nothing)
    d.addPerson({ firstName: "Lukas", lastName: "Sonnenberg" }, "Student-7F3A");
    expect(d.apply("Hi Lukas")).toBe("Hi Student-7F3A");
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

  test("teacher first names in free text do not reveal the teacher (registry → dictionary)", () => {
    const r = new Redactor();
    r.people.register(4711, { firstName: "Sabine", lastName: "Lindqvist", fullName: "Sabine Lindqvist" }, "teacher");
    const out = r.text("Quote: Sabine Rasmussen thinks otherwise. Signed, Sabine Lindqvist");
    expect(out).toBe("Quote: [name] Rasmussen thinks otherwise. Signed, Teacher Lindqvist");
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

describe("label tables", () => {
  const enKeys = Object.keys(LABELS.en).sort();
  test("every language has a table, exactly the keys of en, matching types and bracket placeholders", () => {
    expect(Object.keys(LABELS).sort()).toEqual([...LANGUAGES].sort());
    for (const lang of LANGUAGES) {
      const l = LABELS[lang];
      expect(getLabels(lang)).toBe(l);
      expect(l.language).toBe(lang);
      expect(Object.keys(l).sort()).toEqual(enKeys);
      for (const k of enKeys) expect(typeof l[k as keyof typeof l]).toBe(typeof LABELS.en[k as keyof typeof LABELS.en]);
      for (const k of ["ambiguousName", "email", "phone", "itslearningLink", "linkRemoved", "encodedData", "idPair", "image"] as const) {
        expect(l[k]).toMatch(/^\[[^\]]+\]$/);
      }
      expect(l.student("AB12")).toMatch(/-AB12$/);
      expect(l.person("AB12")).toMatch(/-AB12$/);
      expect(l.teacherPseudonym("AB12")).toMatch(/-AB12$/);
      expect(l.teacher("Lindqvist")).toMatch(/ Lindqvist$/);
      expect(l.teacherWithSalutation("X", "Lindqvist")).toBe("X Lindqvist");
      expect(l.imageN(3)).toContain("3");
      expect(l.element(42)).toContain("42");
      expect(l.group(4, [])).toContain("4");
      expect(l.group(4, ["T"])).toContain("T");
    }
  });
});
