import XLSX from 'xlsx';
const wb = XLSX.readFile('C:/Users/marcs/Desktop/Stammdatenimpoort.ods');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
const weirdSt = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const nr = String(r[1] ?? '').trim();
  if (!nr) continue;
  const st = String(r[19] ?? '').trim();
  const stripped = st.replace(/\s/g,'');
  if (!st) continue;
  if (st.toLowerCase() === 'x') continue;
  if (st === '-') continue;
  if (/^\d{11}$/.test(stripped)) continue;
  weirdSt.push(`${nr}: "${st}"`);
}
console.log('Steuer-ID weder x/-/leer/11 Ziffern:', weirdSt.length);
weirdSt.forEach(s => console.log(' ', s));
