import XLSX from 'xlsx';
const wb = XLSX.readFile('C:/Users/marcs/Desktop/Stammdatenimpoort.ods');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
let mitDaten = 0;
let mitTel = 0;
let mitSteuerId = 0;
const beispieleTel = [];
const beispieleSt = [];
const allTelSamples = new Set();
const allStSamples = new Set();
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const nr = String(r[1] ?? '').trim();
  const nach = String(r[2] ?? '').trim();
  const tel = String(r[4] ?? '').trim();
  const st = String(r[19] ?? '').trim();
  if (!nr) continue;
  if (nach || tel || st) mitDaten++;
  if (tel) { mitTel++; allTelSamples.add(tel); if (beispieleTel.length < 30) beispieleTel.push(`${nr} ${nach}: "${tel}"`); }
  if (st) { mitSteuerId++; allStSamples.add(st); if (beispieleSt.length < 30) beispieleSt.push(`${nr} ${nach}: "${st}"`); }
}
console.log('Zeilen mit Nr:', rows.filter((r,i)=>i>0 && String(r[1]??'').trim()).length);
console.log('Zeilen mit irgendwelchen Daten:', mitDaten);
console.log('Zeilen mit Tel:', mitTel);
console.log('Zeilen mit Steuer-ID:', mitSteuerId);
console.log('\n--- Tel-Beispiele (30) ---');
beispieleTel.forEach(s => console.log(s));
console.log('\n--- Steuer-ID-Beispiele (30) ---');
beispieleSt.forEach(s => console.log(s));
