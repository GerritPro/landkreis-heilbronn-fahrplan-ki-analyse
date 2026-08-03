import React from "react";
import { GTFSDataSet } from "../types";
import { ymdToIso } from "../lib/gtfsEngine";
import { Bus, TrainFront, MapPin, Route, Timer, AlertTriangle, CalendarRange } from "lucide-react";

interface Props {
  ds1: GTFSDataSet | null;
  ds2: GTFSDataSet | null;
}

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : n.toLocaleString("de-DE");

/** Kompakte Netz-Kennzahlen aus der vorberechneten Analyse. */
export const NetworkSummary: React.FC<Props> = ({ ds1, ds2 }) => {
  const ds = ds2 || ds1;
  const a = ds?.analysis?.summary;
  if (!ds || !a) return null;

  const railCombined = a.tramCount + a.railCount;

  const tiles = [
    {
      icon: <Route className="w-4 h-4" />,
      label: "Linien",
      value: fmt(a.routeCount),
      sub: `${a.busCount} Bus · ${railCombined} Bahn`,
      accent: "text-red-600 bg-red-50",
    },
    {
      icon: <MapPin className="w-4 h-4" />,
      label: "Haltestellen",
      value: fmt(a.stopCount),
      sub: `${fmt(a.stopGroupCount)} Knoten`,
      accent: "text-emerald-600 bg-emerald-50",
    },
    {
      icon: <Bus className="w-4 h-4" />,
      label: "Fahrten werktags",
      value: fmt(a.weekdayTripCount),
      sub: `Sa ${fmt(a.saturdayTripCount)} · So ${fmt(a.sundayTripCount)}`,
      accent: "text-blue-600 bg-blue-50",
    },
    {
      icon: <Timer className="w-4 h-4" />,
      label: "Ø HVZ-Takt",
      value: a.avgWeekdayHeadway ? `${a.avgWeekdayHeadway}` : "–",
      sub: a.avgWeekdayHeadway ? "Minuten (Spitze)" : "keine Daten",
      accent: "text-violet-600 bg-violet-50",
    },
    {
      icon: <AlertTriangle className="w-4 h-4" />,
      label: "Bedienungslücken",
      value: fmt(a.gapCount),
      sub: `${fmt(a.nightGapCount)} abends · ${fmt(a.sundayGapCount)} sonntags`,
      accent: "text-amber-600 bg-amber-50",
    },
    {
      icon: <CalendarRange className="w-4 h-4" />,
      label: "Gültigkeit",
      value: a.feedStart ? ymdToIso(a.feedStart).slice(5) : "–",
      sub: a.feedEnd ? `bis ${ymdToIso(a.feedEnd)}` : "unbekannt",
      accent: "text-gray-600 bg-gray-100",
    },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2.5 px-1">
        <div className="flex items-center gap-2 text-heading text-gray-900">
          <TrainFront className="w-4 h-4 text-red-600" />
          Netz-Überblick
        </div>
        <span className="text-meta text-gray-400 truncate max-w-[45%]" title={a.agencies.join(", ")}>
          {a.agencies.length} Verkehrsunternehmen
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md border border-gray-100 bg-gray-50/50 p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${t.accent}`}>{t.icon}</span>
              <span className="text-meta text-gray-500 leading-tight">{t.label}</span>
            </div>
            <div className="text-gray-900 font-semibold tabular-nums text-lg leading-none">{t.value}</div>
            <div className="text-meta text-gray-400 mt-0.5 truncate" title={t.sub}>{t.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
