import React, { useRef, useState } from "react";
import { GTFSDataSet } from "../types";
import { parseGTFSZip, ensureStopTimesIndexed } from "../lib/gtfsParser";
import {
  Upload,
  FileCheck,
  RefreshCw,
  Trash2,
  Bus,
  MapPin,
  Layers,
  AlertTriangle,
  Loader2,
  X,
  FileWarning,
} from "lucide-react";

interface FileUploadSectionProps {
  ds1: GTFSDataSet | null;
  ds2: GTFSDataSet | null;
  setDs1: (ds: GTFSDataSet | null) => void;
  setDs2: (ds: GTFSDataSet | null) => void;
  onStartDemoMode?: () => void;
}

interface ParsingProgress {
  isLoading: boolean;
  fileName: string;
  step: string;
  percent: number;
  slot: 1 | 2;
}

interface ErrorState {
  slot: 1 | 2;
  message: string;
  missingFiles?: string[];
  fileName?: string;
}

export const FileUploadSection: React.FC<FileUploadSectionProps> = ({
  ds1,
  ds2,
  setDs1,
  setDs2,
  onStartDemoMode,
}) => {
  const fileInputRef1 = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);

  const [parsingProgress, setParsingProgress] = useState<ParsingProgress | null>(null);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);

  // Dev-Testhilfe: ?autoload=<url> lädt einen Feed automatisch über denselben
  // Worker-Pfad wie ein echter Upload (nur für Entwicklung/QA gedacht).
  React.useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const url = params.get("autoload");
    if (!url) return;
    const slot = (params.get("slot") === "2" ? 2 : 1) as 1 | 2;
    fetch(url)
      .then((r) => r.blob())
      .then((blob) => {
        const name = url.split("/").pop() || "feed.zip";
        startParsing(new File([blob], name, { type: "application/zip" }), slot);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    slot: 1 | 2
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // Reset input, damit dieselbe Datei erneut wählbar ist
    startParsing(file, slot);
  };

  const startParsing = (file: File, slot: 1 | 2) => {
    setErrorState(null);
    setParsingProgress({
      isLoading: true,
      fileName: file.name,
      step: "Starte GTFS Worker...",
      percent: 5,
      slot,
    });

    // Try using Web Worker for non-blocking UI parsing
    let workerSupported = typeof Worker !== "undefined";

    if (workerSupported) {
      try {
        const worker = new Worker(
          new URL("../lib/gtfsWorker.ts", import.meta.url),
          { type: "module" }
        );

        worker.onmessage = (msg: MessageEvent) => {
          const { type, step, percent, dataset, missingFiles, message } = msg.data;

          if (type === "progress") {
            setParsingProgress({
              isLoading: true,
              fileName: file.name,
              step: step || "Verarbeite GTFS-Daten...",
              percent: percent || 50,
              slot,
            });
          } else if (type === "success") {
            worker.terminate();
            setParsingProgress(null);
            if (dataset) {
              ensureStopTimesIndexed(dataset);
              if (slot === 1) setDs1(dataset);
              else setDs2(dataset);
            }
          } else if (type === "error") {
            worker.terminate();
            setParsingProgress(null);
            setErrorState({
              slot,
              fileName: file.name,
              message: message || "Fehler beim Parsen der GTFS-ZIP.",
              missingFiles,
            });
          }
        };

        worker.onerror = () => {
          worker.terminate();
          // Fallback to main thread async parsing
          runMainThreadParse(file, slot);
        };

        worker.postMessage({
          file,
          datasetId: `zip_${slot}_${Date.now()}`,
          slot,
        });
        return;
      } catch (err) {
        // Fallback if Worker fails to instantiate
        runMainThreadParse(file, slot);
      }
    } else {
      runMainThreadParse(file, slot);
    }
  };

  const runMainThreadParse = async (file: File, slot: 1 | 2) => {
    try {
      const dataset = await parseGTFSZip(
        file,
        `zip_${slot}_${Date.now()}`,
        (step, percent) => {
          setParsingProgress({
            isLoading: true,
            fileName: file.name,
            step,
            percent,
            slot,
          });
        }
      );
      setParsingProgress(null);
      ensureStopTimesIndexed(dataset);
      if (slot === 1) setDs1(dataset);
      else setDs2(dataset);
    } catch (err: any) {
      setParsingProgress(null);
      const msgText = err?.message || "";
      let missing: string[] | undefined = undefined;

      if (msgText.includes("Es fehlen folgende Pflichtdateien:")) {
        const parts = msgText.split("Es fehlen folgende Pflichtdateien:");
        if (parts[1]) {
          missing = parts[1].split(",").map((s: string) => s.trim());
        }
      }

      setErrorState({
        slot,
        fileName: file.name,
        message: msgText || "Fehler beim Lesen der GTFS ZIP-Datei.",
        missingFiles: missing,
      });
    }
  };

  return (
    <div className="card p-4 mb-4 relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-heading text-gray-900 flex items-center gap-2">
            <Upload className="w-4 h-4 text-red-600" />
            GTFS Soll-Fahrplandaten laden
          </h2>
          <p className="text-meta mt-0.5">
            Laden Sie bis zu 2 ZIP-Dateien hoch (z.B. Stand 2024 vs Stand 2025 der HNV-Fahrplandaten).
          </p>
        </div>

        {onStartDemoMode && (
          <button onClick={onStartDemoMode} className="gel gel-light text-body px-3 py-1.5 shrink-0">
            <RefreshCw className="w-3.5 h-3.5 text-red-600" />
            HNV Demo-Fahrpläne laden
          </button>
        )}
      </div>

      {/* Loading Overlay during ZIP parsing */}
      {parsingProgress && parsingProgress.isLoading && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-heading text-blue-900 truncate">
                  Analysiere {parsingProgress.fileName} (Fahrplan {parsingProgress.slot})
                </span>
                <span className="text-data text-blue-700 font-mono">
                  {parsingProgress.percent}%
                </span>
              </div>
              <p className="text-body text-blue-800 truncate">
                {parsingProgress.step}
              </p>
              {/* Progress Bar */}
              <div className="w-full bg-blue-200 h-1.5 rounded-none overflow-hidden mt-2">
                <div
                  className="bg-blue-600 h-full transition-all duration-300 ease-out"
                  style={{ width: `${parsingProgress.percent}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Card for invalid ZIP or missing GTFS files */}
      {errorState && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 text-body text-red-900">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <FileWarning className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-heading text-red-950">
                  Fehler beim Laden von {errorState.fileName || `Fahrplan ${errorState.slot}`}
                </h4>
                <p className="mt-1 text-body text-red-900">
                  {errorState.message}
                </p>

                {errorState.missingFiles && errorState.missingFiles.length > 0 && (
                  <div className="mt-2.5 bg-white border border-red-200 rounded-md p-2.5">
                    <span className="text-heading text-red-950 block mb-1">
                      Fehlende GTFS-Pflichtdateien:
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-red-800 font-mono text-meta">
                      {errorState.missingFiles.map((file, idx) => (
                        <li key={idx}>
                          <span>{file}</span> (GTFS Standard)
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => setErrorState(null)}
              className="p-1 text-red-500 hover:text-red-800 hover:bg-red-100 rounded-md transition-colors shrink-0 cursor-pointer"
              title="Fehler schließen"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Upload Boxes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Upload Box 1 */}
        <div
          className={`relative border-2 border-dashed rounded-lg p-4 transition-colors ${
            ds1
              ? "border-emerald-300 bg-emerald-50/20"
              : "border-gray-200 hover:border-red-400 bg-gray-50 hover:bg-white"
          }`}
        >
          <input
            type="file"
            ref={fileInputRef1}
            accept=".zip"
            onChange={(e) => handleFileUpload(e, 1)}
            className="hidden"
          />

          {ds1 ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-md shrink-0">
                    <FileCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-meta text-emerald-800 block">
                      Fahrplan 1 (Basis Soll-Stand)
                    </span>
                    <h3 className="text-heading text-gray-900 truncate">
                      {ds1.name}
                    </h3>
                  </div>
                </div>
                <button
                  onClick={() => setDs1(null)}
                  className="p-1 text-gray-400 hover:text-red-600 rounded-md hover:bg-gray-100 transition-colors shrink-0 cursor-pointer"
                  title="Datensatz entfernen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Text with middle dot separator (Rule 2c) */}
              <div className="pt-2 border-t border-gray-100 text-data text-gray-700">
                <span>{ds1.routes.length} Linien</span>
                <span className="mx-1.5 text-gray-400">·</span>
                <span>{ds1.stops.length} Haltestellen</span>
                <span className="mx-1.5 text-gray-400">·</span>
                <span>{ds1.totalTripsCount || ds1.trips.length} Fahrten</span>
              </div>

              {Boolean(ds1.filteredStopsCount && ds1.filteredStopsCount > 0) && (
                <div className="text-meta text-amber-700">
                  ℹ️ {ds1.filteredStopsCount} Haltestellen außerhalb der Region ausgeblendet
                </div>
              )}
            </div>
          ) : (
            <div
              onClick={() => fileInputRef1.current?.click()}
              className="cursor-pointer text-center py-4 space-y-2"
            >
              <div className="w-8 h-8 mx-auto bg-gray-100 rounded-md flex items-center justify-center text-gray-500">
                <Upload className="w-4 h-4 text-gray-600" />
              </div>
              <div>
                <p className="text-heading text-gray-800">
                  Fahrplan ZIP 1 hochladen
                </p>
                <p className="text-meta mt-0.5">
                  Hier klicken oder .zip ablegen (z.B. GTFS Soll 2024)
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Upload Box 2 */}
        <div
          className={`relative border-2 border-dashed rounded-lg p-4 transition-colors ${
            ds2
              ? "border-emerald-300 bg-emerald-50/20"
              : "border-gray-200 hover:border-red-400 bg-gray-50 hover:bg-white"
          }`}
        >
          <input
            type="file"
            ref={fileInputRef2}
            accept=".zip"
            onChange={(e) => handleFileUpload(e, 2)}
            className="hidden"
          />

          {ds2 ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-md shrink-0">
                    <FileCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-meta text-emerald-800 block">
                      Fahrplan 2 (Vergleichs-Stand)
                    </span>
                    <h3 className="text-heading text-gray-900 truncate">
                      {ds2.name}
                    </h3>
                  </div>
                </div>
                <button
                  onClick={() => setDs2(null)}
                  className="p-1 text-gray-400 hover:text-red-600 rounded-md hover:bg-gray-100 transition-colors shrink-0 cursor-pointer"
                  title="Datensatz entfernen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Text with middle dot separator (Rule 2c) */}
              <div className="pt-2 border-t border-gray-100 text-data text-gray-700">
                <span>{ds2.routes.length} Linien</span>
                <span className="mx-1.5 text-gray-400">·</span>
                <span>{ds2.stops.length} Haltestellen</span>
                <span className="mx-1.5 text-gray-400">·</span>
                <span>{ds2.totalTripsCount || ds2.trips.length} Fahrten</span>
              </div>

              {Boolean(ds2.filteredStopsCount && ds2.filteredStopsCount > 0) && (
                <div className="text-meta text-amber-700">
                  ℹ️ {ds2.filteredStopsCount} Haltestellen außerhalb der Region ausgeblendet
                </div>
              )}
            </div>
          ) : (
            <div
              onClick={() => fileInputRef2.current?.click()}
              className="cursor-pointer text-center py-4 space-y-2"
            >
              <div className="w-8 h-8 mx-auto bg-gray-100 rounded-md flex items-center justify-center text-gray-500">
                <Upload className="w-4 h-4 text-gray-600" />
              </div>
              <div>
                <p className="text-heading text-gray-800">
                  Fahrplan ZIP 2 hochladen (Optional)
                </p>
                <p className="text-meta mt-0.5">
                  Hier klicken oder .zip ablegen für automatischen Vergleich
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
