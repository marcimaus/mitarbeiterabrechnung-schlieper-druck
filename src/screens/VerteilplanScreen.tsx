// Verteilplan / Bestellzettel für Kunden
// Interaktiv: Teilgebiete, ganze Touren, PLZ-Bereiche oder das Gesamtgebiet
// anklicken → Summe der Auswahl. Touren zusammenklappbar. Darunter Summen je
// PLZ. Druck/PDF als A4-Dokument (mehrseitig) — blanko zum händischen
// Ankreuzen oder ausgefüllt mit Auswahl und berechneten Summen.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import type {
  BeilagenFormat,
  BeilagenKennzeichen,
  BeilagenVorlage,
  BeilagenVorlageTermin,
  Teilgebiet,
  Tour,
} from '../types';
import {
  beilagenVorlagenListener,
  erstelleBeilagenVorlage,
  aktualisiereBeilagenVorlage,
  loescheBeilagenVorlage,
  erstelleBeilage,
  getOrCreateAusgabe,
} from '../lib/db';
import {
  BEILAGEN_FORMATE,
  auswahlStruktur,
  buchbareTeilgebiete,
  formatLabel,
  fehlendeAngabenFuerAuftrag,
  kwAuswahlOptionen,
  stueckzahlVon,
  vorlageUebernahmeVermerken,
  vorlageUebernommenFuer,
  vorlageKwLabel,
  vorlageTeilgebietIds,
  vorlageTermine,
} from '../lib/beilagenVorlagen';
import { getCurrentKW, kwLabel, maxKWinJahr } from '../lib/kalender';
import { berechneBeilagenPreis, eur, type BeilagenPreisErgebnis } from '../lib/beilagenPreis';

export default function VerteilplanScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <VerteilplanInhalt />
    </AdminPinGate>
  );
}

// ── Datenmodell ───────────────────────────────────────────────────────────────

interface TourGruppe {
  key: string;
  tour: Tour | null;
  label: string;
  tgs: Teilgebiet[];
  summe: number;
}

interface PlzGruppe {
  plz: string;
  orte: string;
  tgs: Teilgebiet[];
  summe: number;
}

interface Kundendaten {
  arbeitstitel: string;
  kundenname: string;
  ansprechpartner: string;
  telefon: string;
  datum: string;
  /** '' oder "jahr-kw" */
  kwKey: string;
  format: BeilagenFormat;
  kennzeichen: BeilagenKennzeichen;
  gewichtGStk: string;
  memo: string;
  /** Externer Link (Mail-Thread o. ä.) — wird nicht gedruckt. */
  externerLink: string;
  /** Kennzeichen „Beilage angeliefert" — bei Neuanlage gesetzt. */
  beilageAngeliefert: boolean;
  istDauervorlage: boolean;
  /** Nur Dauerbestellung: geplante KWs mit eigenem Format/Gewicht/Anlieferung. */
  termine: TerminForm[];
}

/** Eingabezeile eines Dauerbestellungs-Termins (gleiche Feldnamen wie Kundendaten). */
interface TerminForm {
  /** "jahr-kw" */
  kwKey: string;
  format: BeilagenFormat;
  gewichtGStk: string;
  beilageAngeliefert: boolean;
}

const gewichtText = (g: number | undefined) => (g ? String(g).replace('.', ',') : '');
const gewichtZahl = (s: string) => parseFloat(s.replace(',', '.')) || 0;
const aktuellerKwKey = () => {
  const { kw, jahr } = getCurrentKW();
  return `${jahr}-${kw}`;
};

function naechsterKwKey(key: string): string {
  const { kw, jahr } = kwKeyParse(key);
  if (kw == null || jahr == null) return aktuellerKwKey();
  return kw >= maxKWinJahr(jahr) ? `${jahr + 1}-1` : `${jahr}-${kw + 1}`;
}

const kwKeySort = (a: string, b: string) => {
  const x = kwKeyParse(a);
  const y = kwKeyParse(b);
  return (x.jahr ?? 0) - (y.jahr ?? 0) || (x.kw ?? 0) - (y.kw ?? 0);
};

/**
 * Vorgewählter Termin beim Öffnen: KW aus dem Link, sonst die aktuelle KW,
 * sonst der nächste noch nicht übernommene Termin, sonst der letzte.
 */
function vorgewaehlterTermin(termine: TerminForm[], v: BeilagenVorlage | null, wunschKey: string | null): number {
  if (termine.length === 0) return -1;
  for (const key of [wunschKey, aktuellerKwKey()]) {
    const i = key ? termine.findIndex((t) => t.kwKey === key) : -1;
    if (i >= 0) return i;
  }
  const heute = aktuellerKwKey();
  const offen = termine.findIndex((t) => {
    const { kw, jahr } = kwKeyParse(t.kwKey);
    return kwKeySort(t.kwKey, heute) >= 0 && !(v && kw != null && jahr != null && vorlageUebernommenFuer(v, kw, jahr));
  });
  return offen >= 0 ? offen : termine.length - 1;
}

const leereKundendaten = (): Kundendaten => ({
  arbeitstitel: '',
  kundenname: '',
  ansprechpartner: '',
  telefon: '',
  datum: new Date().toISOString().slice(0, 10),
  kwKey: '',
  format: '',
  kennzeichen: 'int',
  gewichtGStk: '',
  memo: '',
  externerLink: '',
  beilageAngeliefert: true,
  istDauervorlage: false,
  termine: [],
});

function kwKeyParse(key: string): { kw: number | null; jahr: number | null } {
  const m = /^(\d{4})-(\d{1,2})$/.exec(key);
  return m ? { jahr: Number(m[1]), kw: Number(m[2]) } : { kw: null, jahr: null };
}

function kundendatenAusVorlage(v: BeilagenVorlage): Kundendaten {
  const kwKey = v.kw != null && v.jahr != null ? `${v.jahr}-${v.kw}` : '';
  let termine: TerminForm[] = vorlageTermine(v).map((t) => ({
    kwKey: `${t.jahr}-${t.kw}`,
    format: t.format ?? '',
    gewichtGStk: gewichtText(t.gewichtGStk),
    beilageAngeliefert: t.beilageAngeliefert !== false,
  }));
  // Ältere Dauerbestellungen ohne Termine: bisherige KW als ersten Termin.
  if (v.istDauervorlage && termine.length === 0 && kwKey) {
    termine = [{
      kwKey,
      format: v.format ?? '',
      gewichtGStk: gewichtText(v.gewichtGStk),
      beilageAngeliefert: v.beilageAngeliefert !== false,
    }];
  }
  return {
    termine,
    arbeitstitel: v.arbeitstitel ?? '',
    kundenname: v.kundenname ?? '',
    ansprechpartner: v.ansprechpartner ?? '',
    telefon: v.telefon ?? '',
    datum: v.datum ?? '',
    kwKey: v.istDauervorlage ? '' : kwKey,
    format: v.format ?? '',
    kennzeichen: v.kennzeichen ?? 'int',
    gewichtGStk: v.gewichtGStk ? String(v.gewichtGStk).replace('.', ',') : '',
    memo: v.memo ?? '',
    externerLink: v.externerLink ?? '',
    // Altbestände ohne Kennzeichen gelten als angeliefert.
    beilageAngeliefert: v.beilageAngeliefert !== false,
    istDauervorlage: !!v.istDauervorlage,
  };
}

const standVon = (k: Kundendaten, a: Set<string>) => JSON.stringify([k, [...a].sort()]);

function vorlagenLabel(v: BeilagenVorlage): string {
  const titel = [v.arbeitstitel, v.kundenname].filter(Boolean).join(' · ') || '(ohne Titel)';
  return v.istDauervorlage ? titel : `${titel} — ${vorlageKwLabel(v)}`;
}

type Variante = 'blanko' | 'ausgefuellt';

/** Auswahlzustand einer Menge von TGs: none / some / all. */
type Status = 'none' | 'some' | 'all';

const nf = (n: number) => n.toLocaleString('de-DE');
const nameSort = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });
const summe = (tgs: Teilgebiet[]) => tgs.reduce((s, tg) => s + (tg.stueckzahl || 0), 0);

/** "Uslar1" / "Uslar 2" → "Uslar" */
function ortAusName(name: string): string {
  return name.replace(/[\s\d_\-/.]+$/, '').trim() || name;
}

function statusVon(tgs: Teilgebiet[], auswahl: Set<string>): Status {
  let n = 0;
  for (const tg of tgs) if (auswahl.has(tg.id)) n++;
  if (n === 0) return 'none';
  return n === tgs.length ? 'all' : 'some';
}

function summeAuswahl(tgs: Teilgebiet[], auswahl: Set<string>): number {
  return tgs.reduce((s, tg) => s + (auswahl.has(tg.id) ? tg.stueckzahl || 0 : 0), 0);
}

// ── Screen ────────────────────────────────────────────────────────────────────

function VerteilplanInhalt() {
  const { teilgebiete, touren, parameter, userRole, abrechnungsperioden } = useApp();
  const istAdmin = userRole === 'admin';

  const [kunde, setKunde] = useState<Kundendaten>(leereKundendaten);
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  // Startansicht: alle Touren zugeklappt
  const [aufgeklappt, setAufgeklappt] = useState<Set<string>>(new Set());
  const [vorschau, setVorschau] = useState<Variante | null>(null);

  // ---- Beilagen-Auftragsvorlagen ----
  // Die geladene Vorlage steht in der URL (?vorlage=<id>) — so sind auch
  // archivierte Vorlagen per Link einsehbar.
  const [searchParams, setSearchParams] = useSearchParams();
  const vorlageId = searchParams.get('vorlage');
  const [vorlagen, setVorlagen] = useState<BeilagenVorlage[] | null>(null);
  const [speichern, setSpeichern] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler?: boolean } | null>(null);
  const [archivOffen, setArchivOffen] = useState(false);
  useEffect(() => beilagenVorlagenListener(setVorlagen), []);
  const aktiveVorlage = vorlageId ? vorlagen?.find((v) => v.id === vorlageId) ?? null : null;
  // Archivierte Bestellungen sind erledigt → schreibgeschützt (kein Speichern,
  // kein Löschen). Ändern nur nach „Aus Archiv holen" oder als Kopie.
  const gesperrt = !!aktiveVorlage?.archiviert;
  // Dauerbestellung: Index des Termins, der in einen Auftrag übernommen wird.
  const [gewaehlterTermin, setGewaehlterTermin] = useState(-1);

  // Stand beim Laden/Speichern — für den „ungespeichert"-Hinweis.
  const [gespeicherterStand, setGespeicherterStand] = useState(() => standVon(leereKundendaten(), new Set()));
  const geaendert = standVon(kunde, auswahl) !== gespeicherterStand;

  // Vorlage aus der URL einmalig in den Bearbeitungszustand laden.
  const geladeneVorlageId = useRef<string | null>(null);
  useEffect(() => {
    if (!vorlageId) {
      geladeneVorlageId.current = null;
      return;
    }
    if (geladeneVorlageId.current === vorlageId || !vorlagen || teilgebiete.length === 0) return;
    const v = vorlagen.find((x) => x.id === vorlageId);
    if (!v) return;
    geladeneVorlageId.current = vorlageId;
    const k = kundendatenAusVorlage(v);
    const a = new Set(vorlageTeilgebietIds(v, teilgebiete, touren));
    setKunde(k);
    setAuswahl(a);
    setGewaehlterTermin(vorgewaehlterTermin(k.termine, v, searchParams.get('kw')));
    setGespeicherterStand(standVon(k, a));
    setMeldung(null);
    // searchParams bewusst nicht als Abhängigkeit: nur beim Laden auswerten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vorlageId, vorlagen, teilgebiete, touren]);

  // Was wird übernommen? Normale Bestellung: die Auftragsdaten selbst;
  // Dauerbestellung: der gewählte Termin (KW/Format/Gewicht/Anlieferung).
  const auftragsTeil: TerminForm | null = kunde.istDauervorlage ? kunde.termine[gewaehlterTermin] ?? null : kunde;

  const fehlendeAngabenVon = (t: TerminForm | null) =>
    fehlendeAngabenFuerAuftrag(
      {
        ...(t ? kwKeyParse(t.kwKey) : { kw: null, jahr: null }),
        format: t?.format ?? '',
        gewichtGStk: gewichtZahl(t?.gewichtGStk ?? ''),
        kundenname: kunde.kundenname,
        arbeitstitel: kunde.arbeitstitel,
        beilageAngeliefert: t?.beilageAngeliefert,
      },
      auswahl.size,
    );
  // Was fehlt für die Übernahme in Aufträge? (steuert den grünen Knopf)
  const fehlendeAngaben = fehlendeAngabenVon(auftragsTeil);
  /**
   * Übernahme eines Dauerbestellungs-Termins (laut gespeicherter Bestellung).
   * Übernommene Termine sind fixiert: keine zweite Übernahme (sonst doppelter
   * Auftrag), keine Änderung von KW/Format/Gewicht/Anlieferung, kein Entfernen.
   */
  const uebernommeneKwKeys = new Set((aktiveVorlage?.uebernahmen ?? []).map((u) => `${u.jahr}-${u.kw}`));
  const terminUebernahme = (t: TerminForm) => {
    const { kw, jahr } = kwKeyParse(t.kwKey);
    return aktiveVorlage?.uebernahmen?.find((u) => u.kw === kw && u.jahr === jahr);
  };
  // Warum der Übernahme-Knopf gesperrt ist (null = Übernahme möglich).
  const uebernahmeSperrGrund: string | null = speichern
    ? ' '
    : aktiveVorlage?.archiviert
    ? 'Bereits übernommen und archiviert — für eine erneute Übernahme zuerst „↩ Aus Archiv holen".'
    : geaendert
    ? 'Bitte zuerst die Bestellung speichern.'
    : kunde.istDauervorlage && !auftragsTeil
    ? 'Bitte einen Termin (Kalenderwoche) wählen.'
    : kunde.istDauervorlage && auftragsTeil && terminUebernahme(auftragsTeil)
    ? 'Für diese KW wurde bereits ein Auftrag angelegt — eine zweite Übernahme ist nicht möglich.'
    : fehlendeAngaben.length > 0
    ? `⚠ Dafür fehlt noch: ${fehlendeAngaben.join(', ')}`
    : null;

  // Archiv (nur Admin): erledigte Bestellungen, jüngste zuerst.
  const archivierteVorlagen = useMemo(
    () =>
      (vorlagen ?? [])
        .filter((v) => v.archiviert)
        .sort((a, b) => (b.archiviertAm ?? b.aktualisiertAm ?? 0) - (a.archiviertAm ?? a.aktualisiertAm ?? 0)),
    [vorlagen],
  );

  const auswaehlbareVorlagen = useMemo(() => {
    const liste = (vorlagen ?? []).filter((v) => !v.archiviert);
    const titelSort = (a: BeilagenVorlage, b: BeilagenVorlage) => nameSort(vorlagenLabel(a), vorlagenLabel(b));
    return {
      dauer: liste.filter((v) => v.istDauervorlage).sort(titelSort),
      mitKw: liste
        .filter((v) => !v.istDauervorlage && v.kw != null)
        .sort((a, b) => (a.jahr ?? 0) - (b.jahr ?? 0) || (a.kw ?? 0) - (b.kw ?? 0) || titelSort(a, b)),
      ohneKw: liste.filter((v) => !v.istDauervorlage && v.kw == null).sort(titelSort),
    };
  }, [vorlagen]);

  function zuruecksetzen() {
    setSearchParams({});
    const k = leereKundendaten();
    setKunde(k);
    setAuswahl(new Set());
    setGewaehlterTermin(-1);
    setGespeicherterStand(standVon(k, new Set()));
  }

  // ---- Termine der Dauerbestellung ----
  function terminAendern(i: number, patch: Partial<TerminForm>) {
    setKunde((k) => ({ ...k, termine: k.termine.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  }

  /** Neuer Termin: ohne Angabe die KW nach dem letzten Termin (bzw. die aktuelle KW). */
  function terminHinzufuegen(kwKey?: string) {
    const liste = kunde.termine;
    const letzter = [...liste].sort((a, b) => kwKeySort(a.kwKey, b.kwKey)).at(-1);
    const heute = aktuellerKwKey();
    let key = kwKey;
    if (!key) {
      key = !letzter || kwKeySort(letzter.kwKey, heute) < 0 ? heute : naechsterKwKey(letzter.kwKey);
      while (liste.some((t) => t.kwKey === key)) key = naechsterKwKey(key);
    }
    // Format/Gewicht vom letzten Termin vorschlagen; Anlieferung erst bei Eingang.
    const neu: TerminForm = {
      kwKey: key,
      format: letzter?.format ?? '',
      gewichtGStk: letzter?.gewichtGStk ?? '',
      beilageAngeliefert: false,
    };
    setKunde((k) => ({ ...k, termine: [...k.termine, neu] }));
    setGewaehlterTermin(liste.length);
  }

  function terminEntfernen(i: number) {
    if (terminUebernahme(kunde.termine[i])) return;
    setKunde((k) => ({ ...k, termine: k.termine.filter((_, j) => j !== i) }));
    setGewaehlterTermin((g) => (g === i ? -1 : g > i ? g - 1 : g));
  }

  /** Beim Umschalten die KW-Angaben zwischen Einzel- und Dauerbestellung mitnehmen. */
  function dauerUmschalten(an: boolean) {
    if (an && kunde.termine.length === 0 && kunde.kwKey) {
      const { kwKey, format, gewichtGStk, beilageAngeliefert } = kunde;
      setKunde({ ...kunde, istDauervorlage: true, termine: [{ kwKey, format, gewichtGStk, beilageAngeliefert }] });
      setGewaehlterTermin(0);
    } else if (!an && !kunde.kwKey && kunde.termine.length > 0) {
      const t = kunde.termine[gewaehlterTermin] ?? kunde.termine[0];
      setKunde({ ...kunde, ...t, istDauervorlage: false });
    } else {
      setKunde({ ...kunde, istDauervorlage: an });
    }
  }

  function vorlageOeffnen(id: string | null) {
    if (geaendert && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    setMeldung(null);
    if (id) setSearchParams({ vorlage: id });
    else zuruecksetzen();
  }

  /**
   * Löst das Formular von der geladenen Bestellung: die Eingaben bleiben
   * stehen, gespeichert wird aber erst beim Klick auf „Bestellung speichern"
   * — und dann als neue Bestellung. Das Original bleibt unverändert.
   */
  function alsNeueBestellungVorbereiten() {
    setSearchParams({});
    setGespeicherterStand('');
    setMeldung({ text: 'Kopie vorbereitet — zum Anlegen auf „💾 Bestellung speichern" klicken.' });
  }

  async function vorlageSpeichern() {
    if (gesperrt) return;
    if (!kunde.arbeitstitel.trim() && !kunde.kundenname.trim()) {
      setMeldung({ text: 'Bitte Arbeitstitel oder Kundenname angeben.', fehler: true });
      return;
    }
    const termine: BeilagenVorlageTermin[] = [];
    if (kunde.istDauervorlage) {
      const keys = new Set<string>();
      for (const t of kunde.termine) {
        const p = kwKeyParse(t.kwKey);
        if (p.kw == null || p.jahr == null) continue;
        if (keys.has(t.kwKey)) {
          setMeldung({ text: `${kwLabel(p.kw, p.jahr)} ist doppelt eingetragen.`, fehler: true });
          return;
        }
        keys.add(t.kwKey);
        termine.push({
          kw: p.kw,
          jahr: p.jahr,
          format: t.format,
          gewichtGStk: gewichtZahl(t.gewichtGStk),
          beilageAngeliefert: t.beilageAngeliefert,
        });
      }
      termine.sort((a, b) => a.jahr - b.jahr || a.kw - b.kw);
    }
    // Dauerbestellung: KW/Format/Gewicht/Anlieferung stehen je Termin —
    // auf der Bestellung selbst nur die Werte des ersten Termins (Anzeige).
    const erster = termine[0];
    const gewicht = parseFloat(kunde.gewichtGStk.replace(',', '.'));
    const { kw, jahr } = kunde.istDauervorlage ? { kw: null, jahr: null } : kwKeyParse(kunde.kwKey);
    const daten = {
      arbeitstitel: kunde.arbeitstitel.trim(),
      kundenname: kunde.kundenname.trim(),
      ansprechpartner: kunde.ansprechpartner.trim() || undefined,
      telefon: kunde.telefon.trim() || undefined,
      datum: kunde.datum || undefined,
      kw,
      jahr,
      format: kunde.istDauervorlage ? erster?.format ?? '' : kunde.format,
      kennzeichen: kunde.kennzeichen,
      gewichtGStk: kunde.istDauervorlage
        ? erster?.gewichtGStk ?? 0
        : Number.isFinite(gewicht) && gewicht > 0 ? gewicht : 0,
      memo: kunde.memo.trim() || undefined,
      externerLink: kunde.externerLink.trim() || undefined,
      beilageAngeliefert: kunde.istDauervorlage ? erster?.beilageAngeliefert ?? true : kunde.beilageAngeliefert,
      istDauervorlage: kunde.istDauervorlage,
      termine,
      ...auswahlStruktur(auswahl, teilgebiete, touren),
    };
    setSpeichern(true);
    try {
      if (aktiveVorlage) {
        await aktualisiereBeilagenVorlage(aktiveVorlage.id, daten);
        setMeldung({ text: 'Bestellung gespeichert.' });
      } else {
        const id = await erstelleBeilagenVorlage({
          ...daten,
          archiviert: false,
          uebernahmen: [],
          quelle: 'verteilplan',
        });
        geladeneVorlageId.current = id; // Zustand ist bereits aktuell
        setSearchParams({ vorlage: id });
        setMeldung({ text: 'Neue Bestellung angelegt.' });
      }
      // Termine chronologisch anzeigen, gewählter Termin bleibt gewählt.
      const sortiert = [...kunde.termine].sort((a, b) => kwKeySort(a.kwKey, b.kwKey));
      const kNeu = { ...kunde, termine: sortiert };
      setGewaehlterTermin(sortiert.indexOf(kunde.termine[gewaehlterTermin]));
      setKunde(kNeu);
      setGespeicherterStand(standVon(kNeu, auswahl));
    } catch (err) {
      console.error(err);
      setMeldung({ text: 'Fehler beim Speichern.', fehler: true });
    } finally {
      setSpeichern(false);
    }
  }

  /**
   * Übernimmt die gespeicherte Bestellung als Beilagenauftrag in die Ausgabe
   * der gewählten KW — gleiche Wirkung wie „Beilage hinzufügen" → „Übernehmen"
   * in „Ausgaben & Beilagen". Die Bestellung wird dabei archiviert (außer
   * Dauerbestellungen). Bei Dauerbestellungen wird der gewählte Termin
   * (KW/Format/Gewicht) übernommen.
   */
  async function inAuftragUebernehmen() {
    const t = auftragsTeil;
    if (!aktiveVorlage || aktiveVorlage.archiviert || !t || fehlendeAngaben.length > 0 || !parameter) return;
    const { kw, jahr } = kwKeyParse(t.kwKey);
    if (kw == null || jahr == null) return;

    // Abgeschlossene Periode / Monatswechsel: dort sind Beilagen fixiert.
    const periode = abrechnungsperioden.find(
      (p) => p.jahr === jahr && p.kalenderwochen.includes(kw),
    );
    if (periode?.status === 'abgeschlossen' || periode?.monatswechselSnapshot) {
      setMeldung({
        text: `${kwLabel(kw, jahr)} gehört zu „${periode.bezeichnung}" — die Beilagen sind dort bereits fixiert. Übernahme nicht möglich.`,
        fehler: true,
      });
      return;
    }
    // Dauerbestellung: je KW nur ein Auftrag.
    if (aktiveVorlage.istDauervorlage && vorlageUebernommenFuer(aktiveVorlage, kw, jahr)) {
      setMeldung({ text: `Für ${kwLabel(kw, jahr)} wurde bereits ein Auftrag angelegt.`, fehler: true });
      return;
    }
    if (
      vorlageUebernommenFuer(aktiveVorlage, kw, jahr) &&
      !confirm(`Diese Bestellung wurde für ${kwLabel(kw, jahr)} bereits übernommen. Noch einmal übernehmen?`)
    ) {
      return;
    }

    setSpeichern(true);
    try {
      const tgIds = vorlageTeilgebietIds(aktiveVorlage, teilgebiete, touren);
      const ausgabeId = await getOrCreateAusgabe(jahr, kw, parameter);
      const beilageId = await erstelleBeilage({
        ausgabeId,
        // Ohne Arbeitstitel wird vereinfachend der Kundenname verwendet.
        arbeitstitel: kunde.arbeitstitel.trim() || kunde.kundenname.trim(),
        kundenname: kunde.kundenname.trim(),
        gewichtGStk: gewichtZahl(t.gewichtGStk),
        format: t.format,
        kennzeichen: kunde.kennzeichen,
        teilgebietIds: tgIds,
        vorlageId: aktiveVorlage.id,
      });
      await vorlageUebernahmeVermerken(aktiveVorlage, { beilageId, ausgabeId, kw, jahr });
      setMeldung({
        text:
          `Als Beilagenauftrag in ${kwLabel(kw, jahr)} übernommen (${tgIds.length} Teilgebiete, ` +
          `${nf(stueckzahlVon(tgIds, teilgebiete))} Stück). ` +
          (aktiveVorlage.istDauervorlage
            ? 'Dauerbestellung — bleibt verfügbar.'
            : 'Die Bestellung wurde archiviert.'),
      });
    } catch (err) {
      console.error(err);
      setMeldung({ text: 'Fehler bei der Übernahme.', fehler: true });
    } finally {
      setSpeichern(false);
    }
  }

  async function archivSetzen(archiviert: boolean) {
    if (!aktiveVorlage) return;
    await aktualisiereBeilagenVorlage(aktiveVorlage.id, {
      archiviert,
      archiviertAm: archiviert ? Date.now() : undefined,
    });
    setMeldung({ text: archiviert ? 'Bestellung archiviert.' : 'Bestellung wieder aktiv.' });
  }

  async function vorlageLoeschen() {
    if (!aktiveVorlage || gesperrt) return;
    if (!confirm(`Bestellung „${vorlagenLabel(aktiveVorlage)}" endgültig löschen?`)) return;
    await loescheBeilagenVorlage(aktiveVorlage.id);
    zuruecksetzen();
    setMeldung({ text: 'Bestellung gelöscht.' });
  }

  // KW-Auswahl ab kurz vor der aktuellen KW, unabhängig von angelegten Ausgaben.
  const kwOptionen = useMemo(() => kwAuswahlOptionen(kunde.kwKey, abrechnungsperioden), [kunde.kwKey, abrechnungsperioden]);

  // Nicht buchbare Gebiete ausblenden: TG selbst markiert oder seine Tour markiert.
  const aktiveTGs = useMemo(
    () => buchbareTeilgebiete(teilgebiete, touren).sort((a, b) => nameSort(a.name, b.name)),
    [teilgebiete, touren],
  );

  const tourGruppen: TourGruppe[] = useMemo(() => {
    const gruppen: TourGruppe[] = touren
      .filter((t) => !t.nichtImVerteilplan)
      .sort((a, b) => nameSort(a.name, b.name))
      .map((tour) => {
        const tgs = aktiveTGs.filter((tg) => tg.tourId === tour.id);
        return { key: tour.id, tour, label: `Tour ${tour.name}`, tgs, summe: summe(tgs) };
      });
    const tourIds = new Set(touren.map((t) => t.id));
    const ohne = aktiveTGs.filter((tg) => !tg.tourId || !tourIds.has(tg.tourId));
    gruppen.push({ key: '__ohne__', tour: null, label: 'Ohne Tour', tgs: ohne, summe: summe(ohne) });
    return gruppen.filter((g) => g.tgs.length > 0);
  }, [touren, aktiveTGs]);

  const plzGruppen: PlzGruppe[] = useMemo(() => {
    const map = new Map<string, Teilgebiet[]>();
    for (const tg of aktiveTGs) {
      const plz = tg.plz?.trim() || '—';
      if (!map.has(plz)) map.set(plz, []);
      map.get(plz)!.push(tg);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([plz, tgs]) => ({
        plz,
        orte: [...new Set(tgs.map((tg) => ortAusName(tg.name)))].sort(nameSort).join(', '),
        tgs,
        summe: summe(tgs),
      }));
  }, [aktiveTGs]);

  const gesamt = summe(aktiveTGs);
  const auswahlSumme = summeAuswahl(aktiveTGs, auswahl);
  // Verkaufspreis der Bestellung laut Parametern (netto/brutto) — bei
  // Dauerbestellungen je Verteilung des gewählten Termins.
  const preisGewicht = gewichtZahl(auftragsTeil?.gewichtGStk ?? '');
  const preis = berechneBeilagenPreis(
    {
      format: auftragsTeil?.format ?? '',
      kennzeichen: kunde.kennzeichen,
      gewichtGStk: preisGewicht,
      stueckzahl: auswahlSumme,
    },
    parameter,
  );
  const auswahlAnzahl = aktiveTGs.filter((tg) => auswahl.has(tg.id)).length;

  /** Setzt/entfernt eine Menge TGs: sind alle gewählt → abwählen, sonst alle wählen. */
  function toggleMenge(tgs: Teilgebiet[]) {
    if (gesperrt) return;
    setAuswahl((prev) => {
      const next = new Set(prev);
      const alle = tgs.every((tg) => next.has(tg.id));
      for (const tg of tgs) {
        if (alle) next.delete(tg.id);
        else next.add(tg.id);
      }
      return next;
    });
  }

  function toggleKlappe(key: string) {
    setAufgeklappt((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const alleAuf = tourGruppen.length > 0 && tourGruppen.every((g) => aufgeklappt.has(g.key));

  return (
    <>
    <div className="p-4 md:p-6 max-w-5xl mx-auto print:hidden">
      {/* Kopf */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Verteilplan — Bestellzettel</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Teilgebiete, Touren, PLZ-Bereiche oder das Gesamtgebiet anklicken — die Summe wird berechnet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => vorlageOeffnen(null)}
            disabled={!aktiveVorlage && !geaendert}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40"
            title="Alle Eingaben und die Auswahl zurücksetzen — für eine neue Bestellung"
          >
            🧹 Formular leeren
          </button>
          <button
            onClick={() => setVorschau('blanko')}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            📄 PDF blanko
          </button>
          <button
            onClick={() => setVorschau('ausgefuellt')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            🖨 PDF ausgefüllt
          </button>
        </div>
      </div>

      {/* Beilagen-Auftragsvorlage */}
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase mr-1">Bestellungen</span>
          <select
            value={aktiveVorlage && !aktiveVorlage.archiviert ? aktiveVorlage.id : ''}
            onChange={(e) => vorlageOeffnen(e.target.value || null)}
            className="flex-1 min-w-[14rem] border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">
              {aktiveVorlage?.archiviert ? `(archiviert) ${vorlagenLabel(aktiveVorlage)}` : '— neue Bestellung —'}
            </option>
            {auswaehlbareVorlagen.mitKw.length > 0 && (
              <optgroup label="Bestellt für Kalenderwoche">
                {auswaehlbareVorlagen.mitKw.map((v) => <option key={v.id} value={v.id}>{vorlagenLabel(v)}</option>)}
              </optgroup>
            )}
            {auswaehlbareVorlagen.dauer.length > 0 && (
              <optgroup label="Dauerbestellungen">
                {auswaehlbareVorlagen.dauer.map((v) => <option key={v.id} value={v.id}>{vorlagenLabel(v)}</option>)}
              </optgroup>
            )}
            {auswaehlbareVorlagen.ohneKw.length > 0 && (
              <optgroup label="Ohne Kalenderwoche">
                {auswaehlbareVorlagen.ohneKw.map((v) => <option key={v.id} value={v.id}>{vorlagenLabel(v)}</option>)}
              </optgroup>
            )}
          </select>
          {istAdmin && (
            <button
              onClick={() => setArchivOffen(true)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              title="Archivierte Bestellungen ansehen (nur Admin)"
            >
              🗄 Archiv ({archivierteVorlagen.length})
            </button>
          )}
          <button
            onClick={() => vorlageSpeichern()}
            disabled={speichern || gesperrt || (!!aktiveVorlage && !geaendert)}
            className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-40"
            title={gesperrt ? 'Archivierte Bestellungen können nicht geändert werden.' : undefined}
          >
            💾 Bestellung speichern
          </button>
          {aktiveVorlage && (
            <>
              <button
                onClick={alsNeueBestellungVorbereiten}
                disabled={speichern}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                title="Eingaben übernehmen und vom Original lösen — angelegt wird erst mit „Bestellung speichern“"
              >
                Als neue Bestellung
              </button>
              <button
                onClick={() => archivSetzen(!aktiveVorlage.archiviert)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {aktiveVorlage.archiviert ? '↩ Aus Archiv holen' : '🗄 Archivieren'}
              </button>
              <button
                onClick={vorlageLoeschen}
                disabled={gesperrt}
                className="px-3 py-1.5 text-sm text-red-600 hover:text-red-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-red-600"
                title={gesperrt ? 'Archivierte Bestellungen können nicht gelöscht werden.' : undefined}
              >
                Löschen
              </button>
            </>
          )}
        </div>
        {vorlageId && vorlagen && !aktiveVorlage && (
          <p className="mt-2 text-sm text-red-600">Die verlinkte Bestellung existiert nicht (mehr).</p>
        )}
        {aktiveVorlage?.archiviert && (
          <p className="mt-2 text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded px-3 py-1.5">
            🗄 Archiviert{aktiveVorlage.archiviertAm ? ` am ${new Date(aktiveVorlage.archiviertAm).toLocaleDateString('de-DE')}` : ''} —
            nicht mehr für neue Aufträge auswählbar, nur über diesen Link einsehbar.
            <b> Schreibgeschützt:</b> Speichern und Löschen sind gesperrt. Zum Ändern „↩ Aus Archiv holen" oder
            „Als neue Bestellung" (Kopie) verwenden.
          </p>
        )}
        {aktiveVorlage && (aktiveVorlage.uebernahmen?.length ?? 0) > 0 && (
          <p className="mt-2 text-xs text-gray-600">
            In Aufträge übernommen:{' '}
            {aktiveVorlage.uebernahmen!.map((u) => `${kwLabel(u.kw, u.jahr)} (${new Date(u.am).toLocaleDateString('de-DE')})`).join(', ')}
          </p>
        )}
        {aktiveVorlage && aktiveVorlage.stueckzahlGespeichert != null && aktiveVorlage.stueckzahlGespeichert !== auswahlSumme && !geaendert && (
          <p className="mt-2 text-xs text-blue-800">
            ℹ Stückzahl beim Speichern: {nf(aktiveVorlage.stueckzahlGespeichert)} — nach aktuellem Verteilplan: {nf(auswahlSumme)}.
          </p>
        )}
        {meldung && (
          <p className={`mt-2 text-sm ${meldung.fehler ? 'text-red-600' : 'text-green-700'}`}>{meldung.text}</p>
        )}
        {geaendert && !meldung?.fehler && (
          <p className="mt-2 text-xs text-amber-700">● Ungespeicherte Änderungen</p>
        )}
      </div>

      {/* Auftragsdaten */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-4">
        <div className="text-xs font-semibold text-gray-500 uppercase">Auftragsdaten</div>
        <fieldset disabled={gesperrt} className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 disabled:opacity-70">
          <Eingabe label="Arbeitstitel" value={kunde.arbeitstitel} placeholder="REWE Prospekt"
            onChange={(v) => setKunde({ ...kunde, arbeitstitel: v })} />
          <Eingabe label="Kundenname / Firma" value={kunde.kundenname} placeholder="REWE Uslar GmbH"
            onChange={(v) => setKunde({ ...kunde, kundenname: v })} />
          <Eingabe label="Ansprechpartner" value={kunde.ansprechpartner} placeholder="Max Mustermann"
            onChange={(v) => setKunde({ ...kunde, ansprechpartner: v })} />
          <Eingabe label="Telefon" value={kunde.telefon} placeholder="05571 12345"
            onChange={(v) => setKunde({ ...kunde, telefon: v })} />
          <Eingabe label="Datum" type="date" value={kunde.datum}
            onChange={(v) => setKunde({ ...kunde, datum: v })} />
          {/* Dauerbestellung: KW, Format, Gewicht und Anlieferung je Termin (siehe unten). */}
          {!kunde.istDauervorlage && (<>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kalenderwoche</label>
            <select
              value={kunde.kwKey}
              onChange={(e) => setKunde({ ...kunde, kwKey: e.target.value })}
              className={auswahlKlasse}
            >
              <option value="">— keine —</option>
              {kwOptionen.map((j) => (
                <optgroup key={j.jahr} label={String(j.jahr)}>
                  {j.kws.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Format der Beilage</label>
            <select
              value={kunde.format}
              onChange={(e) => setKunde({ ...kunde, format: e.target.value })}
              className={auswahlKlasse}
            >
              <option value="">— offen —</option>
              {BEILAGEN_FORMATE.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <Eingabe label="Gewicht (g/Stk)" value={kunde.gewichtGStk} placeholder="28"
            onChange={(v) => setKunde({ ...kunde, gewichtGStk: v })} />
          </>)}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Einlegen</label>
            <div className="flex gap-1.5">
              {(['int', 'ext'] as BeilagenKennzeichen[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKunde({ ...kunde, kennzeichen: k })}
                  className={`flex-1 py-1.5 text-xs rounded border ${
                    kunde.kennzeichen === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'
                  }`}
                  title={k === 'int' ? 'Wird im Betrieb eingelegt' : 'Austräger legt ein'}
                >
                  {k === 'int' ? '🏭 Intern' : '🚶 Extern'}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-2 md:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Memo (Besonderheiten zum Auftrag)</label>
            <textarea
              value={kunde.memo}
              onChange={(e) => setKunde({ ...kunde, memo: e.target.value })}
              rows={2}
              className={`${auswahlKlasse} resize-y`}
            />
            {/* Memo und Link sind interne Felder — sie erscheinen nicht im Ausdruck. */}
            <label className="block text-xs text-gray-500 mb-1 mt-2">Externer Link (z. B. Mail zur Bestellung)</label>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={kunde.externerLink}
                onChange={(e) => setKunde({ ...kunde, externerLink: e.target.value })}
                placeholder="https://… oder outlook:… / message:…"
                className={auswahlKlasse}
              />
              {kunde.externerLink.trim() && (
                <a
                  href={kunde.externerLink.trim()}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1.5"
                  title="Link in neuem Tab öffnen"
                >
                  🔗 öffnen
                </a>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Memo und Link stehen nicht im Ausdruck.</p>
          </div>
          {!kunde.istDauervorlage && (
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none self-end pb-1.5">
              <input
                type="checkbox"
                checked={kunde.beilageAngeliefert}
                onChange={(e) => setKunde({ ...kunde, beilageAngeliefert: e.target.checked })}
                className="w-4 h-4 accent-blue-600"
              />
              <span>
                Beilage angeliefert
                <span className="block text-[11px] text-gray-500">Voraussetzung für die Übernahme in Aufträge</span>
              </span>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none self-end pb-1.5">
            <input
              type="checkbox"
              checked={kunde.istDauervorlage}
              onChange={(e) => dauerUmschalten(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            <span>
              Dauerbestellung
              <span className="block text-[11px] text-gray-500">wiederkehrend in mehreren KWs — wird nach Übernahme nicht archiviert</span>
            </span>
          </label>
        </fieldset>
      </div>

      {/* Dauerbestellung: geplante Kalenderwochen. Je KW eigenes Format,
          Gewicht und Anlieferung; der Übernahme-Knopf steht in der Zeile des
          gewählten Termins, damit klar ist, welcher Teil übernommen wird. */}
      {kunde.istDauervorlage && (
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase">Termine der Dauerbestellung</div>
              <p className="text-xs text-gray-500 mt-0.5">
                Kalenderwochen, in denen die Beilage planmäßig gestreut wird — erscheinen in der Personalplanung als
                Bestellung. {aktiveVorlage && !gesperrt && 'Termin anklicken, um ihn in einen Auftrag zu übernehmen.'}
              </p>
            </div>
          </div>
          <fieldset disabled={gesperrt} className="mt-2 space-y-1.5">
            {kunde.termine.map((t, i) => {
              const gewaehlt = i === gewaehlterTermin;
              const uebernahme = terminUebernahme(t);
              // Übernommener Termin: KW/Format/Gewicht/Anlieferung fixiert.
              const fixiert = !!uebernahme;
              const istAktuell = t.kwKey === aktuellerKwKey();
              const doppelt = kunde.termine.some((x, j) => j !== i && x.kwKey === t.kwKey);
              return (
                <div
                  key={i}
                  onClick={() => setGewaehlterTermin(i)}
                  className={`flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border px-3 py-2 cursor-pointer ${
                    gewaehlt ? 'border-green-400 bg-green-50 ring-1 ring-green-400' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    checked={gewaehlt}
                    onChange={() => setGewaehlterTermin(i)}
                    className="w-4 h-4 accent-green-600 mb-2"
                    title="Diesen Termin für die Übernahme wählen"
                  />
                  <fieldset disabled={fixiert} className="contents">
                  <div className="w-44">
                    <label className="block text-[11px] text-gray-500 mb-0.5">
                      Kalenderwoche {istAktuell && <span className="text-green-700 font-semibold">· aktuell</span>}
                    </label>
                    <select
                      value={t.kwKey}
                      onChange={(e) => terminAendern(i, { kwKey: e.target.value })}
                      className={`${auswahlKlasse} ${doppelt ? 'border-red-400' : ''}`}
                    >
                      {kwAuswahlOptionen(t.kwKey, abrechnungsperioden).map((j) => (
                        <optgroup key={j.jahr} label={String(j.jahr)}>
                          {/* Bereits übernommene KWs sind für andere Termine nicht wählbar. */}
                          {j.kws
                            .filter((o) => fixiert || o.key === t.kwKey || !uebernommeneKwKeys.has(o.key))
                            .map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="w-36">
                    <label className="block text-[11px] text-gray-500 mb-0.5">Format</label>
                    <select
                      value={t.format}
                      onChange={(e) => terminAendern(i, { format: e.target.value })}
                      className={auswahlKlasse}
                    >
                      <option value="">— offen —</option>
                      {BEILAGEN_FORMATE.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                  <div className="w-24">
                    <label className="block text-[11px] text-gray-500 mb-0.5">Gewicht (g/Stk)</label>
                    <input
                      value={t.gewichtGStk}
                      onChange={(e) => terminAendern(i, { gewichtGStk: e.target.value })}
                      placeholder="28"
                      className={auswahlKlasse}
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 select-none pb-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={t.beilageAngeliefert}
                      onChange={(e) => terminAendern(i, { beilageAngeliefert: e.target.checked })}
                      className="w-4 h-4 accent-blue-600"
                    />
                    angeliefert
                  </label>
                  </fieldset>
                  {uebernahme && (
                    <span className="text-xs text-green-700 pb-2" title="Für diese KW wurde bereits ein Auftrag angelegt">
                      ✓ übernommen {new Date(uebernahme.am).toLocaleDateString('de-DE')}
                    </span>
                  )}
                  {doppelt && <span className="text-xs text-red-600 pb-2">KW doppelt</span>}
                  <div className="ml-auto flex items-end gap-2">
                    {gewaehlt && aktiveVorlage && (
                      <UebernahmeKnopf
                        onClick={inAuftragUebernehmen}
                        sperrGrund={uebernahmeSperrGrund}
                        klein
                      />
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); terminEntfernen(i); }}
                      disabled={fixiert}
                      className="text-gray-400 hover:text-red-600 text-sm px-1.5 pb-1.5 disabled:invisible"
                      title="Termin entfernen"
                    >
                      ✕
                    </button>
                  </div>
                  {gewaehlt && aktiveVorlage && uebernahmeSperrGrund && (
                    <div className="basis-full text-xs text-amber-700 pl-7">{uebernahmeSperrGrund}</div>
                  )}
                </div>
              );
            })}
            {kunde.termine.length === 0 && (
              <p className="text-sm text-gray-400">Noch keine Kalenderwochen geplant.</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => terminHinzufuegen()}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:hidden"
              >
                + Kalenderwoche hinzufügen
              </button>
              {!kunde.termine.some((t) => t.kwKey === aktuellerKwKey()) && (
                <button
                  type="button"
                  onClick={() => terminHinzufuegen(aktuellerKwKey())}
                  className="px-3 py-1.5 text-sm border border-green-300 bg-green-50 text-green-800 rounded-lg hover:bg-green-100 disabled:hidden"
                >
                  + aktuelle {kwLabel(getCurrentKW().kw, getCurrentKW().jahr)} hinzufügen
                </button>
              )}
            </div>
          </fieldset>
        </div>
      )}

      {/* Übernahme in Aufträge — bewusst unter den Eingabefeldern, weil es
          der abschließende Schritt ist. Archivierte Bestellungen sind
          erledigt und werden gesperrt (kein zweiter Auftrag). */}
      {aktiveVorlage && !kunde.istDauervorlage && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <UebernahmeKnopf onClick={inAuftragUebernehmen} sperrGrund={uebernahmeSperrGrund} />
          {uebernahmeSperrGrund ? (
            <span className={`text-xs ${aktiveVorlage.archiviert ? 'text-gray-500' : 'text-amber-700'}`}>
              {uebernahmeSperrGrund}
            </span>
          ) : (
            <span className="text-xs text-gray-500">
              Legt die Beilage in „Ausgaben & Beilagen" an und archiviert die Bestellung.
            </span>
          )}
        </div>
      )}

      {/* Preisermittlung (Verkaufspreis laut Parametern) */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 mb-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="text-xs font-semibold text-emerald-800 uppercase">
            {kunde.istDauervorlage
              ? `Preis je Verteilung${auftragsTeil ? ` (${vorlageKwLabel(kwKeyParse(auftragsTeil.kwKey))})` : ''}`
              : 'Preis der Bestellung'}
          </span>
          <span className="text-sm text-emerald-900">
            netto <b className="text-lg tabular-nums">{eur(preis.nettoEur)}</b>
          </span>
          <span className="text-sm text-emerald-900">
            zzgl. {preis.ustProzent.toLocaleString('de-DE')} % USt {eur(preis.ustEur)}
          </span>
          <span className="text-sm text-emerald-900">
            brutto <b className="text-lg tabular-nums">{eur(preis.bruttoEur)}</b>
          </span>
        </div>
        <div className="text-xs text-emerald-900/80 mt-1">
          {preis.basisLabel}: {eur(preis.basisEurProTausend)} je 1.000
          {preis.zusatzGramm > 0 && (
            <> · Gewichtszuschlag {preis.zusatzGramm} g über {preis.freigrenzeG} g: {eur(preis.zuschlagEurProTausend)} je 1.000</>
          )}
          {' '}· <b>{eur(preis.proTausendEur)} je 1.000</b> × {nf(auswahlSumme)} Stück
        </div>
        {(preis.unvollstaendig || auswahlSumme === 0 || preisGewicht <= 0) && (
          <div className="text-xs text-amber-800 mt-1">
            ⚠ Noch unvollständig:
            {preis.unvollstaendig && ' Format wählen.'}
            {preisGewicht <= 0 && ' Gewicht (g/Stk) eintragen — sonst ohne Gewichtszuschlag gerechnet.'}
            {auswahlSumme === 0 && ' Teilgebiete auswählen.'}
          </div>
        )}
      </div>

      {/* Auswahl-Leiste (klebt oben) */}
      <div className="sticky top-0 z-10 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 shadow-sm">
        <div className="text-sm text-blue-900">
          <span className="font-semibold">Auswahl:</span> {auswahlAnzahl} von {aktiveTGs.length} Teilgebieten
        </div>
        <div className="text-lg font-bold text-blue-900 tabular-nums">
          {nf(auswahlSumme)} <span className="text-sm font-normal">Stück</span>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setAufgeklappt(alleAuf ? new Set() : new Set(tourGruppen.map((g) => g.key)))}
            className="px-3 py-1 text-xs border border-blue-300 bg-white rounded hover:bg-blue-100"
          >
            {alleAuf ? '▸ Alle zuklappen' : '▾ Alle aufklappen'}
          </button>
          <button
            onClick={() => setAuswahl(new Set())}
            disabled={auswahl.size === 0 || gesperrt}
            className="px-3 py-1 text-xs border border-blue-300 bg-white rounded hover:bg-blue-100 disabled:opacity-40"
          >
            Auswahl leeren
          </button>
        </div>
      </div>

      {/* Verteilplan */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Gesamtgebiet */}
        <label className="flex items-center gap-3 px-3 py-2.5 bg-blue-700 text-white cursor-pointer select-none">
          <Checkbox status={statusVon(aktiveTGs, auswahl)} onChange={() => toggleMenge(aktiveTGs)} hell />
          <span className="font-semibold flex-1">Gesamtgebiet</span>
          <span className="text-xs opacity-80 w-24 text-right tabular-nums">
            {auswahlSumme > 0 ? `${nf(auswahlSumme)} gew.` : ''}
          </span>
          <span className="font-bold w-20 text-right tabular-nums">{nf(gesamt)}</span>
        </label>

        {tourGruppen.map((g) => {
          const offen = aufgeklappt.has(g.key);
          const gew = summeAuswahl(g.tgs, auswahl);
          const farbe = g.tour?.farbe ?? '#9ca3af';
          return (
            <div key={g.key} className="border-t border-gray-200">
              <div
                className="flex items-center gap-3 px-3 py-2 select-none"
                style={{ background: farbe + '22', borderLeft: `4px solid ${farbe}` }}
              >
                <Checkbox status={statusVon(g.tgs, auswahl)} onChange={() => toggleMenge(g.tgs)} />
                <button
                  onClick={() => toggleKlappe(g.key)}
                  className="flex-1 flex items-center gap-2 text-left font-semibold text-gray-800"
                >
                  <span className="inline-block w-4 text-gray-500">{offen ? '▾' : '▸'}</span>
                  {g.label}
                  <span className="text-xs font-normal text-gray-500">({g.tgs.length} TG)</span>
                </button>
                <span className="text-xs text-blue-700 w-24 text-right tabular-nums">
                  {gew > 0 ? `${nf(gew)} gew.` : ''}
                </span>
                <span className="font-bold text-gray-900 w-20 text-right tabular-nums">{nf(g.summe)}</span>
              </div>

              {offen && (
                <div>
                  {g.tgs.map((tg) => {
                    const an = auswahl.has(tg.id);
                    return (
                      <label
                        key={tg.id}
                        className={`flex items-center gap-3 pl-10 pr-3 py-1.5 border-t border-gray-100 cursor-pointer text-sm ${an ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <Checkbox status={an ? 'all' : 'none'} onChange={() => toggleMenge([tg])} />
                        <span className="flex-1 text-gray-800">{tg.name}</span>
                        <span className="w-16 text-gray-500 tabular-nums">{tg.plz}</span>
                        <span className="w-20 text-right tabular-nums text-gray-900">{nf(tg.stueckzahl || 0)}</span>
                      </label>
                    );
                  })}
                  <div className="flex items-center gap-3 pl-10 pr-3 py-1.5 border-t border-gray-200 bg-gray-50 text-sm">
                    <span className="flex-1 font-medium text-gray-600">Summe {g.label}</span>
                    <span className="text-xs text-blue-700 w-24 text-right tabular-nums">
                      {gew > 0 ? `${nf(gew)} gew.` : ''}
                    </span>
                    <span className="w-20 text-right font-bold tabular-nums">{nf(g.summe)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className="flex items-center gap-3 px-3 py-2.5 bg-blue-700 text-white border-t border-blue-800">
          <span className="w-5" />
          <span className="font-semibold flex-1">Summe Gesamtgebiet</span>
          <span className="text-xs opacity-80 w-24 text-right tabular-nums">
            {auswahlSumme > 0 ? `${nf(auswahlSumme)} gew.` : ''}
          </span>
          <span className="font-bold w-20 text-right tabular-nums">{nf(gesamt)}</span>
        </div>
      </div>

      {/* Summen je PLZ */}
      <h2 className="text-base font-semibold text-gray-900 mt-6 mb-2">Summen je Postleitzahl</h2>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2 w-10" />
              <th className="px-3 py-2 text-left">PLZ</th>
              <th className="px-3 py-2 text-left">
                Teilgebiete <span className="normal-case font-normal">(ausgewählte <b>fett</b>)</span>
              </th>
              <th className="px-3 py-2 text-right">TG</th>
              <th className="px-3 py-2 text-right">Ausgewählt</th>
              <th className="px-3 py-2 text-right">Stückzahl</th>
            </tr>
          </thead>
          <tbody>
            {plzGruppen.map((p) => {
              const gew = summeAuswahl(p.tgs, auswahl);
              const st = statusVon(p.tgs, auswahl);
              return (
                <tr
                  key={p.plz}
                  onClick={() => toggleMenge(p.tgs)}
                  className={`border-t border-gray-100 cursor-pointer ${st !== 'none' ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox status={st} onChange={() => toggleMenge(p.tgs)} />
                  </td>
                  <td className="px-3 py-1.5 font-medium tabular-nums">{p.plz}</td>
                  <td className="px-3 py-1.5 text-gray-500" title={p.orte}>
                    <TgNamen tgs={p.tgs} auswahl={auswahl} />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.tgs.length}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-blue-700">{gew > 0 ? nf(gew) : ''}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{nf(p.summe)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <td />
              <td className="px-3 py-2" colSpan={2}>Gesamt</td>
              <td className="px-3 py-2 text-right tabular-nums">{aktiveTGs.length}</td>
              <td className="px-3 py-2 text-right tabular-nums text-blue-700">{auswahlSumme > 0 ? nf(auswahlSumme) : ''}</td>
              <td className="px-3 py-2 text-right tabular-nums">{nf(gesamt)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

      {vorschau && (
        <DruckVorschau
          variante={vorschau}
          kunde={kunde}
          tourGruppen={tourGruppen}
          plzGruppen={plzGruppen}
          aktiveTGs={aktiveTGs}
          auswahl={auswahl}
          preis={preis}
          onVariante={setVorschau}
          onClose={() => setVorschau(null)}
        />
      )}

      {/* Archiv der erledigten Bestellungen — nur Admin */}
      <Modal
        isOpen={istAdmin && archivOffen}
        onClose={() => setArchivOffen(false)}
        title="Archiv — erledigte Bestellungen"
        size="lg"
      >
        <ArchivListe
          vorlagen={archivierteVorlagen}
          onOeffnen={(id) => {
            setArchivOffen(false);
            vorlageOeffnen(id);
          }}
        />
      </Modal>
    </>
  );
}

// ── Archiv ────────────────────────────────────────────────────────────────────

/**
 * Archivierte Bestellungen. Sie stehen bewusst NICHT in der Auswahlliste
 * (sonst wird sie mit der Zeit unbrauchbar lang) — dieses Fenster ist der
 * Zugang für den Admin. Ein Klick lädt die Bestellung wie ein Link
 * (?vorlage=<id>), sie bleibt dabei archiviert.
 */
function ArchivListe({
  vorlagen,
  onOeffnen,
}: {
  vorlagen: BeilagenVorlage[];
  onOeffnen: (id: string) => void;
}) {
  const [suche, setSuche] = useState('');
  const s = suche.trim().toLowerCase();
  const treffer = vorlagen.filter(
    (v) =>
      !s ||
      [v.arbeitstitel, v.kundenname, v.memo, vorlageKwLabel(v)].some((x) => x?.toLowerCase().includes(s)),
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Erledigte Bestellungen — nicht mehr für neue Aufträge auswählbar, aber jederzeit einsehbar.
      </p>
      <input
        type="search"
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
        placeholder="Suchen (Titel, Kunde, KW, Memo) …"
        className={auswahlKlasse}
        autoFocus
      />
      <div className="max-h-[55vh] overflow-y-auto space-y-1.5 pr-1">
        {treffer.map((v) => (
          <div key={v.id} className="border border-gray-200 rounded-lg px-3 py-2 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="font-medium text-gray-900">{v.arbeitstitel || '(ohne Arbeitstitel)'}</span>
                {v.kundenname && <span className="text-gray-500">· {v.kundenname}</span>}
                <span className="text-[11px] text-gray-500">{vorlageKwLabel(v)}</span>
                {v.istDauervorlage && (
                  <span className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Dauerbestellung</span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                archiviert{v.archiviertAm ? ` am ${new Date(v.archiviertAm).toLocaleDateString('de-DE')}` : ''}
                {(v.uebernahmen?.length ?? 0) > 0 &&
                  ` · übernommen: ${v.uebernahmen!.map((u) => kwLabel(u.kw, u.jahr)).join(', ')}`}
              </div>
              {v.memo && <div className="text-xs text-amber-800 mt-0.5 truncate" title={v.memo}>📝 {v.memo}</div>}
            </div>
            <button
              type="button"
              onClick={() => onOeffnen(v.id)}
              className="shrink-0 text-xs border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded px-2.5 py-1 font-medium"
            >
              Ansehen
            </button>
          </div>
        ))}
        {treffer.length === 0 && (
          <p className="text-sm text-gray-400">
            {vorlagen.length === 0 ? 'Noch keine archivierten Bestellungen.' : 'Keine Treffer.'}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Bildschirm-Hilfskomponenten ───────────────────────────────────────────────

/** TG-Namen einer PLZ; ausgewählte fett, damit die Auswahl auf einen Blick sichtbar ist. */
function TgNamen({ tgs, auswahl }: { tgs: Teilgebiet[]; auswahl: Set<string> | null }) {
  return (
    <>
      {tgs.map((tg, i) => (
        <span key={tg.id}>
          {i > 0 && ', '}
          {auswahl?.has(tg.id) ? <b style={{ color: '#111' }}>{tg.name}</b> : tg.name}
        </span>
      ))}
    </>
  );
}

/** „Bestellung in Auftrag übernehmen" — gesperrt, solange `sperrGrund` gesetzt ist. */
function UebernahmeKnopf({ onClick, sperrGrund, klein }: { onClick: () => void; sperrGrund: string | null; klein?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sperrGrund != null}
      className={`rounded-lg font-semibold shadow-sm ${klein ? 'px-4 py-2 text-sm' : 'px-6 py-3 text-base'} ${
        sperrGrund == null ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'
      }`}
      title={sperrGrund?.trim() || 'Als Beilagenauftrag in „Ausgaben & Beilagen" übernehmen'}
    >
      ➡ Bestellung in Auftrag übernehmen
    </button>
  );
}

function Checkbox({ status, onChange, hell }: { status: Status; onChange: () => void; hell?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = status === 'some';
  }, [status]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={status === 'all'}
      onChange={onChange}
      className={`w-5 h-5 cursor-pointer shrink-0 ${hell ? 'accent-white' : 'accent-blue-600'}`}
    />
  );
}

const auswahlKlasse =
  'w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

function Eingabe({
  label, value, onChange, placeholder, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

// ── Druck / PDF ───────────────────────────────────────────────────────────────

interface DruckProps {
  variante: Variante;
  kunde: Kundendaten;
  tourGruppen: TourGruppe[];
  plzGruppen: PlzGruppe[];
  aktiveTGs: Teilgebiet[];
  auswahl: Set<string>;
  /** Verkaufspreis der Auswahl — wird nur im ausgefüllten Plan gedruckt. */
  preis: BeilagenPreisErgebnis;
}

function DruckVorschau(props: DruckProps & { onVariante: (v: Variante) => void; onClose: () => void }) {
  const { variante, onVariante, onClose } = props;

  function drucken() {
    // Dateiname-Vorschlag für „Als PDF speichern"
    const alt = document.title;
    const kunde = props.kunde.kundenname.trim().replace(/[^\wäöüÄÖÜß-]+/g, '_');
    document.title = variante === 'blanko'
      ? 'Verteilplan_blanko'
      : `Verteilplan${kunde ? '_' + kunde : ''}_${props.kunde.datum}`;
    window.print();
    document.title = alt;
  }

  return (
    <>
      <style>{`
        @media screen {
          .vp-print-root { display: none; }
          .vp-sheet {
            width: 210mm; min-height: 297mm; margin: 0 auto 16px; padding: 10mm 20mm;
            background: white; box-shadow: 0 2px 12px rgba(0,0,0,.25); box-sizing: border-box;
          }
        }
        @media print {
          .vp-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .vp-print-root, .vp-print-root * { visibility: visible !important; }
          .vp-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          @page { size: A4 portrait; margin: 10mm 20mm; }
          .vp-sheet { width: auto; padding: 0; }
          .vp-t tr { break-inside: avoid; }
          .vp-tour-kopf { break-after: avoid; }
          .vp-block { break-inside: avoid; }
        }
        .vp-sheet { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; line-height: 1.2; color: #111; }
        table.vp-t { width: 125mm; max-width: 100%; border-collapse: collapse; font-size: 7pt; line-height: 1.15; }
        table.vp-t th {
          background: #1d4ed8; color: white; font-size: 6.5pt; font-weight: bold;
          padding: 0.8mm 1.5mm; text-align: left;
        }
        table.vp-t td { padding: 0.3mm 1.5mm; border-bottom: 1px solid #e5e7eb; }
        table.vp-t .r { text-align: right; font-variant-numeric: tabular-nums; }
        table.vp-t .c { text-align: center; width: 6mm; padding-top: 0; padding-bottom: 0; }
        .vp-box {
          display: inline-block; width: 2.6mm; height: 2.6mm; border: 1px solid #444;
          border-radius: 1px; vertical-align: middle; background: white;
          line-height: 2.5mm; text-align: center; font-size: 6pt; font-weight: bold; color: #1d4ed8;
        }
      `}</style>

      <div className="vp-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            {(['blanko', 'ausgefuellt'] as Variante[]).map((v) => (
              <button
                key={v}
                onClick={() => onVariante(v)}
                className={`px-3 py-1.5 ${variante === v ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50'}`}
              >
                {v === 'blanko' ? 'Blanko' : 'Ausgefüllt'}
              </button>
            ))}
          </div>
          <span className="text-gray-500 text-sm hidden md:inline">A4-Vorschau · Seitenumbruch erfolgt beim Drucken</span>
          <div className="ml-auto">
            <button
              onClick={drucken}
              className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              🖨 Drucken / Als PDF speichern
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-gray-300">
          <VerteilplanSheet {...props} />
        </div>
      </div>

      <div className="vp-print-root">
        <VerteilplanSheet {...props} />
      </div>
    </>
  );
}

function VerteilplanSheet({ variante, kunde, tourGruppen, plzGruppen, aktiveTGs, auswahl, preis }: DruckProps) {
  const voll = variante === 'ausgefuellt';
  const gesamt = summe(aktiveTGs);
  const gewGesamt = summeAuswahl(aktiveTGs, auswahl);

  /** Kästchen: blanko immer leer; ausgefüllt ✕ bei voller Auswahl, – bei Teilauswahl. */
  const box = (tgs: Teilgebiet[]) => {
    const st = voll ? statusVon(tgs, auswahl) : 'none';
    return <span className="vp-box">{st === 'all' ? '✕' : st === 'some' ? '–' : ''}</span>;
  };
  const gew = (tgs: Teilgebiet[]) => {
    if (!voll) return '';
    const s = summeAuswahl(tgs, auswahl);
    return s > 0 ? nf(s) : '';
  };

  const datum = voll && kunde.datum ? new Date(kunde.datum).toLocaleDateString('de-DE') : '';
  // Dauerbestellung: alle geplanten KWs; Format/Gewicht je Kombination.
  const teile: TerminForm[] = kunde.istDauervorlage
    ? [...kunde.termine].sort((a, b) => kwKeySort(a.kwKey, b.kwKey))
    : [kunde];
  const kwText = teile
    .filter((t) => t.kwKey)
    .map((t) => vorlageKwLabel(kwKeyParse(t.kwKey)))
    .join(', ');
  const formatGewichtText = [
    ...new Set(
      teile.map((t) => [formatLabel(t.format), t.gewichtGStk && `${t.gewichtGStk} g`].filter(Boolean).join(' · ')),
    ),
  ]
    .filter(Boolean)
    .join(' / ');

  return (
    <div className="vp-sheet">
      {/* Kopf */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #1d4ed8', paddingBottom: '1.5mm', marginBottom: '2.5mm' }}>
        <div>
          <div style={{ fontSize: '12pt', fontWeight: 'bold', color: '#1d4ed8' }}>Schlieper-Druck GmbH</div>
          <div style={{ fontSize: '6.5pt', color: '#555', marginTop: '0.3mm' }}>
            Tel. 05571 9203-0 · info@schlieper-druck.com · www.schlieper-druck.com
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11pt', fontWeight: 'bold' }}>Verteilplan</div>
          <div style={{ fontSize: '6.5pt', color: '#555' }}>Bestellzettel Beilagenverteilung · Tip aktuell</div>
        </div>
      </div>

      {/* Kundendaten */}
      <div className="vp-block" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: '5mm', rowGap: '1mm', marginBottom: '2mm' }}>
        <DruckFeld label="Kunde / Firma" value={voll ? kunde.kundenname : ''} />
        <DruckFeld label="Ansprechpartner" value={voll ? kunde.ansprechpartner : ''} />
        <DruckFeld label="Telefon" value={voll ? kunde.telefon : ''} />
        <DruckFeld label="Datum" value={datum} />
        <DruckFeld label="Kalenderwoche" value={voll ? kwText : ''} />
        <DruckFeld label="Format / Gewicht (g/Stk)" value={voll ? formatGewichtText : ''} />
      </div>

      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '3px', padding: '0.8mm 2mm', marginBottom: '2mm', fontSize: '6.5pt', color: '#1e40af' }}>
        {voll
          ? <>Ausgewählt: <b>{aktiveTGs.filter((tg) => auswahl.has(tg.id)).length} Teilgebiete</b> mit insgesamt <b>{nf(gewGesamt)} Stück</b>.</>
          : <>Bitte kreuzen Sie die gewünschten Teilgebiete, ganze Touren, PLZ-Bereiche oder das Gesamtgebiet an und senden Sie diesen Bogen zurück.</>}
      </div>

      {/* Verteilplan-Tabelle */}
      <table className="vp-t">
        <thead>
          <tr>
            <th className="c">✓</th>
            <th>Teilgebiet</th>
            <th style={{ width: '18mm' }}>PLZ</th>
            <th className="r" style={{ width: '22mm' }}>Stückzahl</th>
            <th className="r" style={{ width: '24mm' }}>Bestellmenge</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: '#dbeafe', fontWeight: 'bold' }}>
            <td className="c">{box(aktiveTGs)}</td>
            <td colSpan={2}>Gesamtgebiet</td>
            <td className="r">{nf(gesamt)}</td>
            <td className="r">{gew(aktiveTGs)}</td>
          </tr>
          {tourGruppen.map((g) => {
            const farbe = g.tour?.farbe ?? '#9ca3af';
            return [
              <tr key={`k-${g.key}`} className="vp-tour-kopf" style={{ background: farbe + '2a' }}>
                <td className="c" style={{ borderLeft: `3px solid ${farbe}` }}>{box(g.tgs)}</td>
                <td colSpan={2} style={{ fontWeight: 'bold' }}>
                  {g.label} <span style={{ fontWeight: 'normal', color: '#666', fontSize: '6pt' }}>({g.tgs.length} Teilgebiete)</span>
                </td>
                <td className="r" style={{ fontWeight: 'bold' }}>{nf(g.summe)}</td>
                <td className="r" style={{ fontWeight: 'bold' }}>{gew(g.tgs)}</td>
              </tr>,
              ...g.tgs.map((tg) => (
                <tr key={tg.id}>
                  <td className="c">{box([tg])}</td>
                  <td style={{ paddingLeft: '4mm' }}>{tg.name}</td>
                  <td>{tg.plz}</td>
                  <td className="r">{nf(tg.stueckzahl || 0)}</td>
                  <td className="r">{gew([tg])}</td>
                </tr>
              )),
              <tr key={`s-${g.key}`} style={{ background: '#f3f4f6' }}>
                <td className="c" />
                <td colSpan={2} style={{ fontStyle: 'italic', color: '#444' }}>Summe {g.label}</td>
                <td className="r" style={{ fontWeight: 'bold' }}>{nf(g.summe)}</td>
                <td className="r" style={{ fontWeight: 'bold' }}>{gew(g.tgs)}</td>
              </tr>,
            ];
          })}
          <tr style={{ background: '#1d4ed8', color: 'white', fontWeight: 'bold', fontSize: '7.5pt' }}>
            <td className="c" />
            <td colSpan={2}>Summe Gesamtgebiet</td>
            <td className="r">{nf(gesamt)}</td>
            <td className="r">{voll ? nf(gewGesamt) : ''}</td>
          </tr>
        </tbody>
      </table>

      {/* Summen je PLZ */}
      <div style={{ fontSize: '8.5pt', fontWeight: 'bold', margin: '3mm 0 1mm', breakAfter: 'avoid' }}>
        Summen je Postleitzahl
      </div>
      <table className="vp-t" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th className="c">✓</th>
            <th style={{ width: '18mm' }}>PLZ</th>
            <th>Teilgebiete</th>
            <th className="r" style={{ width: '12mm' }}>TG</th>
            <th className="r" style={{ width: '22mm' }}>Stückzahl</th>
            <th className="r" style={{ width: '24mm' }}>Bestellmenge</th>
          </tr>
        </thead>
        <tbody>
          {plzGruppen.map((p) => (
            <tr key={p.plz}>
              <td className="c">{box(p.tgs)}</td>
              <td style={{ fontWeight: 'bold' }}>{p.plz}</td>
              <td style={{ color: '#555' }}>
                <TgNamen tgs={p.tgs} auswahl={voll ? auswahl : null} />
              </td>
              <td className="r">{p.tgs.length}</td>
              <td className="r">{nf(p.summe)}</td>
              <td className="r">{gew(p.tgs)}</td>
            </tr>
          ))}
          <tr style={{ background: '#1d4ed8', color: 'white', fontWeight: 'bold' }}>
            <td className="c" />
            <td colSpan={2}>Gesamt</td>
            <td className="r">{aktiveTGs.length}</td>
            <td className="r">{nf(gesamt)}</td>
            <td className="r">{voll ? nf(gewGesamt) : ''}</td>
          </tr>
        </tbody>
      </table>

      {/* Preis — nur im ausgefüllten Plan (der Blanko-Bogen bleibt preisfrei) */}
      {voll && (
        <div className="vp-block" style={{ marginTop: '3mm' }}>
          <div style={{ fontSize: '8.5pt', fontWeight: 'bold', marginBottom: '1mm' }}>Preis</div>
          <table className="vp-t" style={{ width: '105mm' }}>
            <tbody>
              <tr>
                <td>{preis.basisLabel}</td>
                <td className="r" style={{ width: '30mm' }}>{eur(preis.basisEurProTausend)} je 1.000</td>
              </tr>
              {preis.zusatzGramm > 0 && (
                <tr>
                  <td>
                    Jedes weitere angefangene 1g über {preis.freigrenzeG} g
                    {kunde.gewichtGStk && ` (${kunde.gewichtGStk} g/Stk)`} — {preis.zusatzGramm} g
                  </td>
                  <td className="r">{eur(preis.zuschlagEurProTausend)} je 1.000</td>
                </tr>
              )}
              <tr style={{ background: '#f3f4f6' }}>
                <td style={{ fontWeight: 'bold' }}>
                  Preis je 1.000 Stück × {nf(preis.stueckzahl)} Stück
                </td>
                <td className="r" style={{ fontWeight: 'bold' }}>{eur(preis.proTausendEur)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold' }}>Summe netto</td>
                <td className="r" style={{ fontWeight: 'bold' }}>{eur(preis.nettoEur)}</td>
              </tr>
              <tr>
                <td>zzgl. {preis.ustProzent.toLocaleString('de-DE')} % Umsatzsteuer</td>
                <td className="r">{eur(preis.ustEur)}</td>
              </tr>
              <tr style={{ background: '#1d4ed8', color: 'white', fontWeight: 'bold', fontSize: '8pt' }}>
                <td>Gesamtpreis brutto</td>
                <td className="r">{eur(preis.bruttoEur)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: '6pt', color: '#666', marginTop: '0.8mm' }}>
            Alle Preise gelten je angefangene 1.000 Stück. Angebotspreis — maßgeblich ist die
            Auftragsbestätigung.
          </div>
        </div>
      )}

      {/* Unterschrift */}
      <div className="vp-block" style={{ marginTop: voll ? '6mm' : '9mm', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15mm' }}>
        <div style={{ borderTop: '1px solid #555', paddingTop: '0.8mm', fontSize: '6.5pt', color: '#555' }}>
          Unterschrift Kunde / Datum
        </div>
        <div style={{ borderTop: '1px solid #555', paddingTop: '0.8mm', fontSize: '6.5pt', color: '#555' }}>
          Schlieper-Druck GmbH — Auftragsannahme
        </div>
      </div>
    </div>
  );
}

function DruckFeld({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '5.5pt', color: '#888', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</div>
      <div style={{ borderBottom: '1px solid #aaa', minHeight: '4.2mm', fontSize: '8pt', paddingTop: '0.2mm' }}>
        {value || ' '}
      </div>
    </div>
  );
}
