/**
 * gtfsWorker.ts — Web-Worker: entpackt das GTFS-ZIP, parst es über die reine
 * Engine und berechnet die komplette Analyse VOR, sodass der Main-Thread nie
 * blockiert. Zurückgegeben werden Dataset (ohne Indizes) + fertige Analyse.
 */
import JSZip from "jszip";
import { parseGtfsTexts, computeAnalysis, GtfsTexts } from "./gtfsEngine";

self.onmessage = async (e: MessageEvent) => {
  const { file, datasetId, slot } = e.data;
  if (!file) return;

  const post = (step: string, percent: number) =>
    self.postMessage({ type: "progress", slot, step, percent, fileName: file.name });

  try {
    post("Entpacke ZIP-Archiv…", 8);
    const zip = new JSZip();
    const loaded = await zip.loadAsync(file);

    // Pflichtdateien prüfen
    const required = ["routes", "stops", "trips", "stop_times"];
    const missing: string[] = [];
    for (const name of required) {
      if (loaded.file(new RegExp(`${name}\\.txt$`, "i")).length === 0) {
        missing.push(`${name}.txt`);
      }
    }
    if (missing.length > 0) {
      self.postMessage({
        type: "error",
        slot,
        fileName: file.name,
        missingFiles: missing,
        message: `Ungültige ZIP-Datei: Es fehlen folgende Pflichtdateien: ${missing.join(", ")}`,
      });
      return;
    }

    // Texte extrahieren (shapes.txt wird bewusst NICHT gelesen — bis zu 400 MB)
    post("Lese GTFS-Dateien…", 18);
    const names = ["agency", "routes", "stops", "trips", "stop_times", "calendar", "calendar_dates", "transfers", "feed_info"];
    const texts: GtfsTexts = {};
    for (const name of names) {
      const f = loaded.file(new RegExp(`${name}\\.txt$`, "i"))[0];
      if (f) (texts as any)[name] = await f.async("text");
    }

    const dataset = parseGtfsTexts(texts, {
      datasetId,
      fileName: file.name,
      fileSize: file.size,
      onProgress: (step, percent) => post(step, percent),
    });

    post("Berechne Netz-Analyse…", 92);
    dataset.analysis = computeAnalysis(dataset);

    // Indizes sind Maps und werden nicht mitübertragen (Main-Thread baut neu auf)
    dataset._indices = undefined;
    dataset.stopTimesByStopId = undefined;
    dataset.tripFirstStopMap = undefined;
    dataset.tripLastStopMap = undefined;

    post("Übertrage Daten…", 99);
    self.postMessage({ type: "success", slot, fileName: file.name, dataset });
  } catch (err: any) {
    self.postMessage({
      type: "error",
      slot,
      fileName: file.name,
      message: err?.message || "Fehler beim Verarbeiten des GTFS-Archivs.",
    });
  }
};
