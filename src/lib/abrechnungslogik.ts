// Kern-Abrechnungslogik für eine Abrechnungsperiode

import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  Mitarbeiter,
  Teilgebiet,
  TeilgebietSnapshot,
  Ausgabe,
  Beilage,
  Einsatz,
  Abrechnungsperiode,
  Parameter,
  Sondervereinbarung,
  Fahrt,
} from '../types';
import {
  berechneAustraegerLohn,
  ermittleStundenlohn,
  type AustraegerLohnDetail,
} from './berechnung';
import { berechneNettoMinuten } from './zeiterfassung';
import type { Arbeitszeit, ZusammentragenEinsatz } from '../types';

// ---- Ergebnistypen -----------------------------------------

export interface AustraegerEinsatzErgebnis {
  kw: number;
  jahr: number;
  teilgebietId: string;
  teilgebietName: string;
  typ: 'standard' | 'springer';
  detail: AustraegerLohnDetail;
}

export interface ZusammentragenErgebnis {
  ausgabeId: string;
  kw: number;
  stapelBearbeitet: number;
  istVorarbeit: boolean;
  lohn: number;
  stunden?: number;
}

export interface MitarbeiterAbrechnung {
  mitarbeiter: Mitarbeiter;
  // Austräger
  austraegerEinsaetze: AustraegerEinsatzErgebnis[];
  austraegerGesamt: number;
  // Zusammentragen
  zusammentragenEinsaetze: ZusammentragenErgebnis[];
  zusammentragenGesamt: number;
  // Zeiterfassung (tatsächliche Zeiten)
  arbeitszeiten: Arbeitszeit[];
  zeitStunden: number;
  zeitLohn: number;
  // Fixes Gehalt
  fixesGehalt: number;
  // Fahrtkosten (neue Fahrt-Erfassung)
  fahrten: Fahrt[];
  fahrtSatzEurProKm: number;       // Verwendeter Kilometersatz
  fahrtkostenGesamt: number;       // Betrag in EUR (für Abwärtskompatibilität in UI)
  // Gesamt
  gesamt: number;
}

// ---- Daten für eine Periode laden --------------------------

export interface PeriodeData {
  ausgaben: Ausgabe[];
  beilagen: Beilage[];
  einsaetze: Einsatz[];
  arbeitszeiten: Arbeitszeit[];
  zusammentragenEinsaetze: ZusammentragenEinsatz[];
  fahrten: Fahrt[];
  sondervereinbarungen: Sondervereinbarung[];
}

export async function ladePeriodeData(
  periode: Abrechnungsperiode
): Promise<PeriodeData> {
  const kwSet = new Set(periode.kalenderwochen);

  // Alle Ausgaben dieser Periode
  const ausgabenSnap = await getDocs(
    query(
      collection(db, 'ausgaben'),
      where('jahr', '==', periode.jahr),
      where('kw', 'in', [...kwSet].length > 0 ? [...kwSet] : [-1])
    )
  );
  const ausgaben = ausgabenSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Ausgabe)
  );
  const ausgabeIds = ausgaben.map((a) => a.id);

  // Alle Einsätze dieser Ausgaben
  let einsaetze: Einsatz[] = [];
  if (ausgabeIds.length > 0) {
    for (let i = 0; i < ausgabeIds.length; i += 30) {
      const chunk = ausgabeIds.slice(i, i + 30);
      const snap = await getDocs(
        query(collection(db, 'einsaetze'), where('ausgabeId', 'in', chunk))
      );
      einsaetze.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() } as Einsatz)));
    }
  }

  // Beilagen dieser Ausgaben
  let beilagen: Beilage[] = [];
  if (ausgabeIds.length > 0) {
    for (let i = 0; i < ausgabeIds.length; i += 30) {
      const chunk = ausgabeIds.slice(i, i + 30);
      const snap = await getDocs(
        query(collection(db, 'beilagen'), where('ausgabeId', 'in', chunk))
      );
      beilagen.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() } as Beilage)));
    }
  }

  // Arbeitszeiten des Perioden-Monats
  const von = new Date(periode.jahr, periode.monat - 1, 1).getTime();
  const bis = new Date(periode.jahr, periode.monat, 1).getTime();
  const azSnap = await getDocs(
    query(
      collection(db, 'arbeitszeiten'),
      where('startTime', '>=', von),
      where('startTime', '<', bis),
      orderBy('startTime', 'asc')
    )
  );
  const arbeitszeiten = azSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Arbeitszeit)
  );

  // Zusammentragen-Einsätze dieser Ausgaben
  let zusammentragenEinsaetze: ZusammentragenEinsatz[] = [];
  if (ausgabeIds.length > 0) {
    for (let i = 0; i < ausgabeIds.length; i += 30) {
      const chunk = ausgabeIds.slice(i, i + 30);
      const snap = await getDocs(
        query(collection(db, 'zusammentragezeiten'), where('ausgabeId', 'in', chunk))
      );
      zusammentragenEinsaetze.push(
        ...snap.docs.map((d) => ({ id: d.id, ...d.data() } as ZusammentragenEinsatz))
      );
    }
  }

  // Fahrten dieser Abrechnungsperiode
  const fahrtenSnap = await getDocs(
    query(collection(db, 'fahrten'), where('abrechnungsperiodeId', '==', periode.id))
  );
  const fahrten = fahrtenSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Fahrt)
  );

  // Sondervereinbarungen (alle, gefiltert in der Berechnung)
  const svSnap = await getDocs(collection(db, 'sondervereinbarungen'));
  const sondervereinbarungen = svSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Sondervereinbarung)
  );

  return { ausgaben, beilagen, einsaetze, arbeitszeiten, zusammentragenEinsaetze, fahrten, sondervereinbarungen };
}

// ---- Abrechnung berechnen ----------------------------------

export function berechneAbrechnung(
  mitarbeiterListe: Mitarbeiter[],
  teilgebiete: Teilgebiet[] | TeilgebietSnapshot[],
  data: PeriodeData,
  params: Parameter,
  periode?: Abrechnungsperiode
): MitarbeiterAbrechnung[] {
  // Parameter-Snapshot der Periode bevorzugen (historische Richtigkeit)
  const effParams: Parameter = periode?.paramSnapshot
    ? { ...params, ...periode.paramSnapshot }
    : params;

  // Snapshot-Teilgebiete bevorzugen wenn vorhanden (historische Richtigkeit)
  const effTeilgebiete: (Teilgebiet | TeilgebietSnapshot)[] =
    periode?.periodeSnapshot?.teilgebietSnapshots?.length
      ? periode.periodeSnapshot.teilgebietSnapshots
      : teilgebiete;

  const ergebnisse: MitarbeiterAbrechnung[] = [];

  for (const ma of mitarbeiterListe) {
    if (!ma.isActive) continue;

    // --- Austräger ---
    const austraegerEinsaetze: AustraegerEinsatzErgebnis[] = [];

    if (ma.rollen.includes('austräger')) {
      // Explizite Einsätze (Springer)
      const springerEinsaetze = data.einsaetze.filter(
        (e) => e.mitarbeiterId === ma.id && e.typ === 'springer'
      );

      for (const einsatz of springerEinsaetze) {
        const ausgabe = data.ausgaben.find((a) => a.id === einsatz.ausgabeId);
        const tg = effTeilgebiete.find((t) => t.id === einsatz.teilgebietId);
        if (!ausgabe || !tg) continue;

        const beilagenFuerAusgabe = data.beilagen.filter(
          (b) => b.ausgabeId === ausgabe.id
        );
        const sv = data.sondervereinbarungen.find(
          (s) => s.mitarbeiterId === ma.id && s.teilgebietId === tg.id
        );

        const detail = berechneAustraegerLohn(
          ma, tg as Teilgebiet, ausgabe, beilagenFuerAusgabe, einsatz, sv, effParams
        );
        austraegerEinsaetze.push({
          kw: einsatz.kw,
          jahr: einsatz.jahr,
          teilgebietId: tg.id,
          teilgebietName: tg.name,
          typ: 'springer',
          detail,
        });
      }

      // Standardausträger-Einsätze (Teilgebiete wo dieser MA Standardausträger ist)
      const meineGebiete = effTeilgebiete.filter(
        (tg) => (tg as Teilgebiet).standardAustraegerId === ma.id &&
                (tg as Teilgebiet).isActive !== false
      );

      for (const tg of meineGebiete) {
        for (const ausgabe of data.ausgaben) {
          // Prüfe ob in dieser Ausgabe ein anderer Einsatz hinterlegt ist
          const expliziterEinsatz = data.einsaetze.find(
            (e) => e.ausgabeId === ausgabe.id && e.teilgebietId === tg.id
          );

          if (expliziterEinsatz) {
            if (
              expliziterEinsatz.typ === 'ausfall' ||
              expliziterEinsatz.typ === 'ungeklärt' ||
              expliziterEinsatz.typ === 'springer'
            ) {
              continue;
            }
          }

          // Standard-Einsatz: MA hat ausgetragen
          const fakeEinsatz: Einsatz = {
            id: '',
            ausgabeId: ausgabe.id,
            kw: ausgabe.kw,
            jahr: ausgabe.jahr,
            teilgebietId: tg.id,
            mitarbeiterId: ma.id,
            typ: 'standard',
            erstelltAm: 0,
            aktualisiertAm: 0,
          };

          const beilagenFuerAusgabe = data.beilagen.filter(
            (b) => b.ausgabeId === ausgabe.id
          );
          const sv = data.sondervereinbarungen.find(
            (s) => s.mitarbeiterId === ma.id && s.teilgebietId === tg.id
          );

          // BUG-FIX: effParams statt params (historisch korrekte Parameter)
          const detail = berechneAustraegerLohn(
            ma, tg as Teilgebiet, ausgabe, beilagenFuerAusgabe, fakeEinsatz, sv, effParams
          );
          austraegerEinsaetze.push({
            kw: ausgabe.kw,
            jahr: ausgabe.jahr,
            teilgebietId: tg.id,
            teilgebietName: tg.name,
            typ: 'standard',
            detail,
          });
        }
      }
    }

    const austraegerGesamt = austraegerEinsaetze.reduce(
      (s, e) => s + e.detail.gesamt, 0
    );

    // --- Zusammentragen ---
    const maZusammen = data.zusammentragenEinsaetze.filter(
      (z) => z.mitarbeiterId === ma.id
    );
    const zusammentragenEinsaetze: ZusammentragenErgebnis[] = [];
    const stundenlohn = ermittleStundenlohn(ma, effParams);

    for (const z of maZusammen) {
      const ausgabe = data.ausgaben.find((a) => a.id === z.ausgabeId);
      if (!ausgabe) continue;

      // BUG-FIX: vorarbeitMinuten != null && > 0 (0 wäre falsy ohne diesen Fix)
      if (z.istVorarbeit && z.vorarbeitMinuten != null && z.vorarbeitMinuten > 0) {
        // Vorarbeit: manuell eingegebene Zeit × Stundenlohn
        const stunden = z.vorarbeitMinuten / 60;
        const lohn = stunden * stundenlohn;
        zusammentragenEinsaetze.push({
          ausgabeId: z.ausgabeId,
          kw: ausgabe.kw,
          stapelBearbeitet: z.stapelBearbeitet,
          istVorarbeit: true,
          lohn,
          stunden,
        });
      } else if (!z.istVorarbeit) {
        // Normales Zusammentragen: Stapel × 0.25h × Stundenlohn
        const lohn = z.stapelBearbeitet * 0.25 * stundenlohn;
        zusammentragenEinsaetze.push({
          ausgabeId: z.ausgabeId,
          kw: ausgabe.kw,
          stapelBearbeitet: z.stapelBearbeitet,
          istVorarbeit: false,
          lohn,
        });
      }
    }
    const zusammentragenGesamt = zusammentragenEinsaetze.reduce(
      (s, z) => s + z.lohn, 0
    );

    // --- Zeiterfassung ---
    const maArbeitszeiten = data.arbeitszeiten.filter(
      (a) =>
        a.mitarbeiterId === ma.id &&
        a.status === 'abgeschlossen' &&
        !ma.rollen.includes('austräger') // Austräger werden rechnerisch abgerechnet
    );
    const zeitMinuten = maArbeitszeiten.reduce(
      (s, a) => s + berechneNettoMinuten(a), 0
    );
    const zeitStunden = zeitMinuten / 60;
    const zeitLohn = zeitStunden * stundenlohn;

    // --- Fixes Gehalt ---
    const fixesGehalt =
      ma.abrechnungstyp === 'fix' || ma.abrechnungstyp === 'beides'
        ? (ma.fixesGehalt ?? 0)
        : 0;

    // --- Fahrtkosten (neue Fahrt-Erfassung) ---
    const maFahrten = data.fahrten.filter((f) => f.mitarbeiterId === ma.id);
    const fahrtSatz = ma.fahrkostenEurProKm ?? effParams.fahrkostenEurProKm ?? 0.30;
    const fahrtkostenGesamt = maFahrten.reduce(
      (s, f) => s + f.streckKm * fahrtSatz, 0
    );

    // --- Gesamt ---
    const gesamt =
      austraegerGesamt +
      zusammentragenGesamt +
      zeitLohn +
      fixesGehalt +
      fahrtkostenGesamt;

    // BUG-FIX: Auch reine Zusammenträger aufnehmen (keine Austräger-Einsätze, keine AZ)
    if (
      gesamt > 0 ||
      austraegerEinsaetze.length > 0 ||
      zusammentragenEinsaetze.length > 0 ||
      maArbeitszeiten.length > 0
    ) {
      ergebnisse.push({
        mitarbeiter: ma,
        austraegerEinsaetze,
        austraegerGesamt,
        zusammentragenEinsaetze,
        zusammentragenGesamt,
        arbeitszeiten: maArbeitszeiten,
        zeitStunden,
        zeitLohn,
        fixesGehalt,
        fahrten: maFahrten,
        fahrtSatzEurProKm: fahrtSatz,
        fahrtkostenGesamt,
        gesamt,
      });
    }
  }

  return ergebnisse.sort((a, b) =>
    a.mitarbeiter.name.localeCompare(b.mitarbeiter.name)
  );
}

// ---- Formatierung ------------------------------------------

export function eur(betrag: number): string {
  return betrag.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
  });
}

export function stdMin(stunden: number): string {
  const h = Math.floor(stunden);
  const m = Math.round((stunden - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')} h`;
}
