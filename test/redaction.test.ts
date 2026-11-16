import { describe, expect, test } from "bun:test";
import { detectLoginModeFromHtml } from "../src/auth/loginMode";
import { NameDictionary, redactContacts } from "../src/redaction/freetext";
import { htmlToText } from "../src/redaction/html";
import { Redactor } from "../src/redaction/redactor";
import { isShareableUrl, sanitizeErrorText, stripSecretUrls } from "../src/redaction/secrets";
import { SELF } from "./fixtures";

describe("secrets", () => {
  test("itslearning-URLs und URLs mit Token sind nicht teilbar", () => {
    expect(isShareableUrl("https://example.org/blatt.pdf")).toBe(true);
    expect(isShareableUrl("https://demo.itslearning.com/main.aspx?CourseID=1")).toBe(false);
    expect(isShareableUrl("https://filerepository.itslearning.com/x?Token=abc")).toBe(false);
    expect(isShareableUrl("https://example.org/x?token=abc")).toBe(false);
    expect(isShareableUrl("https://example.org/x?Signature=abc")).toBe(false);
    expect(isShareableUrl("javascript:alert(1)")).toBe(false);
  });

  test("stripSecretUrls ersetzt nur kritische Links", () => {
    const out = stripSecretUrls(
      "Siehe https://example.org/a. Intern: https://demo.itslearning.com/x?y=1, Datei https://cdn.example.org/f?sign=zz",
    );
    expect(out).toContain("https://example.org/a.");
    expect(out).toContain("[itslearning-Link],");
    expect(out).toContain("[Link entfernt]");
    expect(out).not.toContain("sign=zz");
  });

  test("relative itslearning-Links und ID-Angaben werden entfernt", () => {
    expect(stripSecretUrls("Profil: /Person/show_person.aspx?PersonId=4711 ansehen")).toBe("Profil: [itslearning-Link] ansehen");
    expect(stripSecretUrls("siehe main.aspx?CourseID=12&ElementID=3.")).toBe("siehe [itslearning-Link].");
    expect(stripSecretUrls('{"PersonId": 4711, "personid=12", UserId:5}')).toBe("{[ID], [ID], [ID]}");
    // keine Fehlalarme bei normalem Text, Dateinamen und externen Links
    expect(stripSecretUrls("Kapitel 3, Seite 12, Datei blatt.pdf, https://example.org/a.aspx")).toBe(
      "Kapitel 3, Seite 12, Datei blatt.pdf, https://example.org/a.aspx",
    );
  });

  test("URL-kodierte Daten-Blobs werden entfernt, normale Prozentangaben bleiben", () => {
    expect(stripSecretUrls("Start: %7B%22PersonId%22%3A12345678%2C%22Name%22%3A%22M%C3%BCller%22%7D Ende")).toBe("Start: [kodierte Daten entfernt] Ende");
    expect(stripSecretUrls("launch?data=%7B%22a%22%3A1%7D")).toBe("[kodierte Daten entfernt]");
    expect(stripSecretUrls("Rabatt 50% auf 20 % der Fläche, Note 2%")).toBe("Rabatt 50% auf 20 % der Fläche, Note 2%");
    expect(stripSecretUrls("https://example.org/suche?q=Br%C3%BCche%20und%20Prozent")).toBe("https://example.org/suche?q=Br%C3%BCche%20und%20Prozent");
  });

  test("externe Links mit kodierten Personendaten in Parametern sind nicht teilbar", () => {
    const blob = "%7B%22sourcename%22%3A%221234%22%2C%22PersonId%22%3A12345678%7D";
    expect(isShareableUrl(`https://tool.example/launch?data=${blob}`)).toBe(false);
    expect(isShareableUrl("https://tool.example/x?ref=userid%3D5")).toBe(false); // ID-Schlüssel im Wert → verdächtig
    expect(isShareableUrl("https://tool.example/x?q=PersonId")).toBe(false);
    expect(isShareableUrl("https://example.org/suche?q=Br%C3%BCche%20und%20Prozent")).toBe(true);
    expect(isShareableUrl(`https://tool.example/x?long=${"a".repeat(300)}`)).toBe(false);
    expect(isShareableUrl("https://tool.example/x#%7B%22a%22%3A1%7D")).toBe(false);
    expect(isShareableUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toBe(true);

    const r = new Redactor();
    expect(r.text(`Tool: https://tool.example/launch?data=${blob}`)).toBe("Tool: [kodierte Daten entfernt]");
    expect(r.text(`<a href="https://tool.example/launch?data=${blob}">Zum Tool</a>`)).toBe("Zum Tool");
  });

  test("sanitizeErrorText entfernt IDs", () => {
    expect(sanitizeErrorText("CustomerId=1234, PersonId=4711, does not have Read permission")).toBe(
      "CustomerId={n}, PersonId={n}, does not have Read permission",
    );
  });
});

describe("html", () => {
  test("wandelt HTML in lesbaren Text, Links nur wenn teilbar", () => {
    const out = htmlToText(
      '<p>Hallo&nbsp;Klasse,</p><ul><li>Aufgabe&nbsp;1</li><li>Aufgabe 2</li></ul><a href="https://example.org/x">Blatt</a> <a href="https://demo.itslearning.com/y">Kurs</a>',
    );
    expect(out).toBe("Hallo Klasse,\n\n- Aufgabe 1\n- Aufgabe 2\n[Blatt](https://example.org/x) Kurs");
  });
});

describe("freetext", () => {
  test("E-Mail und Telefon, aber keine Daten", () => {
    expect(redactContacts("Mail: a.b@schule.example, Tel 0421 / 123 45 67")).toBe("Mail: [E-Mail], Tel [Telefon]");
    expect(redactContacts("Abgabe am 18.11.2026 um 08:00")).toBe("Abgabe am 18.11.2026 um 08:00");
    expect(redactContacts("Seite 0123")).toBe("Seite 0123");
  });

  test("Namens-Wörterbuch: Varianten, Wortgrenzen, Stoppwörter", () => {
    const d = new NameDictionary();
    d.addPerson({ firstName: "Anna", lastName: "Klein", fullName: "Anna Klein" }, "Frau Klein");
    d.addPerson({ firstName: "Lukas", lastName: "Sonnenberg" }, "Schüler:in-7F3A");
    expect(d.apply("Anna Klein hat geschrieben")).toBe("Frau Klein hat geschrieben");
    expect(d.apply("Gruß, Klein, Anna")).toBe("Gruß, Frau Klein");
    expect(d.apply("Frau Klein sagt: klein schreiben")).toBe("Frau Klein sagt: klein schreiben"); // Stoppwort einzeln
    expect(d.apply("Lukas und SONNENBERG, nicht Sonnenbergstraße")).toBe(
      "Schüler:in-7F3A und Schüler:in-7F3A, nicht Sonnenbergstraße",
    );
  });

  test("gleiche Schreibweise bei zwei Personen → neutral", () => {
    const d = new NameDictionary();
    d.addPerson({ firstName: "Mia", lastName: "Sonnenberg" }, "A");
    d.addPerson({ firstName: "Ben", lastName: "Sonnenberg" }, "B");
    expect(d.apply("Sonnenberg")).toBe("[Name]");
    expect(d.apply("Mia Sonnenberg")).toBe("A");
  });
});

describe("Redactor", () => {
  test("eigenes Konto wird zu 'Ich', Pipeline-Reihenfolge stimmt", () => {
    const r = new Redactor();
    r.registerSelf(SELF);
    const out = r.text(
      '<p>Hallo Jonas Beispielmann, schreib an jonas.beispielmann@schule.example</p><a href="https://demo.itslearning.com/x?Token=abc">hier</a>',
    );
    expect(out).toBe("Hallo Ich, schreib an [E-Mail]\nhier");
    expect(out).not.toMatch(/Jonas|Beispielmann|itslearning|Token/);
  });

  test("Kürzen mit Auslassungszeichen", () => {
    const r = new Redactor();
    expect(r.text("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("loginMode", () => {
  test("erkennt nativen und reinen SSO-Login", () => {
    expect(detectLoginModeFromHtml('<li id="ctl00_ContentPlaceHolder1_nativeLogin">')).toBe("native");
    expect(detectLoginModeFromHtml('<div id="ctl00_ContentPlaceHolder1_federatedLogin">')).toBe("federated-only");
    expect(detectLoginModeFromHtml("<html></html>")).toBe("unknown");
  });
});
