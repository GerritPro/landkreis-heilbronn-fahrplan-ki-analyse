import React, { useState, useMemo, useEffect } from "react";
import { motion } from "motion/react";
import { GTFSDataSet, DayType, DayFrequency, RouteFrequencyRow } from "../types";
import { analyzeStopsDiff, downloadCSV } from "../lib/gtfsParser";
import { ymdToIso } from "../lib/gtfsEngine";
import {
  GitCompare,
  PlusCircle,
  MinusCircle,
  Bus,
  Search,
  Download,
  Printer,
  AlertTriangle,
  MapPin,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Lock,
} from "lucide-react";

interface GtfsDiffViewProps {
  ds1: GTFSDataSet | null;
  ds2: GTFSDataSet | null;
  onShowGapsOnMap?: (gapStems: Set<string>) => void;
  onShowDiffOnMap?: (removedStems: Set<string>, addedStems: Set<string>) => void;
  onStartAIChatWithFacts?: (factsText: string) => void;
  onHoverStopStem?: (stem: string | null) => void;
  onOpenUpload?: () => void;
}

const dayLabel = (d: DayType) => (d === "weekday" ? "Mo–Fr" : d === "saturday" ? "Samstag" : "Sonntag");
const emptyDay: DayFrequency = { trips: 0, firstDeparture: null, lastDeparture: null, headway: null };

export const GtfsDiffView: React.FC<GtfsDiffViewProps> = ({
  ds1,
  ds2,
  onShowGapsOnMap,
  onShowDiffOnMap,
  onStartAIChatWithFacts,
  onHoverStopStem,
  onOpenUpload,
}) => {
  const [dayType, setDayType] = useState<DayType>("weekday");
  const [searchTerm, setSearchTerm] = useState("");
  const [gapSearchTerm, setGapSearchTerm] = useState("");
  const [gapSortKey, setGapSortKey] = useState<"name" | "lastDep" | "sat" | "sun">("name");
  const [gapSortDir, setGapSortDir] = useState<"asc" | "desc">("asc");

  const isTwoDatasets = Boolean(ds1 && ds2);
  const [isTaktOpen, setIsTaktOpen] = useState(true);
  // Bedienungslücken sind kein Kern-Anwendungsfall → standardmäßig eingeklappt,
  // sekundär, nicht im Hauptfokus.
  const [isGapsOpen, setIsGapsOpen] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(isTwoDatasets);

  useEffect(() => {
    setIsDiffOpen(isTwoDatasets);
  }, [isTwoDatasets]);

  const activeDs = ds2 || ds1;

  // 1. Takt-Analyse: direkt aus vorberechneter Analyse (keine Live-Rechnung)
  const frequencyData = useMemo(() => {
    if (!activeDs) return [];
    type Row = {
      routeId: string;
      shortName: string;
      longName: string;
      routeType: number;
      a1: DayFrequency | null;
      a2: DayFrequency | null;
      tripDelta: number;
      statusText: string;
      statusColor: string;
    };

    // Schlüssel = route_id (korrekte Einheit): Liniennummern werden im NVBW-Feed
    // über Städte hinweg mehrfach vergeben (Linie 1 Heilbronn ≠ Linie 1 Öhringen).
    const byId = new Map<string, { r1?: RouteFrequencyRow; r2?: RouteFrequencyRow }>();
    ds1?.analysis?.routeFrequency.forEach((r) => {
      const e = byId.get(r.routeId) || {};
      e.r1 = r;
      byId.set(r.routeId, e);
    });
    ds2?.analysis?.routeFrequency.forEach((r) => {
      const e = byId.get(r.routeId) || {};
      e.r2 = r;
      byId.set(r.routeId, e);
    });

    const hasAnyService = (r?: RouteFrequencyRow) =>
      !!r && (r.days.weekday.trips > 0 || r.days.saturday.trips > 0 || r.days.sunday.trips > 0);

    const rows: Row[] = [];
    byId.forEach(({ r1, r2 }) => {
      // Linien ohne jegliche Fahrten (saisonal/inaktiv) ausblenden
      if (!hasAnyService(r1) && !hasAnyService(r2)) return;
      const meta = r1 || r2!;
      const shortName = meta.shortName;
      const a1 = ds1 ? r1?.days[dayType] ?? emptyDay : null;
      const a2 = ds2 ? r2?.days[dayType] ?? emptyDay : null;
      const t1 = a1?.trips ?? 0;
      const t2 = a2?.trips ?? 0;
      const tripDelta = ds1 && ds2 ? t2 - t1 : 0;

      let statusText = "Unverändert";
      let statusColor = "text-gray-600 bg-gray-100";
      if (ds1 && ds2) {
        const h1 = a1?.headway;
        const h2 = a2?.headway;
        if (t1 === 0 && t2 > 0) {
          statusText = "Neue Linie";
          statusColor = "text-emerald-800 bg-emerald-100 border border-emerald-200";
        } else if (t1 > 0 && t2 === 0) {
          statusText = "Linie entfällt";
          statusColor = "text-red-800 bg-red-100 border border-red-200";
        } else if (tripDelta > 0 || (h2 && h1 && h2 < h1)) {
          statusText = tripDelta > 0 ? `Taktverdichtung (+${tripDelta})` : "Besserer Takt";
          statusColor = "text-emerald-800 bg-emerald-100 border border-emerald-200";
        } else if (tripDelta < 0 || (h2 && h1 && h2 > h1)) {
          statusText = `Taktausdünnung (${tripDelta})`;
          statusColor = "text-red-800 bg-red-100 border border-red-200";
        }
      }

      rows.push({
        routeId: meta.routeId,
        shortName,
        longName: meta.longName,
        routeType: meta.routeType,
        a1,
        a2,
        tripDelta,
        statusText,
        statusColor,
      });
    });

    return rows.sort((a, b) =>
      a.shortName.localeCompare(b.shortName, "de", { numeric: true, sensitivity: "base" })
    );
  }, [ds1, ds2, dayType, activeDs]);

  const maxTrips = useMemo(
    () => Math.max(1, ...frequencyData.map((f) => Math.max(f.a1?.trips ?? 0, f.a2?.trips ?? 0))),
    [frequencyData]
  );

  const filteredFrequency = useMemo(() => {
    if (!searchTerm.trim()) return frequencyData;
    const q = searchTerm.toLowerCase();
    return frequencyData.filter(
      (f) => f.shortName.toLowerCase().includes(q) || f.longName.toLowerCase().includes(q)
    );
  }, [frequencyData, searchTerm]);

  // 2. Bedienungslücken aus vorberechneter Analyse
  const serviceGaps = activeDs?.analysis?.serviceGaps ?? [];

  const filteredGaps = useMemo(() => {
    let list = serviceGaps;
    if (gapSearchTerm.trim()) {
      const q = gapSearchTerm.toLowerCase();
      list = list.filter((g) => g.stopNameStem.toLowerCase().includes(q));
    }
    return list.slice().sort((a, b) => {
      let cmp = 0;
      if (gapSortKey === "name") cmp = a.stopNameStem.localeCompare(b.stopNameStem, "de");
      else if (gapSortKey === "lastDep")
        cmp = (a.lastDepartureWeekday || "00:00").localeCompare(b.lastDepartureWeekday || "00:00");
      else if (gapSortKey === "sat") cmp = a.tripsSaturday - b.tripsSaturday;
      else if (gapSortKey === "sun") cmp = a.tripsSunday - b.tripsSunday;
      return gapSortDir === "asc" ? cmp : -cmp;
    });
  }, [serviceGaps, gapSearchTerm, gapSortKey, gapSortDir]);

  // 3. Haltestellen-Diff
  const stopsDiff = useMemo(() => (ds1 && ds2 ? analyzeStopsDiff(ds1, ds2) : null), [ds1, ds2]);

  const repDates = activeDs?.analysis?.representativeDates;

  // --- Exporte ---
  const handleExportFrequencyCSV = () => {
    const headers = [
      "Linie", "Bezeichnung", "Tagestyp",
      "Fahrten FP1", "Erste FP1", "Letzte FP1", "Takt FP1",
      "Fahrten FP2", "Erste FP2", "Letzte FP2", "Takt FP2",
      "Delta", "Status",
    ];
    const rows = filteredFrequency.map((f) => [
      f.shortName, f.longName, dayLabel(dayType),
      f.a1?.trips ?? "-", f.a1?.firstDeparture ?? "-", f.a1?.lastDeparture ?? "-", f.a1?.headway ?? "-",
      f.a2?.trips ?? "-", f.a2?.firstDeparture ?? "-", f.a2?.lastDeparture ?? "-", f.a2?.headway ?? "-",
      f.tripDelta, f.statusText,
    ]);
    downloadCSV(`Taktanalyse_${dayType}_${new Date().toISOString().split("T")[0]}.csv`, headers, rows);
  };

  const handleExportGapsCSV = () => {
    const headers = ["Haltestelle", "Letzte Abfahrt Mo-Fr", "Fahrten Sa", "Fahrten So", "Nachtlücke", "Sonntagslücke"];
    const rows = filteredGaps.map((g) => [
      g.stopNameStem, g.lastDepartureWeekday || "-", g.tripsSaturday, g.tripsSunday,
      g.hasNightGap ? "JA" : "NEIN", g.hasSundayGap ? "JA" : "NEIN",
    ]);
    downloadCSV(`Bedienungsluecken_${new Date().toISOString().split("T")[0]}.csv`, headers, rows);
  };

  const handlePrint = () => window.print();

  const handleStartAIChat = () => {
    if (!onStartAIChatWithFacts) return;
    const topChanges = filteredFrequency
      .filter((f) => f.tripDelta !== 0 || f.statusText.includes("Takt") || f.statusText.includes("Linie"))
      .slice(0, 10)
      .map((f) => `• Linie ${f.shortName}: FP1 ${f.a1?.trips ?? 0} Fahrten (Takt ${f.a1?.headway ?? "-"}m) → FP2 ${f.a2?.trips ?? 0} Fahrten (Takt ${f.a2?.headway ?? "-"}m) — ${f.statusText}`)
      .join("\n");
    const gapSample = serviceGaps
      .slice(0, 10)
      .map((g) => `• ${g.stopNameStem}: letzte Abfahrt Mo-Fr ${g.lastDepartureWeekday || "keine"}, So ${g.tripsSunday} Fahrten`)
      .join("\n");

    const factsPrompt = `### BERECHNETE FAHRPLAN-FAKTEN (Landkreis Heilbronn)

Analyse-Stichtag (${dayLabel(dayType)}): ${repDates ? ymdToIso(repDates[dayType]) : "-"}

#### 1. Linientaktung & Fahrten
${topChanges || "Keine signifikanten Taktänderungen."}

#### 2. Bedienungslücken (${serviceGaps.length} Haltestellen betroffen)
${gapSample || "Keine Bedienungslücken gefunden."}
${stopsDiff ? `\n#### 3. Haltestellen-Veränderungen\n- Entfallen: ${stopsDiff.removedStopStems.length}\n- Neu: ${stopsDiff.addedStopStems.length}` : ""}

Bitte fasse diese Fahrplandaten verständlich zusammen und gib Empfehlungen.`;
    onStartAIChatWithFacts(factsPrompt);
  };

  const handleShowGapsOnMapClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onShowGapsOnMap) return;
    onShowGapsOnMap(new Set(filteredGaps.map((g) => g.stopNameStem)));
  };
  const handleShowDiffOnMapClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onShowDiffOnMap || !stopsDiff) return;
    onShowDiffOnMap(
      new Set(stopsDiff.removedStopStems.map((s) => s.stem)),
      new Set(stopsDiff.addedStopStems.map((s) => s.stem))
    );
  };

  if (!ds1 && !ds2) {
    return (
      <div id="section-diff" className="h-[48px] bg-gray-50 rounded-lg border border-gray-200 px-4 flex items-center justify-between text-gray-400 select-none mb-4">
        <div className="flex items-center gap-2 text-body font-medium text-gray-500">
          <GitCompare className="w-4 h-4 text-gray-400" />
          <span>GTFS Fahrplan-Vergleich</span>
        </div>
        <Lock className="w-4 h-4 text-gray-400" />
      </div>
    );
  }
  if (!activeDs) return null;

  const activeGapCount = serviceGaps.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-4 no-print">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="section-badge shrink-0" style={{ ["--c" as any]: "var(--warn)" }}><GitCompare className="w-4 h-4" /></span>
            <h2 className="text-heading text-gray-900">
              {ds1 ? ds1.name : "HNV Fahrplan"}{" "}
              {ds2 ? (
                <>
                  <span className="text-gray-400 font-normal">vs.</span> {ds2.name}
                </>
              ) : (
                <span className="text-meta text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md ml-1">Einzelnetz</span>
              )}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="gel gel-light text-body px-3 py-1.5">
              <Printer className="w-3.5 h-3.5 text-gray-600" />
              <span>Drucken</span>
            </button>
            {onStartAIChatWithFacts && (
              <button onClick={handleStartAIChat} className="gel gel-blue text-body px-3 py-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>KI befragen</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 1: Takt-Analyse */}
      <div className="card overflow-hidden">
        <button onClick={() => setIsTaktOpen(!isTaktOpen)} className={`panel-head w-full p-4 flex items-center justify-between gap-2 text-left cursor-pointer ${isTaktOpen ? "border-b border-[var(--border)]" : ""}`}>
          <div className="flex items-center gap-2">
            <span className="section-badge shrink-0" style={{ ["--c" as any]: "var(--brand)" }}><Bus className="w-4 h-4" /></span>
            <div>
              <h3 className="text-heading text-gray-900">1. Takt-Analyse pro Linie</h3>
              <p className="text-meta">{frequencyData.length} Linien · {dayLabel(dayType)}</p>
            </div>
          </div>
          {isTaktOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {isTaktOpen && (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 no-print">
              <div className="seg">
                {(["weekday", "saturday", "sunday"] as DayType[]).map((d) => {
                  const active = dayType === d;
                  return (
                    <button key={d} onClick={() => setDayType(d)} data-active={active} className="seg-item">
                      {active && (
                        <motion.span layoutId="daytype-thumb" className="absolute inset-0 rounded-[9px] pill-thumb" transition={{ type: "spring", stiffness: 500, damping: 36 }} />
                      )}
                      <span className="relative z-10">{dayLabel(d)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input type="text" placeholder="Linie…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-7 pr-2 py-1 bg-white border border-gray-200 rounded-md text-body focus:outline-none w-28" />
                </div>
                <button onClick={handleExportFrequencyCSV} className="gel gel-light p-1.5" title="CSV Export">
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-left border-collapse text-body">
                <thead>
                  <tr className="text-meta sticky top-0 bg-white shadow-[0_1px_0_0_#f3f4f6]">
                    <th className="p-2 w-14">Linie</th>
                    <th className="p-2">Verlauf</th>
                    {ds1 && <th className="p-2">{ds2 ? "Fahrplan 1" : "Fahrten"}</th>}
                    {ds2 && <th className="p-2">Fahrplan 2</th>}
                    {ds1 && ds2 && <th className="p-2">Status</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-800">
                  {filteredFrequency.map((row) => {
                    const single = !(ds1 && ds2);
                    const primary = ds2 ? row.a2 : row.a1;
                    return (
                      <tr key={row.routeId} className="hover:bg-gray-50 transition-colors">
                        <td className="p-2 font-medium align-top">
                          <span className="line-badge px-2 py-0.5 rounded-md text-data">{row.shortName}</span>
                        </td>
                        <td className="p-2 text-body text-gray-700 max-w-[260px] truncate align-top" title={row.longName || undefined}>
                          {row.longName || <span className="text-gray-300">–</span>}
                        </td>
                        {ds1 && (
                          <td className="p-2 align-top min-w-[110px]">
                            <FreqCell d={ds2 ? row.a1 : primary} maxTrips={maxTrips} />
                          </td>
                        )}
                        {ds2 && (
                          <td className="p-2 align-top min-w-[110px]">
                            <FreqCell d={row.a2} maxTrips={maxTrips} />
                          </td>
                        )}
                        {ds1 && ds2 && (
                          <td className="p-2 align-top">
                            <span className={`chip-soft text-meta px-2 py-0.5 ${row.statusColor}`}>{row.statusText}</span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: Bedienungslücken */}
      <div className="card overflow-hidden">
        <div role="button" tabIndex={0} onClick={() => setIsGapsOpen(!isGapsOpen)} className={`panel-head w-full p-4 flex items-center justify-between gap-2 text-left cursor-pointer ${isGapsOpen ? "border-b border-[var(--border)]" : ""}`}>
          <div className="flex items-center gap-2">
            <span className="section-badge shrink-0" style={{ ["--c" as any]: "var(--text-secondary)" }}><AlertTriangle className="w-4 h-4" /></span>
            <div>
              <h3 className="text-heading text-gray-900">2. Bedienungslücken (Abend & Sonntag)</h3>
              <p className="text-meta">{activeGapCount} Haltestellen mit Frühschluss (&lt; 20 Uhr) oder Sonntagslücke</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onShowGapsOnMap && activeGapCount > 0 && (
              <button type="button" onClick={handleShowGapsOnMapClick} className="gel gel-light text-body px-2.5 py-1">Auf Karte</button>
            )}
            {isGapsOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </div>

        {isGapsOpen && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="relative flex-1 max-w-[220px]">
                <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input type="text" placeholder="Haltestelle filtern…" value={gapSearchTerm} onChange={(e) => setGapSearchTerm(e.target.value)} className="w-full pl-7 pr-2 py-1 bg-white border border-gray-200 rounded-md text-body focus:outline-none" />
              </div>
              <button onClick={handleExportGapsCSV} className="gel gel-light p-1.5" title="CSV Export">
                <Download className="w-3.5 h-3.5 text-emerald-600" />
              </button>
            </div>

            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-body">
                <thead>
                  <tr className="text-meta sticky top-0 bg-white shadow-[0_1px_0_0_#f3f4f6]">
                    <GapTh label="Haltestelle" k="name" cur={gapSortKey} dir={gapSortDir} set={setGapSortKey} setDir={setGapSortDir} />
                    <GapTh label="Letzte Mo-Fr" k="lastDep" cur={gapSortKey} dir={gapSortDir} set={setGapSortKey} setDir={setGapSortDir} />
                    <GapTh label="Sa" k="sat" cur={gapSortKey} dir={gapSortDir} set={setGapSortKey} setDir={setGapSortDir} />
                    <GapTh label="So" k="sun" cur={gapSortKey} dir={gapSortDir} set={setGapSortKey} setDir={setGapSortDir} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-800">
                  {filteredGaps.slice(0, 40).map((g) => (
                    <tr key={g.representativeStop.stop_id} onMouseEnter={() => onHoverStopStem?.(g.stopNameStem)} onMouseLeave={() => onHoverStopStem?.(null)} onClick={() => onHoverStopStem?.(g.stopNameStem)} className="hover:bg-amber-50/50 cursor-pointer transition-colors">
                      <td className="p-2 text-heading text-gray-900">{g.stopNameStem}</td>
                      <td className="p-2">
                        {g.hasNightGap ? (
                          <span className="font-medium text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-sm border border-amber-200 text-data">{g.lastDepartureWeekday || "keine"}</span>
                        ) : (
                          <span className="text-data">{g.lastDepartureWeekday}</span>
                        )}
                      </td>
                      <td className="p-2 text-data text-gray-600">{g.tripsSaturday}</td>
                      <td className="p-2">
                        {g.hasSundayGap ? (
                          <span className="font-medium text-red-800 bg-red-50 px-1.5 py-0.5 rounded-sm border border-red-200 text-data">0</span>
                        ) : (
                          <span className="text-data">{g.tripsSunday}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredGaps.length > 40 && (
                <p className="text-meta text-gray-400 pt-2">… und {filteredGaps.length - 40} weitere (CSV-Export für vollständige Liste)</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: Haltestellen-Diff */}
      {stopsDiff && (
        <div className="card overflow-hidden">
          <div role="button" tabIndex={0} onClick={() => setIsDiffOpen(!isDiffOpen)} className={`panel-head w-full p-4 flex items-center justify-between gap-2 text-left cursor-pointer ${isDiffOpen ? "border-b border-[var(--border)]" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="section-badge shrink-0" style={{ ["--c" as any]: "var(--bus)" }}><MapPin className="w-4 h-4" /></span>
              <div>
                <h3 className="text-heading text-gray-900">3. Haltestellen-Diff</h3>
                <p className="text-meta">−{stopsDiff.removedStopStems.length} entfallen · +{stopsDiff.addedStopStems.length} neu</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onShowDiffOnMap && (
                <button type="button" onClick={handleShowDiffOnMapClick} className="gel gel-light text-body px-2.5 py-1">Auf Karte</button>
              )}
              {isDiffOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </div>

          {isDiffOpen && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-body">
              <div className="space-y-2">
                <span className="text-heading text-red-700 flex items-center gap-1">
                  <MinusCircle className="w-3.5 h-3.5" /> Entfallen ({stopsDiff.removedStopStems.length})
                </span>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {stopsDiff.removedStopStems.length === 0 && <p className="text-meta text-gray-400">Keine entfallenen Haltestellen</p>}
                  {stopsDiff.removedStopStems.map((s) => (
                    <div key={s.stem} onMouseEnter={() => onHoverStopStem?.(s.stem)} onMouseLeave={() => onHoverStopStem?.(null)} className="p-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md font-medium text-red-950 flex items-center justify-between cursor-pointer text-body">
                      <span className="truncate">− {s.stem}</span>
                      <span className="text-meta text-red-700 font-normal shrink-0">{s.stops.length} St.</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-heading text-emerald-700 flex items-center gap-1">
                  <PlusCircle className="w-3.5 h-3.5" /> Neu ({stopsDiff.addedStopStems.length})
                </span>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {stopsDiff.addedStopStems.length === 0 && <p className="text-meta text-gray-400">Keine neuen Haltestellen</p>}
                  {stopsDiff.addedStopStems.map((s) => (
                    <div key={s.stem} onMouseEnter={() => onHoverStopStem?.(s.stem)} onMouseLeave={() => onHoverStopStem?.(null)} className="p-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md font-medium text-emerald-950 flex items-center justify-between cursor-pointer text-body">
                      <span className="truncate">+ {s.stem}</span>
                      <span className="text-meta text-emerald-700 font-normal shrink-0">{s.stops.length} St.</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Zelle mit Fahrtenzahl, Mini-Balken, Takt und Betriebszeit
const FreqCell: React.FC<{ d: DayFrequency | null; maxTrips: number }> = ({ d }) => {
  if (!d || d.trips === 0) return <span className="text-gray-300">—</span>;
  return (
    <div className="leading-tight">
      <div className="flex items-baseline gap-1.5">
        <span className="text-data text-gray-900">{d.trips}</span>
        <span className="text-meta text-gray-400">Fahrten</span>
      </div>
      <div className="text-meta text-gray-400 tabular-nums mt-0.5">
        {d.headway ? `Takt ${d.headway} min · ` : ""}{d.firstDeparture}–{d.lastDeparture}
      </div>
    </div>
  );
};

const GapTh: React.FC<{
  label: string;
  k: "name" | "lastDep" | "sat" | "sun";
  cur: string;
  dir: "asc" | "desc";
  set: (k: any) => void;
  setDir: (d: "asc" | "desc") => void;
}> = ({ label, k, cur, dir, set, setDir }) => (
  <th className="p-2 select-none">
    <button
      className="inline-flex items-center gap-0.5 hover:text-gray-700 cursor-pointer"
      onClick={() => {
        if (cur === k) setDir(dir === "asc" ? "desc" : "asc");
        else {
          set(k);
          setDir("asc");
        }
      }}
    >
      {label}
      {cur === k && (dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  </th>
);
