// Allgemeine Helfer-Funktionen

import type { Abrechnungsperiode } from './types';

export function nameMitFestgehaltSymbol(m: { name: string; hatFestgehalt?: boolean }): string {
  return m.hatFestgehalt ? `🔒 ${m.name}` : m.name;
}

/**
 * Prüft, ob ein Mitarbeiter in operativen Auswahllisten (Standardausträger,
 * Springer, Zusammenträger, manuelle Zeit-Erfassung etc.) auswählbar ist.
 * Aktiv UND nicht abgemeldet. „Noch nicht angemeldet" schließt NICHT mehr
 * aus — der MA soll bereits eingesetzt werden können; in der Abrechnung
 * erscheint stattdessen ein Warnhinweis.
 */
export function istEinsatzbereit(m: {
  isActive: boolean;
  abgemeldet?: boolean;
  istInteressent?: boolean;
}): boolean {
  // Interessenten sind nie einsatzbereit — sie sind nur Kontaktdaten und
  // werden in operativen Auswahllisten nicht angeboten.
  if (m.istInteressent) return false;
  return m.isActive === true && m.abgemeldet !== true;
}

/**
 * Einmal pro Browser-Session den User fragen, ob der Monatswechsel bereits
 * durchgeführt wurde. Wird verwendet, bevor stammdaten-relevante Felder
 * (z. B. Standardausträger eines Teilgebiets) gespeichert werden — denn nach
 * Monatswechsel darf das geändert werden, vorher würde es laufende
 * Berechnungen verschieben.
 *
 * Liefert true, wenn der User bestätigt (oder bereits in dieser Session
 * bestätigt hat), false bei Ablehnen.
 */
const MONATSWECHSEL_SESSION_KEY = 'monatswechsel-bestaetigt';

export function bestaetigeMonatswechselEinmalProSession(): boolean {
  try {
    if (sessionStorage.getItem(MONATSWECHSEL_SESSION_KEY) === '1') return true;
  } catch {
    // sessionStorage kann z. B. in privaten Modi fehlen — dann jedes Mal fragen.
  }
  const ok = confirm(
    'Wurde der Monatswechsel durchgeführt?\n\n' +
      'Wenn JA: Die Änderung wirkt sich nur auf zukünftige Perioden aus — die laufende Periode wurde fixiert (Austragen & Zusammentragen).\n\n' +
      'Wenn NEIN: Die Änderung verschiebt rückwirkend die Berechnung der laufenden Periode. Das ist meistens nicht gewollt.'
  );
  if (ok) {
    try {
      sessionStorage.setItem(MONATSWECHSEL_SESSION_KEY, '1');
    } catch {
      // ignorieren
    }
  }
  return ok;
}

/**
 * Liefert den für eine konkrete Ausgabe (jahr/kw) GÜLTIGEN Standardausträger
 * eines Teilgebiets — also den historisch korrekten, nicht den aktuell live
 * gesetzten.
 *
 * Hintergrund: `tg.standardAustraegerId` ist ein einzelner, veränderlicher
 * Zeiger ohne Zeitbezug. Ändert sich der Standardausträger (z. B. beim
 * Monatswechsel), würden alle vergangenen Ausgaben rückwirkend „kippen", weil
 * sie den Standard live aus diesem Feld auflösen. Deshalb wird hier — analog
 * zur Abrechnungslogik (`effTeilgebiete` in lib/abrechnungslogik.ts) — der für
 * die Periode eingefrorene Snapshot bevorzugt:
 *
 *   periodeSnapshot (abgeschlossen) → monatswechselSnapshot (fixiert) → live.
 *
 * Für noch offene, nicht fixierte Perioden (z. B. der neue laufende Monat)
 * gibt es keinen Snapshot → es gilt korrekt der aktuelle Standardausträger.
 */
export function effektiverStandardAustraegerId(
  tg: { id: string; standardAustraegerId: string | null },
  jahr: number,
  kw: number,
  perioden: Abrechnungsperiode[],
): string | null {
  const periode = perioden.find(
    (p) => p.jahr === jahr && p.kalenderwochen.includes(kw),
  );
  const snaps =
    periode?.periodeSnapshot?.teilgebietSnapshots?.length
      ? periode.periodeSnapshot.teilgebietSnapshots
      : periode?.monatswechselSnapshot?.teilgebietSnapshots?.length
        ? periode.monatswechselSnapshot.teilgebietSnapshots
        : null;
  if (snaps) {
    const snap = snaps.find((s) => s.id === tg.id);
    // TG kann im Snapshot fehlen (z. B. neu angelegt) → live-Fallback.
    if (snap) return snap.standardAustraegerId;
  }
  return tg.standardAustraegerId;
}
