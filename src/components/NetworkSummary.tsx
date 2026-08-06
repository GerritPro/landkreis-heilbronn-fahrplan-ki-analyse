import React, { useEffect, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { GTFSDataSet } from "../types";
import { ymdToIso } from "../lib/gtfsEngine";
import { Bus, MapPin, Route, Timer } from "lucide-react";

interface Props {
  ds1: GTFSDataSet | null;
  ds2: GTFSDataSet | null;
}

/** Zahl, die beim Erscheinen von 0 auf den Zielwert hochzählt. */
const CountUp: React.FC<{ value: number; suffix?: string }> = ({ value, suffix }) => {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <>
      {Math.round(display).toLocaleString("de-DE")}
      {suffix ? <span className="text-[15px] font-medium text-gray-400 ml-0.5">{suffix}</span> : null}
    </>
  );
};

/** Netz-Kennzahlen. Klare Hierarchie: Bestandsdaten ruhig, Befund hervorgehoben,
 *  Metadaten klein. Farbe trägt Bedeutung (nur der Befund ist farbig). */
export const NetworkSummary: React.FC<Props> = ({ ds1, ds2 }) => {
  const ds = ds2 || ds1;
  const a = ds?.analysis?.summary;
  if (!ds || !a) return null;

  const stats: { icon: typeof Bus; label: string; num?: number; suffix?: string; text?: string }[] = [
    { icon: Route, label: "Linien", num: a.routeCount },
    { icon: MapPin, label: "Haltestellen", num: a.stopCount },
    { icon: Bus, label: "Fahrten Mo–Fr", num: a.weekdayTripCount },
    { icon: Timer, label: "Ø HVZ-Takt", num: a.avgWeekdayHeadway ?? undefined, suffix: "min", text: a.avgWeekdayHeadway ? undefined : "–" },
  ];

  const validity = a.feedEnd ? `gültig bis ${ymdToIso(a.feedEnd)}` : "";

  return (
    <div className="card p-6">
      <div className="flex items-baseline justify-between gap-3 mb-5">
        <h2 className="text-heading text-gray-900">Netz-Überblick</h2>
        {validity && <span className="text-meta tabular-nums shrink-0">{validity}</span>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-6">
        {stats.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-label leading-tight truncate">{t.label}</span>
              </div>
              <div className="text-display text-gray-900">
                {t.num !== undefined ? <CountUp value={t.num} suffix={t.suffix} /> : t.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
