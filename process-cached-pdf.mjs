// Helper: Write cached Drive download to PDF and run parser.
// Usage: node process-cached-pdf.mjs <cachePath> <fileId> <fileName> <jahr> <monat> [--korrektur]
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const [cachePath, fileId, fileName, jahrStr, monatStr, ...rest] = process.argv.slice(2);
if (!cachePath || !fileId || !fileName || !jahrStr || !monatStr) {
  console.error('Usage: node process-cached-pdf.mjs <cachePath> <fileId> <fileName> <jahr> <monat> [--korrektur]');
  process.exit(1);
}
const istKorrektur = rest.includes('--korrektur');
const tmpPdf = 'tmp_bulk.pdf';

const j = JSON.parse(readFileSync(cachePath, 'utf8'));
writeFileSync(tmpPdf, Buffer.from(j.content, 'base64'));

const cmd = `node parse-lohnbuero-pdf.mjs ${tmpPdf} ${fileId} "${fileName}" ${jahrStr} ${monatStr}${istKorrektur ? ' --korrektur' : ''}`;
try {
  const out = execSync(cmd, { encoding: 'utf8' });
  process.stdout.write(out);
} catch (e) {
  console.error('Parse-Fehler:', e.message);
} finally {
  try { unlinkSync(tmpPdf); } catch {}
}
