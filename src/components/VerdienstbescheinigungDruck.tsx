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
// =============================================================

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

  const seiteJsx = (
    <div className="vb-seite">
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

      <div className="vb-inhalt">
        <div className="vb-titel">Verdienstbescheinigung für {mitarbeiter.name}</div>
        <div className="vb-subtitel">Geringfügige Beschäftigung (Minijob) · Zeitraum {zeitraumLabel}</div>
        {betreffZusatz.trim() && (
          <div className="vb-betreff">{betreffZusatz}</div>
        )}

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

        <div className="vb-section">
          <div className="vb-section-titel">Verdienst (Brutto)</div>
          <table className="vb-monate">
            <thead>
              <tr>
                <th>Monat</th>
                <th style={{ textAlign: 'right' }}>Brutto-Verdienst</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={`${z.jahr}-${z.monat}`}>
                  <td>{MONATSNAMEN[z.monat - 1]} {z.jahr}</td>
                  <td className="eur">{eur(z.bruttoEur)}</td>
                </tr>
              ))}
              <tr className="summe">
                <td>Durchschnitt ({zeilen.length} Monate)</td>
                <td className="eur">{eur(durchschnittEur)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {alleFragen.length > 0 && (
          <div className="vb-section vb-fragen">
            <div className="vb-section-titel">Weitere Angaben</div>
            <ol>
              {alleFragen.map((f) => (
                <li key={f.id}>
                  {f.fragetext}
                  <span className="antwort">{antwortAnzeige(f)}</span>
                  {f.zusatzText && (
                    <div className="zusatz">{f.zusatzText}</div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {anmerkung && (
          <div className="vb-section">
            <div className="vb-section-titel">Anmerkung</div>
            <div className="vb-anmerkung">{anmerkung}</div>
          </div>
        )}

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
      </div>

      <div className="vb-fuss">
        <div className="vb-fuss-marke">
          <img src="/schlieper-druck-logo.jpg" alt="" />
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
    </div>
  );

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body * { visibility: hidden !important; }
          .vb-druckbereich,
          .vb-druckbereich * { visibility: visible !important; }
          .vb-druckbereich {
            position: absolute;
            inset: 0;
            background: white;
          }
          .no-print { display: none !important; }
          body { margin: 0; }
        }
        @media screen {
          .vb-seite {
            background: white;
            box-shadow: 0 2px 12px rgba(0,0,0,0.18);
            margin: 24px auto;
          }
        }
        .vb-seite {
          width: 210mm;
          min-height: 297mm;
          padding: 0;
          position: relative;
          box-sizing: border-box;
          font-family: 'Helvetica Neue', Arial, sans-serif;
          color: #1f2937;
          font-size: 10pt;
          line-height: 1.4;
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
        .vb-betreff {
          margin-top: 6pt;
          margin-bottom: 10pt;
          font-weight: 700;
          font-size: 10pt;
          color: #111827;
        }
        .vb-inhalt {
          padding: 6mm 18mm 40mm 18mm;
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
          width: 70%;
          margin-top: 4pt;
          font-size: 9.5pt;
        }
        table.vb-monate th,
        table.vb-monate td {
          border: 0.5pt solid #6b7280;
          padding: 3pt 6pt;
        }
        table.vb-monate th {
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
        .vb-fragen ol {
          margin: 0;
          padding-left: 18pt;
        }
        .vb-fragen li {
          margin-bottom: 4pt;
        }
        .vb-fragen .antwort {
          font-weight: 600;
          margin-left: 4pt;
        }
        .vb-fragen .zusatz {
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
          gap: 8pt;
          margin-bottom: 6pt;
        }
        .vb-fuss-marke img {
          height: 10mm;
          width: auto;
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
            {seiteJsx}
          </div>
        </div>
      </div>

      {/* ---- Echter Druckbereich: nur beim Drucken sichtbar, OUTSIDE des
              .no-print Overlays. Sonst würde `display:none` des Overlays
              den Inhalt mit wegschmeißen → leeres PDF. ---- */}
      <div className="vb-druckbereich hidden print:block">
        {seiteJsx}
      </div>
    </>
  );
}
