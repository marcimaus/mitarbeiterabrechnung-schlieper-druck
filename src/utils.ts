// Allgemeine Helfer-Funktionen

export function nameMitFestgehaltSymbol(m: { name: string; hatFestgehalt?: boolean }): string {
  return m.hatFestgehalt ? `🔒 ${m.name}` : m.name;
}

/**
 * Prüft, ob ein Mitarbeiter in operativen Auswahllisten (Standardausträger,
 * Springer, Zusammenträger, manuelle Zeit-Erfassung etc.) auswählbar ist.
 * Aktiv UND nicht „noch nicht angemeldet" UND nicht abgemeldet.
 */
export function istEinsatzbereit(m: {
  isActive: boolean;
  nochNichtAngemeldet?: boolean;
  abgemeldet?: boolean;
}): boolean {
  return m.isActive === true && m.nochNichtAngemeldet !== true && m.abgemeldet !== true;
}
