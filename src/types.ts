// ============================================================
// Mitarbeiterabrechnung Schlieper-Druck — Typen-Definitionen
// ============================================================

// ---- Rollen ------------------------------------------------

export type Rolle =
  | 'austräger'
  | 'zusammenträger'
  | 'fahrer'
  | 'bürohilfe'
  | 'drucker'
  | 'setzer'
  | 'falzmaschine'
  | 'schneidemaschine'
  | 'sonstiges';

export const ROLLEN_LABELS: Record<Rolle, string> = {
  'austräger': 'Austräger',
  'zusammenträger': 'Zusammenträger',
  'fahrer': 'Fahrer',
  'bürohilfe': 'Bürohilfe',
  'drucker': 'Drucker',
  'setzer': 'Setzer',
  'falzmaschine': 'Falzmaschinenbediener',
  'schneidemaschine': 'Schneidemaschinenbediener',
  'sonstiges': 'Sonstige Aushilfe',
};

export type Abrechnungstyp = 'fix' | 'variabel' | 'beides';

// ---- Mitarbeiter -------------------------------------------

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
  geburtsdatum: string;   // ISO-Date YYYY-MM-DD
  rollen: Rolle[];
  nfcUid?: string;
  pinHash?: string;       // SHA-256 des optionalen Mitarbeiter-PINs (Selbstschutz)
  stundenlohnIndividuell?: number;
  fixesGehalt?: number;
  fahrkostenEurProKm?: number;   // Überschreibt den globalen Kilomtersatz
  abrechnungstyp: Abrechnungstyp;
  isActive: boolean;
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
  gesperrtAm?: number;                // Zeitstempel des Abschlusses
  erstelltAm: number;
}

// ---- Einsatz (wer trägt welches Gebiet aus) ----------------

export type EinsatzTyp = 'standard' | 'springer' | 'ausfall' | 'ungeklärt';

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
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Arbeitszeiterfassung ----------------------------------

export type ArbeitszeitsQuelle = 'nfc' | 'manuell';
export type ArbeitszeitsTyp =
  | 'büro'
  | 'zusammentragen'
  | 'vorarbeit'
  | 'fahrer'
  | 'drucker'
  | 'setzer'
  | 'falzmaschine'
  | 'schneidemaschine'
  | 'sonstiges';

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

// ---- Systemparameter ---------------------------------------

export interface Parameter {
  // Zeitwerte Austragen
  laufgeschwindigkeitMProH: number;       // Standard: 5000 m/h
  steckzeitStkProH: number;               // Standard: 720 Stk/h
  // Stundenlöhne
  stundenlohnErwachseneAustr: number;     // MiLoG: 13.90
  stundenlohnMinderjAustr: number;        // Standard: 10.00
  mindeststundenlohn: number;             // Warnschwelle
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
  // Auth
  adminPinHash: string;
  adminName: string;
  abrechnungPinHash?: string;  // Zweiter PIN für "Mitarbeiter Abrechnung"-Rolle
  // Beilagenformate & Preise (JSON-serialisiert)
  beilagenPreise: BeilagenPreis[];
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
