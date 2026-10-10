// Bulk re-parse: processes a list of {cacheSuffix, fileId, name, year, month} entries.
// Called with: node bulk-reparse.mjs <queue-json>
// queue-json: path to a JSON array of {cacheSuffix, fileId, name, year, month, korrektur?}
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const queueFile = process.argv[2];
if (!queueFile) { console.error('Usage: node bulk-reparse.mjs <queue-json>'); process.exit(1); }

const queue = JSON.parse(readFileSync(queueFile, 'utf8'));
const toolResultsDir = 'C:\\Users\\marcs\\.claude\\projects\\C--Users-marcs-Documents-Claude-Projects-Mitarbeiterabrechnung-gesamt\\543a7573-00b1-44ad-8e02-9fd659c51e91\\tool-results';
const tmpPdf = 'tmp_bulk.pdf';

let ok = 0, err = 0;
for (const f of queue) {
  const cachePath = join(toolResultsDir, `mcp-bf5e59df-bdb9-436b-bbba-e325e9994df4-download_file_content-${f.cacheSuffix}`);
  if (!existsSync(cachePath)) {
    console.log(`SKIP (kein Cache): ${f.year}-${f.month} ${f.name}`);
    continue;
  }
  const j = JSON.parse(readFileSync(cachePath, 'utf8'));
  writeFileSync(tmpPdf, Buffer.from(j.content, 'base64'));
  const korr = f.korrektur ? ' --korrektur' : '';
  const cmd = `node parse-lohnbuero-pdf.mjs ${tmpPdf} ${f.fileId} "${f.name}" ${f.year} ${f.month}${korr}`;
  try {
    const out = execSync(cmd, { encoding: 'utf8' });
    const last = out.trim().split('\n').pop();
    console.log(`OK ${f.year}-${String(f.month).padStart(2,'0')} ${last}`);
    ok++;
  } catch (e) {
    console.error(`ERR ${f.year}-${f.month} ${f.name}: ${e.message.slice(0, 120)}`);
    err++;
  } finally {
    try { unlinkSync(tmpPdf); } catch {}
  }
}
console.log(`\nFertig: ${ok} OK, ${err} Fehler.`);
