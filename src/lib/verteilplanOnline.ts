// Erinnerung „Verteilplan online aktualisieren"
//
// Auf der Webseite können Beilagenkunden den Verteilplan ansehen und Beilagen
// bestellen; der Kundenpreis hängt im Wesentlichen von der Stückzahl ab.
// Grundlage ist das „PDF blanko" aus „Verteilplan & Bestellungen". Ändert
// sich eine buchbare Stückzahl, ist die Online-Version veraltet — die App
// merkt sich das in `meta/parameter` und zeigt einen Hinweis, bis jemand das
// Aktualisieren mit „Erledigt" bestätigt.

import type { Teilgebiet, Tour } from '../types';
import { ladeParameter, speichereParameter } from './db';
import { buchbareTeilgebiete } from './beilagenVorlagen';

type TgStand = Pick<Teilgebiet, 'name' | 'stueckzahl' | 'isActive' | 'nichtImVerteilplan' | 'tourId'>;

const stk = (n: number) => `${n.toLocaleString('de-DE')} Stk`;

function istBuchbar(tg: TgStand, touren: Tour[]): boolean {
  return buchbareTeilgebiete([tg as Teilgebiet], touren).length > 0;
}

/**
 * Beschreibt, wie sich ein Teilgebiet auf den Verteilplan auswirkt — oder
 * null, wenn die Online-Version davon nicht betroffen ist. `alt === null`
 * heißt: Teilgebiet neu angelegt.
 */
export function verteilplanRelevanteAenderung(
  alt: TgStand | null,
  neu: TgStand,
  touren: Tour[],
): string | null {
  const warBuchbar = alt ? istBuchbar(alt, touren) : false;
  const istJetztBuchbar = istBuchbar(neu, touren);
  if (!warBuchbar && !istJetztBuchbar) return null;
  if (!warBuchbar) return `${neu.name}: neu im Verteilplan (${stk(neu.stueckzahl)})`;
  if (!istJetztBuchbar) return `${neu.name}: nicht mehr im Verteilplan (bisher ${stk(alt!.stueckzahl)})`;
  if (alt!.stueckzahl !== neu.stueckzahl) {
    return `${neu.name}: ${stk(alt!.stueckzahl)} → ${stk(neu.stueckzahl)}`;
  }
  return null;
}

/** Änderung vormerken — der Hinweis bleibt, bis er als erledigt markiert wird. */
export async function merkeVerteilplanOnlineAenderung(text: string): Promise<void> {
  const p = await ladeParameter();
  const offen = p?.verteilplanOnlineHinweis;
  const datum = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  await speichereParameter({
    verteilplanOnlineHinweis: {
      seit: offen?.seit ?? Date.now(),
      aenderungen: [...(offen?.aenderungen ?? []), `${text} (${datum})`],
    },
  });
}

export async function verteilplanOnlineErledigt(): Promise<void> {
  await speichereParameter({ verteilplanOnlineHinweis: null });
}
