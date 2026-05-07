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
  deleteField,
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
  VariablerPeriodenZusatz,
  AuslieferungsMemo,
  LohnkontoBuchung,
} from '../types';
import { berechneStapel } from './berechnung';
import { normalisiereRollen } from '../types';

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

/**
 * Wie `stripUndef`, aber `undefined`-Werte werden in `deleteField()`-Sentinels
 * übersetzt. Verwenden, wenn der Aufrufer ausdrücklich Felder löschen können
 * soll (z. B. Formulare, in denen ein Eingabefeld geleert wurde — vorher
 * gespeicherter Wert muss verschwinden, nicht stehen bleiben).
 */
function undefAsDelete(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === undefined ? deleteField() : v;
  }
  return out;
}

/**
 * Rekursive Variante: entfernt undefined an beliebiger Tiefe (in Objekten und
 * innerhalb von Array-Elementen). Wird benötigt für komplexe Snapshots wie
 * `abrechnungSnapshot.ergebnisse`, in denen viele optionale Felder eingebettet
 * sind (z. B. `mitarbeiter.nfcUid`, `bonusKommentar`, …). Firestore lehnt
 * jedes `undefined` mit „Unsupported field value" ab.
 */
function stripUndefDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefDeep(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

// ---- Parameter (Singleton in meta/parameter) ---------------

function withParameterDefaults(p: Parameter): Parameter {
  return {
    ...p,
    austragenNachIstZeit: p.austragenNachIstZeit ?? false,
    zusammentragenNachIstZeit: p.zusammentragenNachIstZeit ?? false,
  };
}

export async function ladeParameter(): Promise<Parameter | null> {
  const snap = await getDoc(doc(db, 'meta', 'parameter'));
  if (!snap.exists()) return null;
  return withParameterDefaults(snap.data() as Parameter);
}

export async function speichereParameter(params: Partial<Parameter>): Promise<void> {
  await setDoc(doc(db, 'meta', 'parameter'), params, { merge: true });
}

export function parameterListener(cb: (p: Parameter | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'meta', 'parameter'), (snap) => {
    cb(snap.exists() ? withParameterDefaults(snap.data() as Parameter) : null);
  });
}

// ---- Mitarbeiter -------------------------------------------

function normalisiereMitarbeiterDoc(id: string, raw: Record<string, unknown>): Mitarbeiter {
  const data = { ...raw } as Record<string, unknown>;
  // abrechnungstyp (alt) verwerfen
  delete data.abrechnungstyp;
  const rollen = normalisiereRollen((raw.rollen as string[] | undefined) ?? []);
  return {
    id,
    ...(data as Omit<Mitarbeiter, 'id' | 'rollen' | 'hatFestgehalt'>),
    rollen,
    hatFestgehalt: (raw.hatFestgehalt as boolean | undefined) ?? false,
  } as Mitarbeiter;
}

export async function ladeMitarbeiter(): Promise<Mitarbeiter[]> {
  const q = query(collection(db, 'mitarbeiter'), orderBy('name'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalisiereMitarbeiterDoc(d.id, d.data()));
}

export function mitarbeiterListener(cb: (list: Mitarbeiter[]) => void): Unsubscribe {
  const q = query(collection(db, 'mitarbeiter'), orderBy('name'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => normalisiereMitarbeiterDoc(d.id, d.data())));
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
  // undefined → deleteField(), damit geleerte Eingabefelder ihren persistierten
  // Wert in Firestore tatsächlich verlieren (sonst bliebe z. B. ein leerer
  // Tätigkeitsbonus stehen, weil stripUndef den Schlüssel still ignoriert).
  await updateDoc(doc(db, 'mitarbeiter', id), {
    ...undefAsDelete(data as Record<string, unknown>),
    aktualisiertAm: now(),
  });
}

export async function deaktiviereMitarbeiter(id: string): Promise<void> {
  await updateDoc(doc(db, 'mitarbeiter', id), {
    isActive: false,
    aktualisiertAm: now(),
  });
}

export async function aktiviereMitarbeiter(id: string): Promise<void> {
  await updateDoc(doc(db, 'mitarbeiter', id), {
    isActive: true,
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
    ...stripUndef(data as Record<string, unknown>),
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
    ...stripUndef(data as Record<string, unknown>),
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

export async function loescheAusgabe(id: string): Promise<void> {
  await deleteDoc(doc(db, 'ausgaben', id));
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

// ---- Auslieferungs-Memos -----------------------------------

export async function ladeAuslieferungsmemos(ausgabeId?: string): Promise<AuslieferungsMemo[]> {
  const q = ausgabeId
    ? query(collection(db, 'auslieferungsmemos'), where('ausgabeId', '==', ausgabeId))
    : query(collection(db, 'auslieferungsmemos'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuslieferungsMemo));
}

export async function ladeAuslieferungsmemosFuerAusgaben(
  ausgabeIds: string[]
): Promise<AuslieferungsMemo[]> {
  if (ausgabeIds.length === 0) return [];
  // Firestore 'in'-Query: max 30 Werte
  const result: AuslieferungsMemo[] = [];
  for (let i = 0; i < ausgabeIds.length; i += 30) {
    const batch = ausgabeIds.slice(i, i + 30);
    const snap = await getDocs(
      query(collection(db, 'auslieferungsmemos'), where('ausgabeId', 'in', batch))
    );
    for (const d of snap.docs) {
      result.push({ id: d.id, ...d.data() } as AuslieferungsMemo);
    }
  }
  return result;
}

export async function erstelleAuslieferungsmemo(
  data: Omit<AuslieferungsMemo, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'auslieferungsmemos'), {
    ...data,
    erstelltAm: now,
    aktualisiertAm: now,
  });
  return ref.id;
}

export async function aktualisiereAuslieferungsmemo(
  id: string,
  data: Partial<Omit<AuslieferungsMemo, 'id' | 'erstelltAm'>>
): Promise<void> {
  await updateDoc(doc(db, 'auslieferungsmemos', id), {
    ...data,
    aktualisiertAm: Date.now(),
  });
}

export async function loescheAuslieferungsmemo(id: string): Promise<void> {
  await deleteDoc(doc(db, 'auslieferungsmemos', id));
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
  _currentParams?: Parameter | null   // beibehalten für Rückwärtskompatibilität
): Promise<string> {
  // KEIN Parameter-Snapshot beim Anlegen — solange die Periode offen ist,
  // sollen Parameter-Änderungen weiterhin in die Berechnung einfließen.
  // Der Snapshot wird erst bei "Periode abschließen" festgeschrieben.
  void _currentParams;
  const ref = await addDoc(collection(db, 'abrechnungsperioden'), {
    ...stripUndef(data as Record<string, unknown>),
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

/** Einsätze eines bestimmten Mitarbeiters laden (für Selbstmeldung) */
export async function ladeEinsaetzeFuerMitarbeiter(
  mitarbeiterId: string
): Promise<Einsatz[]> {
  const q = query(
    collection(db, 'einsaetze'),
    where('mitarbeiterId', '==', mitarbeiterId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Einsatz));
}

/** Selbstmeldung des Austrägers speichern (Arbeitszeit + Restmenge) */
export async function aktualisiereEinsatzMeldung(
  id: string,
  data: {
    arbeitszeit: import('../types').AustraegerArbeitszeit;
    restmenge: number;
    meldungEingereichtAm: number;
  }
): Promise<void> {
  await updateDoc(doc(db, 'einsaetze', id), {
    ...data,
    aktualisiertAm: now(),
  });
}

// ---- Zusammentragen-Einsätze --------------------------------

import type { ZusammentragenEinsatz } from '../types';

export async function ladeZusammentragenEinsaetze(ausgabeId: string): Promise<ZusammentragenEinsatz[]> {
  const snap = await getDocs(
    query(collection(db, 'zusammentragezeiten'), where('ausgabeId', '==', ausgabeId))
  );
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ZusammentragenEinsatz));

  // Self-Healing: Bei regulärem Zusammentragen darf nur EIN MA pro TG existieren.
  // Frühere Versionen haben beim MA-Wechsel den alten Eintrag stehen lassen, wodurch
  // sich Doppel-Einträge ansammeln und in der Abrechnung doppelt verrechnet würden.
  // Pro (Ausgabe, TG): jüngsten Eintrag behalten, alte löschen.
  const buckets = new Map<string, ZusammentragenEinsatz[]>();
  for (const e of list) {
    if (e.istVorarbeit) continue;
    const key = e.teilgebietId;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }
  const verwaiste: string[] = [];
  for (const arr of buckets.values()) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => (b.aktualisiertAm ?? b.erstelltAm ?? 0) - (a.aktualisiertAm ?? a.erstelltAm ?? 0));
    for (const e of arr.slice(1)) verwaiste.push(e.id);
  }
  if (verwaiste.length > 0) {
    await Promise.all(verwaiste.map((id) => deleteDoc(doc(db, 'zusammentragezeiten', id))));
    return list.filter((e) => !verwaiste.includes(e.id));
  }
  return list;
}

export async function setzeZusammentragenEinsatz(
  data: Omit<ZusammentragenEinsatz, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  // Reguläres Zusammentragen: nur EIN MA pro (ausgabe, TG). Beim MA-Wechsel
  // alle bestehenden Einsätze für dasselbe TG aufräumen.
  // Vorarbeit (teilgebietId='__vorarbeit__'): mehrere MA erlaubt — nur Eintrag
  // desselben MA aktualisieren.
  const ts = now();
  const payload = { ...stripUndef(data as Record<string, unknown>), aktualisiertAm: ts };

  if (!data.istVorarbeit) {
    const allTg = await getDocs(query(
      collection(db, 'zusammentragezeiten'),
      where('ausgabeId', '==', data.ausgabeId),
      where('teilgebietId', '==', data.teilgebietId)
    ));
    const fremdeMa = allTg.docs.filter((d) => (d.data() as ZusammentragenEinsatz).mitarbeiterId !== data.mitarbeiterId);
    await Promise.all(fremdeMa.map((d) => deleteDoc(doc(db, 'zusammentragezeiten', d.id))));

    const eigene = allTg.docs.find((d) => (d.data() as ZusammentragenEinsatz).mitarbeiterId === data.mitarbeiterId);
    if (eigene) {
      await updateDoc(doc(db, 'zusammentragezeiten', eigene.id), payload);
      return eigene.id;
    }
    const ref = await addDoc(collection(db, 'zusammentragezeiten'), { ...payload, erstelltAm: ts });
    return ref.id;
  }

  const snap = await getDocs(query(
    collection(db, 'zusammentragezeiten'),
    where('ausgabeId', '==', data.ausgabeId),
    where('teilgebietId', '==', data.teilgebietId),
    where('mitarbeiterId', '==', data.mitarbeiterId)
  ));
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
  // undefined → deleteField(), damit z. B. ein zurückgenommenes
  // „nichtBeruecksichtigen"-Flag tatsächlich aus dem Dokument verschwindet.
  await updateDoc(doc(db, 'arbeitszeiten', id), {
    ...undefAsDelete(data as Record<string, unknown>),
    aktualisiertAm: now(),
  });
}

export async function loescheArbeitszeit(id: string): Promise<void> {
  await deleteDoc(doc(db, 'arbeitszeiten', id));
}

/** Lädt Arbeitszeiten einer bestimmten Ausgabe (Vorarbeit-Zuordnung) */
export async function ladeArbeitszeitenFuerAusgabe(ausgabeId: string): Promise<Arbeitszeit[]> {
  const q = query(collection(db, 'arbeitszeiten'), where('ausgabeId', '==', ausgabeId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Arbeitszeit));
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
  teilgebiete: Teilgebiet[],
  currentParams?: Parameter | null,
  /**
   * Berechnete Abrechnungs-Ergebnisse, die als Snapshot persistiert werden
   * sollen. Typ ist `MitarbeiterAbrechnung[]` (aus lib/abrechnungslogik.ts) —
   * hier `unknown[]` um zirkuläre Imports zu vermeiden. Der Aufrufer cast't
   * entsprechend.
   */
  abrechnungErgebnisse?: unknown[]
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

  // Parameter-Snapshot ZUM ZEITPUNKT DES ABSCHLUSSES — danach sind die Werte
  // für diese Periode unveränderlich und werden auch bei späteren Parameter-
  // Änderungen nicht mehr beeinflusst (historische Richtigkeit).
  const params = currentParams ?? (await ladeParameter());

  // Abrechnungs-Snapshot (das berechnete Ergebnis) — wird hier persistiert,
  // damit beim Anzeigen einer abgeschlossenen Periode kein Neuberechnen mehr
  // nötig ist. Firestore akzeptiert keine `undefined`-Werte; deshalb explizit
  // weglassen wenn nichts übergeben wurde.
  // Datum: NICHT serverTimestamp, sondern numerischer ms-Stempel — Firestore
  // erlaubt keine `serverTimestamp` innerhalb eines verschachtelten Arrays.
  // WICHTIG: tief von `undefined` befreien — die `MitarbeiterAbrechnung`-
  // Objekte enthalten viele optionale Felder (`bonusKommentar`, `nfcUid`,
  // `stundenlohnIndividuell`, …), die Firestore sonst ablehnt.
  const abrechnungSnapshotEintrag = abrechnungErgebnisse
    ? {
        ergebnisse: stripUndefDeep(abrechnungErgebnisse) as unknown[],
        erstelltAm: ts,
      }
    : undefined;

  // Periode aktualisieren
  await updateDoc(doc(db, 'abrechnungsperioden', periodeId), {
    ...stripUndef({
      status: 'abgeschlossen',
      periodeSnapshot,
      paramSnapshot: params ?? undefined,
      abrechnungSnapshot: abrechnungSnapshotEintrag,
      gesperrtAm: ts,
    }),
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
  // Nur die End-Snapshots verwerfen. Der Monatswechsel-Snapshot bleibt
  // erhalten, damit die fixierten Austragen/Zusammentragen-Werte nach dem
  // Wieder-Öffnen weiterhin gelten — Vorschüsse, Boni & Lohnkonto sind dann
  // wieder editierbar. Komplettes Reset der Periode geschieht über die
  // separate Funktion `verwerfeMonatswechselSnapshot`.
  await updateDoc(doc(db, 'abrechnungsperioden', periodeId), {
    status: 'offen',
    gesperrtAm: null,
    paramSnapshot: deleteField(),
    periodeSnapshot: deleteField(),
    abrechnungSnapshot: deleteField(),
  });
}

// ---- Monatswechsel-Snapshot --------------------------------
//
// Fixiert die stammdatenabhängigen Tätigkeiten (Austragen, Zusammentragen
// inkl. Vorarbeit) sowie Parameter/Teilgebiete zu einem Zeitpunkt zwischen
// Monatswechsel und endgültigem Abschluss. Andere Werte werden weiter live
// berechnet. Beim späteren Abschluss kombiniert `schliessePeriodeAb` beide
// Stände zum endgültigen `abrechnungSnapshot`.

interface MonatswechselFixierung {
  mitarbeiterId: string;
  austraegerEinsaetze: unknown[];
  austraegerGesamt: number;
  gewichtsbonusAnzeigenblatt: number;
  gewichtsbonusBeilagen: number;
  zusammentragenEinsaetze: unknown[];
  zusammentragenGesamt: number;
}

export async function schreibeMonatswechselSnapshot(
  periodeId: string,
  teilgebiete: Teilgebiet[],
  currentParams: Parameter | null,
  /** MitarbeiterAbrechnung[] vom Aufrufer — als unknown[] um Imports zu vermeiden. */
  ergebnisseLiveBerechnet: unknown[]
): Promise<void> {
  const ts = now();

  const teilgebietSnapshots: TeilgebietSnapshot[] = teilgebiete.map((tg) => ({
    id: tg.id,
    name: tg.name,
    plz: tg.plz,
    stueckzahl: tg.stueckzahl,
    wegstreckeM: tg.wegstreckeM,
    tourId: tg.tourId,
    standardAustraegerId: tg.standardAustraegerId,
  }));

  // Aus jedem MA-Ergebnis nur die Austragen-/Zusammentragen-Felder herausziehen
  const fixierungProMa: MonatswechselFixierung[] = (ergebnisseLiveBerechnet as Array<{
    mitarbeiter: { id: string };
    austraegerEinsaetze: unknown[];
    austraegerGesamt: number;
    gewichtsbonusAnzeigenblatt: number;
    gewichtsbonusBeilagen: number;
    zusammentragenEinsaetze: unknown[];
    zusammentragenGesamt: number;
  }>).map((er) => ({
    mitarbeiterId: er.mitarbeiter.id,
    austraegerEinsaetze: er.austraegerEinsaetze,
    austraegerGesamt: er.austraegerGesamt,
    gewichtsbonusAnzeigenblatt: er.gewichtsbonusAnzeigenblatt,
    gewichtsbonusBeilagen: er.gewichtsbonusBeilagen,
    zusammentragenEinsaetze: er.zusammentragenEinsaetze,
    zusammentragenGesamt: er.zusammentragenGesamt,
  }));

  const params = currentParams ?? (await ladeParameter());

  const monatswechselSnapshot = {
    erstelltAm: ts,
    paramSnapshot: params ?? {},
    teilgebietSnapshots,
    fixierungProMa: stripUndefDeep(fixierungProMa) as MonatswechselFixierung[],
  };

  await updateDoc(doc(db, 'abrechnungsperioden', periodeId), {
    monatswechselSnapshot: stripUndefDeep(monatswechselSnapshot) as Record<string, unknown>,
    monatswechselDurchgefuehrtAm: ts,
  });
}

export async function verwerfeMonatswechselSnapshot(periodeId: string): Promise<void> {
  await updateDoc(doc(db, 'abrechnungsperioden', periodeId), {
    monatswechselSnapshot: deleteField(),
    monatswechselDurchgefuehrtAm: deleteField(),
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

// ---- Variable Periodenzusätze ------------------------------

export async function ladeVariablePeriodenZusaetze(
  periodeId?: string
): Promise<VariablerPeriodenZusatz[]> {
  const q = periodeId
    ? query(collection(db, 'variablePeriodenZusatz'), where('abrechnungsperiodeId', '==', periodeId))
    : query(collection(db, 'variablePeriodenZusatz'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as VariablerPeriodenZusatz));
}

export function variablePeriodenZusaetzeListener(
  cb: (list: VariablerPeriodenZusatz[]) => void
): Unsubscribe {
  return onSnapshot(collection(db, 'variablePeriodenZusatz'), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VariablerPeriodenZusatz)));
  });
}

export async function erstelleVariablenPeriodenZusatz(
  data: Omit<VariablerPeriodenZusatz, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  const ts = now();
  const ref = await addDoc(collection(db, 'variablePeriodenZusatz'), {
    ...stripUndef(data as Record<string, unknown>),
    erstelltAm: ts,
    aktualisiertAm: ts,
  });
  return ref.id;
}

export async function aktualisiereVariablenPeriodenZusatz(
  id: string,
  data: Partial<VariablerPeriodenZusatz>
): Promise<void> {
  await updateDoc(doc(db, 'variablePeriodenZusatz', id), {
    ...stripUndef(data as Record<string, unknown>),
    aktualisiertAm: now(),
  });
}

export async function loescheVariablenPeriodenZusatz(id: string): Promise<void> {
  await deleteDoc(doc(db, 'variablePeriodenZusatz', id));
}

// ---- Lohnkonto-Buchungen -----------------------------------

export async function ladeLohnkontoBuchungen(
  mitarbeiterId?: string
): Promise<LohnkontoBuchung[]> {
  const q = mitarbeiterId
    ? query(collection(db, 'lohnkontoBuchungen'), where('mitarbeiterId', '==', mitarbeiterId))
    : query(collection(db, 'lohnkontoBuchungen'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as LohnkontoBuchung));
}

export function lohnkontoBuchungenListener(
  cb: (list: LohnkontoBuchung[]) => void
): Unsubscribe {
  return onSnapshot(collection(db, 'lohnkontoBuchungen'), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LohnkontoBuchung)));
  });
}

export async function erstelleLohnkontoBuchung(
  data: Omit<LohnkontoBuchung, 'id' | 'erstelltAm' | 'aktualisiertAm'>
): Promise<string> {
  const ts = now();
  const ref = await addDoc(collection(db, 'lohnkontoBuchungen'), {
    ...stripUndef(data as Record<string, unknown>),
    erstelltAm: ts,
    aktualisiertAm: ts,
  });
  return ref.id;
}

export async function aktualisiereLohnkontoBuchung(
  id: string,
  data: Partial<LohnkontoBuchung>
): Promise<void> {
  await updateDoc(doc(db, 'lohnkontoBuchungen', id), {
    ...stripUndef(data as Record<string, unknown>),
    aktualisiertAm: now(),
  });
}

export async function loescheLohnkontoBuchung(id: string): Promise<void> {
  await deleteDoc(doc(db, 'lohnkontoBuchungen', id));
}

// ---- Audit-Log (nur schreiben, nicht ändern) ---------------

export async function schreibeAuditLog(
  data: Omit<AuditLog, 'id'>
): Promise<void> {
  await addDoc(collection(db, 'auditlog'), data);
}
