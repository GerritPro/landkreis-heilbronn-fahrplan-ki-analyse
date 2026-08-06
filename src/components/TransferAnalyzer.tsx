import React, { useState, useEffect, useMemo } from "react";
import { GTFSDataSet, GTFSStop } from "../types";
import { getTransferConnectionsAtStop, ymdToIso } from "../lib/gtfsEngine";
import { StopSearchInput } from "./StopSearchInput";
import { ArrowLeftRight, Bus, TrainFront, Search, Lock, AlertTriangle } from "lucide-react";

const isRailLine = (s: string) => /^(S|R|RE|RB|MEX|IC|EC|IR)/i.test(s.trim());

interface TransferAnalyzerProps {
  ds1: GTFSDataSet | null;
  ds2: GTFSDataSet | null;
  externalSelectedStopId?: string | null;
  onSelectStop?: (stop: GTFSStop) => void;
  onOpenUpload?: () => void;
}

// Bevorzugt einen sinnvollen Umstiegsknoten als Startwert (Hbf/ZOB/Rathaus).
function pickDefaultStop(stops: GTFSStop[]): string {
  const byLines = [...stops].sort((a, b) => (b.lines?.length || 0) - (a.lines?.length || 0));
  const hub = byLines.find((s) => /hauptbahnhof|hbf|zob|busbahnhof|rathaus/i.test(s.stop_name));
  return (hub || byLines[0] || stops[0])?.stop_id;
}

export const TransferAnalyzer: React.FC<TransferAnalyzerProps> = ({
  ds1,
  ds2,
  externalSelectedStopId,
  onSelectStop,
  onOpenUpload,
}) => {
  const activeDataset = ds2 || ds1;
  const stops = activeDataset?.stops || [];

  const repWeekdayIso = activeDataset?.analysis
    ? ymdToIso(activeDataset.analysis.representativeDates.weekday)
    : new Date().toISOString().split("T")[0];

  const [selectedStopId, setSelectedStopId] = useState<string>("");
  const [selectedDateStr, setSelectedDateStr] = useState(repWeekdayIso);
  const [arrivalTime, setArrivalTime] = useState("14:00");
  const [targetStopName, setTargetStopName] = useState("");

  // Startwerte setzen, sobald ein Datensatz vorliegt / wechselt
  useEffect(() => {
    if (stops.length > 0 && !stops.some((s) => s.stop_id === selectedStopId)) {
      setSelectedStopId(pickDefaultStop(stops));
    }
  }, [stops, selectedStopId]);

  useEffect(() => {
    setSelectedDateStr(repWeekdayIso);
  }, [repWeekdayIso]);

  useEffect(() => {
    if (externalSelectedStopId && stops.some((s) => s.stop_id === externalSelectedStopId)) {
      setSelectedStopId(externalSelectedStopId);
    }
  }, [externalSelectedStopId, stops]);

  const selectedStop = stops.find((s) => s.stop_id === selectedStopId) || stops[0];
  const selectedDate = useMemo(() => new Date(selectedDateStr || repWeekdayIso), [selectedDateStr, repWeekdayIso]);

  const transfers = useMemo(
    () =>
      activeDataset && selectedStopId
        ? getTransferConnectionsAtStop(activeDataset, selectedStopId, arrivalTime, selectedDate, targetStopName)
        : [],
    [activeDataset, selectedStopId, arrivalTime, selectedDate, targetStopName]
  );

  const handleStopChange = (stop: GTFSStop) => {
    setSelectedStopId(stop.stop_id);
    onSelectStop?.(stop);
  };

  if (!ds1 && !ds2) {
    return (
      <div id="section-transfers" className="h-[48px] bg-gray-50 rounded-lg border border-gray-200 px-4 flex items-center justify-between text-gray-400 select-none mb-4">
        <div className="flex items-center gap-2 text-body font-medium text-gray-500">
          <ArrowLeftRight className="w-4 h-4 text-gray-400" />
          <span>Umstiegs- & Anschlussanalyse</span>
        </div>
        <Lock className="w-4 h-4 text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center gap-2.5 mb-5">
          <span className="section-badge shrink-0" style={{ ["--c" as any]: "var(--bus)" }}>
            <ArrowLeftRight className="w-4 h-4" />
          </span>
          <h2 className="text-heading text-gray-900">Umstiegs- &amp; Anschlussanalyse</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl well">
          <div className="sm:col-span-2">
            <StopSearchInput
              stops={stops}
              selectedStopId={selectedStopId}
              onSelectStop={handleStopChange}
              label="Umstiegsknoten (Haltestelle)"
              placeholder="Haltestelle suchen (min. 2 Zeichen)…"
            />
          </div>

          <div>
            <label className="block text-label mb-1.5">Datum</label>
            <input type="date" value={selectedDateStr} onChange={(e) => setSelectedDateStr(e.target.value)} className="w-full px-3.5 py-2.5 bg-white border border-[var(--border-strong)] rounded-xl text-data text-gray-900" />
          </div>

          <div>
            <label className="block text-label mb-1.5">Ankunftszeit Erstlinie</label>
            <input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className="w-full px-3.5 py-2.5 bg-white border border-[var(--border-strong)] rounded-xl text-data text-gray-900" />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-label mb-1.5">Ziel-Filter (optional)</label>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input type="text" value={targetStopName} onChange={(e) => setTargetStopName(e.target.value)} placeholder="Nur Anschlüsse Richtung … (z.B. Neckarsulm)" className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-[var(--border-strong)] rounded-xl text-body text-gray-900" />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3.5">
        <div className="flex items-baseline justify-between gap-3 px-0.5">
          <h3 className="text-title text-gray-900 truncate min-w-0">
            Anschlüsse <span className="text-gray-400 font-normal">an</span> {selectedStop?.stop_name || "—"}
          </h3>
          <span className="text-meta whitespace-nowrap tabular-nums shrink-0">
            {selectedDate.toLocaleDateString("de-DE")} · {arrivalTime} Uhr
          </span>
        </div>

        {transfers.length === 0 ? (
          <div className="card p-8 flex flex-col items-center text-center gap-3">
            <span className="section-badge" style={{ ["--c" as any]: "var(--text-secondary)" }}>
              <Bus className="w-4 h-4" />
            </span>
            <p className="text-body text-gray-500 max-w-[16rem]">
              {!activeDataset || !activeDataset.stopTimes || activeDataset.stopTimes.length === 0
                ? "Bitte zuerst einen Fahrplan laden."
                : "Keine Anschlüsse in diesem Zeitfenster – probieren Sie eine andere Uhrzeit oder ein anderes Datum."}
            </p>
          </div>
        ) : (
          <div className="card stagger divide-y divide-[var(--border)] overflow-hidden">
            {transfers.map((tf, idx) => {
              const arrRail = isRailLine(tf.arrivingTrip.routeShortName);
              const depRail = isRailLine(tf.departingTrip.routeShortName);
              // „knapp": physisch kaum machbare Umsteigezeit – ehrlich markieren
              // statt als normalen Anschluss darzustellen.
              const tight =
                tf.waitTimeMinutes <= 1 || (tf.transferType === "fußweg" && tf.waitTimeMinutes <= 2);
              const ModeArr = arrRail ? TrainFront : Bus;
              const ModeDep = depRail ? TrainFront : Bus;
              return (
                <div key={idx} className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                  {/* Ankunft: feste Spalten → alles fluchtet untereinander */}
                  <span className="tabular-nums text-[15px] font-semibold text-gray-900 w-[3rem] shrink-0">{tf.arrivingTrip.arrivalTime}</span>
                  <ModeArr className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="line-badge text-data px-1.5 py-0.5 rounded-md min-w-[2.6rem] inline-flex items-center justify-center shrink-0">{tf.arrivingTrip.routeShortName}</span>

                  {/* Umsteigezeit (feste Breite, zentriert) */}
                  <div
                    className="w-[3.6rem] flex justify-center shrink-0"
                    title={
                      tight
                        ? `Nur ${tf.waitTimeMinutes} Min Umstieg (${tf.transferType === "direkt" ? "gleiche Haltestelle" : "Fußweg"}) – sehr knapp, kaum realistisch.`
                        : `${tf.waitTimeMinutes} Min Umstieg · ${tf.transferType === "direkt" ? "gleiche Haltestelle" : "Fußweg"}`
                    }
                  >
                    <span
                      className={`inline-flex items-center gap-1 text-meta tabular-nums ${
                        tight ? "bg-amber-50 text-amber-700 border border-amber-200 font-semibold px-1.5 py-0.5 rounded-md" : "text-gray-400"
                      }`}
                    >
                      {tight && <AlertTriangle className="w-3 h-3 shrink-0" />}
                      {tf.waitTimeMinutes} min
                    </span>
                  </div>

                  {/* Abfahrt */}
                  <span className="tabular-nums text-[15px] font-semibold text-gray-900 w-[3rem] shrink-0">{tf.departingTrip.departureTime}</span>
                  <ModeDep className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="line-badge text-data px-1.5 py-0.5 rounded-md min-w-[2.6rem] inline-flex items-center justify-center shrink-0">{tf.departingTrip.routeShortName}</span>

                  {/* Ziel */}
                  <span className="flex-1 min-w-0 text-body text-gray-600 truncate ml-1" title={tf.departingTrip.toStopName}>
                    {tf.departingTrip.toStopName}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
