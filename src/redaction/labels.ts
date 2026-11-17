/**
 * Localizable labels for everything the redaction layer inserts into tool output:
 * person displays, placeholders and fallback names. Selected via REDACTION_LANGUAGE (default "en").
 */

export type Language = "en" | "de";
export const LANGUAGES: readonly Language[] = ["en", "de"];

export type Labels = {
  language: Language;
  /** The account owner. */
  self: string;
  /** Teacher with a known last name and no salutation configured. */
  teacher: (lastName: string) => string;
  /** Teacher with a salutation from teachers.json (e.g. "Mrs", "Frau"). */
  teacherWithSalutation: (salutation: string, lastName: string) => string;
  /** Teacher pseudonym (REDACT_TEACHERS=true or no last name known). */
  teacherPseudonym: (id: string) => string;
  student: (id: string) => string;
  /** Person whose role is unknown. */
  person: (id: string) => string;
  /** No person id at all. */
  unknown: string;
  /** Same spelling belongs to several people. */
  ambiguousName: string;
  email: string;
  phone: string;
  itslearningLink: string;
  linkRemoved: string;
  encodedData: string;
  idPair: string;
  image: string;
  /** Fallback file names. */
  attachment: string;
  imageN: (n: number) => string;
  file: string;
  element: (id: number) => string;
  /** Fallback title of a message thread without name and participants. */
  messages: string;
  /** Title of a group thread without a name. */
  group: (participants: number, teachers: string[]) => string;
};

const en: Labels = {
  language: "en",
  self: "Me",
  teacher: (last) => `Teacher ${last}`,
  teacherWithSalutation: (sal, last) => `${sal} ${last}`,
  teacherPseudonym: (id) => `Teacher-${id}`,
  student: (id) => `Student-${id}`,
  person: (id) => `Person-${id}`,
  unknown: "Unknown",
  ambiguousName: "[name]",
  email: "[email]",
  phone: "[phone]",
  itslearningLink: "[itslearning link]",
  linkRemoved: "[link removed]",
  encodedData: "[encoded data removed]",
  idPair: "[ID]",
  image: "[image]",
  attachment: "Attachment",
  imageN: (n) => `Image ${n}`,
  file: "File",
  element: (id) => `Element ${id}`,
  messages: "Messages",
  group: (n, teachers) => `Group (${n} participants)${teachers.length ? ` with ${teachers.join(", ")}` : ""}`,
};

const de: Labels = {
  language: "de",
  self: "Ich",
  teacher: (last) => `Lehrkraft ${last}`,
  teacherWithSalutation: (sal, last) => `${sal} ${last}`,
  teacherPseudonym: (id) => `Lehrkraft-${id}`,
  student: (id) => `Schüler:in-${id}`,
  person: (id) => `Person-${id}`,
  unknown: "Unbekannt",
  ambiguousName: "[Name]",
  email: "[E-Mail]",
  phone: "[Telefon]",
  itslearningLink: "[itslearning-Link]",
  linkRemoved: "[Link entfernt]",
  encodedData: "[kodierte Daten entfernt]",
  idPair: "[ID]",
  image: "[Bild]",
  attachment: "Anhang",
  imageN: (n) => `Bild ${n}`,
  file: "Datei",
  element: (id) => `Element ${id}`,
  messages: "Nachrichten",
  group: (n, teachers) => `Gruppe (${n} Teilnehmende)${teachers.length ? ` mit ${teachers.join(", ")}` : ""}`,
};

export const LABELS: Record<Language, Labels> = { en, de };

export function getLabels(language: Language = "en"): Labels {
  return LABELS[language];
}
