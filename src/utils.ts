// Allgemeine Helfer-Funktionen

export function nameMitFestgehaltSymbol(m: { name: string; hatFestgehalt?: boolean }): string {
  return m.hatFestgehalt ? `🔒 ${m.name}` : m.name;
}
