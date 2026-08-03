# Landkreis Heilbronn – Soll-Fahrplan KI-Analyse

Analyse- und Vergleichswerkzeug für **GTFS-Soll-Fahrpläne** (HNV / NVBW) im
Raum Heilbronn: interaktive Karte, Takt-Analyse pro Linie, Bedienungslücken-
Finder, Umstiegs-/Anschlussanalyse, Vorher-Nachher-Vergleich zweier Fahrpläne
und ein KI-Assistent, der ausschließlich **berechnete Fakten** formuliert.

Die App läuft vollständig lokal. Es werden keine Fahrplandaten an externe
Dienste gesendet – das Parsen und alle Analysen passieren im Browser.

## Highlights

- **Robustes GTFS-Parsing** ganzer Landes-Feeds (getestet mit dem NVBW-Feed,
  ~78 MB ZIP, 326.000 Fahrzeiten) in einem Web-Worker – die Oberfläche bleibt
  flüssig. `shapes.txt` (bis ~400 MB) wird bewusst nicht geladen.
- **Datengetriebene Analyse-Stichtage:** Werktag / Samstag / Sonntag werden
  automatisch als der jeweils betriebsstärkste Tag **innerhalb des Feed-
  Gültigkeitszeitraums** gewählt. Kein Rätselraten, keine Nulldaten durch
  falsch gesetzte Kalender.
- **Netz-Überblick** mit Kennzahlen (Linien nach Verkehrsart, Haltestellen,
  Fahrten je Tagestyp, Ø-HVZ-Takt, Bedienungslücken, Gültigkeit).
- **Takt-Analyse pro Linie** (Fahrten, HVZ-Takt, Betriebszeit) je Tagestyp,
  inkl. Vergleichsstatus zwischen zwei Fahrplänen und CSV-Export.
- **Bedienungslücken-Finder** (Frühschluss < 20 Uhr, Sonntagslücken).
- **Umstiegs-/Anschlussanalyse** an Knoten (inkl. Steig-Gruppierung über DHIDs
  und Mindestumsteigezeiten aus `transfers.txt`).
- **Interaktive Karte** (Leaflet, Canvas-Renderer) mit tausenden Haltestellen,
  Linienverlauf, Richtungsfilter und Erkennung asymmetrisch bedienter Halte.
- **KI-Assistent** mit dreistufiger Strategie (siehe unten).

## Lokal starten

**Voraussetzung:** Node.js (getestet mit Node 20+).

```bash
npm install
npm run dev        # Entwicklungsserver auf http://localhost:3000
```

Für einen optimierten Produktivlauf (deutlich schnelleres Parsen):

```bash
npm run build
npm start           # dient dist/ auf http://localhost:3000
```

## KI-Assistent

Der Assistent berechnet zunächst harte **Fakten** aus dem Fahrplan
(`src/lib/factCalculator.ts`) und formuliert daraus eine Antwort. Er erfindet
keine Linien, Zeiten oder Haltestellen. Die Formulierung erfolgt in dieser
Reihenfolge (`server.ts`):

1. **Ollama** (lokales LLM im Amtsnetz) – Modell/URL konfigurierbar. Es wird
   zunächst ein 2-Sekunden-Erreichbarkeits-Check ausgeführt; nur bei Erfolg
   wird das Modell befragt. So warten Offline-Nutzer nicht auf ein Timeout.
2. **Gemini** (optional, nur wenn `GEMINI_API_KEY` gesetzt ist).
3. **Direktausgabe** – die berechneten Fakten werden als Markdown-Tabellen
   ausgegeben. Funktioniert immer, auch ohne jede KI.

Konfiguration über Umgebungsvariablen (optional):

```
OLLAMA_URL=http://<host>:11434
OLLAMA_MODEL=qwen3:30b
GEMINI_API_KEY=...
```

## Projektstruktur

```
src/lib/gtfsEngine.ts     Reine Parsing-/Analyse-Engine (Browser + Node)
src/lib/gtfsWorker.ts     Web-Worker: entpackt ZIP, parst, berechnet Analyse
src/lib/gtfsParser.ts     Fallback-Parser, Demo-Daten, CSV-Export
src/lib/factCalculator.ts Faktenaufbereitung für den KI-Assistenten
src/components/           React-Oberfläche (Karte, Analysen, KI, Upload)
server.ts                 Express-Server + KI-Endpunkte
scripts/                  QA-Werkzeuge (Engine-Test gegen echte Feeds, Screenshots)
```

### Engine-Test gegen einen echten Feed

```bash
npx tsx scripts/test-engine.ts pfad/zum/feed.zip
```

Gibt Kennzahlen, Repräsentativtage, Top-Linien und einen Umstiegstest aus –
nützlich, um einen neuen Feed schnell zu validieren.
