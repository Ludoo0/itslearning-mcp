/**
 * Localizable labels for everything the redaction layer inserts into tool output:
 * person displays, placeholders and fallback names. Selected via REDACTION_LANGUAGE (default "en").
 */

/** en = English, de = German, nb = Norwegian Bokmål, sv = Swedish, nl = Dutch, fr = French. */
export type Language = "en" | "de" | "nb" | "sv" | "nl" | "fr";
export const LANGUAGES: readonly Language[] = ["en", "de", "nb", "sv", "nl", "fr"];

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
  /** Child of a parent account (experimental parent support). */
  child: (id: string) => string;
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
  child: (id) => `Child-${id}`,
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
  child: (id) => `Kind-${id}`,
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

const nb: Labels = {
  language: "nb",
  self: "Jeg",
  teacher: (last) => `Lærer ${last}`,
  teacherWithSalutation: (sal, last) => `${sal} ${last}`,
  teacherPseudonym: (id) => `Lærer-${id}`,
  student: (id) => `Elev-${id}`,
  child: (id) => `Barn-${id}`,
  person: (id) => `Person-${id}`,
  unknown: "Ukjent",
  ambiguousName: "[navn]",
  email: "[e-post]",
  phone: "[telefon]",
  itslearningLink: "[itslearning-lenke]",
  linkRemoved: "[lenke fjernet]",
  encodedData: "[kodede data fjernet]",
  idPair: "[ID]",
  image: "[bilde]",
  attachment: "Vedlegg",
  imageN: (n) => `Bilde ${n}`,
  file: "Fil",
  element: (id) => `Element ${id}`,
  messages: "Meldinger",
  group: (n, teachers) => `Gruppe (${n} deltakere)${teachers.length ? ` med ${teachers.join(", ")}` : ""}`,
};

const sv: Labels = {
  language: "sv",
  self: "Jag",
  teacher: (last) => `Lärare ${last}`,
  teacherWithSalutation: (sal, last) => `${sal} ${last}`,
  teacherPseudonym: (id) => `Lärare-${id}`,
  student: (id) => `Elev-${id}`,
  child: (id) => `Barn-${id}`,
  person: (id) => `Person-${id}`,
  unknown: "Okänd",
  ambiguousName: "[namn]",
  email: "[e-post]",
  phone: "[telefon]",
  itslearningLink: "[itslearning-länk]",
  linkRemoved: "[länk borttagen]",
  encodedData: "[kodad data borttagen]",
  idPair: "[ID]",
  image: "[bild]",
  attachment: "Bilaga",
  imageN: (n) => `Bild ${n}`,
  file: "Fil",
  element: (id) => `Element ${id}`,
  messages: "Meddelanden",
  group: (n, teachers) => `Grupp (${n} deltagare)${teachers.length ? ` med ${teachers.join(", ")}` : ""}`,
};

const nl: Labels = {
  language: "nl",
  self: "Ik",
  teacher: (last) => `Docent ${last}`,
  teacherWithSalutation: (sal, last) => `${sal} ${last}`,
  teacherPseudonym: (id) => `Docent-${id}`,
  student: (id) => `Leerling-${id}`,
  child: (id) => `Kind-${id}`,
  person: (id) => `Persoon-${id}`,
  unknown: "Onbekend",
  ambiguousName: "[naam]",
  email: "[e-mail]",
  phone: "[telefoon]",
  itslearningLink: "[itslearning-link]",
  linkRemoved: "[link verwijderd]",
  encodedData: "[gecodeerde gegevens verwijderd]",
  idPair: "[ID]",
  image: "[afbeelding]",
  attachment: "Bijlage",
  imageN: (n) => `Afbeelding ${n}`,
  file: "Bestand",
  element: (id) => `Element ${id}`,
  messages: "Berichten",
  group: (n, teachers) => `Groep (${n} deelnemers)${teachers.length ? ` met ${teachers.join(", ")}` : ""}`,
};

const fr: Labels = {
  language: "fr",
  self: "Moi",
  teacher: (last) => `Enseignant ${last}`,
  teacherWithSalutation: (sal, last) => `${sal} ${last}`,
  teacherPseudonym: (id) => `Enseignant-${id}`,
  student: (id) => `Élève-${id}`,
  child: (id) => `Enfant-${id}`,
  person: (id) => `Personne-${id}`,
  unknown: "Inconnu",
  ambiguousName: "[nom]",
  email: "[e-mail]",
  phone: "[téléphone]",
  itslearningLink: "[lien itslearning]",
  linkRemoved: "[lien supprimé]",
  encodedData: "[données encodées supprimées]",
  idPair: "[ID]",
  image: "[image]",
  attachment: "Pièce jointe",
  imageN: (n) => `Image ${n}`,
  file: "Fichier",
  element: (id) => `Élément ${id}`,
  messages: "Messages",
  group: (n, teachers) => `Groupe (${n} participants)${teachers.length ? ` avec ${teachers.join(", ")}` : ""}`,
};

export const LABELS: Record<Language, Labels> = { en, de, nb, sv, nl, fr };

export function getLabels(language: Language = "en"): Labels {
  return LABELS[language];
}
