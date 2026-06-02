# Sicherung — Code & Daten

Kurzanleitung, wie Quellcode und Firestore-Daten gesichert werden.

---

## Wo liegt was?

| Aspekt | Speicherort |
|---|---|
| Quellcode lokal | `C:\Users\marcs\Documents\Claude\Projects\Mitarbeiterabrechnung gesamt` |
| Quellcode remote | GitHub: `github.com/marcimaus/mitarbeiterabrechnung-schlieper-druck` |
| Build-Output (live) | Firebase Hosting: `mitarbeiterabrechnung-sdruck.web.app` |
| Daten (live) | Firestore (Firebase-Projekt `mitarbeiterabrechnung-sdruck`) |
| Lokale Daten-Backups | `backups/firestore-YYYY-MM-DD-HHmm/` (in `.gitignore`) |
| Cloud-Backups (Firestore) | tägliche Snapshots + PITR (in der Firebase-Konsole) |

---

## Sicherungs-Schichten im Überblick

| Schicht | Status | Schützt vor |
|---|---|---|
| **Code auf GitHub** | ✅ aktiv | Festplatten-Crash, lokale Datenverluste |
| **Lokales Daten-Backup** (`scripts/export-firestore.mjs`) | ✅ verfügbar (manuell ausführen) | Komplettausfall Firebase-Konto |
| **Firestore tägliche Backups** | ✅ aktiv | Größere Datenverluste mehrere Tage zurück |
| **Firestore PITR** (Wiederherstellung zu Zeitpunkt) | ✅ aktiv | Versehentliche Lösch-/Überschreib-Aktionen, sekundengenau bis 7 Tage zurück |

---

## 1) Code sichern — `git commit && git push`

Beim Deployen wird **nur** das gebaute Bundle nach Firebase Hosting hochgeladen.
Der Quellcode kommt **nicht automatisch** ins GitHub-Repo. Faustregel:

```bash
# Vor jedem Deploy:
git add -A
git commit -m "feat: <kurze Beschreibung>"
git push

# Erst dann:
npm run build
npx firebase deploy --only hosting
```

Status prüfen jederzeit mit `git status` (sollte nach erfolgreichem Push „nothing
to commit" anzeigen).

> **Hinweis Branch-Name:** Der Hauptbranch heißt aktuell `phase-4-abrechnung`,
> nicht `main`. Bei `git push` ohne weitere Angaben wird automatisch in den
> aktiven Branch gepusht.

---

## 2) Daten sichern — lokales Skript

Einmal pro Woche (oder vor größeren Eingriffen) laufen lassen:

```bash
node scripts/export-firestore.mjs
```

Das Skript schreibt eine JSON-Datei je Collection in einen neuen Ordner
`backups/firestore-2026-05-03-0824/` (Zeitstempel im Namen).

Voraussetzungen:
- `npm install` einmal gelaufen (für `dotenv` und `firebase`).
- `.env` enthält die `VITE_FIREBASE_*`-Variablen.

Ergebnis: alle Mitarbeiter, Teilgebiete, Ausgaben, Arbeitszeiten,
Lohnkonto-Buchungen, Abrechnungsperioden (inkl. gespeicherter Snapshots)
usw. liegen lesbar als JSON vor.

**Zur Wiederherstellung** kann das vorhandene `scripts/import-firestore.mjs`
als Vorlage dienen, oder die JSON-Dateien werden gezielt über die
Firebase-Konsole importiert.

**Tipp:** den `backups/`-Ordner gelegentlich auf einen USB-Stick oder
externes Laufwerk kopieren — dann liegt er auch außerhalb des PCs.

---

## 3) Firestore tägliche Backups (Cloud) — aktiv ✓

Status: **eingerichtet und läuft täglich automatisch**.

Wofür gut: vollständige Sicherung des gesamten Datenbestands für mehrere
Tage zurück. Ideal, wenn ein größerer Fehler erst nach ein paar Tagen
auffällt.

**Wiederherstellung:**
1. Firebase-Konsole → Projekt `mitarbeiterabrechnung-sdruck` → Firestore Database.
2. Tab **„Backups"** → gewünschten Tag auswählen.
3. **„In Projekt wiederherstellen"** — entweder dasselbe Projekt
   (überschreibt!) oder ein neues für gefahrlosen Test-Restore.

> **Empfehlung:** im Ernstfall **immer** zuerst in ein Test-Projekt
> wiederherstellen, vergleichen, und nur dann gezielt übernehmen, was
> gebraucht wird. Direktes Überschreiben löscht zwischenzeitlich
> entstandene korrekte Eingaben.

---

## 4) Firestore PITR — Wiederherstellung zu einem bestimmten Zeitpunkt — aktiv ✓

Status: **eingerichtet und läuft kontinuierlich**. Aufbewahrung **7 Tage**.

Wofür gut: die „Strg+Z"-Taste für die ganze Datenbank. Sekundengenau auf
jeden beliebigen Moment der letzten 7 Tage zurückspringen — perfekt für
versehentliche Klicks im Tagesgeschäft.

**Beispiel:** Um 14:32 fällt auf, dass um 14:25 versehentlich 50
Mitarbeiter gelöscht wurden → PITR auf 14:24 stellt den Stand
unmittelbar vor dem Fehler wieder her.

**Wiederherstellung:**
1. Firebase-Konsole → Firestore Database → Tab **„Backups"** oder
   **„Wiederherstellung"**.
2. Datum + Uhrzeit (sekundengenau) eingeben.
3. **In neue Datenbank wiederherstellen** wählen, dann gezielt
   übernehmen — nicht direkt überschreiben.

---

## 5) Notfall — was tun wenn …

| Situation | Mittel der Wahl | Wie? |
|---|---|---|
| „Ich habe gerade etwas versehentlich gelöscht / falsch überschrieben" (innerhalb der letzten 7 Tage) | **PITR** | Konsole → Wiederherstellung zu Zeitpunkt → Minute vor dem Fehler |
| „Ich brauche Daten von vor 1–14 Tagen" | **Tägliches Backup** | Konsole → Backups → Tag wählen |
| „Ich brauche Daten älter als 14 Tage / will sie offline einsehen" | **Lokales JSON-Backup** | `backups/firestore-…/` durchsuchen oder per Import-Skript einspielen |
| „Mein PC ist kaputt — ich brauche den Code wieder" | **GitHub** | Auf neuem PC `git clone …` + `.env` rüberkopieren |
| „Komplettausfall Firebase-Projekt" (sehr unwahrscheinlich) | **Lokales JSON-Backup** + neues Projekt | Neues Firebase-Projekt anlegen, Daten per Import-Skript zurückspielen |
| „Ich will testen, ob die Backups funktionieren" | **Test-Restore** | Backup in **neues** Firebase-Projekt wiederherstellen, prüfen, dann verwerfen |

---

## 6) Wichtige Dateien NICHT einchecken

`.gitignore` schließt bereits aus:

- `.env`, `.env.local`, `.env.*.local` — enthält Firebase-API-Keys
- `firebase-service-account*.json`, `service-account*.json` — Admin-Schlüssel
- `backups/` — lokale Daten-Sicherungen

Vor jedem `git commit` kurz prüfen, dass diese Pfade in `git status` nicht
auftauchen.
