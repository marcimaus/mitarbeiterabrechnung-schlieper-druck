// Beilagen-Auftragsvorlagen: gemeinsame Hilfsfunktionen für Verteilplan,
// „Ausgaben & Beilagen" und Personalplanung.
//
// Eine Vorlage speichert die Auswahl in drei Ebenen (Gesamtgebiet, ganze
// Touren, einzelne Teilgebiete). Bei der Übernahme in einen Auftrag werden
// daraus die AKTUELL gültigen Teilgebiete ermittelt — kommt z. B. ein neues
// TG zu einer gewählten Tour hinzu, ist es automatisch dabei; deaktivierte
// TGs fallen heraus.

import type {
  Abrechnungsperiode,
  BeilagenFormat,
  BeilagenVorlage,
  BeilagenVorlageTermin,
  Teilgebiet,
  Tour,
} from '../types';
import { aktualisiereBeilagenVorlage } from './db';
import { donnerstagDerKW, getCurrentKW, getISOWeek, getISOYear, kwLabel, maxKWinJahr } from './kalender';

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
 * KWs, deren Abrechnungsperiode abgeschlossen ist oder in der der
 * Monatswechsel durchgeführt wurde — dort sind die Beilagen fixiert, es
 * darf nichts mehr geändert werden. Schlüssel: "jahr-kw".
 */
export function gesperrteKwKeys(perioden: Abrechnungsperiode[]): Set<string> {
  const s = new Set<string>();
  for (const p of perioden) {
    if (p.status !== 'abgeschlossen' && !p.monatswechselSnapshot && !p.monatswechselDurchgefuehrtAm) continue;
    for (const kw of p.kalenderwochen) s.add(`${p.jahr}-${kw}`);
  }
  return s;
}

/** Erste KW des laufenden Monats (Abrechnungsperiode der aktuellen KW). */
function ersteKwAktuellerMonat(perioden: Abrechnungsperiode[]): { jahr: number; kw: number } {
  const heute = getCurrentKW();
  const periode = perioden.find((p) => p.jahr === heute.jahr && p.kalenderwochen.includes(heute.kw));
  if (periode && periode.kalenderwochen.length > 0) {
    return { jahr: periode.jahr, kw: Math.min(...periode.kalenderwochen) };
  }
  // Keine Periode angelegt: KW des ersten Donnerstags im Kalendermonat.
  const d = new Date();
  const ersterDo = new Date(d.getFullYear(), d.getMonth(), 1);
  while (ersterDo.getDay() !== 4) ersterDo.setDate(ersterDo.getDate() + 1);
  const kandidat = { jahr: getISOYear(ersterDo), kw: getISOWeek(ersterDo) };
  // Nie nach der aktuellen KW beginnen.
  return kandidat.jahr * 100 + kandidat.kw > heute.jahr * 100 + heute.kw ? heute : kandidat;
}

/**
 * KW-Auswahl für Bestellungen: beginnt bei der ersten KW des laufenden
 * Monats (Abrechnungsperiode der aktuellen KW) und reicht gut ein Jahr in die
 * Zukunft. KWs abgeschlossener Monate (bzw. nach dem Monatswechsel) sind
 * nicht wählbar. Eine bereits gespeicherte KW außerhalb der Liste wird vorne
 * ergänzt, damit ältere Bestellungen korrekt angezeigt werden.
 * Schlüssel: "jahr-kw".
 */
export function kwAuswahlOptionen(
  ausgewaehlt: string | undefined,
  perioden: Abrechnungsperiode[],
): { jahr: number; kws: { key: string; label: string }[] }[] {
  const label = (kw: number, jahr: number) =>
    `${kwLabel(kw, jahr)} · Do ${donnerstagDerKW(kw, jahr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
  const key = (y: { jahr: number; kw: number }) => `${y.jahr}-${y.kw}`;
  const gesperrt = gesperrteKwKeys(perioden);

  const start = ersteKwAktuellerMonat(perioden);
  let { kw, jahr } = start;
  const liste: { jahr: number; kw: number; hinweis?: string }[] = [];
  for (let i = 0; i < 66; i++) {
    if (!gesperrt.has(key({ jahr, kw }))) liste.push({ jahr, kw });
    kw++;
    if (kw > maxKWinJahr(jahr)) { jahr++; kw = 1; }
  }

  const m = ausgewaehlt ? /^(\d{4})-(\d{1,2})$/.exec(ausgewaehlt) : null;
  if (m && !liste.some((y) => key(y) === ausgewaehlt)) {
    const y = { jahr: Number(m[1]), kw: Number(m[2]) };
    const vorStart = y.jahr * 100 + y.kw < start.jahr * 100 + start.kw;
    liste.unshift({
      ...y,
      hinweis: gesperrt.has(key(y)) ? ' · Monat abgeschlossen' : vorStart ? ' · vergangen' : '',
    });
  }

  const gruppen: { jahr: number; kws: { key: string; label: string }[] }[] = [];
  for (const y of liste) {
    let g = gruppen[gruppen.length - 1];
    if (!g || g.jahr !== y.jahr) gruppen.push((g = { jahr: y.jahr, kws: [] }));
    g.kws.push({ key: key(y), label: label(y.kw, y.jahr) + (y.hinweis ?? '') });
  }
  return gruppen;
}

/** Link auf die Bestellung; mit KW wird bei Dauerbestellungen dieser Termin vorgewählt. */
export function vorlageLink(id: string, termin?: { kw: number | null; jahr: number | null }): string {
  const kw = termin?.kw != null && termin.jahr != null ? `&kw=${termin.jahr}-${termin.kw}` : '';
  return `/verteilplan?vorlage=${encodeURIComponent(id)}${kw}`;
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

/** Termine einer Dauerbestellung, chronologisch sortiert. */
export function vorlageTermine(v: Pick<BeilagenVorlage, 'istDauervorlage' | 'termine'>): BeilagenVorlageTermin[] {
  if (!v.istDauervorlage) return [];
  return [...(v.termine ?? [])].sort((a, b) => a.jahr - b.jahr || a.kw - b.kw);
}

/**
 * Die Bestellung, wie sie für eine bestimmte KW gilt: bei Dauerbestellungen
 * mit Terminen die Werte (Format, Gewicht, Anlieferung) des Termins dieser
 * KW, sonst die Vorlage selbst, sofern sie für diese KW bestellt ist.
 * null = für diese KW nicht bestellt.
 */
export function vorlageFuerKw(v: BeilagenVorlage, kw: number, jahr: number): BeilagenVorlage | null {
  if (v.istDauervorlage && (v.termine?.length ?? 0) > 0) {
    const t = v.termine!.find((x) => x.kw === kw && x.jahr === jahr);
    return t
      ? { ...v, kw, jahr, format: t.format, gewichtGStk: t.gewichtGStk, beilageAngeliefert: t.beilageAngeliefert }
      : null;
  }
  return v.kw === kw && v.jahr === jahr ? v : null;
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
