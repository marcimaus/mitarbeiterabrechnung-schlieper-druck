// Teilgebiets-Auswertung für Interessenten
// ------------------------------------------------------------
// Beschreibt ein Teilgebiet und rechnet die Verdienstmöglichkeit beim
// Austragen hoch — je Ausgabe und für einen Durchschnittsmonat. Grundlage
// sind die ECHTEN Ausgaben (Seitenzahl, Papier) und Beilagen (Anzahl,
// Gewicht, int/ext) der vergangenen Abrechnungsperioden, kombiniert mit den
// AKTUELLEN Stammdaten des Teilgebiets (Stückzahl, Wegstrecke) und den
// aktuell gültigen Parametern (Geschwindigkeiten, Stundenlöhne, Zulagen).
//
// Die Formeln sind dieselben wie in der Lohnberechnung
// (berechneAustraegerLohn): Soll-Zeit aus Wegstrecke + Stückzahl + externen
// Beilagen × Stundenlohn, plus Gewichtszulagen Anzeigenblatt/Beilagen, plus
// optional Bonus Zeiterfassung. Springer-Zuschläge und Sondervereinbarungen
// spielen für einen neuen Austräger keine Rolle und bleiben außen vor.

import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { Abrechnungsperiode, Ausgabe, Beilage, Parameter, Teilgebiet } from '../types';
import {
  berechneAustraegezeit,
  berechneGewichtProExemplarG,
  berechneGewichtAnzeigenblattKg,
  berechneGewichtBeilagenKg,
} from './berechnung';
import { istInSaisonpauseFuer } from './saison';

export interface PeriodeAusgabenDaten {
  periode: Abrechnungsperiode;
  ausgaben: Ausgabe[];
  beilagen: Beilage[];
}

/**
 * Lädt nur Ausgaben + Beilagen der Perioden — bewusst schlanker als
 * `ladePeriodeData` (keine Arbeitszeiten, Fahrten, Einsätze …), weil hier
 * mehrere Monate auf einmal ausgewertet werden.
 */
export async function ladeAusgabenUndBeilagen(
  perioden: Abrechnungsperiode[]
): Promise<PeriodeAusgabenDaten[]> {
  return Promise.all(
    perioden.map(async (periode) => {
      const kws = periode.kalenderwochen ?? [];
      if (kws.length === 0) return { periode, ausgaben: [], beilagen: [] };
      const ausgabenSnap = await getDocs(
        query(
          collection(db, 'ausgaben'),
          where('jahr', '==', periode.jahr),
          where('kw', 'in', kws.slice(0, 30))
        )
      );
      const ausgaben = ausgabenSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Ausgabe))
        .sort((a, b) => a.kw - b.kw);
      const ids = ausgaben.map((a) => a.id);
      const beilagen: Beilage[] = [];
      for (let i = 0; i < ids.length; i += 30) {
        const snap = await getDocs(
          query(collection(db, 'beilagen'), where('ausgabeId', 'in', ids.slice(i, i + 30)))
        );
        beilagen.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() } as Beilage)));
      }
      return { periode, ausgaben, beilagen };
    })
  );
}

// ---- Ergebnistypen -----------------------------------------

/** Verdienst-Beträge, die vom Stundenlohn abhängen — für beide Altersgruppen. */
export interface LohnPaar {
  erwachsene: number;
  minderjaehrige: number;
}

export interface TgAusgabeZeile {
  ausgabeId: string;
  kw: number;
  jahr: number;
  /** Saisonpause: Gebiet wurde in dieser Ausgabe nicht beliefert. */
  inSaisonpause: boolean;
  seitenzahl: number;
  gewichtExemplarG: number;
  beilagenInt: number;
  beilagenExt: number;
  /** Summe der Beilagengewichte je Haushalt (g). */
  beilagenGewichtG: number;
  laufzeitH: number;
  steckzeitH: number;
  einlegezeitH: number;
  zeitH: number;
  gewichtAnzeigenblattKg: number;
  gewichtBeilagenKg: number;
  grundlohn: LohnPaar;
  gewichtsbonusAnzeigenblatt: number;
  gewichtsbonusBeilagen: number;
  bonusZeiterfassung: number;
  gesamt: LohnPaar;
}

export interface TgMonatZeile {
  periode: Abrechnungsperiode;
  /** Ausgaben, in denen das Gebiet beliefert wurde. */
  anzAusgaben: number;
  /** Ausgaben des Monats, in denen das Gebiet in Saisonpause war. */
  anzSaisonpause: number;
  zeitH: number;
  gesamt: LohnPaar;
}

/** Durchschnittswerte je belieferter Ausgabe (Basis der Beispielrechnung). */
export interface TgDurchschnitt {
  seitenzahl: number;
  gewichtExemplarG: number;
  beilagenInt: number;
  beilagenExt: number;
  beilagenGewichtG: number;
  laufzeitH: number;
  steckzeitH: number;
  einlegezeitH: number;
  zeitH: number;
  gewichtAnzeigenblattKg: number;
  gewichtBeilagenKg: number;
  grundlohn: LohnPaar;
  gewichtsbonusAnzeigenblatt: number;
  gewichtsbonusBeilagen: number;
  bonusZeiterfassung: number;
  gesamt: LohnPaar;
}

export interface TgAuswertung {
  zeilen: TgAusgabeZeile[];
  monate: TgMonatZeile[];
  /** Ø je belieferter Ausgabe; null, wenn keine Ausgabe vorlag. */
  jeAusgabe: TgDurchschnitt | null;
  /** Ø belieferte Ausgaben je Monat. */
  ausgabenJeMonat: number;
  /** Ø Verdienst / Zeit im Monat (= Summe aller Monate / Anzahl Monate). */
  jeMonat: { zeitH: number; gesamt: LohnPaar };
  /** Perioden ohne erfasste Ausgaben — nicht in den Durchschnitt eingerechnet. */
  periodenOhneDaten: Abrechnungsperiode[];
  stundenlohn: LohnPaar;
  bonusJeAusgabe: number;
}

// ---- Berechnung --------------------------------------------

export function berechneTgAuswertung(
  tg: Teilgebiet,
  daten: PeriodeAusgabenDaten[],
  params: Parameter,
  mitBonusZeiterfassung: boolean
): TgAuswertung {
  const stundenlohn: LohnPaar = {
    erwachsene: params.stundenlohnErwachseneAustr,
    minderjaehrige: params.stundenlohnMinderjAustr,
  };
  const bonusJeAusgabe = mitBonusZeiterfassung ? params.bonusZeiterfassungEur ?? 0 : 0;
  const extGeschw = params.externeBeilageEinlegeGeschwStkProH || params.steckzeitStkProH;

  const zeilen: TgAusgabeZeile[] = [];
  const monate: TgMonatZeile[] = [];
  const periodenOhneDaten: Abrechnungsperiode[] = [];

  // Älteste Periode zuerst — liest sich in den Tabellen natürlicher.
  const sortiert = [...daten].sort((a, b) =>
    a.periode.jahr !== b.periode.jahr ? a.periode.jahr - b.periode.jahr : a.periode.monat - b.periode.monat
  );

  for (const { periode, ausgaben, beilagen } of sortiert) {
    if (ausgaben.length === 0) {
      periodenOhneDaten.push(periode);
      continue;
    }
    const monat: TgMonatZeile = {
      periode,
      anzAusgaben: 0,
      anzSaisonpause: 0,
      zeitH: 0,
      gesamt: { erwachsene: 0, minderjaehrige: 0 },
    };
    for (const ausgabe of ausgaben) {
      const beilagenTg = beilagen.filter(
        (b) => b.ausgabeId === ausgabe.id && b.teilgebietIds.includes(tg.id)
      );
      const beilagenExt = beilagenTg.filter((b) => b.kennzeichen === 'ext').length;
      const inSaisonpause = istInSaisonpauseFuer(tg, ausgabe);
      const laufzeitH = tg.wegstreckeM / params.laufgeschwindigkeitMProH;
      const steckzeitH = tg.stueckzahl / params.steckzeitStkProH;
      const einlegezeitH = beilagenExt > 0 ? (tg.stueckzahl * beilagenExt) / extGeschw : 0;
      const zeitH = berechneAustraegezeit(tg, params, beilagenExt);
      const gewichtAnzeigenblattKg = berechneGewichtAnzeigenblattKg(tg, ausgabe);
      const gewichtBeilagenKg = berechneGewichtBeilagenKg(tg, beilagenTg);
      const gewichtsbonusAnzeigenblatt = gewichtAnzeigenblattKg * params.gewichtszulageAnzeigenblattEurKg;
      const gewichtsbonusBeilagen = gewichtBeilagenKg * params.gewichtszulageBeilagenEurKg;
      const grundlohn: LohnPaar = {
        erwachsene: zeitH * stundenlohn.erwachsene,
        minderjaehrige: zeitH * stundenlohn.minderjaehrige,
      };
      const zuschlaege = gewichtsbonusAnzeigenblatt + gewichtsbonusBeilagen + bonusJeAusgabe;
      const zeile: TgAusgabeZeile = {
        ausgabeId: ausgabe.id,
        kw: ausgabe.kw,
        jahr: ausgabe.jahr,
        inSaisonpause,
        seitenzahl: ausgabe.seitenzahl,
        gewichtExemplarG: berechneGewichtProExemplarG(ausgabe),
        beilagenInt: beilagenTg.length - beilagenExt,
        beilagenExt,
        beilagenGewichtG: beilagenTg.reduce((s, b) => s + (b.gewichtGStk || 0), 0),
        laufzeitH,
        steckzeitH,
        einlegezeitH,
        zeitH,
        gewichtAnzeigenblattKg,
        gewichtBeilagenKg,
        grundlohn,
        gewichtsbonusAnzeigenblatt,
        gewichtsbonusBeilagen,
        bonusZeiterfassung: bonusJeAusgabe,
        gesamt: {
          erwachsene: grundlohn.erwachsene + zuschlaege,
          minderjaehrige: grundlohn.minderjaehrige + zuschlaege,
        },
      };
      zeilen.push(zeile);
      if (inSaisonpause) {
        monat.anzSaisonpause++;
        continue;
      }
      monat.anzAusgaben++;
      monat.zeitH += zeitH;
      monat.gesamt.erwachsene += zeile.gesamt.erwachsene;
      monat.gesamt.minderjaehrige += zeile.gesamt.minderjaehrige;
    }
    monate.push(monat);
  }

  const beliefert = zeilen.filter((z) => !z.inSaisonpause);
  const n = beliefert.length;
  const avg = (f: (z: TgAusgabeZeile) => number) => (n > 0 ? beliefert.reduce((s, z) => s + f(z), 0) / n : 0);
  const jeAusgabe: TgDurchschnitt | null =
    n === 0
      ? null
      : {
          seitenzahl: avg((z) => z.seitenzahl),
          gewichtExemplarG: avg((z) => z.gewichtExemplarG),
          beilagenInt: avg((z) => z.beilagenInt),
          beilagenExt: avg((z) => z.beilagenExt),
          beilagenGewichtG: avg((z) => z.beilagenGewichtG),
          laufzeitH: avg((z) => z.laufzeitH),
          steckzeitH: avg((z) => z.steckzeitH),
          einlegezeitH: avg((z) => z.einlegezeitH),
          zeitH: avg((z) => z.zeitH),
          gewichtAnzeigenblattKg: avg((z) => z.gewichtAnzeigenblattKg),
          gewichtBeilagenKg: avg((z) => z.gewichtBeilagenKg),
          grundlohn: {
            erwachsene: avg((z) => z.grundlohn.erwachsene),
            minderjaehrige: avg((z) => z.grundlohn.minderjaehrige),
          },
          gewichtsbonusAnzeigenblatt: avg((z) => z.gewichtsbonusAnzeigenblatt),
          gewichtsbonusBeilagen: avg((z) => z.gewichtsbonusBeilagen),
          bonusZeiterfassung: avg((z) => z.bonusZeiterfassung),
          gesamt: {
            erwachsene: avg((z) => z.gesamt.erwachsene),
            minderjaehrige: avg((z) => z.gesamt.minderjaehrige),
          },
        };

  const anzMonate = monate.length;
  const jeMonat = {
    zeitH: anzMonate > 0 ? monate.reduce((s, m) => s + m.zeitH, 0) / anzMonate : 0,
    gesamt: {
      erwachsene: anzMonate > 0 ? monate.reduce((s, m) => s + m.gesamt.erwachsene, 0) / anzMonate : 0,
      minderjaehrige: anzMonate > 0 ? monate.reduce((s, m) => s + m.gesamt.minderjaehrige, 0) / anzMonate : 0,
    },
  };

  return {
    zeilen,
    monate,
    jeAusgabe,
    ausgabenJeMonat: anzMonate > 0 ? n / anzMonate : 0,
    jeMonat,
    periodenOhneDaten,
    stundenlohn,
    bonusJeAusgabe,
  };
}
