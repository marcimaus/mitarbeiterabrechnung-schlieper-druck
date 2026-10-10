// Öffentliche Straßenliste eines Teilgebiets — ohne Login.
// Aufruf via: /strassenliste?tg=<teilgebietId>
//
// Die Austräger erreichen diese Seite über den zweiten QR-Code auf dem
// Lieferschein. Sie sehen die Straßen ihres Gebiets mit Stückzahl und können
// pro Straße den hinterlegten PlusCode (Google Maps) antippen. Außerdem wird
// — falls vorhanden — der Karten-Link (z. B. Google My Maps) des Teilgebiets
// bzw. der zugehörigen Tour als großer Button angeboten.

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Teilgebiet, Tour } from '../types';

// Effektiver Karten-Link: TG-Override hat Vorrang, sonst Tour-Default.
// (Spiegelt `effektiverKartenLink` aus TeilgebieteScreen, hier ohne Import
//  da diese Hilfsfunktion dort nicht exportiert wird.)
function effektiverKartenLink(
  kartenLink: string | undefined,
  tour: Tour | null,
): string | null {
  const override = kartenLink?.trim();
  if (override) return override;
  const tourLink = tour?.kartenLink?.trim();
  return tourLink ? tourLink : null;
}

export default function StrassenlisteScreen() {
  const [searchParams] = useSearchParams();
  const teilgebietId = searchParams.get('tg') ?? '';

  const [teilgebiet, setTeilgebiet] = useState<Teilgebiet | null>(null);
  const [tour, setTour] = useState<Tour | null>(null);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    if (!teilgebietId) {
      setFehler('Kein Teilgebiet-Link angegeben.');
      setLoading(false);
      return;
    }
    loadAlles();
  }, [teilgebietId]);

  async function loadAlles() {
    setLoading(true);
    setFehler('');
    try {
      const tgSnap = await getDoc(doc(db, 'teilgebiete', teilgebietId));
      if (!tgSnap.exists()) {
        setFehler('Teilgebiet nicht gefunden. Bitte wende dich ans Büro.');
        setLoading(false);
        return;
      }
      const tg = { id: tgSnap.id, ...tgSnap.data() } as Teilgebiet;
      setTeilgebiet(tg);

      // Tour für den Karten-Link-Default laden (optional)
      if (tg.tourId) {
        const tourSnap = await getDoc(doc(db, 'touren', tg.tourId));
        if (tourSnap.exists()) {
          setTour({ id: tourSnap.id, ...tourSnap.data() } as Tour);
        }
      }
    } catch (err) {
      console.error(err);
      setFehler('Fehler beim Laden. Bitte Seite neu laden.');
    } finally {
      setLoading(false);
    }
  }

  // ---- Render -----------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-3 animate-spin">⏳</div>
          <p>Lade Straßenliste…</p>
        </div>
      </div>
    );
  }

  if (fehler) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-6 max-w-sm w-full text-center">
          <div className="text-5xl mb-3">⚠️</div>
          <p className="text-gray-700 font-medium">{fehler}</p>
        </div>
      </div>
    );
  }

  const strassen = teilgebiet?.strassen ?? [];
  const summe = strassen.reduce((s, r) => s + (r.stueckzahl || 0), 0);
  const kartenLink = effektiverKartenLink(teilgebiet?.kartenLink, tour);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-800 text-white px-4 py-5">
        <div className="max-w-lg mx-auto">
          <p className="text-blue-200 text-sm font-medium uppercase tracking-wide">Straßenliste</p>
          <h1 className="text-2xl font-bold mt-0.5">
            {teilgebiet?.name}
            {teilgebiet?.plz && (
              <span className="text-blue-300 text-lg font-normal ml-2">{teilgebiet.plz}</span>
            )}
          </h1>
          <p className="text-blue-200 text-sm mt-1">
            {strassen.length} Straße{strassen.length === 1 ? '' : 'n'} · {summe.toLocaleString('de-DE')} Stück · Schlieper-Druck
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Karten-Link (Google My Maps o. ä.) */}
        {kartenLink && (
          <a
            href={kartenLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-xl px-4 py-3 shadow-sm"
          >
            🗺️ Gebietskarte öffnen
          </a>
        )}

        {/* Straßen-Liste */}
        {strassen.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">
            <span className="text-4xl">📋</span>
            <p className="text-gray-600 mt-2">Für dieses Teilgebiet ist noch keine Straßenliste hinterlegt.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
            {strassen.map((s) => {
              const plus = s.plusCode?.trim();
              const inner = (
                <>
                  <div className="min-w-0">
                    <div className="font-medium text-gray-800 truncate">{s.strassenname}</div>
                    <div className="text-xs text-gray-500">
                      {s.stueckzahl.toLocaleString('de-DE')} Stück
                      {plus && <span className="ml-2 font-mono text-blue-600">📍 {plus}</span>}
                    </div>
                  </div>
                  {plus && <span className="text-blue-600 text-xl shrink-0">›</span>}
                </>
              );
              return plus ? (
                <a
                  key={s.id}
                  href={`https://plus.codes/${encodeURIComponent(plus)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-blue-50 active:bg-blue-100"
                >
                  {inner}
                </a>
              ) : (
                <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  {inner}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-gray-400 text-xs pb-6 pt-2">
          Schlieper-Druck GmbH · Straßenliste {teilgebiet?.name}
        </div>
      </div>
    </div>
  );
}
