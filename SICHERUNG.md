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

---

## 1) Code sichern — `git commit && git push`

Beim Deployen wird **nur** das gebaute Bundle nach Firebase Hosting hochgeladen.
Der Quellcode kommt **nicht automatisch** ins GitHub-Repo. Faustregel:

```bash
# Vor jedem Deploy:
git add -A
git commit -m "feat: <kurze Beschreibung>"
git push origin main

# Erst dann:
npm run build
npx firebase deploy --only hosting
```

Status prüfen jederzeit mit `git status` (sollte nach erfolgreichem Push „nothing
to commit" anzeigen).

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

---

## 3) Daten sichern — Managed Backups in der Firebase-Konsole (für Live-Betrieb)

Empfehlung: zusätzlich zum lokalen Skript automatische Cloud-Backups einrichten.

1. Firebase-Konsole öffnen → Projekt `mitarbeiterabrechnung-sdruck`.
2. Linke Leiste → **Firestore Database**.
3. Tab **„Backups"** wählen.
4. **„Backup-Zeitplan erstellen"** → täglich, Aufbewahrung 14 Tage (oder 7/30
   nach Bedarf).
5. Speichern.

Kosten: ca. 0,18 €/GiB/Monat — bei der aktuellen Datenmenge (< 10 MB)
praktisch vernachlässigbar.

Wiederherstellung: Konsole → Backups → bestehenden Snapshot wählen →
**„In Projekt wiederherstellen"** (in dasselbe Projekt überschreibt; in ein
neues Projekt für Test-Restore).

> **Hinweis:** Managed Backups setzen den **Blaze-Plan** (Pay-as-you-go)
> voraus. Falls aktuell Spark-Plan, im Konsolen-Plan-Switcher hochstufen.

---

## 4) Wichtige Dateien NICHT einchecken

`.gitignore` schließt bereits aus:

- `.env`, `.env.local`, `.env.*.local` — enthält Firebase-API-Keys
- `firebase-service-account*.json`, `service-account*.json` — Admin-Schlüssel
- `backups/` — lokale Daten-Sicherungen

Vor jedem `git commit` kurz prüfen, dass diese Pfade in `git status` nicht
auftauchen.
