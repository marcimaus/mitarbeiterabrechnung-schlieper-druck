// =============================================================
// Verdienstbescheinigung Minijob — Druck-Komponente (A4)
// -------------------------------------------------------------
// Bescheinigt einem Minijob-Mitarbeiter den Brutto-Verdienst je
// Monat. Layout rekonstruiert den Schlieper-Druck-Briefbogen:
//   - oben rechts: Firmenlogo (PNG aus public/) + Kontaktblock
//   - unten links: kleines Logo + Firmenname
//   - Fußzeile: Bankverbindung (KSN) + Gerichtsstand
// Anschrift + Geschäftsführung tauchen nur in der Fußzeile auf
// (nicht im Inhalt). Fragen kommen über Props rein — Standard +
// optionale Zusatzfragen aus dem globalen Katalog.
//
// Seitenaufteilung: Der Inhalt wird in Blöcke zerlegt (Abschnitte,
// einzelne Monatszeilen, einzelne Fragen), deren Höhen in einem
// unsichtbaren Mess-Container ermittelt werden. Daraus entstehen
// feste A4-Seiten (210 × 297 mm) mit Fußzeile auf jeder Seite —
// Vorschau und Ausdruck sind damit identisch, und beim Druck bricht
// jede Seite sauber um. Die Monatstabelle wird auf Folgeseiten mit
// wiederholtem Tabellenkopf fortgesetzt.
// =============================================================

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Mitarbeiter } from '../types';
import { eur } from '../lib/abrechnungslogik';

interface MonatsBetrag {
  jahr: number;
  monat: number;
  bruttoEur: number;
}

interface FrageZeile {
  id: string;
  fragetext: string;
  antwortTyp: 'jaNein' | 'betrag' | 'text';
  antwort: string;  // 'Ja'/'Nein' bei jaNein (bereits gelabelt); freier String sonst
  /** Optionaler Zusatztext, der unter die Antwort gedruckt wird (z. B. Hinweis bei „Ja"). */
  zusatzText?: string;
}

const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function formatDatumDe(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE');
}

function antwortAnzeige(f: FrageZeile): string {
  if (f.antwortTyp === 'betrag') {
    const raw = f.antwort.trim();
    if (!raw) return '— (nicht beantwortet)';
    const num = parseFloat(raw.replace(',', '.'));
    return Number.isFinite(num) ? eur(num) : '—';
  }
  if (f.antwortTyp === 'text') {
    return f.antwort.trim() || '— (nicht beantwortet)';
  }
  // jaNein — Eingabe kann 'Ja'/'Nein' (bereits gelabelt) oder 'ja'/'nein' sein.
  // Leere Eingabe → bewusst „nicht beantwortet" markieren.
  const norm = f.antwort.trim().toLowerCase();
  if (norm === 'ja') return 'Ja';
  if (norm === 'nein') return 'Nein';
  return '— (nicht beantwortet)';
}

interface AdresskopfBlock {
  name?: string;
  strasse?: string;
  plz?: string;
  ort?: string;
}

// ---- Seitenaufteilung ----------------------------------------

type BlockArt = 'normal' | 'monatZeile' | 'frage';

interface Block {
  key: string;
  art: BlockArt;
  /** Block darf nicht als letzter auf einer Seite stehen (Überschriften). */
  mitNaechstem?: boolean;
  node: ReactNode;
}

interface Masse {
  seite: number;       // Seitenhöhe in px
  kopfErste: number;   // Briefkopf Seite 1 (inkl. Titel)
  kopfFolge: number;   // schmaler Kopf ab Seite 2
  fuss: number;        // Fußzeile
  bloecke: Record<string, number>;
}

const KEY_MONAT_FORTSETZUNG = 'monate-fortsetzung';
const KEY_FRAGEN_FORTSETZUNG = 'fragen-fortsetzung';

/** Verteilt die Blöcke anhand der gemessenen Höhen auf A4-Seiten. */
function paginiere(bloecke: Block[], fortsetzung: Record<string, Block>, m: Masse): Block[][] {
  // Sicherheitsabstand über der Fußzeile (Rundung, Druck-Skalierung).
  const reserve = m.seite * (6 / 297);
  const verfuegbar = (seitenIndex: number) =>
    m.seite - (seitenIndex === 0 ? m.kopfErste : m.kopfFolge) - m.fuss - reserve;
  const hoehe = (b: Block) => m.bloecke[b.key] ?? 0;

  const seiten: Block[][] = [[]];
  let rest = verfuegbar(0);
  for (let i = 0; i < bloecke.length; i++) {
    const b = bloecke[i];
    const naechster = bloecke[i + 1];
    const bedarf = hoehe(b) + (b.mitNaechstem && naechster ? hoehe(naechster) : 0);
    const aktuelle = seiten[seiten.length - 1];
    if (bedarf > rest && aktuelle.length > 0) {
      seiten.push([]);
      rest = verfuegbar(seiten.length - 1);
      // Tabelle / Fragenliste auf der neuen Seite mit Überschrift fortsetzen.
      const fs = b.art === 'monatZeile'
        ? fortsetzung[KEY_MONAT_FORTSETZUNG]
        : b.art === 'frage'
          ? fortsetzung[KEY_FRAGEN_FORTSETZUNG]
          : undefined;
      if (fs) {
        seiten[seiten.length - 1].push(fs);
        rest -= hoehe(fs);
      }
    }
    seiten[seiten.length - 1].push(b);
    rest -= hoehe(b);
  }
  return seiten;
}

export default function VerdienstbescheinigungDruck({
  mitarbeiter,
  taetigkeit,
  zeilen,
  durchschnittEur,
  standardFragen,
  zusatzFragen,
  anmerkung,
  adresskopf,
  betreffZusatz,
  onClose,
}: {
  mitarbeiter: Mitarbeiter;
  taetigkeit: string;
  zeilen: MonatsBetrag[];
  durchschnittEur: number;
  standardFragen: FrageZeile[];
  zusatzFragen: FrageZeile[];
  anmerkung: string;
  adresskopf: AdresskopfBlock | null;
  betreffZusatz: string;
  onClose: () => void;
}) {
  const adresskopfHatInhalt = !!adresskopf && (
    !!adresskopf.name?.trim() || !!adresskopf.strasse?.trim() ||
    !!adresskopf.plz?.trim() || !!adresskopf.ort?.trim()
  );
  const taetigkeitsText = taetigkeit.trim() || '—';
  const heuteIso = new Date().toISOString().slice(0, 10);
  const zeitraumLabel = zeilen.length > 0
    ? `${MONATSNAMEN[zeilen[0].monat - 1]} ${zeilen[0].jahr} – ${MONATSNAMEN[zeilen[zeilen.length - 1].monat - 1]} ${zeilen[zeilen.length - 1].jahr}`
    : '—';

  // Nur beantwortete Fragen drucken — leere/unbeantwortete bleiben aus dem Dokument heraus.
  const istBeantwortet = (f: FrageZeile): boolean => {
    const raw = f.antwort.trim();
    if (!raw) return false;
    if (f.antwortTyp === 'jaNein') {
      const norm = raw.toLowerCase();
      return norm === 'ja' || norm === 'nein';
    }
    return true;
  };
  const alleFragen: FrageZeile[] = [...standardFragen, ...zusatzFragen].filter(istBeantwortet);

  // ---- Kopf- und Fußbereiche -------------------------------------

  const kopfErste = (
    <div className="vb-kopfbereich">
      {/* ---- Briefkopf: Logo + Adressblock oben rechts ---- */}
      <div className="vb-kopf">
        <div /> {/* linker Slot bleibt frei */}
        <div>
          <img src="/schlieper-druck-logo.jpg" alt="Schlieper-Druck" className="vb-logo-img" />
          <div className="vb-kopf-adresse">
            Schützenweg 18<br />
            37170 Uslar<br />
            Tel. 05571 / 9203-0<br />
            Fax 05571 / 9203-33<br />
            info@schlieper-druck.com<br />
            www.schlieper-druck.com
          </div>
        </div>
      </div>

      <div className="vb-absender-zeile">
        Schlieper-Druck GmbH · Schützenweg 18 · 37170 Uslar
      </div>

      {/* Adresskopf (DIN-A4-Adressfenster). Bleibt leer wenn Modus 'keine'. */}
      <div className="vb-adresskopf">
        {adresskopfHatInhalt && adresskopf && (
          <>
            {adresskopf.name && <div>{adresskopf.name}</div>}
            {adresskopf.strasse && <div>{adresskopf.strasse}</div>}
            {(adresskopf.plz || adresskopf.ort) && (
              <div>{[adresskopf.plz, adresskopf.ort].filter(Boolean).join(' ')}</div>
            )}
          </>
        )}
      </div>

      <div className="vb-titelblock">
        <div className="vb-titel">Verdienstbescheinigung für {mitarbeiter.name}</div>
        <div className="vb-subtitel">Geringfügige Beschäftigung (Minijob) · Zeitraum {zeitraumLabel}</div>
        {betreffZusatz.trim() && (
          <div className="vb-betreff">{betreffZusatz}</div>
        )}
      </div>
    </div>
  );

  const kopfFolge = (
    <div className="vb-kopfbereich">
      <div className="vb-folgekopf">
        <span>Verdienstbescheinigung für {mitarbeiter.name}</span>
        <span>Schlieper-Druck GmbH</span>
      </div>
    </div>
  );

  const fuss = (seite: number, von: number) => (
    <div className="vb-fuss">
      <div className="vb-fuss-marke">
        <img src="/schlieper-druck-logo.jpg" alt="" />
        {von > 1 && <span className="vb-seitenzahl">Seite {seite} von {von}</span>}
      </div>
      <div className="vb-fuss-cols">
        <div>
          <b>Bankverbindung:</b><br />
          Kreis-Sparkasse Northeim<br />
          <span className="nowrap">IBAN: DE81 2625 0001 0000 2021 35</span><br />
          BIC: NOLADE21NOM
        </div>
        <div>
          <b>Geschäftsführung</b><br />
          Marc Schlieper, Dipl.-Kfm.<br />
          Christina Johanning, Dipl.-Psych.
        </div>
        <div>
          <b>Gerichtsstand Göttingen</b><br />
          Steuer-Nr. 35/200/01669<br />
          HRB 200949
        </div>
      </div>
    </div>
  );

  // ---- Inhaltsblöcke ---------------------------------------------

  const monatsColgroup = (
    <colgroup>
      <col className="vb-col-monat" />
      <col className="vb-col-betrag" />
    </colgroup>
  );
  const monatsTabellenkopf = (titel: string) => (
    <>
      <div className="vb-section-titel">{titel}</div>
      <table className="vb-monate vb-monate-kopf">
        {monatsColgroup}
        <thead>
          <tr>
            <th>Monat</th>
            <th style={{ textAlign: 'right' }}>Brutto-Verdienst</th>
          </tr>
        </thead>
      </table>
    </>
  );

  const bloecke: Block[] = [];
  bloecke.push({
    key: 'arbeitgeber',
    art: 'normal',
    node: (
      <div className="vb-section">
        <div className="vb-section-titel">Arbeitgeber</div>
        <table className="vb-daten">
          <tbody>
            <tr>
              <td className="label">Firma</td>
              <td>Schlieper-Druck GmbH</td>
            </tr>
            <tr>
              <td className="label">Betriebsnummer</td>
              <td>19930265</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
  });
  bloecke.push({
    key: 'arbeitnehmer',
    art: 'normal',
    node: (
      <div className="vb-section">
        <div className="vb-section-titel">Arbeitnehmer</div>
        <table className="vb-daten">
          <tbody>
            <tr>
              <td className="label">Mitarbeiternummer</td>
              <td>{mitarbeiter.nummer || '—'}</td>
            </tr>
            <tr>
              <td className="label">Anschrift</td>
              <td>
                {mitarbeiter.adresse.strasse}, {mitarbeiter.adresse.plz} {mitarbeiter.adresse.ort}
              </td>
            </tr>
            <tr>
              <td className="label">Geburtsdatum</td>
              <td>{formatDatumDe(mitarbeiter.geburtsdatum)}</td>
            </tr>
            <tr>
              <td className="label">Sozialversicherungsnummer</td>
              <td>{mitarbeiter.sozialversicherungsNummer || '—'}</td>
            </tr>
            <tr>
              <td className="label">Beginn der Beschäftigung</td>
              <td>{formatDatumDe(mitarbeiter.startDatum)}</td>
            </tr>
            {mitarbeiter.abgemeldet && (
              <tr>
                <td className="label">Hinweis</td>
                <td><strong>Das Beschäftigungsverhältnis ist beendet.</strong></td>
              </tr>
            )}
            <tr>
              <td className="label">Tätigkeit</td>
              <td>{taetigkeitsText}</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
  });

  // Monatstabelle: Kopf + jede Zeile als eigener Block, damit sie über
  // Seiten hinweg umbrechen kann. Die Einzeltabellen haben feste
  // Spaltenbreiten und schließen randlos aneinander an.
  bloecke.push({
    key: 'monate-kopf',
    art: 'normal',
    mitNaechstem: true,
    node: monatsTabellenkopf('Verdienst (Brutto)'),
  });
  for (const z of zeilen) {
    bloecke.push({
      key: `monat-${z.jahr}-${z.monat}`,
      art: 'monatZeile',
      node: (
        <table className="vb-monate">
          {monatsColgroup}
          <tbody>
            <tr>
              <td>{MONATSNAMEN[z.monat - 1]} {z.jahr}</td>
              <td className="eur">{eur(z.bruttoEur)}</td>
            </tr>
          </tbody>
        </table>
      ),
    });
  }
  bloecke.push({
    key: 'monate-summe',
    art: 'monatZeile',
    node: (
      <table className="vb-monate vb-monate-ende">
        {monatsColgroup}
        <tbody>
          <tr className="summe">
            <td>Durchschnitt ({zeilen.length} {zeilen.length === 1 ? 'Monat' : 'Monate'})</td>
            <td className="eur">{eur(durchschnittEur)}</td>
          </tr>
        </tbody>
      </table>
    ),
  });

  if (alleFragen.length > 0) {
    bloecke.push({
      key: 'fragen-kopf',
      art: 'normal',
      mitNaechstem: true,
      node: <div className="vb-section-titel">Weitere Angaben</div>,
    });
    alleFragen.forEach((f, idx) => {
      bloecke.push({
        key: `frage-${f.id}`,
        art: 'frage',
        node: (
          <ol className={`vb-fragen${idx === alleFragen.length - 1 ? ' vb-fragen-ende' : ''}`} start={idx + 1}>
            <li>
              {f.fragetext}
              <span className="antwort">{antwortAnzeige(f)}</span>
              {f.zusatzText && (
                <div className="zusatz">{f.zusatzText}</div>
              )}
            </li>
          </ol>
        ),
      });
    });
  }

  if (anmerkung) {
    bloecke.push({
      key: 'anmerkung',
      art: 'normal',
      node: (
        <div className="vb-section">
          <div className="vb-section-titel">Anmerkung</div>
          <div className="vb-anmerkung">{anmerkung}</div>
        </div>
      ),
    });
  }

  bloecke.push({
    key: 'unterschrift',
    art: 'normal',
    node: (
      <div className="vb-unterschrift">
        <div>
          <div className="linie" />
          <div className="label">Ort, Datum (Uslar, {formatDatumDe(heuteIso)})</div>
        </div>
        <div>
          <div className="linie" />
          <div className="label">Unterschrift Arbeitgeber</div>
        </div>
      </div>
    ),
  });

  const fortsetzung: Record<string, Block> = {
    [KEY_MONAT_FORTSETZUNG]: {
      key: KEY_MONAT_FORTSETZUNG,
      art: 'normal',
      node: monatsTabellenkopf('Verdienst (Brutto) – Fortsetzung'),
    },
    [KEY_FRAGEN_FORTSETZUNG]: {
      key: KEY_FRAGEN_FORTSETZUNG,
      art: 'normal',
      node: <div className="vb-section-titel">Weitere Angaben – Fortsetzung</div>,
    },
  };

  // ---- Messen -----------------------------------------------------

  const messRef = useRef<HTMLDivElement>(null);
  const [masse, setMasse] = useState<Masse | null>(null);
  const [, setMessTick] = useState(0);

  // Nach dem Laden der Schriften (und des Logos) neu messen.
  useEffect(() => {
    let aktiv = true;
    document.fonts?.ready.then(() => { if (aktiv) setMessTick((t) => t + 1); });
    return () => { aktiv = false; };
  }, []);

  useLayoutEffect(() => {
    const root = messRef.current;
    if (!root) return;
    const h = (sel: string) => root.querySelector<HTMLElement>(sel)?.getBoundingClientRect().height ?? 0;
    const bloeckeH: Record<string, number> = {};
    root.querySelectorAll<HTMLElement>('[data-block]').forEach((el) => {
      bloeckeH[el.dataset.block!] = el.getBoundingClientRect().height;
    });
    const neu: Masse = {
      seite: h('[data-mess="seite"]'),
      kopfErste: h('[data-mess="kopf-erste"]'),
      kopfFolge: h('[data-mess="kopf-folge"]'),
      fuss: h('[data-mess="fuss"]'),
      bloecke: bloeckeH,
    };
    setMasse((alt) => (alt && JSON.stringify(alt) === JSON.stringify(neu) ? alt : neu));
  });

  const seiten: Block[][] = masse ? paginiere(bloecke, fortsetzung, masse) : [bloecke];
  const blockDiv = (b: Block) => (
    <div key={b.key} className="vb-block">{b.node}</div>
  );

  const seitenJsx = seiten.map((inhalt, i) => (
    <div className="vb-seite" key={i}>
      {i === 0 ? kopfErste : kopfFolge}
      <div className="vb-inhalt">{inhalt.map(blockDiv)}</div>
      {fuss(i + 1, seiten.length)}
    </div>
  ));

  const messJsx = (
    <div ref={messRef} className="vb-mess" aria-hidden="true">
      <div data-mess="seite" style={{ height: '297mm' }} />
      <div data-mess="kopf-erste">{kopfErste}</div>
      <div data-mess="kopf-folge">{kopfFolge}</div>
      <div data-mess="fuss">{fuss(1, 2)}</div>
      <div className="vb-inhalt">
        {[...bloecke, ...Object.values(fortsetzung)].map((b) => (
          <div key={b.key} data-block={b.key} className="vb-block">{b.node}</div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          /* Nur die Bescheinigung drucken: die komplette App (#root)
             verschwindet, der Druckbereich hängt direkt an <body>. */
          #root { display: none !important; }
          body { margin: 0; background: white !important; }
          .vb-druckbereich { display: block !important; }
          .vb-druckbereich .vb-seite {
            height: 296.5mm;
            break-after: page;
            page-break-after: always;
          }
          .vb-druckbereich .vb-seite:last-child {
            break-after: auto;
            page-break-after: auto;
          }
        }
        @media screen {
          .vb-druckbereich { display: none; }
          .vb-vorschau .vb-seite {
            background: white;
            box-shadow: 0 2px 12px rgba(0,0,0,0.18);
            margin: 24px auto;
          }
        }
        .vb-mess {
          position: absolute;
          left: -10000px;
          top: 0;
          width: 210mm;
          visibility: hidden;
          pointer-events: none;
        }
        .vb-mess .vb-fuss { position: static; }
        .vb-mess > div,
        .vb-kopfbereich,
        .vb-block { display: flow-root; }
        .vb-seite,
        .vb-mess {
          font-family: 'Helvetica Neue', Arial, sans-serif;
          color: #1f2937;
          font-size: 10pt;
          line-height: 1.4;
          box-sizing: border-box;
        }
        .vb-seite {
          width: 210mm;
          height: 297mm;
          padding: 0;
          position: relative;
          overflow: hidden;
          background: white;
        }
        .vb-kopf {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 12mm 18mm 0 18mm;
        }
        .vb-logo-img {
          height: 24mm;
          width: auto;
          display: block;
          margin-left: auto;
        }
        .vb-kopf-adresse {
          font-size: 8.5pt;
          color: #374151;
          line-height: 1.45;
          text-align: right;
          margin-top: 4pt;
        }
        .vb-absender-zeile {
          padding: 6mm 18mm 0 18mm;
          font-size: 7pt;
          color: #6b7280;
        }
        .vb-adresskopf {
          padding: 4mm 18mm 0 18mm;
          font-size: 10pt;
          line-height: 1.35;
          color: #111827;
          min-height: 35mm;
        }
        .vb-titelblock {
          padding: 6mm 18mm 0 18mm;
        }
        .vb-folgekopf {
          margin: 12mm 18mm 8mm 18mm;
          padding-bottom: 3pt;
          border-bottom: 0.5pt solid #9ca3af;
          display: flex;
          justify-content: space-between;
          font-size: 8.5pt;
          color: #4b5563;
        }
        .vb-betreff {
          margin-top: 6pt;
          margin-bottom: 10pt;
          font-weight: 700;
          font-size: 10pt;
          color: #111827;
        }
        .vb-inhalt {
          padding: 0 18mm;
        }
        .vb-titel {
          font-size: 14pt;
          font-weight: 700;
          margin-bottom: 10pt;
          letter-spacing: 0.3px;
        }
        .vb-subtitel {
          font-size: 10pt;
          color: #6b7280;
          margin-bottom: 14pt;
        }
        .vb-section {
          margin-bottom: 10pt;
        }
        .vb-section-titel {
          font-weight: 700;
          margin-bottom: 4pt;
          color: #111827;
        }
        table.vb-daten {
          border-collapse: collapse;
          width: 100%;
          font-size: 9.5pt;
        }
        table.vb-daten td {
          padding: 2pt 6pt 2pt 0;
          vertical-align: top;
        }
        table.vb-daten td.label {
          color: #4b5563;
          width: 40%;
        }
        table.vb-monate {
          border-collapse: collapse;
          table-layout: fixed;
          width: 70%;
          font-size: 9.5pt;
        }
        table.vb-monate col.vb-col-monat { width: 55%; }
        table.vb-monate col.vb-col-betrag { width: 45%; }
        table.vb-monate th,
        table.vb-monate td {
          border: 0.5pt solid #6b7280;
          border-top: none;
          padding: 3pt 6pt;
        }
        table.vb-monate th {
          border-top: 0.5pt solid #6b7280;
          background: #f3f4f6;
          font-weight: 600;
          text-align: left;
        }
        table.vb-monate td.eur {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        table.vb-monate tr.summe td {
          font-weight: 700;
          background: #f9fafb;
        }
        table.vb-monate-ende {
          margin-bottom: 10pt;
        }
        ol.vb-fragen {
          margin: 0;
          padding-left: 18pt;
        }
        ol.vb-fragen li {
          margin-bottom: 4pt;
        }
        ol.vb-fragen-ende {
          margin-bottom: 6pt;
        }
        ol.vb-fragen .antwort {
          font-weight: 600;
          margin-left: 4pt;
        }
        ol.vb-fragen .zusatz {
          font-size: 8.5pt;
          color: #4b5563;
          font-style: italic;
          margin-top: 1pt;
        }
        .vb-anmerkung {
          margin-top: 8pt;
          padding: 6pt 8pt;
          border: 0.5pt solid #d1d5db;
          background: #f9fafb;
          font-size: 9.5pt;
          white-space: pre-wrap;
        }
        .vb-unterschrift {
          margin-top: 14pt;
          display: flex;
          justify-content: space-between;
          gap: 24pt;
        }
        .vb-unterschrift > div {
          flex: 1;
        }
        .vb-unterschrift .linie {
          border-bottom: 0.5pt solid #1f2937;
          height: 28pt;
        }
        .vb-unterschrift .label {
          font-size: 8.5pt;
          color: #4b5563;
          margin-top: 3pt;
        }
        .vb-fuss {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          padding: 6mm 18mm 8mm 18mm;
          font-size: 7.5pt;
          color: #4b5563;
        }
        .vb-fuss-marke {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8pt;
          margin-bottom: 6pt;
        }
        .vb-fuss-marke img {
          height: 10mm;
          width: auto;
        }
        .vb-seitenzahl {
          font-size: 8pt;
          color: #4b5563;
        }
        .vb-fuss-cols {
          display: grid;
          grid-template-columns: 2fr 1.3fr 1fr;
          gap: 12pt;
        }
        .vb-fuss-cols b {
          color: #1f2937;
          font-weight: 700;
        }
        .vb-fuss-cols .nowrap {
          white-space: nowrap;
        }
      `}</style>

      <div className="no-print fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">
            Verdienstbescheinigung — {mitarbeiter.name}
          </span>
          <span className="text-xs text-gray-500">
            A4 · {seiten.length} {seiten.length === 1 ? 'Seite' : 'Seiten'}
          </span>
          <div className="ml-auto">
            <button
              onClick={() => window.print()}
              className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              🖨️ Drucken
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-200">
          <div className="vb-vorschau">
            {seitenJsx}
          </div>
        </div>

        {messJsx}
      </div>

      {/* ---- Echter Druckbereich: direkt an <body> gehängt, damit beim
              Drucken die komplette App (#root) ausgeblendet werden kann
              und die Seiten ganz normal umbrechen. ---- */}
      {createPortal(
        <div className="vb-druckbereich">{seitenJsx}</div>,
        document.body,
      )}
    </>
  );
}
