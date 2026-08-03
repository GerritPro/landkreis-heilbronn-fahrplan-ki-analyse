import React, { useState, useEffect, useMemo } from "react";
import { GTFSDataSet, GTFSStop } from "../types";
import { getTransferConnectionsAtStop, ymdToIso } from "../lib/gtfsEngine";
import { StopSearchInput } from "./StopSearchInput";
import { ArrowLeftRight, Clock, Navigation, Bus, Search, Calendar as CalendarIcon, Lock, ArrowRight } from "lucide-react";

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
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-heading text-emerald-600 mb-1">
          <ArrowLeftRight className="w-4 h-4" />
          Umstiegs- & Anschlussanalyse
        </div>
        <h2 className="text-heading text-gray-900">Folgelinien am Umstiegsknoten</h2>
        <p className="text-meta mt-0.5 mb-4">Ermittelt reale Anschlussfahrten aus dem geladenen Fahrplan (inkl. Steig-Gruppen &amp; Mindestumsteigezeiten).</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50 p-3 rounded-md border border-gray-200">
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
            <label className="block text-heading text-gray-700 mb-1.5">Datum</label>
            <div className="relative">
              <CalendarIcon className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="date" value={selectedDateStr} onChange={(e) => setSelectedDateStr(e.target.value)} className="w-full pl-8 pr-2 py-1.5 bg-white border border-gray-300 rounded-md text-data focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-gray-900" />
            </div>
          </div>

          <div>
            <label className="block text-heading text-gray-700 mb-1.5">Ankunftszeit Erstlinie</label>
            <div className="relative">
              <Clock className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className="w-full pl-8 pr-2 py-1.5 bg-white border border-gray-300 rounded-md text-data focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-gray-900" />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-heading text-gray-700 mb-1.5">Ziel-Filter (optional)</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" value={targetStopName} onChange={(e) => setTargetStopName(e.target.value)} placeholder="Nur Anschlüsse Richtung … (z.B. Neckarsulm)" className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-300 rounded-md text-body focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-gray-900" />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-heading text-gray-900 flex items-center gap-1.5">
          <Bus className="w-3.5 h-3.5 text-emerald-600" />
          Anschlüsse an „{selectedStop?.stop_name || "—"}" ({selectedDate.toLocaleDateString("de-DE")}, {arrivalTime} Uhr)
        </h3>

        {transfers.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center text-body text-amber-800">
            {!activeDataset || !activeDataset.stopTimes || activeDataset.stopTimes.length === 0
              ? "Bitte Fahrplan-ZIP laden"
              : "Keine Anschlüsse im gewählten Zeitfenster gefunden. Versuchen Sie eine andere Uhrzeit oder ein anderes Datum."}
          </div>
        ) : (
          <div className="space-y-3">
            {transfers.map((tf, idx) => (
              <div key={idx} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-gray-100 text-meta">
                  <span className="text-emerald-800 font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {tf.waitTimeMinutes} Min. Umstiegszeit
                  </span>
                  <span className={`font-medium px-1.5 py-0.5 rounded-sm ${tf.transferType === "direkt" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>
                    {tf.transferType === "direkt" ? "gleiche Haltestelle" : "kurzer Fußweg"}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-meta text-gray-500 mb-0.5">Ankunft</div>
                    <div className="flex items-center gap-2">
                      <span className="text-data px-2 py-0.5 bg-gray-900 text-white rounded-sm">L{tf.arrivingTrip.routeShortName}</span>
                      <span className="text-data text-gray-900">{tf.arrivingTrip.arrivalTime}</span>
                    </div>
                    <div className="text-meta text-gray-500 truncate mt-0.5">aus {tf.arrivingTrip.fromStopName}</div>
                  </div>

                  <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="text-meta text-emerald-700 font-medium mb-0.5">Abfahrt</div>
                    <div className="flex items-center gap-2">
                      <span className="text-data px-2 py-0.5 bg-emerald-600 text-white font-bold rounded-sm">L{tf.departingTrip.routeShortName}</span>
                      <span className="text-data text-emerald-900 font-bold">{tf.departingTrip.departureTime}</span>
                    </div>
                    <div className="text-meta text-gray-700 truncate mt-0.5">→ {tf.departingTrip.toStopName}</div>
                  </div>
                </div>

                <div className="bg-gray-50 p-2 rounded-md border border-gray-100 text-meta text-gray-600 flex items-center gap-1.5">
                  <Navigation className="w-3 h-3 text-emerald-600 shrink-0" />
                  {tf.platformNote}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
