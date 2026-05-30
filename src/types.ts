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
  /**
   * Fahrtkosten-Erstattung freigeschaltet. Nur wenn `true`, sieht der MA
   * die Fahrtkosten-Maske (Menü-Item + eigene Fahrten). Standardmäßig
   * `false` / undefined — sonst würde jeder MA Fahrten erfassen können.
   * Admins und Abrechnung sehen die Maske unabhängig davon.
   */
  fahrtkostenerstattung?: boolean;
  /**
   * „Abholer": Austräger holt seinen Stapel Anzeigenblätter selbst im Werk
   * ab. Auf Lieferscheinen wird das deutlich markiert, damit der Tour-Fahrer
   * den Stapel NICHT mitnimmt — er bleibt zur Abholung im Werk liegen.
   */
  istAbholer?: boolean;
  /**
   * „Drucksaal": Mitarbeiter ist im Drucksaal einsetzbar (Drucken, Falzen,
   * Schneiden, Verpacken). Nur diese erscheinen in der Drucksaal-Planung
   * der Personalplanungs-Maske. Nur Admin darf das Flag pflegen.
   */
  istDrucksaal?: boolean;
  /**
   * Manuelle Sortierreihenfolge in der Zusammenträger-Liste der
   * Personalplanung. Niedrigere Werte erscheinen oben. Wer keinen Wert hat,
   * landet alphabetisch hinter denen mit Wert. Wird ausschließlich aus der
   * Planungs-Maske heraus gepflegt (Pfeil-Buttons).
   */
  sortierungZusammen?: number;
  /** Analog für die Urlaubs-Sektion der Planungs-Maske. */
  sortierungUrlaub?: number;
  /**
   * Untergruppierung in der Zusammenträger-Sektion der Planungsmaske:
   *  - undefined / false → „fest eingeplant" (Standard, oben angezeigt)
   *  - true               → „auf Abruf" (unten, leicht graue Hintergrund)
   * Nur Admin darf dieses Flag setzen.
   */
  zusammenAufAbruf?: boolean;
  /**
   * Wenn true, blendet der Admin diesen MA aus der Urlaubs-Sektion der
   * Personalplanung aus. Standard ist sichtbar (Flag undefined/false).
   * MAs lassen sich vom Admin jederzeit wieder einblenden.
   */
  urlaubsplanungAusgeblendet?: boolean;
  /**
   * Optionales Kürzel des Mitarbeiters — 3 Großbuchstaben, frei wählbar.
   * Vorschlag bei Neuerfassung: Vorname[0] + Nachname[0..2]. Wird in der
   * Drucksaal-Planung auf den Chips angezeigt (statt voller Name), wenn
   * gesetzt.
   */
  kuerzel?: string;
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
  // ---- Anmeldung / Abmeldung beim Lohnbüro ------------------
  /** MA ist neu — noch nicht beim Lohnbüro angemeldet. Nicht in Auswahllisten. */
  nochNichtAngemeldet?: boolean;
  /** Bei Minderjährigen: Erlaubnis der Eltern eingeholt. */
  erlaubnisElternEingeholt?: boolean;
  /** Link zur FastDok-Bestätigungsmail des Lohnbüros. */
  lohnbueroBestaetigungLink?: string;
  /** Erste Abrechnungsperiode, in der der MA erscheinen soll. */
  startAbrechnungsperiodeId?: string;
  /** Alternativ: konkretes Startdatum (ISO YYYY-MM-DD). */
  startDatum?: string;
  /** Optional: ersetzt diesen anderen Mitarbeiter (z. B. Nachfolger). */
  ersetztMitarbeiterId?: string;
  /** Status der Anmelde-Erfassung. */
  anmeldungStatus?: 'fragebogen-beim-ma' | 'fragebogen-zurueck-unvollstaendig' | 'vollstaendig';
  /** Memo bei Status „unvollständig" zu fehlenden Infos. */
  anmeldungUnvollstaendigMemo?: string;
  /** Datum der Datenübermittlung an das Lohnbüro (ISO YYYY-MM-DD). */
  anmeldungUebermittlungDatum?: string;
  /** MA wurde beim Lohnbüro abgemeldet. */
  abgemeldet?: boolean;
  /**
   * „Vorläufig nicht abmelden": Bedarfs-Springer, der mehrere Monate
   * nicht eingesetzt wird, soll vom Lohnbüro NICHT automatisch
   * abgemeldet werden. Wirkung:
   *   · MA wird beim Periodenabschluss nicht zur Abmeldung vorgeschlagen
   *     (auch wenn keine Auszahlung in dieser Periode).
   *   · In der Lohnübermittlung erscheint ein expliziter Hinweis, sobald
   *     der MA keinen Bruttolohn in dieser Periode hat — damit das
   *     Lohnbüro die Karte nicht selbsttätig schließt.
   */
  vorlaeufigNichtAbmelden?: boolean;
  /** Datum der Abmelde-Übermittlung ans Lohnbüro. */
  abmeldungUebermittlungDatum?: string;
  /** Letzte Abrechnungsperiode des MA. */
  letzteAbrechnungsperiodeId?: string;
  teilgebietFreigaben?: string[];      // IDs der Teilgebiete, die dieser MA austragen darf
  teilgebietBoni?: TeilgebietBonus[];  // Bonus je Teilgebiet und Ausgabe
  // ---- Interessent (Bewerber / Lead) ------------------------
  /**
   * Kennzeichen „Interessent": Person ist als potenzieller MA erfasst, aber
   * noch nicht eingestellt. Es gelten reduzierte Pflichtfelder (keine
   * Mitarbeiternummer-Pflicht, keine Altersprüfung, keine Rollen-/
   * Gebiets-/Bonus-Zuordnung, keine Berücksichtigung in der Abrechnung,
   * keine Auswahl in Auswahllisten). Wenn der Haken entfernt wird, wird
   * der Datensatz wie ein neuer MA behandelt (nochNichtAngemeldet=true).
   */
  istInteressent?: boolean;
  /**
   * „Deinteressiert": Interessent hat kein Interesse mehr. Datensatz bleibt
   * in den Stammdaten, wird aber nicht mehr in Listen vorgeschlagen.
   * Wirkung analog zu isActive=false bei normalen MAs.
   */
  interessentDeinteressiert?: boolean;
  /** Tätigkeiten, für die Interesse besteht (Mehrfachauswahl). */
  interesseTaetigkeiten?: InteresseTaetigkeit[];
  /** Datum der ersten Kontaktaufnahme (ISO YYYY-MM-DD). */
  interessentKontaktDatum?: string;
  /** Link zu weiterer Korrespondenz (z. B. Google-Mail-Thread). */
  interessentKorrespondenzLink?: string;
  /** Freitext-Memo: Eindruck, Einschätzung, Notizen zum Interessenten. */
  interessentMemo?: string;
  /**
   * Alternativ zum Geburtsdatum: Alter in Jahren zum Zeitpunkt der
   * Erfassung (= `interessentKontaktDatum`). Das aktuelle Alter wird
   * dann fortlaufend berechnet (kontaktDatum + n Jahre).
   */
  interessentAlterBeiErfassung?: number;
  /**
   * Legacy-MA: nur zur Zuordnung historischer Lohnbüro-Daten angelegt.
   * Wird ausschließlich aus dem „Lohnbüro auswerten"-Screen erzeugt
   * (manuelles Mapping von „kein Match"-Einträgen). Plausibilitäts-
   * Prüfungen (Alter, Pflichtfelder etc.) entfallen; der MA wird beim
   * Anlegen automatisch deaktiviert und abgemeldet. Erscheint NICHT in
   * der Personalplanung, NICHT in der Stempeluhr, NICHT in der Abrechnung
   * — er existiert nur als Auflöser für Namens-Treffer in den
   * historischen PDF-Daten.
   */
  istLegacy?: boolean;
  erstelltAm: number;     // Unix-Timestamp ms
  aktualisiertAm: number;
}

export type InteresseTaetigkeit =
  | 'aushilfeProduktion'
  | 'auslieferungsfahrer'
  | 'zusammentragen'
  | 'austragen'
  | 'buero';

export const INTERESSE_TAETIGKEIT_LABELS: Record<InteresseTaetigkeit, string> = {
  aushilfeProduktion: 'Aushilfe in der Produktion',
  auslieferungsfahrer: 'Auslieferungsfahrer',
  zusammentragen: 'Zusammentragen',
  austragen: 'Austragen',
  buero: 'Büro',
};

// ---- Tour --------------------------------------------------

export interface Tour {
  id: string;
  name: string;
  farbe: string;          // CSS-Farbe, z.B. '#ef4444'
  /**
   * Regelmäßig gefahrene Strecke in ganzen Kilometern, wenn ein Fahrer
   * diese Tour übernimmt (wöchentliche Auslieferungsfahrt). Wird in der
   * Fahrtkosten-Erfassung als Vorschlag für die Strecke summiert, sobald
   * der Nutzer Touren statt eines Ziels wählt. Nur Admin darf den Wert
   * setzen.
   */
  streckeFahrkostenKm?: number;
  /**
   * Wenn true, blendet der Admin diese Tour in der Fahrer-Sektion der
   * Personalplanung aus. Andere Bereiche (Lieferschein, Einsätze,
   * Fahrtkosten) bleiben unberührt — die Tour existiert weiter.
   */
  fahrerplanungAusgeblendet?: boolean;
  /**
   * Standard-Karten-Link (z. B. Google My Maps) für alle TGs dieser Tour.
   * Wird vom Teilgebiete-Strassen-Tab als Default angezeigt; pro TG kann
   * der Admin diesen über `Teilgebiet.kartenLink` weiterhin überschreiben.
   * Nur Admin darf den Wert pflegen.
   */
  kartenLink?: string;
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
  // ---- Auslagestelle (Teilgebiet ohne Austräger, nur Auslage) -------
  /**
   * Wenn true: reines Auslage-Gebiet — Fahrer legt an einer Adresse aus,
   * Leser holen sich Exemplare ab. Kein Standardausträger, kein Springer,
   * keine Wegstrecke nötig. In der Teilgebiete-Übersicht NICHT als
   * unbesetzt markieren.
   */
  istAuslagestelle?: boolean;
  /** Anlieferungsadresse (Straße + Hausnummer + ggf. Hinweis). */
  auslagestelleAdresse?: string;
  /** Optionaler Ansprechpartner vor Ort. */
  auslagestelleKontaktName?: string;
  auslagestelleKontaktTelefon?: string;
  auslagestelleKontaktEmail?: string;
  /** Memo für Absprachen mit der Kontaktperson. */
  auslagestelleMemo?: string;
  /**
   * Optionaler externer Link zur Kartenansicht (z. B. Google My Maps).
   * Wenn nicht gesetzt, greift ein Tour-spezifischer Default (siehe
   * `defaultKartenLink()` in TeilgebieteScreen). Nur Admin darf den
   * pro-TG-Wert setzen/überschreiben.
   */
  kartenLink?: string;
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
  /**
   * Zwischen-Snapshot vor Monatswechsel — fixiert nur Austragen/Zusammentragen
   * (inkl. Vorarbeit) sowie Stammdaten-Snapshots (Teilgebiete, Parameter).
   * Andere Werte (Zeiterfassung, Fahrtkosten, Vorschüsse, Boni, Lohnkonto)
   * werden weiterhin live berechnet, bis die Periode endgültig abgeschlossen
   * wird. Aufbau spiegelt Teile von `MitarbeiterAbrechnung` (siehe
   * lib/abrechnungslogik.ts), als `unknown[]` typisiert um zirkuläre Imports
   * zu vermeiden.
   */
  monatswechselSnapshot?: {
    erstelltAm: number;
    paramSnapshot: Partial<Parameter>;
    teilgebietSnapshots: TeilgebietSnapshot[];
    /**
     * Pro MA: fixierte Austragen-/Zusammentragen-Werte. Cast an der
     * Verwendungsstelle in `abrechnungslogik.ts`.
     */
    fixierungProMa: Array<{
      mitarbeiterId: string;
      austraegerEinsaetze: unknown[];
      austraegerGesamt: number;
      gewichtsbonusAnzeigenblatt: number;
      gewichtsbonusBeilagen: number;
      zusammentragenEinsaetze: unknown[];
      zusammentragenGesamt: number;
    }>;
  };
  /** Redundant zum Snapshot-Timestamp, vereinfacht UI-Checks. */
  monatswechselDurchgefuehrtAm?: number;
  /**
   * Snapshot der Abmelde-Liste zum Zeitpunkt des Periodenabschlusses.
   * Wenn vorhanden, ersetzt er die Live-Liste in der UI — auch nachdem die
   * Periode wieder geöffnet wurde, damit die gesetzten Kennzeichen
   * nachvollziehbar bleiben. Pro Eintrag kann der Admin einzeln „MA wieder
   * aktivieren" auslösen, was den Eintrag aus dem Snapshot entfernt.
   */
  abmeldungenSnapshot?: {
    erstelltAm: number;
    eintraege: Array<{
      mitarbeiterId: string;
      name: string;
      nummer: string;
      abmeldedatum: string;        // ISO YYYY-MM-DD
      ersetztDurchId?: string;     // historisch — kann leer sein
    }>;
  };
  gesperrtAm?: number;                // Zeitstempel des Abschlusses
  erstelltAm: number;
}

// ---- Austrägerwechsel-Vorbereitung (entfernt) --------------
//
// Der separate Reiter „Austrägerwechsel vorbereiten" wurde abgeschafft —
// dauerhafte Wechsel werden ausschließlich über `StandardAustraegerWechselPlan`
// in der Personalplanung gepflegt (siehe weiter unten).

// ---- Stückzahl-Anpassung vorbereiten -----------------------
//
// Vorgemerkte Änderung der Stückzahl (Anzahl Exemplare) pro Teilgebiet.
// Wird beim nächsten Monatswechsel zur Einzel-Bestätigung angeboten;
// nach Übernahme wird tg.stueckzahl aktualisiert (und der manuelle
// Override-Flag stueckzahlManuell=true gesetzt), der Eintrag gelöscht.
// Upsert auf teilgebietId.

export interface StueckzahlAnpassung {
  id: string;
  teilgebietId: string;
  neueStueckzahl: number;
  bemerkung?: string;
  erstelltVon?: string;
  erstelltAm: number;
  aktualisiertAm: number;
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
  // ---- Planungs-Felder (aus PlanungScreen geschrieben) -----
  /** Freitext-Kommentar zum Ausfall/Springer, aus der Planung gepflegt. */
  kommentar?: string;
  /** Externer Link (z. B. Mail-Thread) zum Ausfall. */
  externerLink?: string;
  /**
   * Gruppen-Anker für mehrwöchige Ausfälle: alle Einsätze einer logischen
   * Gruppe tragen identische `(ausfallBisJahr, ausfallBisKw)`. Beim
   * Bearbeiten/Löschen aus der Planung werden alle Geschwister gemeinsam
   * behandelt. Bei Single-Cell-Ausfällen identisch mit (jahr, kw).
   */
  ausfallBisJahr?: number;
  ausfallBisKw?: number;
  /**
   * Snapshot des Standardausträgers zum Planungszeitpunkt. Wird zum
   * Anlegen einmal befüllt und bei Folge-Updates beibehalten — der
   * Planungsscreen vergleicht damit gegen den aktuellen Standardausträger
   * und warnt mit ⚡, falls sich dieser zwischenzeitlich geändert hat.
   */
  standardAustraegerSnapshot?: string | null;
  /**
   * Markierung „auto vom Wechselplan": Einsatz wurde automatisch vom
   * Speichern eines `StandardAustraegerWechselPlan` angelegt — damit der
   * neue Austräger in den Ausgaben zwischen `abAusgabe` und dem
   * Periodenende bereits als Springer geführt wird (vor dem
   * Monatswechsel, der ihn offiziell zum Standardausträger macht).
   *
   * Wird beim Löschen / Editieren des Wechselplans wieder eingesammelt
   * — vom User manuell gepflegte Springer (ohne dieses Flag) bleiben
   * unberührt.
   */
  autoVomWechselplan?: boolean;
  // Selbstmeldung durch den Austräger (ohne Login, via QR-Code)
  arbeitszeit?: AustraegerArbeitszeit;
  restmenge?: number;           // nicht ausgetragene Stücke (Überschuss)
  fehlmenge?: number;           // zu wenig erhalten (Mangel) — z. B. weil neue Häuser dazukamen
  meldungKommentar?: string;    // Freitext-Kommentar des Austrägers (Grund, Hinweis)
  meldungEingereichtAm?: number; // Unix-Timestamp ms der Einreichung
  erstelltAm: number;
  aktualisiertAm: number;
}

// ---- Arbeitszeiterfassung ----------------------------------

export type ArbeitszeitsQuelle = 'nfc' | 'manuell' | 'selbstmeldung';
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
  /**
   * Zuordnung zu einem Einsatz — wird gesetzt, wenn die Arbeitszeit aus der
   * QR-Code-Selbstmeldung des Austrägers entstanden ist. Beim erneuten
   * Speichern derselben Selbstmeldung wird der bestehende Datensatz
   * aktualisiert, statt einen zweiten anzulegen.
   */
  einsatzId?: string;
  erstelltAm: number;
  aktualisiertAm: number;
  autoGeschlossenUm24?: boolean;
  /** Wenn `true`, fließt der Eintrag NICHT in die Abrechnung ein. Nicht-Admins
   *  können falsch erfasste Einträge nicht löschen, aber so markieren. */
  nichtBeruecksichtigen?: boolean;
  /** Begründung, warum der Eintrag ignoriert werden soll (optional). */
  nichtBeruecksichtigenGrund?: string;
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
  /**
   * Frei eingegebenes Ziel — leer, wenn die Fahrt über `tourIds`
   * dokumentiert wurde. Mindestens eines von beiden ist erforderlich.
   */
  ziel: string;
  /**
   * Liste der gefahrenen Touren (z. B. wöchentliche Verteilung). Wenn
   * gesetzt, wird die Default-Strecke aus den Tour-Daten summiert, kann
   * aber im Form überschrieben werden (Umwege, Mehrfachfahrten).
   */
  tourIds?: string[];
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
  // Bonus „Zeiterfassung Austragen": pauschaler Bonus in EUR je vollständig
  // online erfasstem Einsatz (Austragen). Nur Austräger erhalten ihn; je
  // Teilgebiet & Ausgabe einmal. Bedingung: Arbeitszeit (von/bis) UND
  // Restmenge eingegeben UND Meldung eingereicht (alles über QR-Code).
  // Wert in EUR. 0 = deaktiviert.
  bonusZeiterfassungEur?: number;
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

// ---- Mitarbeiter-Memo (Abrechnungsvorbereitung) ------------
//
// Hinweise / Mitteilungen ans Lohnbüro, die zu einer bestimmten
// Abrechnungsperiode übermittelt werden sollen. Beispiele:
//   - IBAN-Änderung
//   - Adress-Änderung
//   - Abrechnungs-Parameter (Stundenlohn, Festgehalt etc.)
//   - Anforderung spezieller Auswertungen / Meldungen
//   - Krankmeldungen
//
// `abrechnungsperiodeId` optional: bevor klar ist, in welcher Periode
// das Memo übermittelt werden soll, bleibt das Memo „nicht zugeordnet"
// und wird im AbrechnungScreen entsprechend angezeigt.
//
// `nurAdmin`: vom Admin als „privat" markiertes Memo. Wird der Rolle
// `abrechnung` nicht angezeigt und auch nicht im Export gelistet.
// Standardmäßig false. Nur Admin darf das Flag setzen.

export type MemoKategorie =
  | 'iban'
  | 'adresse'
  | 'parameter'
  | 'auswertung'
  | 'krankmeldung'
  | 'sonstiges';

export const MEMO_KATEGORIE_LABELS: Record<MemoKategorie, string> = {
  iban: 'IBAN-Änderung',
  adresse: 'Adress-Änderung',
  parameter: 'Abrechnungs-Parameter',
  auswertung: 'Auswertung / Meldung',
  krankmeldung: 'Krankmeldung',
  sonstiges: 'Sonstiges',
};

export interface MitarbeiterMemo {
  id: string;
  mitarbeiterId: string;
  kategorie: MemoKategorie;
  text: string;
  /** Optional: Abrechnungsperiode, in der das Memo übermittelt werden soll. */
  abrechnungsperiodeId?: string;
  /**
   * Optionaler externer Link (z. B. Mail-Thread, Bestätigungs-PDF,
   * Drive-Datei). Wird in der Abrechnung als anklickbares Icon
   * angezeigt — **nicht** Teil des Excel-Exports zur Lohnübermittlung
   * (der Inhalt des Links bleibt intern).
   */
  externerLink?: string;
  /** Nur sichtbar für Admin — vom Admin gesetzt. Standard false. */
  nurAdmin: boolean;
  erstellerName: string;
  erstellerRolle: 'admin' | 'abrechnung';
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

/**
 * Feste Liste der Reklamationsgründe (Mehrfachauswahl). Zusätzlich kann
 * pro Reklamation ein Freitext-Grund erfasst werden (`gruendeFreitext`).
 */
export const REKLAMATION_GRUND_KEYS = [
  'nichtBeliefert',
  'zuSpaetBeliefert',
  'exemplareZerknueddelt',
  'gbImZaun',
  'gbAufsGrundstueck',
  'willNichtBeliefert',
  'zuVieleExemplare',
  'zuWenigExemplare',
] as const;
export type ReklamationGrundKey = (typeof REKLAMATION_GRUND_KEYS)[number];
export const REKLAMATION_GRUND_LABELS: Record<ReklamationGrundKey, string> = {
  nichtBeliefert: 'Nicht beliefert',
  zuSpaetBeliefert: 'Zu spät beliefert',
  exemplareZerknueddelt: 'Exemplare zerknüddelt',
  gbImZaun: 'GB steckt im Zaun',
  gbAufsGrundstueck: 'GB aufs Grundstück geworfen',
  willNichtBeliefert: 'Will nicht beliefert werden',
  zuVieleExemplare: 'Zu viele Exemplare erhalten',
  zuWenigExemplare: 'Zu wenig Exemplare erhalten',
};

/**
 * Anrufer-Merkmale als Tri-State: Schlüssel fehlt = Frage wurde dem
 * Anrufer nicht gestellt; 'ja' / 'nein' = gestellt und beantwortet.
 */
export const ANRUFER_MERKMAL_KEYS = [
  'hatHund',
  'hatBriefkasten',
  'aufkleberKeineWerbung',
  'briefkastenEingezaeunt',
  'schonMalMitgeteilt',
] as const;
export type AnruferMerkmalKey = (typeof ANRUFER_MERKMAL_KEYS)[number];
export const ANRUFER_MERKMAL_LABELS: Record<AnruferMerkmalKey, string> = {
  hatHund: 'Hat Hund',
  hatBriefkasten: 'Hat Briefkasten',
  aufkleberKeineWerbung: 'Hat Aufkleber „Keine Werbung"',
  briefkastenEingezaeunt: 'Briefkasten auf eingezäuntem Bereich',
  schonMalMitgeteilt: 'Problem schon mal mitgeteilt',
};

/**
 * Ein Zeitbezug der Reklamation. Mehrere Einträge möglich. Steuert das
 * Zeitfenster für die Austräger-/Springer-Vorauswahl.
 *  - `kw`        : betrifft eine bestimmte Ausgabe (von) oder Range (von..bis).
 *  - `geschaetzt`: Anrufer kennt die KW nicht — „seit N Wochen/Monaten".
 *  - `datum`     : einzelnes „Problem bekannt am"-Datum.
 */
export interface ReklamationZeitraum {
  typ: 'kw' | 'geschaetzt' | 'datum';
  // typ === 'kw'
  vonJahr?: number;
  vonKw?: number;
  bisJahr?: number;
  bisKw?: number;
  // typ === 'geschaetzt'
  einheit?: 'wochen' | 'monate';
  anzahl?: number;
  // typ === 'datum'
  datum?: string; // ISO YYYY-MM-DD
}

export interface Reklamation {
  id: string;
  anruferName: string;
  telefon?: string;
  email?: string;
  /** Adresse des Anrufers — Basis für die TG-Vorschlag-Logik. */
  strasse?: string;
  hausnummer?: string;
  plz?: string;
  ort?: string;
  anmerkung?: string;
  /**
   * Aktuell genutztes Plural-Feld: ein Reklamationsfall kann mehrere
   * Teilgebiete betreffen (z. B. wenn eine Straße durch mehrere TGs
   * verläuft). Der Verursacher wird später geklärt.
   */
  teilgebietIds?: string[];
  /** Analog: mehrere Austräger/Springer können in Frage kommen. */
  mitarbeiterIds?: string[];
  /** @deprecated — bleibt für alte Datensätze lesbar, wird nicht mehr geschrieben. */
  teilgebietId?: string;
  /** @deprecated — siehe teilgebietId. */
  mitarbeiterId?: string;
  mitgeteilt: boolean;          // dem Mitarbeiter mitgeteilt
  /**
   * Archiviert: Reklamation ist abgeschlossen und erscheint nicht mehr in
   * der „offen"-Liste der Startseite. Unabhängig vom „mitgeteilt"-Flag —
   * eine Reklamation kann auch ohne MA-Mitteilung archiviert werden, z. B.
   * wenn sich der Anrufer als Falschmeldung erweist.
   */
  archiviert?: boolean;
  /** Reklamationsgründe (Mehrfachauswahl, feste Liste). */
  gruende?: ReklamationGrundKey[];
  /** Zusätzliche frei erfasste Gründe (Freitext). */
  gruendeFreitext?: string[];
  /** Anrufer-Merkmale als Tri-State (Schlüssel fehlt = nicht gefragt). */
  anruferMerkmale?: Partial<Record<AnruferMerkmalKey, 'ja' | 'nein'>>;
  /** Zeitbezüge der Reklamation (KW / geschätzt / Datum). */
  zeitraeume?: ReklamationZeitraum[];
  /**
   * Optionaler Link auf einen E-Mail-Thread (Gmail, Outlook, …), in dem die
   * Verarbeitung der Reklamation dokumentiert ist.
   */
  mailLink?: string;
  erstelltAm: number;
  aktualisiertAm: number;

  // ---- @deprecated Legacy-Felder (nur noch lesbar, migriert beim Laden) ----
  /** @deprecated → anruferMerkmale.hatBriefkasten */
  briefkastenVorhanden?: boolean;
  /** @deprecated → anruferMerkmale.aufkleberKeineWerbung */
  aufkleberKeineWerbung?: boolean;
  /** @deprecated → anruferMerkmale.schonMalMitgeteilt */
  schonMalMitgeteilt?: boolean;
  /** @deprecated → gruende.nichtBeliefert */
  nichtBeliefert?: boolean;
  /** @deprecated → gruende.zuSpaetBeliefert */
  zuSpaetBeliefert?: boolean;
  /** @deprecated → zeitraeume (typ='datum') */
  seitWann?: string;
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

// ---- Lohnbüro-Abrechnungen (indizierte PDFs) ---------------
//
// Das Steuer-/Lohnbüro liefert pro Monat ein PDF mit einer Seite je
// Mitarbeiter (Brutto-/Netto-Abrechnung). Diese Records repräsentieren
// das Ergebnis der Indizierung dieser PDFs — ein Record pro
// (Datei, Seite, MA). Quell-PDFs liegen im Google-Drive und werden via
// Deep-Link `…/view#page=N` aufgerufen. Bei Korrektur-PDFs
// ("Nachberechnung…") wird `istKorrektur=true` gesetzt.
//
// Privacy: Bewusst nur die 4 angeforderten Beträge + Name + Drive-Link.
// SV-Nummer, IBAN, Adresse bleiben ausschließlich im PDF.
export interface LohnbueroAbrechnung {
  id: string;
  // Quelle
  fileId: string;
  fileName: string;
  fileUrl: string;            // https://drive.google.com/file/d/<id>/view
  seite: number;              // 1-basiert
  // Periode
  jahr: number;
  monat: number;              // 1..12
  istKorrektur: boolean;
  // MA
  mitarbeiterId: string | null;
  nameRoh: string;
  personalNrLohnbuero?: string;
  // Werte (EUR)
  gesamtBrutto: number;
  nettoVerdienst: number;
  svAbzuege: number;
  auszahlungsbetrag: number;
  // Weitere Werte aus der Abrechnung (per Lohnart-Schlüssel des Steuerbüros):
  /** Fahrtkosten (Lohnart-Schlüssel 9074). */
  fahrtkosten?: number;
  /** Vorschuss / „Abschlag" (Lohnart-Schlüssel 9001). */
  vorschuss?: number;
  /** Darlehensrückzahlung im Monat (Lohnart-Schlüssel 9993). */
  darlehensRueckzahlung?: number;
  /** Darlehen Restbetrag (Label „Darlehen Rest", kein fester Schlüssel). */
  darlehenRest?: number;
  // Optional
  eintritt?: string;          // ISO YYYY-MM-DD
  austritt?: string;
  // Audit
  indiziertAm: number;
  indizierVersion: number;
}

// ---- Lohnbüro-Drive-Links (externer Speicher) --------------
//
// Pro Abrechnungsmonat (bzw. -jahr) ein Link in das Google Drive, in dem
// die vom Steuer-/Lohnbüro gelieferten Original-Abrechnungen liegen.
//   - `monat = null` → Link zum Jahres-Ordner
//   - `monat = 1..12` → Link zum Monats-Ordner
// Doc-ID: `${jahr}` für Jahres-Links, `${jahr}-${monat}` für Monats-Links.
export interface LohnbueroDriveLink {
  id: string;
  jahr: number;
  monat: number | null;
  url: string;
  kommentar?: string;
  aktualisiertAm: number;
  aktualisiertVon?: string;
}

export interface LohnbueroAnmeldung {
  id: string;
  fileId: string;
  fileName: string;
  fileUrl: string;
  seite: number;
  jahr: number;
  monat: number;
  mitarbeiterId: string | null;
  nameRoh: string;
  personalNrLohnbuero?: string;
  typ: 'anmeldung' | 'abmeldung';
  grundDerAbgabe?: string;     // Schlüsselzahl + Klartext
  beschaeftigungVon?: string;  // ISO
  beschaeftigungBis?: string;
  indiziertAm: number;
  indizierVersion: number;
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

// ============================================================
// Personalplanung (Drucksaal + Austräger)
// ============================================================
//
// Vier separate Collections — jede ist klein, hat einen eindeutigen
// Composite-Key und lässt sich pro Eintrag sperren/freigeben.
// Alle Einträge werden über (jahr, kw) abgefragt; UI cached die jeweils
// sichtbare Jahresansicht im RAM.

/** Drucksaal-Tätigkeiten, die in der Planung wöchentlich besetzt werden. */
export type DrucksaalTaetigkeit =
  | 'drucken'
  | 'falzen1'
  | 'falzen2'
  | 'schneiden'
  | 'verpacken';

export const DRUCKSAAL_TAETIGKEIT_LABELS: Record<DrucksaalTaetigkeit, string> = {
  drucken: 'Drucken',
  falzen1: 'Falzen 1',
  falzen2: 'Falzen 2',
  schneiden: 'Schneiden',
  verpacken: 'Verpacken',
};

/** Status, mit dem ein Zusammenträger seine Anwesenheit pro KW plant. */
export type ZusammentragerStatus =
  | 'kommt'
  | 'kommt-nicht'
  | 'kommt-ggf'
  | 'unabgemeldet-nicht-erschienen';

export const ZUSAMMENTRAGER_STATUS_LABELS: Record<ZusammentragerStatus, string> = {
  'kommt': 'kommt',
  'kommt-nicht': 'kommt nicht',
  'kommt-ggf': 'kommt ggf.',
  'unabgemeldet-nicht-erschienen': 'unabgemeldet nicht erschienen',
};

/**
 * Drucksaal-Planung: eine Zelle pro (jahr, kw, taetigkeit).
 * docId = `${jahr}-${kw}-${taetigkeit}` — Upsert.
 */
export interface DrucksaalPlanung {
  id: string;
  jahr: number;
  kw: number;
  taetigkeit: DrucksaalTaetigkeit;
  mitarbeiterId: string | null;
  /** Optionaler Freitext-Kommentar zur Zelle (Rechtsklick im UI). */
  kommentar?: string;
  erstelltAm: number;
  aktualisiertAm: number;
}

/**
 * Fahrer-Planung: eine Zelle pro (jahr, kw, tourId).
 * docId = `${jahr}-${kw}-${tourId}` — Upsert.
 */
export interface FahrerPlanung {
  id: string;
  jahr: number;
  kw: number;
  tourId: string;
  mitarbeiterId: string | null;
  /** Optionaler Freitext-Kommentar zur Zelle (Rechtsklick im UI). */
  kommentar?: string;
  erstelltAm: number;
  aktualisiertAm: number;
}

/**
 * Zusammenträger-Planung: eine Zelle pro (jahr, kw, mitarbeiterId).
 * docId = `${jahr}-${kw}-${mitarbeiterId}` — Upsert.
 */
export interface ZusammentragerPlanung {
  id: string;
  jahr: number;
  kw: number;
  mitarbeiterId: string;
  /**
   * Optional: ein Eintrag darf auch nur einen Kommentar tragen, ohne dass
   * der Chip aktiviert wird. Erst beim aktiven Klick auf den Chip wird
   * der Status gesetzt.
   */
  status?: ZusammentragerStatus;
  kommentar?: string;
  /** Optionaler externer Link (z. B. Mail-Thread, Bestätigungs-PDF). */
  externerLink?: string;
  erstelltAm: number;
  aktualisiertAm: number;
}

/**
 * Austräger-Ausfall (= Springer-Planung): eine Zelle pro (jahr, kw, teilgebietId).
 * docId = `${jahr}-${kw}-${teilgebietId}` — Upsert.
 *
 * Felder:
 *  - `standardAustraegerSnapshot`: ID des Standardausträgers zum Zeitpunkt
 *    der Planung. Bleibt erhalten, auch wenn der TG-Standard später wechselt.
 *  - `springerMitarbeiterId`: Ersatzkraft. Solange null → Anzeige rot.
 *  - `ausfallBisKw` + `ausfallBisJahr`: optional, automatische Auto-Anlage
 *    der Folgewochen erfolgt nicht in der DB, sondern bei jedem Speichern
 *    durch die UI (idempotenter Upsert).
 *  - `inAbrechnungUebernommen`: wenn `true`, ist die Planung in einen
 *    Springer-Einsatz für die KW geflossen. Daten werden gesperrt.
 *  - `uebernommenSpringerEinsatzId`: optionale Rückreferenz, damit beim
 *    Reset bekannt ist, welcher Einsatz zu löschen ist.
 */
/** Urlaubsstatus pro (KW, Mitarbeiter). */
export type UrlaubStatus = 'ganze-woche' | 'einzeltag' | 'mehrtaegig';

export const URLAUB_STATUS_LABELS: Record<UrlaubStatus, string> = {
  'ganze-woche': 'Urlaub — ganze Woche',
  'einzeltag': 'Urlaubstag',
  'mehrtaegig': 'Urlaub mehrtägig',
};

/**
 * Urlaubseintrag — eine Zelle pro (jahr, kw, mitarbeiterId).
 * docId = `${jahr}-${kw}-${mitarbeiterId}` — Upsert.
 *
 * Erstreckt sich der Urlaub über mehrere KWs, wird beim Speichern ein
 * separater Eintrag pro betroffener KW angelegt (mit identischen
 * von/bis-Daten). Damit funktioniert die KW-Matrix ohne Spezialfälle.
 *
 * Freigabe-Workflow:
 *  - Erstellt durch Admin → automatisch `freigegeben: true`
 *  - Erstellt durch Abrechnung → `freigegeben: false`; bis ein Admin
 *    den Eintrag freigibt, erscheint er gelb markiert + in der
 *    Hinweisbox auf der Startseite.
 */
export interface UrlaubsEintrag {
  id: string;
  jahr: number;
  kw: number;
  mitarbeiterId: string;
  status: UrlaubStatus;
  datumVon?: string;        // ISO YYYY-MM-DD
  datumBis?: string;
  kommentar?: string;
  externerLink?: string;
  /**
   * Konkrete Werktage (Mo–Fr) in dieser Kalenderwoche, ISO-Format.
   * Wenn gesetzt, ist das die maßgebliche Quelle für Statusberechnung
   * (1 Tag = einzeltag, 2-4 = mehrtaegig, 5 = ganze-woche). Erlaubt
   * mehrere Einzeltage pro KW (z. B. Mo + Mi + Fr). Bei Altdaten leer →
   * Fallback aus datumVon/Bis.
   */
  werktageInKw?: string[];
  erstellerName: string;
  erstellerRolle: 'admin' | 'abrechnung';
  freigegeben: boolean;
  freigegebenVon?: string;
  freigegebenAm?: number;
  erstelltAm: number;
  aktualisiertAm: number;
}

/**
 * Geplanter dauerhafter Standardausträger-Wechsel je Teilgebiet.
 * Wird in der Planungsmaske unterhalb der „Ausfälle"-Sektion angelegt;
 * unabhängig vom kurzfristigen Ausfall-Handling.
 *
 * docId = `teilgebietId` (pro TG gibt es maximal einen geplanten Wechsel).
 *
 * Felder:
 *  - letzteAusgabe(Jahr,Kw): letzte Ausgabe, die der BISHERIGE Standard-
 *    austräger noch verteilt. Pflicht.
 *  - neuerAustraegerId + abAusgabe(Jahr,Kw): optional — solange nicht
 *    gesetzt, gilt das TG ab der nächsten Ausgabe als unbesetzt.
 */
export interface StandardAustraegerWechselPlan {
  id: string;
  teilgebietId: string;
  /**
   * Letzte Ausgabe, die der BISHERIGE Standardausträger noch verteilt.
   * OPTIONAL: bei Teilgebieten, die seit Beginn unbesetzt sind (kein
   * Standardausträger jemals gesetzt), gibt es keine letzte Ausgabe.
   * In diesem Fall bleibt das Feld leer und der Lücken-Bereich beginnt
   * effektiv ab KW 1 des sichtbaren Jahres.
   */
  letzteAusgabeJahr?: number;
  letzteAusgabeKw?: number;
  neuerAustraegerId?: string;
  abAusgabeJahr?: number;
  abAusgabeKw?: number;
  kommentar?: string;
  /** Optionaler externer Link (z. B. Mail-Thread). */
  externerLink?: string;
  erstelltAm: number;
  aktualisiertAm: number;
}

export interface AustraegerAusfall {
  id: string;
  jahr: number;
  kw: number;
  teilgebietId: string;
  standardAustraegerSnapshot: string | null;
  springerMitarbeiterId: string | null;
  kommentar?: string;
  externerLink?: string;
  ausfallBisJahr?: number;
  ausfallBisKw?: number;
  inAbrechnungUebernommen?: boolean;
  uebernommenAm?: number;
  uebernommenSpringerEinsatzId?: string;
  erstelltAm: number;
  aktualisiertAm: number;
}
