// ISO Kalenderwochen-Hilfsfunktionen

export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getISOYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

export function getCurrentKW(): { kw: number; jahr: number } {
  const today = new Date();
  return { kw: getISOWeek(today), jahr: getISOYear(today) };
}

export function maxKWinJahr(jahr: number): number {
  // Eine Jahr hat 53 KWs wenn der 31.12. ein Donnerstag ist
  // oder der 1.1. ein Donnerstag (Schaltjahr)
  const dec31 = new Date(jahr, 11, 31);
  const kw = getISOWeek(dec31);
  return kw === 1 ? 52 : kw;
}

export function alleKWsImJahr(jahr: number): number[] {
  const max = maxKWinJahr(jahr);
  return Array.from({ length: max }, (_, i) => i + 1);
}

export function kwLabel(kw: number, jahr: number): string {
  return `KW ${kw.toString().padStart(2, '0')}/${jahr}`;
}

// Donnerstag der gegebenen KW (Erscheinungstag des Blattes)
export function donnerstagDerKW(kw: number, jahr: number): Date {
  const jan4 = new Date(Date.UTC(jahr, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const weekStart = new Date(jan4.getTime() - (jan4Day - 1) * 86400000);
  const thursday = new Date(weekStart.getTime() + (kw - 1) * 7 * 86400000 + 3 * 86400000);
  return thursday;
}

export function formatDonnerstag(kw: number, jahr: number): string {
  const d = donnerstagDerKW(kw, jahr);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
