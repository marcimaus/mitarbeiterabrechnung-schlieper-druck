// SHA-256 basierte PIN-Authentifizierung (kein Firebase Auth)

export async function hashPin(pin: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const computed = await hashPin(pin);
  return computed === hash;
}

// ---- PIN aus dem Hash ermitteln ----------------------------
// Gespeichert wird ausschließlich der SHA-256-Hash (Firestore ist ohne
// Auth offen lesbar — ein Klartext-PIN in der Datenbank wäre schlechter
// als gar keine Anzeige). Damit der Admin einen vergessenen PIN dennoch
// vorlesen kann, probieren wir alle numerischen PINs der Länge 4–6
// durch: 4-stellige PINs sind sofort gefunden, der komplette Bereich
// (1,11 Mio. Kombinationen) braucht je nach Gerät einige Sekunden bis
// etwa eine Minute. Längere PINs lassen sich so nicht auflösen und
// müssen neu gesetzt werden.

export interface PinSucheOptionen {
  minLaenge?: number;
  maxLaenge?: number;
  /** Fortschritt in Prozent (0–100). */
  onFortschritt?: (prozent: number) => void;
  /** Wird regelmäßig abgefragt; true ⇒ Suche abbrechen. */
  abbruch?: () => boolean;
}

/**
 * Sucht den Klartext-PIN zu einem Hash. Liefert den PIN oder null, wenn
 * er im abgesuchten Bereich nicht vorkommt (oder abgebrochen wurde).
 */
export async function ermittlePinAusHash(
  hash: string,
  opts: PinSucheOptionen = {}
): Promise<string | null> {
  const minLaenge = opts.minLaenge ?? 4;
  const maxLaenge = opts.maxLaenge ?? 6;
  const gesamt = Array.from(
    { length: maxLaenge - minLaenge + 1 },
    (_, i) => 10 ** (minLaenge + i)
  ).reduce((a, b) => a + b, 0);

  let geprueft = 0;
  const BLOCK = 2048;

  for (let laenge = minLaenge; laenge <= maxLaenge; laenge++) {
    const anzahl = 10 ** laenge;
    for (let start = 0; start < anzahl; start += BLOCK) {
      if (opts.abbruch?.()) return null;
      const ende = Math.min(start + BLOCK, anzahl);
      const kandidaten: string[] = [];
      for (let n = start; n < ende; n++) kandidaten.push(String(n).padStart(laenge, '0'));
      const hashes = await Promise.all(kandidaten.map(hashPin));
      const treffer = hashes.indexOf(hash);
      if (treffer >= 0) {
        opts.onFortschritt?.(100);
        return kandidaten[treffer];
      }
      geprueft += ende - start;
      opts.onFortschritt?.(Math.round((geprueft / gesamt) * 100));
      // Event-Loop freigeben, damit Fortschritt/Abbruch greifen.
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return null;
}
