import XLSX from 'xlsx';
const wb = XLSX.readFile('C:/Users/marcs/Desktop/Stammdatenimpoort.ods');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

// Show all unique non-trivial Steuer-IDs and tel separators
const stPatterns = { x: 0, leer: 0, ziffern: 0, andere: [] };
const telWithComma = [];
const telWithSlash = [];
const telWithMobil = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const nr = String(r[1] ?? '').trim();
  if (!nr) continue;
  const tel = String(r[4] ?? '').trim();
  const st = String(r[19] ?? '').trim();
  if (!st) stPatterns.leer++;
  else if (st.toLowerCase() === 'x') stPatterns.x++;
  else if (/^\d{11}$/.test(st.replace(/\s/g,''))) stPatterns.ziffern++;
  else stPatterns.andere.push(`${nr}: "${st}"`);
  if (tel.includes(',')) telWithComma.push(`${nr}: "${tel}"`);
  if (tel.includes('/')) telWithSlash.push(`${nr}: "${tel}"`);
  if (/01[567]/.test(tel)) telWithMobil.push(`${nr}: "${tel}"`);
}
console.log('Steuer-ID Verteilung:', stPatterns);
console.log(`Tel mit Komma: ${telWithComma.length}`);
telWithComma.slice(0,30).forEach(s => console.log(' ', s));
console.log(`Tel mit / : ${telWithSlash.length}`);
telWithSlash.slice(0,20).forEach(s => console.log(' ', s));
console.log(`Tel mit 015/016/017 (mobile): ${telWithMobil.length}`);
telWithMobil.slice(0,40).forEach(s => console.log(' ', s));
