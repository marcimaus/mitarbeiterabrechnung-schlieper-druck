// ---- Saisonteilgebiete ----------------------------------------------
//
// Ein Teilgebiet kann Monate haben, in denen es automatisch nicht
// beliefert wird (`saisonPauseMonate`, z. B. Winterpause einer
// Auslagestelle auf dem Campingplatz). Maßgeblich ist der Monat des
// Erscheinungstags (Donnerstag der KW).
//
// `isActive` bleibt die Stammdaten-Aktivität. Für alles, was sich auf eine
// konkrete Ausgabe bezieht (Zusammentragen, Einsätze, Austragen-Lohn,
// Lieferscheine, Übernahme einer Bestellung in den Auftrag …), gilt
// `istTgAktivFuer` (berücksichtigt auch die je Ausgabe in „Einsätze" gesetzte
// Ausnahme „diese Woche trotzdem beliefern"). Im Verteilplan bleiben
// Saisonteilgebiete buchbar; aus Bestellungen werden sie in Pausenmonaten nie
// automatisch in Aufträge übernommen.

import type { Ausgabe, Teilgebiet } from '../types';
import { donnerstagDerKW, getCurrentKW } from './kalender';

export const MONATE_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Monat (1–12) des Erscheinungstags der KW. */
export function monatDerKw(kw: number, jahr: number): number {
  return donnerstagDerKW(kw, jahr).getUTCMonth() + 1;
}

export function istSaisonTeilgebiet(tg: Pick<Teilgebiet, 'saisonPauseMonate'>): boolean {
  return (tg.saisonPauseMonate?.length ?? 0) > 0;
}

/** Liegt die KW in der Saisonpause des Teilgebiets? */
export function istInSaisonpause(
  tg: Pick<Teilgebiet, 'saisonPauseMonate'>,
  kw: number,
  jahr: number,
): boolean {
  return !!tg.saisonPauseMonate?.includes(monatDerKw(kw, jahr));
}

/** Saisonpause in der aktuellen KW („zur Zeit nicht beliefert"). */
export function istAktuellInSaisonpause(tg: Pick<Teilgebiet, 'saisonPauseMonate'>): boolean {
  const { kw, jahr } = getCurrentKW();
  return istInSaisonpause(tg, kw, jahr);
}

/** Wird das Teilgebiet in dieser KW beliefert? (aktiv und nicht in Saisonpause) */
export function istTgAktivInKw(
  tg: Pick<Teilgebiet, 'isActive' | 'saisonPauseMonate'>,
  kw: number,
  jahr: number,
): boolean {
  return tg.isActive !== false && !istInSaisonpause(tg, kw, jahr);
}

/** Bezug auf eine konkrete Ausgabe (KW + ggf. Ausnahmen „trotzdem beliefern"). */
export type AusgabeBezug = Pick<Ausgabe, 'kw' | 'jahr' | 'saisonAusnahmeTeilgebietIds'>;

/** Wurde das TG in dieser Ausgabe ad hoc trotz Saisonpause freigeschaltet? */
export function istSaisonAusnahme(tg: Pick<Teilgebiet, 'id'>, ausgabe: AusgabeBezug): boolean {
  return !!ausgabe.saisonAusnahmeTeilgebietIds?.includes(tg.id);
}

/** Saisonpause in dieser Ausgabe — unter Berücksichtigung der Ausnahmen. */
export function istInSaisonpauseFuer(
  tg: Pick<Teilgebiet, 'id' | 'saisonPauseMonate'>,
  ausgabe: AusgabeBezug,
): boolean {
  return istInSaisonpause(tg, ausgabe.kw, ausgabe.jahr) && !istSaisonAusnahme(tg, ausgabe);
}

/** Wird das TG in dieser Ausgabe beliefert? (aktiv, keine Saisonpause oder Ausnahme) */
export function istTgAktivFuer(
  tg: Pick<Teilgebiet, 'id' | 'isActive' | 'saisonPauseMonate'>,
  ausgabe: AusgabeBezug,
): boolean {
  return tg.isActive !== false && !istInSaisonpauseFuer(tg, ausgabe);
}

/**
 * Pausenmonate kompakt, zusammenhängende Monate als Bereich — auch über den
 * Jahreswechsel: [11,12,1,2,3] → „Nov–Mär", [1,3] → „Jan, Mär".
 */
export function saisonPauseText(monate: number[] | undefined): string {
  const set = new Set((monate ?? []).filter((m) => m >= 1 && m <= 12));
  if (set.size === 0) return '';
  if (set.size === 12) return 'ganzjährig';
  // Start bei einem Monat, dessen Vormonat nicht in der Pause liegt.
  const vor = (m: number) => (m === 1 ? 12 : m - 1);
  const nach = (m: number) => (m === 12 ? 1 : m + 1);
  const starts = [...set].filter((m) => !set.has(vor(m))).sort((a, b) => a - b);
  return starts
    .map((s) => {
      let e = s;
      while (set.has(nach(e))) e = nach(e);
      return s === e ? MONATE_KURZ[s - 1] : `${MONATE_KURZ[s - 1]}–${MONATE_KURZ[e - 1]}`;
    })
    .join(', ');
}
