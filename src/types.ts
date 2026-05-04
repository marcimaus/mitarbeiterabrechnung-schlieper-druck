// ============================================================
// Mitarbeiterabrechnung Schlieper-Druck — Typen-Definitionen
// ============================================================

// ---- Rollen ------------------------------------------------

export type Rolle = 'austräger' | 'zusammenträger' | 'sonstige';

export const ROLLEN_LABELS: Record<Rolle, string> = {
  'austräger': 'Austräger',
  'zusammenträger': 'Zusammenträger',
  'sonstige': 'Sonstige',
};

/** Normalisiert eine evtl. veraltete Rolle auf die neuen drei Werte. */
export function normalisiereRolle(r: string): Rolle {
  if (r === 'austräger' || r === 'zusammenträger' || r === 'sonstige') return r;
  return 'sonstige';
}

export function normalisiereRollen(rollen: string[] | undefined): Rolle[] {
  if (!rollen || rollen.length === 0) return [];
  const out = new Set<Rolle>();
  for (const r of rollen) out.add(normalisiereRolle(r));
  return Array.from(out);
}

// ---- Mitarbeiter -------------------------------------------

export interface TeilgebietBonus {
  teilgebietId: string;
  betragEur: number;      // Bonus je verteilter Ausgabe als Standardausträger
}

export interface Mitarbeiter {
  id: string;
  nummer: string;         // 5-stellig, beginnt mit 9
  name: string;
  adresse: {
    strasse: string;
    plz: string;
    ort: string;
  };
  telefon: string;
  /** Mobilnummer (zusätzlich zum Festnetz-Telefon, falls abweichend). */
  mobilnummer?: string;
  /** E-Mail-Adresse des Mitarbeiters. */
  email?: string;
  /** Mitarbeiter ist über WhatsApp erreichbar (auf der Mobilnummer). */
  nutztWhatsApp?: boolean;
  /** Mitarbeiter ist über Telegram erreichbar. */
  nutztTelegram?: boolean;
  // ---- Kontaktdaten Eltern / Erziehungsberechtigte (nur bei Minderjährigen) --
  elternName?: string;
  elternTelefon?: string;
  elternMobil?: string;
  elternEmail?: string;
  elternNutztWhatsApp?: boolean;
  elternNutztTelegram?: boolean;
  geburtsdatum: string;   // ISO-Date YYYY-MM-DD
  rollen: Rolle[];
  nfcUid?: string;
  pinHash?: string;       // SHA-256 des optionalen Mitarbeiter-PINs (Selbstschutz)
  stundenlohnIndividuell?: number;
  /**
   * Ausnahme-Kennzeichen für minderjährige Mitarbeiter: wenn true, wird der
   * MA wie ein Erwachsener nach MiLoG abgerechnet (Austragen + Zusammentragen),
   * statt mit dem reduzierten Minderjährigen-Stundenlohn. Nur Admin darf setzen.
   * Hat keinen Effekt, wenn der MA volljährig oder ein individueller
   * Stundenlohn gesetzt ist.
   */
  abrechnungAlsErwachseneMiLoG?: boolean;
  fixesGehalt?: number;
  fahrkostenEurProKm?: number;   // Überschreibt den globalen Kilomtersatz
  /** Wenn true: Mitarbeiter bekommt fixes Monatsgehalt statt variabler Abrechnung. */
  hatFestgehalt: boolean;
  festgehaltEur?: number;        // EUR pro Monat bei hatFestgehalt===true
  /**
   * Durchschnittliche Wochenarbeitszeit lt. Vertrag bei Festgehalt-Mitarbeitern.
   * Eines von beiden (Wochen oder Monat) reicht — das andere wird automatisch
   * berechnet (Monat = 52/12 * Woche). Wird für die Mindestlohn-Prüfung gebraucht.
   */
  wochenstundenFestgehalt?: number;
  /** Durchschnittliche Monatsarbeitszeit lt. Vertrag bei Festgehalt-Mitarbeitern. */
  monatsstundenFestgehalt?: number;
  /**
   * Geschäftsführer-Kennzeichen. Wenn true, gelten weder die Mindestlohn-
   * Pflicht noch das Erfordernis, Wochen-/Monatsstunden anzugeben — der
   * Geschäftsführer fällt nicht unter MiLoG.
   */
  istGeschaeftsfuehrer?: boolean;
  /**
   * Optionaler Link auf den Google-Drive-Ordner mit den Unterlagen
   * dieses Mitarbeiters (Vertrag, Bescheinigungen etc.).
   * Sowohl Admin als auch Abrechnung dürfen sehen + bearbeiten.
   */
  googleDriveLink?: string;
  /** Minijob-Kennzeichen: Warnung wenn Bruttolohn im Monat die Minijob-Grenze überschreitet. */
  istMinijob?: boolean;
  /**
   * Individuelle Lohngrenze (€/Monat) — z. B. wegen weiterer Minijobs bei
   * anderen Arbeitgebern oder vertraglicher Höchstgrenze. Wenn der
   * Bruttolohn im Monat diese Grenze überschreitet, erscheint in der
   * Abrechnung eine Warnung. Optional zusätzlich zur Minijob-Grenze.
   */
  lohngrenzeIndividuellEur?: number;
  /** Begründung / Vermerk zur individuellen Lohngrenze. */
  lohngrenzeIndividuellKommentar?: string;
  /**
   * Pauschaler Tätigkeitsbonus in Minuten — gilt PRO Ausgabe der Abrechnungsperiode.
   * Wird mit dem Stundensatz des MA vergütet. Beispiel: 60 Min und 4 Ausgaben in
   * der Periode → 4 h × Stundensatz.
   */
  ausgabenBonusMinuten?: number;
  /** Grund / Vermerk zum Tätigkeitsbonus, z. B. „Betreuung Zusammenträger und Orga". */
  ausgabenBonusKommentar?: string;
  /**
   * Befreiung von Sozialversicherung liegt vor.
   * Nur bei diesen Mitarbeitern ist Brutto = Netto und die Auszahlung kann direkt berechnet werden.
   */
  sozialversicherungsBefreit?: boolean;
  isActive: boolean;
  teilgebietFreigaben?: string[];      // IDs der Teilgebiete, die dieser MA austragen darf
  teilgebietBoni?: TeilgebietBonus[];  // Bonus je Teilgebiet und Ausgabe
  erstelltAm: number;     // Unix-Timestamp ms
  aktualisiertAm: number;
}

// ---- Tour --------------------------------------------------

export interface Tour {
  id: string;
  name: string;
  farbe: string;          // CSS-Farbe, z.B. '#ef4444'
  erstelltAm: number;
}

export const STANDARD_TOUREN: Omit<Tour, 'erstelltAm'>[] = [
  { id: 'rot',   name: 'Rot',   farbe: '#ef4444' },
  { id: 'blau',  name: 'Blau',  farbe: '#3b82f6' },
  { id: 'gelb',  name: 'Gelb',  farbe: '#eab308' },
  { id: 'weiss', name: 'Weiß',  farbe: '#9ca3af' },
  { id: 'grün',  name: 'Grün',  farbe: '#22c55e' },
];

// ---- Teilgebiet --------------------------------------------

export interface Strasse {
  id: string;
  strassenname: string;
  stueckzahl: number;
  plusCode?: string;
}

export interface Sonderauslage {
  id: string;
  bezeichnung: string;
  adresse?: string;
  stueckzahl: number;
}

export interface NichtBeliefen {
  id: string;
  adresse: string;
  bemerkung?: string;
}

export interface Teilgebiet {
  id: string;
  name: string;               // z.B. "Uslar1"
  plz: string;
  stueckzahl: number;
  stueckzahlManuell: boolean; // true = manuell, false = Summe aus Straßenliste
  wegstreckeM: number;        // Meter
  tourId: string | null;
  standardAustraegerId: string | null;
  isActive: boolean;
  strassen: Strasse[];
  sonderauslagen: Sonderauslage[];
  nichtBeliefen: NichtBeliefen[];
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Sondervereinbarung ------------------------------------

export interface Sondervereinbarung {
  id: string;
  mitarbeiterId: string;
  teilgebietId: string;
  betragEur: number;
  begruendung: string;
  erstelltAm: number;         // Zeitstempel zur Nachverfolgung
}

// ---- Ausgabe (= wöchentliche KW) ---------------------------

export type AusgabeStatus = 'geplant' | 'laufend' | 'abgeschlossen';

export interface Ausgabe {
  id: string;
  kw: number;
  jahr: number;
  seitenzahl: number;         // 8, 10, 12, 14, ...
  stapelAnzahl: number;       // Anzahl Stapel für Zusammentragen (manuell eingebbar)
  grammaturGqm: number;       // Standard: 65 g/m²
  seitenformatMm: { breite: number; hoehe: number }; // Standard: 305×215
  status: AusgabeStatus;
  /** Wenn true, darf selbsterfasste Vorarbeit für diese Ausgabe in Lohnberechnung einfließen. */
  vorarbeitFreigegeben?: boolean;
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Beilage -----------------------------------------------

export type BeilagenFormat = 'A4' | 'A5' | 'kleinerA5' | string;
export type BeilagenKennzeichen = 'int' | 'ext';

export interface Beilage {
  id: string;
  ausgabeId: string;
  arbeitstitel: string;
  kundenname: string;
  gewichtGStk: number;        // Gramm je Stück
  format: BeilagenFormat;
  kennzeichen: BeilagenKennzeichen;
  teilgebietIds: string[];    // welche Teilgebiete beliefert werden
  erstelltAm: number;
}

// ---- Abrechnungsperiode (= Monat) --------------------------

export type PeriodeStatus = 'offen' | 'abgeschlossen';

export interface Abrechnungsperiode {
  id: string;
  bezeichnung: string;        // z.B. "Januar 2026"
  jahr: number;
  monat: number;              // 1-12
  kalenderwochen: number[];   // manuell zugeordnete KWs
  status: PeriodeStatus;
  paramSnapshot?: Partial<Parameter>; // Parameter zum Zeitpunkt der Erstellung
  periodeSnapshot?: PeriodeSnapshot;  // Vollständiger Snapshot beim Abschluss
  /**
   * Snapshot des berechneten Abrechnungs-Ergebnisses zum Zeitpunkt des
   * Abschlusses. `ergebnisse` ist eine Liste vom Typ `MitarbeiterAbrechnung[]`
   * (siehe lib/abrechnungslogik.ts) — wir typisieren hier mit `unknown[]`, um
   * eine zirkuläre Type-Abhängigkeit zu vermeiden, und casten an den
   * Verwendungsstellen.
   */
  abrechnungSnapshot?: {
    ergebnisse: unknown[];
    erstelltAm: number;
  };
  gesperrtAm?: number;                // Zeitstempel des Abschlusses
  erstelltAm: number;
}

// ---- Einsatz (wer trägt welches Gebiet aus) ----------------

export type EinsatzTyp = 'standard' | 'springer' | 'ausfall' | 'ungeklärt';

export interface AustraegerArbeitszeit {
  datum: string;            // ISO-Date YYYY-MM-DD
  von: string;              // HH:MM
  bis: string;              // HH:MM
  pausenMinuten: number;
}

export interface Einsatz {
  id: string;
  ausgabeId: string;
  kw: number;
  jahr: number;
  teilgebietId: string;
  mitarbeiterId: string | null;   // null bei Ausfall/ungeklärt
  typ: EinsatzTyp;
  springerZuschlagProzent?: number; // individ. Zuschlag, sonst aus Parametern
  memo?: string;
  // Selbstmeldung durch den Austräger (ohne Login, via QR-Code)
  arbeitszeit?: AustraegerArbeitszeit;
  restmenge?: number;           // nicht ausgetragene Stücke
  meldungEingereichtAm?: number; // Unix-Timestamp ms der Einreichung
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Arbeitszeiterfassung ----------------------------------

export type ArbeitszeitsQuelle = 'nfc' | 'manuell';
export type ArbeitszeitsTyp =
  | 'zusammentragen'
  | 'austragen'
  | 'vorarbeit'
  | 'sonstige';

export const TYP_LABELS: Record<ArbeitszeitsTyp, string> = {
  zusammentragen: 'Zusammentragen',
  austragen: 'Austragen',
  vorarbeit: 'Vorarbeit',
  sonstige: 'Sonstige',
};

/** Normalisiert einen evtl. veralteten ArbeitszeitsTyp auf die neuen vier Werte. */
export function normalisiereArbeitszeitsTyp(t: string): ArbeitszeitsTyp {
  if (t === 'zusammentragen' || t === 'austragen' || t === 'vorarbeit' || t === 'sonstige') return t;
  return 'sonstige';
}

export interface Pause {
  start: number;    // Unix-Timestamp ms
  ende: number | null;
}

export interface AuditEintrag {
  zeitstempel: number;
  adminName: string;
  aktion: string;
  vorher?: string;
  nachher?: string;
}

export interface Arbeitszeit {
  id: string;
  mitarbeiterId: string;
  startTime: number;           // Unix-Timestamp ms
  endTime: number | null;
  status: 'aktiv' | 'pause' | 'abgeschlossen';
  quelle: ArbeitszeitsQuelle;
  typ: ArbeitszeitsTyp;
  pausen: Pause[];
  gesamtPauseMinuten: number;
  korrekturLog: AuditEintrag[];
  /** Zuordnung zu einer Ausgabe — nötig für Vorarbeit (Freigabe-Kennzeichen pro Ausgabe). */
  ausgabeId?: string;
  erstelltAm: number;
  aktualisiertAm: number;
  autoGeschlossenUm24?: boolean;
}

// ---- Zusammentragen ----------------------------------------

export interface ZusammentragenEinsatz {
  id: string;
  ausgabeId: string;
  teilgebietId: string;        // welches Teilgebiet wurde zusammengetragen
  mitarbeiterId: string;
  stapelBearbeitet: number;    // Anzahl Stapel (= ausgabe.stapelAnzahl)
  istVorarbeit: boolean;
  vorarbeitMinuten?: number;   // manuelle Eingabe bei Vorarbeit
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Fahrtkosten (neue Struktur) ----------------------------

export interface Fahrt {
  id: string;
  mitarbeiterId: string;
  datum: string;               // ISO-Date YYYY-MM-DD
  streckKm: number;
  ziel: string;
  bemerkung?: string;
  abrechnungsperiodeId?: string;  // gesetzt wenn der Abrechnungsperiode zugeordnet
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Auslieferungs-Memo ------------------------------------
// Hinweise an Austräger, die auf dem Lieferschein erscheinen sollen.
// Scope: 'alle' (alle Teilgebiete) | 'tour' (alle TG einer Tour) | 'teilgebiet' (einzelnes TG)

export interface AuslieferungsMemo {
  id: string;
  ausgabeId: string;
  scope: 'alle' | 'tour' | 'teilgebiet';
  tourId?: string;
  teilgebietId?: string;
  text: string;
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Systemparameter ---------------------------------------

export interface Parameter {
  // Zeitwerte Austragen
  laufgeschwindigkeitMProH: number;       // Standard: 5000 m/h
  steckzeitStkProH: number;               // Standard: 720 Stk/h
  // Stundenlöhne Austragen
  stundenlohnErwachseneAustr: number;     // MiLoG: 13.90
  stundenlohnMinderjAustr: number;        // Standard: 10.00
  mindeststundenlohn: number;             // Warnschwelle
  // Zusammentragen
  zusammentragGeschwErste2StapelStkProH: number;   // Standard: 1700 Stk/h (erste 2 Anzeigenblatt-Stapel)
  zusammentragGeschwWeitereStapelStkProH: number;  // Standard: 4300 Stk/h (jeder weitere Stapel + Beilagen)
  externeBeilageEinlegeGeschwStkProH: number;      // Standard: 442 Stk/h (je externe Beilage, Austräger/Springer)
  stundenlohnErwachseneZusammen: number;           // Standard: 13.90 EUR/h
  stundenlohnMinderjZusammen: number;              // Standard: 10.00 EUR/h
  // Springer
  springerZuschlagProzent: number;        // Standard: 25%
  // Gewichtszulagen
  gewichtszulageAnzeigenblattEurKg: number; // 0.05 EUR/kg
  gewichtszulageBeilagenEurKg: number;      // 0.30 EUR/kg
  // Standardwerte Ausgabe
  standardGrammurGqm: number;             // 65 g/m²
  standardSeitenformatBreiteMm: number;   // 305 mm
  standardSeitenformatHoeheMm: number;    // 215 mm
  // Fahrtkosten
  fahrkostenEurProKm: number;             // Standard: 0.30 EUR/km
  // Minijob-Grenze (EUR/Monat) — Warnung wenn überschritten bei istMinijob-Mitarbeitern
  minijobGrenzeEurProMonat: number;       // Standard (2024/2025): 556.00 EUR
  // Gewichtskontrolle (Zusammentragen)
  gewichtToleranzObenProzent: number;     // Standard: 2 (obere Abweichung in %)
  gewichtToleranzUntenProzent: number;    // Standard: 1 (untere Abweichung in %)
  // Springer
  springerZuschlagOptionen: number[];     // Auswählbare Prozentwerte, z.B. [25, 30, 50]
  // Auth
  adminPinHash: string;
  adminName: string;
  abrechnungPinHash?: string;  // Zweiter PIN für "Mitarbeiter Abrechnung"-Rolle
  // Beilagenformate & Preise (JSON-serialisiert)
  beilagenPreise: BeilagenPreis[];
  // Abrechnungslogik: Plan-Zeit (false) oder Ist-Zeit (true)
  austragenNachIstZeit: boolean;
  zusammentragenNachIstZeit: boolean;
}

// ---- Lohnkonto -----------------------------------------------
// Buchungen auf dem persönlichen Lohnkonto eines Mitarbeiters.
// Anwendungsfall: ein Teil des Lohns einer Periode soll NICHT an das Lohnbüro
// übermittelt werden (z. B. weil der MA in dem Monat eine Lohngrenze nicht
// überschreiten darf), sondern auf ein internes Konto „verschoben" werden.
// Der Saldo wird in Folgemonaten dem Lohn ggf. wieder zugeschlagen.
//
// Vorzeichen-Konvention:
//   art === 'verschiebung'  → betragEur > 0 → reduziert die aktuelle Auszahlung,
//                                              erhöht den Konto-Saldo
//   art === 'verrechnung'   → betragEur > 0 → erhöht die aktuelle Auszahlung,
//                                              reduziert den Konto-Saldo
// Das ist absichtlich so getrennt — so erkennt man die Bewegung sofort.

export type LohnkontoBuchungArt = 'verschiebung' | 'verrechnung';

export interface LohnkontoBuchung {
  id: string;
  mitarbeiterId: string;
  abrechnungsperiodeId: string;   // Periode in der die Buchung wirkt
  art: LohnkontoBuchungArt;
  betragEur: number;              // immer positiv; Vorzeichen ergibt sich aus art
  kommentar?: string;
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Variabler Periodenzusatz ------------------------------

export interface VariablerPeriodenZusatz {
  id: string;
  mitarbeiterId: string;
  abrechnungsperiodeId: string;
  betragEur: number;
  kommentar?: string;
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Historisierungs-Snapshot (beim Periodenabschluss) -----

export interface TeilgebietSnapshot {
  id: string;
  name: string;
  plz: string;
  stueckzahl: number;
  wegstreckeM: number;
  tourId: string | null;
  standardAustraegerId: string | null;
}

export interface PeriodeSnapshot {
  teilgebietSnapshots: TeilgebietSnapshot[];
  erstelltAm: number;
}

export interface BeilagenPreis {
  format: BeilagenFormat;
  label: string;
  preisProStkEur: number;
}

// ---- Reklamation -------------------------------------------

export interface Reklamation {
  id: string;
  anruferName: string;
  telefon?: string;
  email?: string;
  briefkastenVorhanden: boolean;
  aufkleberKeineWerbung: boolean;
  anmerkung?: string;
  teilgebietId?: string;
  mitarbeiterId?: string;       // zuständiger Austräger
  mitgeteilt: boolean;          // dem Mitarbeiter mitgeteilt
  seitWann?: string;            // ISO-Date: seit wann besteht das Problem
  schonMalMitgeteilt: boolean;  // wurde es schon mal mitgeteilt
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Vorschuss (Abschlagszahlung) --------------------------

export interface Vorschuss {
  id: string;
  mitarbeiterId: string;
  abrechnungsperiodeId: string;
  betragEur: number;
  bemerkung?: string;
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Audit-Log (unveränderlich) ----------------------------

export interface AuditLog {
  id: string;
  zeitstempel: number;
  adminName: string;
  entitaet: string;            // z.B. 'mitarbeiter', 'einsatz'
  entitaetId: string;
  aktion: string;              // z.B. 'erstellt', 'bearbeitet', 'gelöscht'
  details?: string;
}

// ---- Hilfsfunktionen / Utils-Typen -------------------------

export interface SelectOption {
  value: string;
  label: string;
}
