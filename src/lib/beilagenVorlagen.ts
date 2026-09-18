// Beilagen-Auftragsvorlagen: gemeinsame Hilfsfunktionen für Verteilplan,
// „Ausgaben & Beilagen" und Personalplanung.
//
// Eine Vorlage speichert die Auswahl in drei Ebenen (Gesamtgebiet, ganze
// Touren, einzelne Teilgebiete). Bei der Übernahme in einen Auftrag werden
// daraus die AKTUELL gültigen Teilgebiete ermittelt — kommt z. B. ein neues
// TG zu einer gewählten Tour hinzu, ist es automatisch dabei; deaktivierte
// TGs fallen heraus.

import type {
  BeilagenFormat,
  BeilagenVorlage,
  Teilgebiet,
  Tour,
} from '../types';
import { aktualisiereBeilagenVorlage } from './db';
import { donnerstagDerKW, getCurrentKW, kwLabel, maxKWinJahr } from './kalender';

export const BEILAGEN_FORMATE: { value: BeilagenFormat; label: string }[] = [
  { value: 'A4', label: 'DIN A4' },
  { value: 'A5', label: 'DIN A5' },
  { value: 'kleinerA5', label: 'Kleiner als A5' },
];

export function formatLabel(format: BeilagenFormat | undefined): string {
  if (!format) return '';
  return BEILAGEN_FORMATE.find((f) => f.value === format)?.label ?? format;
}

/** Teilgebiete, die im Verteilplan buchbar sind (aktiv, nicht ausgeblendet). */
export function buchbareTeilgebiete(teilgebiete: Teilgebiet[], touren: Tour[]): Teilgebiet[] {
  const gesperrteTouren = new Set(touren.filter((t) => t.nichtImVerteilplan).map((t) => t.id));
  return teilgebiete.filter(
    (tg) => tg.isActive && !tg.nichtImVerteilplan && !(tg.tourId && gesperrteTouren.has(tg.tourId)),
  );
}

/** Zerlegt eine TG-Auswahl in Gesamtgebiet / vollständige Touren / TGs. */
export function auswahlStruktur(
  auswahl: Iterable<string>,
  teilgebiete: Teilgebiet[],
  touren: Tour[],
): Pick<BeilagenVorlage, 'gesamtgebiet' | 'tourIds' | 'teilgebietIds' | 'stueckzahlGespeichert'> {
  const ids = new Set(auswahl);
  const aktiv = teilgebiete.filter((tg) => tg.isActive && ids.has(tg.id));
  const buchbar = buchbareTeilgebiete(teilgebiete, touren);
  const gesamtgebiet = buchbar.length > 0 && buchbar.every((tg) => ids.has(tg.id));
  const tourIds = touren
    .filter((t) => !t.nichtImVerteilplan)
    .filter((t) => {
      const tgs = buchbar.filter((tg) => tg.tourId === t.id);
      return tgs.length > 0 && tgs.every((tg) => ids.has(tg.id));
    })
    .map((t) => t.id);
  return {
    gesamtgebiet,
    tourIds,
    teilgebietIds: aktiv.map((tg) => tg.id),
    stueckzahlGespeichert: aktiv.reduce((s, tg) => s + (tg.stueckzahl || 0), 0),
  };
}

/** Aktuell gültige Teilgebiete einer Vorlage. */
export function vorlageTeilgebietIds(
  vorlage: Pick<BeilagenVorlage, 'gesamtgebiet' | 'tourIds' | 'teilgebietIds'>,
  teilgebiete: Teilgebiet[],
  touren: Tour[],
): string[] {
  const buchbar = new Set(buchbareTeilgebiete(teilgebiete, touren).map((tg) => tg.id));
  const tourSet = new Set(vorlage.tourIds ?? []);
  const tgSet = new Set(vorlage.teilgebietIds ?? []);
  return teilgebiete
    .filter((tg) => {
      if (!tg.isActive) return false;
      if (tgSet.has(tg.id)) return true;
      if (!buchbar.has(tg.id)) return false;
      return vorlage.gesamtgebiet || (!!tg.tourId && tourSet.has(tg.tourId));
    })
    .map((tg) => tg.id);
}

export function stueckzahlVon(tgIds: string[], teilgebiete: Teilgebiet[]): number {
  const set = new Set(tgIds);
  return teilgebiete.reduce((s, tg) => s + (set.has(tg.id) ? tg.stueckzahl || 0 : 0), 0);
}

/**
 * KW-Auswahl für Bestellungen: beginnt kurz vor der aktuellen KW (damit die
 * nächsten Wochen oben stehen und man nicht scrollen muss) und reicht gut
 * ein Jahr in die Zukunft. Eine bereits gewählte KW außerhalb des Bereichs
 * wird vorne ergänzt. Schlüssel: "jahr-kw".
 */
export function kwAuswahlOptionen(ausgewaehlt?: string): { jahr: number; kws: { key: string; label: string }[] }[] {
  const label = (kw: number, jahr: number) =>
    `${kwLabel(kw, jahr)} · Do ${donnerstagDerKW(kw, jahr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
  let { kw, jahr } = getCurrentKW();
  // 2 Wochen zurück
  for (let i = 0; i < 2; i++) {
    kw--;
    if (kw < 1) { jahr--; kw = maxKWinJahr(jahr); }
  }
  const liste: { jahr: number; kw: number }[] = [];
  for (let i = 0; i < 66; i++) {
    liste.push({ jahr, kw });
    kw++;
    if (kw > maxKWinJahr(jahr)) { jahr++; kw = 1; }
  }
  const m = ausgewaehlt ? /^(\d{4})-(\d{1,2})$/.exec(ausgewaehlt) : null;
  if (m && !liste.some((x) => `${x.jahr}-${x.kw}` === ausgewaehlt)) {
    liste.unshift({ jahr: Number(m[1]), kw: Number(m[2]) });
  }
  const gruppen: { jahr: number; kws: { key: string; label: string }[] }[] = [];
  for (const x of liste) {
    let g = gruppen[gruppen.length - 1];
    if (!g || g.jahr !== x.jahr) gruppen.push((g = { jahr: x.jahr, kws: [] }));
    g.kws.push({ key: `${x.jahr}-${x.kw}`, label: label(x.kw, x.jahr) });
  }
  return gruppen;
}

export function vorlageLink(id: string): string {
  return `/verteilplan?vorlage=${encodeURIComponent(id)}`;
}

export function vorlageKwLabel(v: Pick<BeilagenVorlage, 'kw' | 'jahr'>): string {
  if (v.kw == null || v.jahr == null) return 'ohne KW';
  return `KW ${String(v.kw).padStart(2, '0')}/${v.jahr}`;
}

/**
 * Was fehlt, damit die Bestellung als Auftrag übernommen werden kann?
 * Leere Liste = vollständig.
 */
export function fehlendeAngabenFuerAuftrag(
  v: {
    kw: number | null;
    jahr: number | null;
    format: BeilagenFormat;
    gewichtGStk: number;
    kundenname: string;
    arbeitstitel?: string;
    beilageAngeliefert?: boolean;
  },
  teilgebietAnzahl: number,
): string[] {
  const fehlt: string[] = [];
  if (v.kw == null || v.jahr == null) fehlt.push('Kalenderwoche');
  if (!v.format) fehlt.push('Format');
  if (!(v.gewichtGStk > 0)) fehlt.push('Gewicht (g/Stk)');
  if (!v.kundenname.trim()) fehlt.push('Kundenname');
  if (teilgebietAnzahl === 0) fehlt.push('Teilgebiete');
  if (v.beilageAngeliefert === false) fehlt.push('Kennzeichen „Beilage angeliefert“');
  return fehlt;
}

/** Wurde die Vorlage bereits für diese KW in einen Auftrag übernommen? */
export function vorlageUebernommenFuer(v: BeilagenVorlage, kw: number, jahr: number): boolean {
  return (v.uebernahmen ?? []).some((u) => u.kw === kw && u.jahr === jahr);
}

/**
 * Nach dem Anlegen eines Auftrags aus einer Vorlage: Übernahme protokollieren
 * und — außer bei Dauervorlagen — archivieren.
 */
export async function vorlageUebernahmeVermerken(
  vorlage: BeilagenVorlage,
  uebernahme: { beilageId: string; ausgabeId: string; kw: number; jahr: number },
): Promise<void> {
  const ts = Date.now();
  await aktualisiereBeilagenVorlage(vorlage.id, {
    uebernahmen: [...(vorlage.uebernahmen ?? []), { ...uebernahme, am: ts }],
    ...(vorlage.istDauervorlage ? {} : { archiviert: true, archiviertAm: ts }),
  });
}
