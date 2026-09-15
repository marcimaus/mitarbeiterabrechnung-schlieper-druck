/**
 * Setzt istMinijob=true bei allen Mitarbeitern mit Rolle „austräger".
 *
 * Trockenlauf:    node scripts/set-austraeger-minijob.mjs
 * Echte Änderung: node scripts/set-austraeger-minijob.mjs --confirm
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
dotenvConfig({ path: join(projectRoot, '.env') });

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const istBestaetigt = process.argv.includes('--confirm');

console.log(`🔌 Verbinde zu Firestore (Projekt: ${firebaseConfig.projectId})…\n`);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const maSnap = await getDocs(collection(db, 'mitarbeiter'));
console.log(`👥 ${maSnap.size} Mitarbeiter geladen.\n`);

let austraegerGesamt = 0;
let bereitsMinijob = 0;
const zuSetzen = [];

for (const d of maSnap.docs) {
  const data = d.data();
  const istAustraeger = Array.isArray(data.rollen) && data.rollen.includes('austräger');
  if (!istAustraeger) continue;
  austraegerGesamt++;
  if (data.istMinijob === true) {
    bereitsMinijob++;
  } else {
    zuSetzen.push({ id: d.id, name: data.name });
  }
}

console.log(`Mitarbeiter mit Rolle „austräger":            ${austraegerGesamt}`);
console.log(`  davon bereits istMinijob=true             :   ${bereitsMinijob}`);
console.log(`  zu setzen                                 :   ${zuSetzen.length}\n`);

if (zuSetzen.length > 0 && zuSetzen.length <= 10) {
  console.log('Betroffene Mitarbeiter:');
  zuSetzen.forEach((m) => console.log(`   – ${m.name}  (${m.id})`));
  console.log('');
} else if (zuSetzen.length > 10) {
  console.log('Beispiele (max. 10):');
  zuSetzen.slice(0, 10).forEach((m) => console.log(`   – ${m.name}`));
  console.log(`   … und ${zuSetzen.length - 10} weitere\n`);
}

if (!istBestaetigt) {
  console.log('⚠  Trockenlauf — KEINE Änderung. Echtes Schreiben mit:');
  console.log('   node scripts/set-austraeger-minijob.mjs --confirm');
  process.exit(0);
}

if (zuSetzen.length === 0) {
  console.log('Nichts zu tun.');
  process.exit(0);
}

console.log(`✍  Schreibe ${zuSetzen.length} Änderungen…`);
const ts = Date.now();
let geschrieben = 0;
for (let i = 0; i < zuSetzen.length; i += 500) {
  const batch = writeBatch(db);
  const chunk = zuSetzen.slice(i, i + 500);
  for (const m of chunk) {
    batch.update(doc(db, 'mitarbeiter', m.id), {
      istMinijob: true,
      aktualisiertAm: ts,
    });
  }
  await batch.commit();
  geschrieben += chunk.length;
  process.stdout.write(`   …${geschrieben}/${zuSetzen.length}\r`);
}

console.log(`\n✅ Fertig. ${zuSetzen.length} Austräger als Minijob gekennzeichnet.`);
process.exit(0);
