// ---- Vorarbeit: Zuordnung zur Ausgabe + Zeitfenster-Kappung ----------
//
// Zuordnung: Eine Vorarbeit-Arbeitszeit gehört zur Ausgabe der
// Kalenderwoche, in der sie begonnen hat. Die Zusammenträger wählen beim
// Stempeln keine KW aus — maßgeblich ist daher das Datum. Nur wenn für
// die KW (noch) keine Ausgabe existiert, greift die an der Arbeitszeit
// gespeicherte `ausgabeId`.
//
// Kappung: Hat die Ausgabe für den Tag ein Zeitfenster (`von` und/oder
// `bis`), wird nur der Teil der Vorarbeit innerhalb des Fensters vergütet.
// Der Rest gilt als Zusammentragen (Soll-Zeit-Vergütung) und wird nicht
// extra bezahlt — typischer Fall: vergessenes Ausstempeln.

import type { Arbeitszeit, Ausgabe, Pause, VorarbeitZeitfenster } from '../types';
import { getISOWeek, getISOYear, donnerstagDerKW } from './kalender';
import { berechneNettoMinuten } from './zeiterfassung';

const pad = (n: number) => n.toString().padStart(2, '0');

/** Lokales Datum als YYYY-MM-DD. */
export function lokalesDatum(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Lokale Tage (YYYY-MM-DD) Montag bis Sonntag der ISO-KW. */
export function tageDerKw(kw: number, jahr: number): string[] {
  const do_ = donnerstagDerKW(kw, jahr);
  const montag = new Date(do_.getUTCFullYear(), do_.getUTCMonth(), do_.getUTCDate() - 3);
  return Array.from({ length: 7 }, (_, i) =>
    lokalesDatum(new Date(montag.getFullYear(), montag.getMonth(), montag.getDate() + i))
  );
}

/** Zeitraum [start, ende) der ISO-KW in lokaler Zeit (ms). */
export function kwZeitraum(kw: number, jahr: number): { start: number; ende: number } {
  const do_ = donnerstagDerKW(kw, jahr);
  const start = new Date(do_.getUTCFullYear(), do_.getUTCMonth(), do_.getUTCDate() - 3);
  const ende = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start: start.getTime(), ende: ende.getTime() };
}

/**
 * Ausgabe, zu der eine Vorarbeit-Arbeitszeit gehört: primär die Ausgabe der
 * KW des Startzeitpunkts, sonst die gespeicherte `ausgabeId`.
 */
export function vorarbeitAusgabe(
  a: Pick<Arbeitszeit, 'startTime' | 'ausgabeId'>,
  ausgaben: Ausgabe[],
): Ausgabe | undefined {
  const d = new Date(a.startTime);
  const kw = getISOWeek(d);
  const jahr = getISOYear(d);
  const kwAusgaben = ausgaben.filter((x) => x.jahr === jahr && x.kw === kw);
  if (kwAusgaben.length > 0) {
    return kwAusgaben.find((x) => x.id === a.ausgabeId) ?? kwAusgaben[0];
  }
  return a.ausgabeId ? ausgaben.find((x) => x.id === a.ausgabeId) : undefined;
}

/** Wirksames Zeitfenster der Ausgabe für den Starttag der Arbeitszeit. */
export function zeitfensterFuer(
  a: Pick<Arbeitszeit, 'startTime'>,
  ausgabe: Ausgabe | undefined,
): VorarbeitZeitfenster | undefined {
  const datum = lokalesDatum(a.startTime);
  const f = ausgabe?.vorarbeitZeitfenster?.find((x) => x.datum === datum);
  return f && (f.von || f.bis) ? f : undefined;
}

/** Kurztext eines Zeitfensters, z. B. „8:00–12:00", „bis 12:00", „ab 8:00". */
export function zeitfensterText(f: Pick<VorarbeitZeitfenster, 'von' | 'bis'>): string {
  if (f.von && f.bis) return `${f.von}–${f.bis} Uhr`;
  if (f.bis) return `bis ${f.bis} Uhr`;
  if (f.von) return `ab ${f.von} Uhr`;
  return 'ohne Begrenzung';
}

function pausenMinutenIn(pausen: Pause[], s: number, e: number, jetzt: number): number {
  return pausen.reduce((sum, p) => {
    const ps = Math.max(p.start, s);
    const pe = Math.min(p.ende ?? jetzt, e);
    return pe > ps ? sum + (pe - ps) / 60_000 : sum;
  }, 0);
}

/**
 * Kappt eine Vorarbeit-Arbeitszeit auf das Zeitfenster der Ausgabe.
 * Liefert die Arbeitszeit unverändert, wenn kein Fenster gilt oder sie
 * vollständig darin liegt; sonst einen Klon mit gekapptem Start/Ende,
 * anteiligen Pausen und `vorarbeitKappung`. `verguetetMin` = 0 bedeutet:
 * vollständig außerhalb des Fensters.
 */
export function kappeVorarbeit(a: Arbeitszeit, ausgabe: Ausgabe | undefined): Arbeitszeit {
  if (a.typ !== 'vorarbeit' || a.endTime == null) return a;
  const f = zeitfensterFuer(a, ausgabe);
  if (!f) return a;
  const fensterStart = f.von ? new Date(`${f.datum}T${f.von}:00`).getTime() : -Infinity;
  const fensterEnde = f.bis ? new Date(`${f.datum}T${f.bis}:00`).getTime() : Infinity;
  const s = Math.max(a.startTime, fensterStart);
  const e = Math.min(a.endTime, fensterEnde);
  if (s === a.startTime && e === a.endTime) return a;

  const originalNettoMin = berechneNettoMinuten(a);
  const kappungBasis = {
    originalStart: a.startTime,
    originalEnd: a.endTime,
    originalNettoMin,
    ...(f.von ? { von: f.von } : {}),
    ...(f.bis ? { bis: f.bis } : {}),
  };
  if (e <= s) {
    return { ...a, vorarbeitKappung: { ...kappungBasis, verguetetMin: 0 } };
  }

  // Pausen: echte Überlappung, wenn die Pausenliste die Pausensumme trägt;
  // sonst (manuell gepflegte Pausensumme) anteilig zur gekappten Dauer.
  const pausenListeMin = pausenMinutenIn(a.pausen ?? [], a.startTime, a.endTime, a.endTime);
  const pauseMin =
    Math.abs(pausenListeMin - (a.gesamtPauseMinuten ?? 0)) < 1
      ? pausenMinutenIn(a.pausen ?? [], s, e, a.endTime)
      : (a.gesamtPauseMinuten ?? 0) * (e - s) / (a.endTime - a.startTime);
  const pausen = (a.pausen ?? [])
    .map((p) => ({ start: Math.max(p.start, s), ende: Math.min(p.ende ?? a.endTime!, e) }))
    .filter((p) => p.ende > p.start);
  const geklont: Arbeitszeit = {
    ...a,
    startTime: s,
    endTime: e,
    pausen,
    gesamtPauseMinuten: pauseMin,
  };
  return {
    ...geklont,
    vorarbeitKappung: { ...kappungBasis, verguetetMin: berechneNettoMinuten(geklont) },
  };
}
