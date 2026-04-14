// Firestore CRUD-Operationen

import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  Mitarbeiter,
  Tour,
  Teilgebiet,
  TeilgebietSnapshot,
  PeriodeSnapshot,
  Sondervereinbarung,
  Ausgabe,
  Beilage,
  Abrechnungsperiode,
  Einsatz,
  Arbeitszeit,
  Fahrt,
  Vorschuss,
  Reklamation,
  Parameter,
  AuditLog,
} from '../types';
import { berechneStapel } from './berechnung';

// ---- Hilfsfunktionen ---------------------------------------

function now(): number {
  return Date.now();
}

/** Entfernt undefined-Werte (Firestore akzeptiert kein undefined) */
function stripUndef(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  );
}

// ---- Parameter (Singleton in meta/parameter) ---------------

export async function ladeParameter(): Promise<Parameter | null> {
  const snap = await getDoc(doc(db, 'meta', 'parameter'));
  if (!snap.exists()) return null;
  return snap.data() as Parameter;
}

export async function speichereParameter(params: Partial<Parameter>): Promise<void> {
  await setDoc(doc(db, 'meta', 'parameter'), params, { merge: true });
}

export function parameterListener(cb: (p: Parameter | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'meta', 'parameter'), (snap) => {
    cb(snap.exists() ? (snap.data() as Parameter) : null);
  });
}

// ---- Mitarbeiter -------------------------------------------

export async function ladeMitarbeiter(): Promise<Mitarbeiter[]> {
  const q = query(collection(db, 'mitarbeiter'), orderBy('name'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Mitarbeiter));
}

export function mitarbeiterListener(cb: (list: Mitarbeiter[]) => void): Unsubscribe {
  const q = query(collection(db, 'mitarbeiter'), orderBy('name'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Mitarbeiter)));
  });
}

export async function erstelleMitarbeiter(
  data: Omit<Mitarbeiter, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  const ts = now();
  const ref = await addDoc(collection(db, 'mitarbeiter'), {
    ...stripUndef(data as Record<string, unknown>),
    erstelltAm: ts,
    aktualisiertAm: ts,
  });
  return ref.id;
}

export async function aktualisiereMitarbeiter(
  id: string,
  data: Partial<Mitarbeiter>
): Promise<void> {
  await updateDoc(doc(db, 'mitarbeiter', id), {
    ...stripUndef(data as Record<string, unknown>),
    aktualisiertAm: now(),
  });
}

export async function deaktiviereMitarbeiter(id: string): Promise<void> {
  await updateDoc(doc(db, 'mitarbeiter', id), {
    isActive: false,
    aktualisiertAm: now(),
  });
}

// ---- Touren ------------------------------------------------

export async function ladeTouren(): Promise<Tour[]> {
  const q = query(collection(db, 'touren'), orderBy('name'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Tour));
}

export function tourenListener(cb: (list: Tour[]) => void): Unsubscribe {
  const q = query(collection(db, 'touren'), orderBy('name'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Tour)));
  });
}

export async function erstelleTour(data: Omit<Tour, 'id' | 'erstelltAm'>): Promise<string> {
  const ref = await addDoc(collection(db, 'touren'), {
    ...data,
    erstelltAm: now(),
  });
  return ref.id;
}

export async function aktualisiereTour(id: string, data: Partial<Tour>): Promise<void> {
  await updateDoc(doc(db, 'touren', id), data);
}

export async function loescheTour(id: string): Promise<void> {
  await deleteDoc(doc(db, 'touren', id));
}

// ---- Teilgebiete -------------------------------------------

export async function ladeTeilgebiete(): Promise<Teilgebiet[]> {
  const q = query(collection(db, 'teilgebiete'), orderBy('name'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Teilgebiet));
}

export function teilgebieteListener(cb: (list: Teilgebiet[]) => void): Unsubscribe {
  const q = query(collection(db, 'teilgebiete'), orderBy('name'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Teilgebiet)));
  });
}

export async function erstelleTeilgebiet(
  data: Omit<Teilgebiet, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  const ts = now();
  const ref = await addDoc(collection(db, 'teilgebiete'), {
    ...data,
    erstelltAm: ts,
    aktualisiertAm: ts,
  });
  return ref.id;
}

export async function aktualisiereTeilgebiet(
  id: string,
  data: Partial<Teilgebiet>
): Promise<void> {
  await updateDoc(doc(db, 'teilgebiete', id), {
    ...data,
    aktualisiertAm: now(),
  });
}

// ---- Sondervereinbarungen ----------------------------------

export async function ladeSondervereinbarungen(): Promise<Sondervereinbarung[]> {
  const snap = await getDocs(collection(db, 'sondervereinbarungen'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Sondervereinbarung));
}

export async function erstelleSondervereinbarung(
  data: Omit<Sondervereinbarung, 'id' | 'erstelltAm'>
): Promise<string> {
  const ref = await addDoc(collection(db, 'sondervereinbarungen'), {
    ...data,
    erstelltAm: now(),
  });
  return ref.id;
}

export async function aktualisiereSondervereinbarung(
  id: string,
  data: Partial<Sondervereinbarung>
): Promise<void> {
  await updateDoc(doc(db, 'sondervereinbarungen', id), data);
}

export async function loescheSondervereinbarung(id: string): Promise<void> {
  await deleteDoc(doc(db, 'sondervereinbarungen', id));
}

// ---- Ausgaben ----------------------------------------------

export async function ladeAusgaben(): Promise<Ausgabe[]> {
  const q = query(collection(db, 'ausgaben'), orderBy('jahr', 'desc'), orderBy('kw', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Ausgabe));
}

export function ausgabenListener(cb: (list: Ausgabe[]) => void): Unsubscribe {
  const q = query(collection(db, 'ausgaben'), orderBy('jahr', 'desc'), orderBy('kw', 'desc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Ausgabe)));
  });
}

export async function erstelleAusgabe(
  data: Omit<Ausgabe, 'id' | 'stapel' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  const ts = now();
  const stapel = berechneStapel(data.seitenzahl);
  const ref = await addDoc(collection(db, 'ausgaben'), {
    ...data,
    stapel,
    erstelltAm: ts,
    aktualisiertAm: ts,
  });
  return ref.id;
}

export async function aktualisiereAusgabe(
  id: string,
  data: Partial<Ausgabe>
): Promise<void> {
  const update: Partial<Ausgabe> & { aktualisiertAm: number } = {
    ...data,
    aktualisiertAm: now(),
  };
  // Stapel nur auto-berechnen wenn nicht explizit mitgegeben
  // Stapelanzahl auto-vorbelegen wenn nicht explizit mitgegeben
  if (data.seitenzahl !== undefined && data.stapelAnzahl === undefined) {
    update.stapelAnzahl = berechneStapel(data.seitenzahl).length;
  }
  await updateDoc(doc(db, 'ausgaben', id), update);
}

// ---- Beilagen ----------------------------------------------

export async function ladeBeilagen(ausgabeId?: string): Promise<Beilage[]> {
  const q = ausgabeId
    ? query(collection(db, 'beilagen'), where('ausgabeId', '==', ausgabeId))
    : query(collection(db, 'beilagen'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Beilage));
}

export async function erstelleBeilage(
  data: Omit<Beilage, 'id' | 'erstelltAm'>
): Promise<string> {
  const ref = await addDoc(collection(db, 'beilagen'), {
    ...data,
    erstelltAm: now(),
  });
  return ref.id;
}

export async function aktualisiereBeilage(
  id: string,
  data: Partial<Beilage>
): Promise<void> {
  await updateDoc(doc(db, 'beilagen', id), data);
}

export async function loescheBeilage(id: string): Promise<void> {
  await deleteDoc(doc(db, 'beilagen', id));
}

// ---- Abrechnungsperioden -----------------------------------

export async function ladeAbrechnungsperioden(): Promise<Abrechnungsperiode[]> {
  const q = query(
    collection(db, 'abrechnungsperioden'),
    orderBy('jahr', 'desc'),
    orderBy('monat', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Abrechnungsperiode));
}

export function abrechnungsperiodenListener(
  cb: (list: Abrechnungsperiode[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'abrechnungsperioden'),
    orderBy('jahr', 'desc'),
    orderBy('monat', 'desc')
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Abrechnungsperiode)));
  });
}

export async function erstelleAbrechnungsperiode(
  data: Omit<Abrechnungsperiode, 'id' | 'erstelltAm'>,
  currentParams?: Parameter | null
): Promise<string> {
  // Aktuellen Parameter-Stand als Snapshot speichern
  const params = currentParams ?? await ladeParameter();
  const ref = await addDoc(collection(db, 'abrechnungsperioden'), {
    ...stripUndef(data as Record<string, unknown>),
    paramSnapshot: params ?? undefined,
    erstelltAm: now(),
  });
  return ref.id;
}

export async function aktualisiereAbrechnungsperiode(
  id: string,
  data: Partial<Abrechnungsperiode>
): Promise<void> {
  await updateDoc(doc(db, 'abrechnungsperioden', id), data);
}

// ---- Einsätze (Austragen) ----------------------------------

export async function ladeEinsaetze(ausgabeId?: string): Promise<Einsatz[]> {
  const q = ausgabeId
    ? query(collection(db, 'einsaetze'), where('ausgabeId', '==', ausgabeId))
    : query(collection(db, 'einsaetze'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Einsatz));
}

export async function setzeEinsatz(
  data: Omit<Einsatz, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  // Prüfe ob bereits ein Einsatz für dieses Teilgebiet in dieser Ausgabe existiert
  const q = query(
    collection(db, 'einsaetze'),
    where('ausgabeId', '==', data.ausgabeId),
    where('teilgebietId', '==', data.teilgebietId)
  );
  const snap = await getDocs(q);
  const ts = now();
  if (!snap.empty) {
    const existingId = snap.docs[0].id;
    await updateDoc(doc(db, 'einsaetze', existingId), {
      ...data,
      aktualisiertAm: ts,
    });
    return existingId;
  }
  const ref = await addDoc(collection(db, 'einsaetze'), {
    ...data,
    erstelltAm: ts,
    aktualisiertAm: ts,
  });
  return ref.id;
}

export async function loescheEinsatz(id: string): Promise<void> {
  await deleteDoc(doc(db, 'einsaetze', id));
}

// ---- Zusammentragen-Einsätze --------------------------------

import type { ZusammentragenEinsatz } from '../types';

export async function ladeZusammentragenEinsaetze(ausgabeId: string): Promise<ZusammentragenEinsatz[]> {
  const snap = await getDocs(
    query(collection(db, 'zusammentragezeiten'), where('ausgabeId', '==', ausgabeId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ZusammentragenEinsatz));
}

export async function setzeZusammentragenEinsatz(
  data: Omit<ZusammentragenEinsatz, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  // Upsert per ausgabeId + teilgebietId + mitarbeiterId
  // (Vorarbeit: mehrere Mitarbeiter möglich pro teilgebietId='__vorarbeit__')
  const q = query(
    collection(db, 'zusammentragezeiten'),
    where('ausgabeId', '==', data.ausgabeId),
    where('teilgebietId', '==', data.teilgebietId),
    where('mitarbeiterId', '==', data.mitarbeiterId)
  );
  const snap = await getDocs(q);
  const ts = now();
  const payload = { ...stripUndef(data as Record<string, unknown>), aktualisiertAm: ts };
  if (!snap.empty) {
    const existingId = snap.docs[0].id;
    await updateDoc(doc(db, 'zusammentragezeiten', existingId), payload);
    return existingId;
  }
  const ref = await addDoc(collection(db, 'zusammentragezeiten'), { ...payload, erstelltAm: ts });
  return ref.id;
}

export async function loescheZusammentragenEinsatz(id: string): Promise<void> {
  await deleteDoc(doc(db, 'zusammentragezeiten', id));
}

// ---- Arbeitszeiten -----------------------------------------

export async function ladeArbeitszeiten(mitarbeiterId?: string): Promise<Arbeitszeit[]> {
  const q = mitarbeiterId
    ? query(
        collection(db, 'arbeitszeiten'),
        where('mitarbeiterId', '==', mitarbeiterId),
        orderBy('startTime', 'desc')
      )
    : query(collection(db, 'arbeitszeiten'), orderBy('startTime', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Arbeitszeit));
}

export async function erstelleArbeitszeit(
  data: Omit<Arbeitszeit, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  const ts = now();
  const ref = await addDoc(collection(db, 'arbeitszeiten'), {
    ...data,
    erstelltAm: ts,
    aktualisiertAm: ts,
  });
  return ref.id;
}

export async function aktualisiereArbeitszeit(
  id: string,
  data: Partial<Arbeitszeit>
): Promise<void> {
  await updateDoc(doc(db, 'arbeitszeiten', id), {
    ...data,
    aktualisiertAm: now(),
  });
}

// ---- Fahrt-Erfassung (neue Collection) ----------------------

export async function ladeFahrten(filter?: {
  mitarbeiterId?: string;
  abrechnungsperiodeId?: string;
}): Promise<Fahrt[]> {
  let q;
  if (filter?.mitarbeiterId) {
    q = query(
      collection(db, 'fahrten'),
      where('mitarbeiterId', '==', filter.mitarbeiterId),
      orderBy('datum', 'desc')
    );
  } else if (filter?.abrechnungsperiodeId) {
    q = query(
      collection(db, 'fahrten'),
      where('abrechnungsperiodeId', '==', filter.abrechnungsperiodeId),
      orderBy('datum', 'desc')
    );
  } else {
    q = query(collection(db, 'fahrten'), orderBy('datum', 'desc'));
  }
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Fahrt));
}

export async function erstelleFahrt(
  data: Omit<Fahrt, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  const ts = now();
  const ref = await addDoc(collection(db, 'fahrten'), {
    ...stripUndef(data as Record<string, unknown>),
    erstelltAm: ts,
    aktualisiertAm: ts,
  });
  return ref.id;
}

export async function aktualisiereFahrt(
  id: string,
  data: Partial<Fahrt>
): Promise<void> {
  await updateDoc(doc(db, 'fahrten', id), {
    ...stripUndef(data as Record<string, unknown>),
    aktualisiertAm: now(),
  });
}

export async function loescheFahrt(id: string): Promise<void> {
  await deleteDoc(doc(db, 'fahrten', id));
}

export async function weisFahrtPeriodeZu(
  fahrtId: string,
  periodeId: string
): Promise<void> {
  await updateDoc(doc(db, 'fahrten', fahrtId), {
    abrechnungsperiodeId: periodeId,
    aktualisiertAm: now(),
  });
}

export async function entferneFahrtPeriode(fahrtId: string): Promise<void> {
  await updateDoc(doc(db, 'fahrten', fahrtId), {
    abrechnungsperiodeId: null,
    aktualisiertAm: now(),
  });
}

// ---- Periode abschließen (mit Snapshot) --------------------

export async function schliessePeriodeAb(
  periodeId: string,
  teilgebiete: Teilgebiet[]
): Promise<void> {
  const ts = now();

  // Periode laden
  const periodeSnap = await getDoc(doc(db, 'abrechnungsperioden', periodeId));
  if (!periodeSnap.exists()) throw new Error('Periode nicht gefunden');
  const periode = { id: periodeId, ...periodeSnap.data() } as Abrechnungsperiode;

  // Teilgebiet-Snapshot erstellen
  const teilgebietSnapshots: TeilgebietSnapshot[] = teilgebiete.map((tg) => ({
    id: tg.id,
    name: tg.name,
    plz: tg.plz,
    stueckzahl: tg.stueckzahl,
    wegstreckeM: tg.wegstreckeM,
    tourId: tg.tourId,
    standardAustraegerId: tg.standardAustraegerId,
  }));

  const periodeSnapshot: PeriodeSnapshot = {
    teilgebietSnapshots,
    erstelltAm: ts,
  };

  // Periode aktualisieren
  await updateDoc(doc(db, 'abrechnungsperioden', periodeId), {
    status: 'abgeschlossen',
    periodeSnapshot,
    gesperrtAm: ts,
  });

  // Alle Ausgaben dieser Periode auf 'abgeschlossen' setzen
  if (periode.kalenderwochen.length > 0) {
    const ausSnap = await getDocs(
      query(
        collection(db, 'ausgaben'),
        where('jahr', '==', periode.jahr),
        where('kw', 'in', periode.kalenderwochen)
      )
    );
    await Promise.all(
      ausSnap.docs.map((d) =>
        updateDoc(doc(db, 'ausgaben', d.id), {
          status: 'abgeschlossen',
          aktualisiertAm: ts,
        })
      )
    );
  }
}

// ---- Periode wieder öffnen (nur Admin) ---------------------

export async function oeffnePeriodeWieder(periodeId: string): Promise<void> {
  await updateDoc(doc(db, 'abrechnungsperioden', periodeId), {
    status: 'offen',
    gesperrtAm: null,
  });
}

// ---- Vorschüsse --------------------------------------------

export async function ladeVorschuesse(periodeId?: string): Promise<Vorschuss[]> {
  const q = periodeId
    ? query(collection(db, 'vorschuesse'), where('abrechnungsperiodeId', '==', periodeId))
    : collection(db, 'vorschuesse');
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vorschuss));
}

export async function erstelleVorschuss(
  data: Omit<Vorschuss, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  const ts = now();
  const ref = await addDoc(collection(db, 'vorschuesse'), { ...stripUndef(data as Record<string, unknown>), erstelltAm: ts, aktualisiertAm: ts });
  return ref.id;
}

export async function aktualisiereVorschuss(id: string, data: Partial<Vorschuss>): Promise<void> {
  await updateDoc(doc(db, 'vorschuesse', id), stripUndef({ ...data as Record<string, unknown>, aktualisiertAm: now() }));
}

export async function loescheVorschuss(id: string): Promise<void> {
  await deleteDoc(doc(db, 'vorschuesse', id));
}

// ---- Reklamationen -----------------------------------------

export function abonniereReklamationen(cb: (list: Reklamation[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'reklamationen'), orderBy('erstelltAm', 'desc')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Reklamation)))
  );
}

export async function erstelleReklamation(
  data: Omit<Reklamation, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  const ts = now();
  const ref = await addDoc(collection(db, 'reklamationen'), { ...data, erstelltAm: ts, aktualisiertAm: ts });
  return ref.id;
}

export async function aktualisiereReklamation(
  id: string,
  data: Partial<Reklamation>
): Promise<void> {
  await updateDoc(doc(db, 'reklamationen', id), stripUndef({ ...data as Record<string, unknown>, aktualisiertAm: now() }));
}

export async function loescheReklamation(id: string): Promise<void> {
  await deleteDoc(doc(db, 'reklamationen', id));
}

// ---- Audit-Log (nur schreiben, nicht ändern) ---------------

export async function schreibeAuditLog(
  data: Omit<AuditLog, 'id'>
): Promise<void> {
  await addDoc(collection(db, 'auditlog'), data);
}
