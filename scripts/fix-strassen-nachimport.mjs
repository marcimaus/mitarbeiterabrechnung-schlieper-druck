// Straßenlisten nachimportieren, die beim Erstimport (import-firestore.mjs)
// wegen abweichender Namen zwischen App-TG und Doku-Blatt nicht zugeordnet
// wurden (z. B. „Vernawahlsh." ↔ Blatt „Vernawahlshausen").
// Quelle: Google-Drive-Doku „Gebietsdokumentation mit Protokoll
// Mengenprüfungen", als .xlsx exportiert.
//
// Aufruf: node scripts/fix-strassen-nachimport.mjs <doku.xlsx> [--apply]
import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDocs, updateDoc, addDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const [, , XLSX_PATH, flag] = process.argv;
const APPLY = flag === '--apply';

// App-Teilgebietsname → Blattname in der Doku
const ZUORDNUNG = {
  'Vernawahlsh.': 'Vernawahlshausen',
  'Lichtenborn': 'LichtenbornGoseplack',
  'Espol': 'Espol',
  'Üssinghausen': 'Üssinghausen',
};

const app = initializeApp({
  apiKey: 'AIzaSyBGbMres7hAZLIaku_IAC4UAYKZyPNthNg',
  authDomain: 'mitarbeiterabrechnung-sdruck.firebaseapp.com',
  projectId: 'mitarbeiterabrechnung-sdruck',
});
const db = getFirestore(app);

function leseStrassen(rows) {
  const strassen = [];
  let idCnt = 1;
  for (let i = 3; i < rows.length; i++) {
    const col0 = String(rows[i][0] ?? '').trim();
    if (!col0) continue;
    const lo = col0.toLowerCase();
    // Straßenblock endet mit dem ersten Abschnittstitel
    if (lo.startsWith('sonderauslage') || lo.startsWith('nicht zu beliefern') || lo.startsWith('besonderheit')) break;
    if (lo.startsWith('rest nach') || lo.startsWith('summe')) continue;
    const stueck = typeof rows[i][1] === 'number' && rows[i][1] > 0 ? Math.round(rows[i][1]) : 0;
    const plusCode = String(rows[i][2] ?? '').trim().replace('https://plus.codes/', '');
    strassen.push({ id: String(idCnt++), strassenname: col0, stueckzahl: stueck, ...(plusCode ? { plusCode } : {}) });
  }
  return strassen;
}

const wb = XLSX.readFile(XLSX_PATH);
const snap = await getDocs(collection(db, 'teilgebiete'));

for (const [tgName, blatt] of Object.entries(ZUORDNUNG)) {
  const d = snap.docs.find((x) => x.data().name === tgName);
  if (!d) { console.log(`✗ TG „${tgName}" nicht gefunden`); continue; }
  const tg = d.data();
  const strassen = leseStrassen(XLSX.utils.sheet_to_json(wb.Sheets[blatt], { header: 1, defval: '' }));
  console.log(`\n${tgName} (Blatt „${blatt}"): ${strassen.length} Straße(n), Stückzahl ${tg.stueckzahl}`);
  strassen.forEach((s) => console.log(`   ${s.strassenname}  ${s.plusCode ?? ''}`));

  const update = { stueckzahlManuell: true, aktualisiertAm: Date.now() };
  if ((tg.strassen ?? []).length === 0 && strassen.length > 0) update.strassen = strassen;
  if (!APPLY) continue;

  await updateDoc(doc(db, 'teilgebiete', d.id), update);
  const log = (feld, alt, neu, beschreibung) => addDoc(collection(db, 'auditlog'), {
    adminName: 'Claude (Nachimport)', bereich: 'teilgebiet-stammdaten', aktion: 'geaendert',
    teilgebietId: d.id, teilgebietName: tgName, mitarbeiterId: null, mitarbeiterName: null,
    feld, altWert: alt, neuWert: neu, beschreibung, zeitstempel: Date.now(),
  });
  if (!tg.stueckzahlManuell) {
    await log('Herkunft der Stückzahl', 'Summe der Straßenliste', 'manuell gesetzt',
      `Herkunft der Stückzahl: Summe der Straßenliste → manuell gesetzt (Stückzahl ${tg.stueckzahl} bleibt)`);
  }
  if (update.strassen) {
    await log('Straßenliste', '', update.strassen.map((s) => s.strassenname).join(', '),
      `Straßenliste aus Online-Gebietsdoku (Blatt „${blatt}") nachimportiert: ${update.strassen.length} Straße(n)`);
  }
  console.log('   ✓ gespeichert + protokolliert');
}
console.log(APPLY ? '\nFertig.' : '\nProbelauf — mit --apply schreiben.');
process.exit(0);
