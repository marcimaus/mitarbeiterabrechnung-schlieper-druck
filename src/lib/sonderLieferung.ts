// ============================================================
// Sonder-Lieferadresse + Vorschuss-Vormerkung je Einsatz
// ============================================================
//
// Beide Angaben hängen an einer Ausgabe × Teilgebiet (Collection
// `einsaetze`) und gelten nur für diese Woche:
//  - Sonder-Lieferadresse: Auslieferung ausnahmsweise an eine andere
//    Adresse als lt. Mitarbeiter (Lieferschein hebt sie hervor).
//  - Vorschuss vorgemerkt: der Einsatz wird dem Austräger als Vorschuss
//    ausgezahlt (Liste/Druck im Einsätze-Screen, Hinweis in der Abrechnung).

import { berechneAustraegerLohn } from './berechnung';
import { hatAdresse } from '../utils';
import type {
  Ausgabe,
  Beilage,
  Einsatz,
  Lieferadresse,
  Mitarbeiter,
  Parameter,
  SonderLieferadresse,
  Sondervereinbarung,
  Teilgebiet,
} from '../types';

export function formatAdresse(a: Pick<Lieferadresse, 'strasse' | 'plz' | 'ort'> | undefined | null): string {
  if (!a) return '';
  return [a.strasse?.trim(), `${a.plz ?? ''} ${a.ort ?? ''}`.trim()].filter(Boolean).join(', ');
}

export function hatSonderLieferadresse(e: Pick<Einsatz, 'sonderLieferadresse'> | null | undefined): boolean {
  return hatAdresse(e?.sonderLieferadresse);
}

/**
 * Wer trägt das Teilgebiet in dieser Ausgabe effektiv aus?
 * Springer-Einsatz → Springer; Ausfall/ungeklärt → niemand; sonst der
 * (periodengerechte) Standardausträger.
 */
export function effektiverAustraegerId(
  einsatz: Pick<Einsatz, 'typ' | 'mitarbeiterId'> | null | undefined,
  standardId: string | null,
): string | null {
  if (einsatz?.typ === 'springer') return einsatz.mitarbeiterId ?? null;
  if (einsatz?.typ === 'ausfall' || einsatz?.typ === 'ungeklärt') return null;
  return standardId;
}

/**
 * Geplanter Vorschuss eines Einsatzes: fester Betrag, falls hinterlegt,
 * sonst der rechnerische Austragen-Lohn dieser Woche (Soll-Zeit inkl.
 * Springer-Zuschlag, Gewichtszulage und Sondervereinbarung).
 */
export function geplanterVorschussBetrag(
  einsatz: Einsatz,
  ma: Mitarbeiter,
  tg: Teilgebiet,
  ausgabe: Ausgabe,
  beilagen: Beilage[],
  sondervereinbarungen: Sondervereinbarung[],
  params: Parameter,
): number {
  if (einsatz.vorschussBetragEur != null) return einsatz.vorschussBetragEur;
  const sv = sondervereinbarungen.find((s) => s.mitarbeiterId === ma.id && s.teilgebietId === tg.id);
  const rechenEinsatz: Einsatz = einsatz.typ === 'springer' ? einsatz : { ...einsatz, typ: 'standard' };
  return berechneAustraegerLohn(ma, tg, ausgabe, beilagen, rechenEinsatz, sv, params).gesamt;
}

// ---- Formularwerte (SonderLieferungFelder) ------------------

export interface SonderLieferungWert {
  adresseAktiv: boolean;
  adresse: SonderLieferadresse;
  vorschuss: boolean;
  /** Fester Betrag als Eingabetext; leer = berechneter Lohn. */
  vorschussBetrag: string;
}

export const LEERE_SONDER_ADRESSE: SonderLieferadresse = { strasse: '', plz: '', ort: '', telefon: '', memo: '' };

export function sonderWertAusEinsatz(e: Einsatz | null | undefined): SonderLieferungWert {
  return {
    adresseAktiv: hatAdresse(e?.sonderLieferadresse),
    adresse: { ...LEERE_SONDER_ADRESSE, ...(e?.sonderLieferadresse ?? {}) },
    vorschuss: e?.vorschussVorgemerkt === true,
    vorschussBetrag: e?.vorschussBetragEur != null ? String(e.vorschussBetragEur) : '',
  };
}

/** Felder für `setzeEinsatz` — `undefined` löscht den gespeicherten Wert. */
export function sonderFelderAusWert(
  w: SonderLieferungWert,
  vorschussMoeglich: boolean,
): Pick<Einsatz, 'sonderLieferadresse' | 'vorschussVorgemerkt' | 'vorschussBetragEur'> {
  const a = w.adresse;
  let adresse: SonderLieferadresse | undefined;
  if (w.adresseAktiv && hatAdresse(a)) {
    // Verschachtelte undefined-Werte mag Firestore nicht — nur Gesetztes übernehmen.
    adresse = { strasse: a.strasse.trim(), plz: a.plz.trim(), ort: a.ort.trim() };
    if (a.telefon?.trim()) adresse.telefon = a.telefon.trim();
    if (a.memo?.trim()) adresse.memo = a.memo.trim();
    if (a.quelleMitarbeiterId) adresse.quelleMitarbeiterId = a.quelleMitarbeiterId;
    if (a.quelleBeschreibung) adresse.quelleBeschreibung = a.quelleBeschreibung;
  }
  const vorschuss = vorschussMoeglich && w.vorschuss;
  const betrag = parseFloat(w.vorschussBetrag.replace(',', '.'));
  return {
    sonderLieferadresse: adresse,
    vorschussVorgemerkt: vorschuss ? true : undefined,
    vorschussBetragEur: vorschuss && !isNaN(betrag) && betrag > 0 ? Math.round(betrag * 100) / 100 : undefined,
  };
}

/** Kurztext der Änderungen für das Änderungsprotokoll (leer = unverändert). */
export function beschreibeSonderAenderung(
  alt: Pick<Einsatz, 'sonderLieferadresse' | 'vorschussVorgemerkt' | 'vorschussBetragEur'> | null | undefined,
  neu: Pick<Einsatz, 'sonderLieferadresse' | 'vorschussVorgemerkt' | 'vorschussBetragEur'>,
): string[] {
  const teile: string[] = [];
  const altAdr = formatAdresse(alt?.sonderLieferadresse);
  const neuAdr = formatAdresse(neu.sonderLieferadresse);
  if (altAdr !== neuAdr) teile.push(`Sonder-Lieferadresse: ${altAdr || '—'} → ${neuAdr || '—'}`);
  const vText = (x: typeof neu | null | undefined) =>
    x?.vorschussVorgemerkt ? (x.vorschussBetragEur != null ? `ja (${x.vorschussBetragEur.toFixed(2)} €)` : 'ja (berechnet)') : 'nein';
  if (vText(alt) !== vText(neu)) teile.push(`Vorschuss vorgemerkt: ${vText(alt)} → ${vText(neu)}`);
  return teile;
}

// ---- Auswahl gespeicherter Adressen -------------------------

export interface AdressKandidat {
  key: string;
  mitarbeiter: Mitarbeiter;
  /** z. B. „Wohnadresse", „Abweichende Lieferadresse", „Lieferadresse Uslar3" */
  art: string;
  adresse: Lieferadresse;
  /** MA hat eine Freigabe für das betroffene Teilgebiet. */
  hatFreigabe: boolean;
  /** Adresse ist dessen Lieferadresse für genau dieses Teilgebiet. */
  fuerDiesesTg: boolean;
}

/**
 * Alle gespeicherten Adressen aktiver Mitarbeiter (Wohnadresse, allgemeine
 * abweichende Lieferadresse, Lieferadressen je Teilgebiet). Sortiert:
 * Mitarbeiter mit Freigabe für das Teilgebiet zuerst, darin deren
 * Lieferadresse für genau dieses Teilgebiet vorn.
 */
export function adressKandidaten(
  mitarbeiter: Mitarbeiter[],
  teilgebietId: string,
  teilgebiete: Teilgebiet[],
  ausserMitarbeiterId?: string | null,
): AdressKandidat[] {
  const tgName = new Map(teilgebiete.map((t) => [t.id, t.name]));
  const out: AdressKandidat[] = [];
  for (const ma of mitarbeiter) {
    if (!ma.isActive || ma.istInteressent || ma.abgemeldet) continue;
    if (ma.id === ausserMitarbeiterId) continue;
    const hatFreigabe = ma.teilgebietFreigaben?.includes(teilgebietId) ?? false;
    const wohn: Lieferadresse = { strasse: ma.adresse.strasse, plz: ma.adresse.plz, ort: ma.adresse.ort, telefon: ma.telefon || ma.mobilnummer };
    if (hatAdresse(wohn)) {
      out.push({ key: `${ma.id}|wohn`, mitarbeiter: ma, art: 'Wohnadresse', adresse: wohn, hatFreigabe, fuerDiesesTg: false });
    }
    if (ma.abweichendeLieferadresseAktiv && hatAdresse(ma.abweichendeLieferadresse)) {
      out.push({ key: `${ma.id}|abw`, mitarbeiter: ma, art: 'Abweichende Lieferadresse', adresse: ma.abweichendeLieferadresse, hatFreigabe, fuerDiesesTg: false });
    }
    for (const l of ma.lieferadressenJeTeilgebiet ?? []) {
      if (!hatAdresse(l)) continue;
      out.push({
        key: `${ma.id}|tg|${l.teilgebietId}`,
        mitarbeiter: ma,
        art: `Lieferadresse ${tgName.get(l.teilgebietId) ?? 'Teilgebiet'}`,
        adresse: l,
        hatFreigabe,
        fuerDiesesTg: l.teilgebietId === teilgebietId,
      });
    }
  }
  return out.sort(
    (a, b) =>
      Number(b.hatFreigabe) - Number(a.hatFreigabe) ||
      Number(b.fuerDiesesTg) - Number(a.fuerDiesesTg) ||
      a.mitarbeiter.name.localeCompare(b.mitarbeiter.name, 'de') ||
      a.art.localeCompare(b.art, 'de'),
  );
}
