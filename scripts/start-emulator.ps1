# Startet den lokalen Firestore-Emulator (Test-Sandbox) mit dem installierten
# JDK 21 und PERSISTENTEM Datenstand (Ordner .emulator-data).
# (ASCII-only gehalten, damit Windows PowerShell 5.1 die Datei fehlerfrei liest.)
#
# In einem EIGENEN PowerShell-Fenster ausfuehren und offen lassen:
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-emulator.ps1
# Beenden mit Strg+C -- dabei wird der aktuelle Stand nach .emulator-data
# exportiert und beim naechsten Start automatisch wieder geladen. So bleiben
# vorgemerkte Mengenaenderungen / Wechselplaene ueber Neustarts erhalten.
#
# Erststart (noch kein gespeicherter Stand): Emulator startet leer -- danach
# EINMAL die Produktivdaten klonen (liest Prod nur lesend):
#   node scripts/clone-prod-to-emulator.mjs
# und in einem zweiten Fenster den Dev-Server starten:
#   npm run dev
# App dann unter http://localhost:5173/ (nutzt dank .env.local den Emulator).

$jdk = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
if (-not (Test-Path $jdk)) {
  Write-Error "JDK 21 nicht gefunden unter $jdk - bitte Pfad anpassen."
  exit 1
}
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"

$dataDir = Join-Path $PSScriptRoot '..\.emulator-data'
$emArgs = @('emulators:start', '--only', 'firestore', '--project', 'mitarbeiterabrechnung-sdruck', '--export-on-exit', $dataDir)
if (Test-Path (Join-Path $dataDir 'firebase-export-metadata.json')) {
  $emArgs += @('--import', $dataDir)
  Write-Host "Lade gespeicherten Emulator-Stand aus $dataDir ..." -ForegroundColor Cyan
} else {
  Write-Host "Kein gespeicherter Stand - Emulator startet leer. Danach einmal: node scripts/clone-prod-to-emulator.mjs" -ForegroundColor Yellow
}
Write-Host "Starte Firestore-Emulator (Java: $jdk) ..." -ForegroundColor Cyan
firebase @emArgs
