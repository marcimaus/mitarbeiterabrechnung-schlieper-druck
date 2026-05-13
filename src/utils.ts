// Allgemeine Helfer-Funktionen

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
