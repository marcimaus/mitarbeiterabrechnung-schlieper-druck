// ============================================================
// Urlaub — Datums-Hilfen (Werktage, ISO-Wochen, Gruppen)
// ============================================================
//
// Gemeinsam genutzt von der Personalplanung (Urlaubs-Sektion) und dem
// Bereich „Urlaub" (Mitarbeiter-Ansicht mit Kollegen-Vergleich).

import { getISOWeek, getISOYear, donnerstagDerKW } from './kalender';
import type { UrlaubStatus, UrlaubsEintrag } from '../types';

export function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Werktagsverteilung pro ISO-Woche für einen Datumsbereich.
 * Liefert je Woche, in die mind. ein Werktag (Mo-Fr) fällt, die Anzahl
 * der enthaltenen Werktage. Wochenenden werden ignoriert.
 *
 * Wird verwendet, um pro Chip den Urlaubsstatus abzuleiten:
 *   5 Werktage  → ganze Woche
 *   2-4         → mehrtägig
 *   1           → einzeltag (z. B. Urlaub beginnt Freitag oder endet Montag)
 */
export function urlaubWochenAusBereich(
  datumVon: string,
  datumBis: string,
  zusatzWerktage: string[] = [],
): Array<{ jahr: number; kw: number; status: UrlaubStatus; werktageInKw: string[] }> {
  // Sammle alle Werktage (Mo–Fr) aus dem [von..bis]-Bereich plus
  // explizite Zusatz-Werktage (z. B. Mo + Mi + Fr in einer KW).
  const alleTage = new Set<string>();
  if (datumVon && datumBis) {
    const von = new Date(datumVon);
    const bis = new Date(datumBis);
    if (!isNaN(+von) && !isNaN(+bis) && bis >= von) {
      const cursor = new Date(von);
      while (cursor <= bis) {
        const dow = cursor.getDay();
        if (dow >= 1 && dow <= 5) {
          alleTage.add(isoFromDate(cursor));
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }
  for (const iso of zusatzWerktage) {
    if (!iso) continue;
    const d = new Date(iso);
    if (isNaN(+d)) continue;
    const dow = d.getDay();
    if (dow < 1 || dow > 5) continue; // nur Werktage
    alleTage.add(iso);
  }
  if (alleTage.size === 0) return [];

  // Gruppiere nach ISO-Woche.
  const buckets = new Map<string, { jahr: number; kw: number; tage: string[] }>();
  for (const iso of alleTage) {
    const d = new Date(iso);
    const j = getISOYear(d);
    const k = getISOWeek(d);
    const key = `${j}-${k}`;
    const b = buckets.get(key) ?? { jahr: j, kw: k, tage: [] };
    b.tage.push(iso);
    buckets.set(key, b);
  }

  const out: Array<{ jahr: number; kw: number; status: UrlaubStatus; werktageInKw: string[] }> = [];
  for (const b of buckets.values()) {
    b.tage.sort();
    const c = b.tage.length;
    const status: UrlaubStatus =
      c >= 5 ? 'ganze-woche' : c >= 2 ? 'mehrtaegig' : 'einzeltag';
    out.push({ jahr: b.jahr, kw: b.kw, status, werktageInKw: b.tage });
  }
  out.sort((a, b) => a.jahr - b.jahr || a.kw - b.kw);
  return out;
}

/** Anzahl Werktage (Mo–Fr) zwischen `von` und `bis` inklusiv. */
export function zaehleWerktage(datumVon: string, datumBis: string): number {
  if (!datumVon || !datumBis) return 0;
  const v = new Date(datumVon);
  const b = new Date(datumBis);
  if (isNaN(+v) || isNaN(+b) || b < v) return 0;
  let n = 0;
  const c = new Date(v);
  while (c <= b) {
    const dow = c.getDay();
    if (dow >= 1 && dow <= 5) n++;
    c.setDate(c.getDate() + 1);
  }
  return n;
}

/**
 * Berechnet aus `datumVon` + Anzahl Werktage das resultierende `datumBis`.
 * Startet beim `datumVon`; wenn dieses ein Wochenend-Tag ist, wird auf den
 * folgenden Montag verschoben. Liefert ISO-Date oder leeren String, wenn
 * die Eingabe ungültig ist.
 */
export function bisAusWerktage(datumVon: string, anzahl: number): string {
  if (!datumVon || anzahl < 1) return '';
  const start = new Date(datumVon);
  if (isNaN(+start)) return '';
  // Wenn datumVon ein Samstag (6) oder Sonntag (0): auf nächsten Montag legen.
  const dow0 = start.getDay();
  if (dow0 === 0) start.setDate(start.getDate() + 1);
  if (dow0 === 6) start.setDate(start.getDate() + 2);
  let werktageGezaehlt = 0;
  const cursor = new Date(start);
  // Werktage-Count bis Anzahl erreicht. Letzter Werktag = Bis-Datum.
  while (werktageGezaehlt < anzahl) {
    const dow = cursor.getDay();
    if (dow >= 1 && dow <= 5) werktageGezaehlt++;
    if (werktageGezaehlt < anzahl) cursor.setDate(cursor.getDate() + 1);
  }
  return isoFromDate(cursor);
}

/** Montag der ISO-KW als ISO-Datum. */
export function montagDerKw(jahr: number, kw: number): string {
  const d = donnerstagDerKW(kw, jahr);
  const m = new Date(d.getTime() - 3 * 86400000);
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}-${String(m.getUTCDate()).padStart(2, '0')}`;
}

/** Die fünf Werktage (Mo–Fr) einer ISO-KW als ISO-Daten. */
export function werktageDerKw(jahr: number, kw: number): string[] {
  const mo = new Date(montagDerKw(jahr, kw) + 'T00:00:00');
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mo);
    d.setDate(mo.getDate() + i);
    return isoFromDate(d);
  });
}

/**
 * Konkrete Urlaubs-Werktage eines Eintrags (seiner KW). Altdaten ohne
 * `werktageInKw` werden aus datumVon/Bis rekonstruiert.
 */
export function werktageDesEintrags(e: UrlaubsEintrag): string[] {
  if (e.werktageInKw && e.werktageInKw.length > 0) return [...e.werktageInKw].sort();
  if (!e.datumVon || !e.datumBis) return [];
  const tage = new Set(werktageDerKw(e.jahr, e.kw));
  return urlaubWochenAusBereich(e.datumVon, e.datumBis)
    .flatMap((w) => w.werktageInKw)
    .filter((d) => tage.has(d));
}

/**
 * Ein Urlaub aus Nutzersicht: alle Wochen-Datensätze mit identischem
 * (mitarbeiterId, datumVon, datumBis) — siehe `setzeUrlaubsGruppe`.
 */
export interface UrlaubGruppe {
  key: string;
  mitarbeiterId: string;
  datumVon: string;
  datumBis: string;
  eintraege: UrlaubsEintrag[];
  werktage: string[];
  alleFreigegeben: boolean;
  keinerFreigegeben: boolean;
  kommentar?: string;
}

export function gruppiereUrlaube(eintraege: UrlaubsEintrag[]): UrlaubGruppe[] {
  const map = new Map<string, UrlaubGruppe>();
  for (const e of eintraege) {
    const key = `${e.mitarbeiterId}|${e.datumVon ?? ''}|${e.datumBis ?? ''}`;
    const g = map.get(key) ?? {
      key,
      mitarbeiterId: e.mitarbeiterId,
      datumVon: e.datumVon ?? '',
      datumBis: e.datumBis ?? '',
      eintraege: [],
      werktage: [],
      alleFreigegeben: true,
      keinerFreigegeben: true,
      kommentar: e.kommentar,
    };
    g.eintraege.push(e);
    g.werktage.push(...werktageDesEintrags(e));
    if (e.freigegeben) g.keinerFreigegeben = false;
    else g.alleFreigegeben = false;
    if (!g.kommentar && e.kommentar) g.kommentar = e.kommentar;
    map.set(key, g);
  }
  return Array.from(map.values())
    .map((g) => {
      g.eintraege.sort((a, b) => a.jahr - b.jahr || a.kw - b.kw);
      g.werktage.sort();
      return g;
    })
    .sort((a, b) => (a.werktage[0] ?? a.datumVon).localeCompare(b.werktage[0] ?? b.datumVon));
}

export function fmtDatumKurz(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** „12.08.2026 – 16.08.2026" bzw. ein Datum bei eintägigem Urlaub. */
export function fmtZeitraum(von: string, bis: string): string {
  if (!von && !bis) return '—';
  if (!bis || von === bis) return fmtDatumKurz(von || bis);
  return `${fmtDatumKurz(von)} – ${fmtDatumKurz(bis)}`;
}

// ---- Vergleichsraster (Mitarbeiter-Ansicht + Druck) ---------

export type UrlaubTagStatus = 'genehmigt' | 'beantragt';

/** Urlaubs-Werktage je Mitarbeiter: maId → (ISO-Datum → Status). */
export function urlaubsTageJeMa(
  eintraege: UrlaubsEintrag[],
): Map<string, Map<string, UrlaubTagStatus>> {
  const out = new Map<string, Map<string, UrlaubTagStatus>>();
  for (const e of eintraege) {
    const tage = out.get(e.mitarbeiterId) ?? new Map<string, UrlaubTagStatus>();
    for (const d of werktageDesEintrags(e)) {
      // Ein genehmigter Tag bleibt genehmigt, auch wenn ein zweiter Datensatz
      // denselben Tag als beantragt führt.
      if (tage.get(d) !== 'genehmigt') tage.set(d, e.freigegeben ? 'genehmigt' : 'beantragt');
    }
    out.set(e.mitarbeiterId, tage);
  }
  return out;
}

/** Monat (1–12) einer ISO-KW — maßgeblich ist der Donnerstag (ISO-Regel). */
export function monatDerKw(jahr: number, kw: number): number {
  return donnerstagDerKW(kw, jahr).getUTCMonth() + 1;
}

/** Aufeinanderfolgende KWs je Monat — für die Monatszeile im Rasterkopf. */
export function monatsSpannen(jahr: number, kws: number[]): Array<{ monat: number; anzahl: number }> {
  const out: Array<{ monat: number; anzahl: number }> = [];
  for (const kw of kws) {
    const m = monatDerKw(jahr, kw);
    const letzte = out[out.length - 1];
    if (letzte && letzte.monat === m) letzte.anzahl++;
    else out.push({ monat: m, anzahl: 1 });
  }
  return out;
}
