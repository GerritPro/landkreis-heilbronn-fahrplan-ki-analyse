import { GTFSDataSet, DayType } from "../types";
import { compareGTFSDataSets } from "./gtfsParser";
import { getTransferConnectionsAtStop, analyzeStopsDiff, ymdToIso } from "./gtfsEngine";

function ymdToDate(ymd: string): Date {
  return new Date(
    parseInt(ymd.slice(0, 4), 10),
    parseInt(ymd.slice(4, 6), 10) - 1,
    parseInt(ymd.slice(6, 8), 10)
  );
}

/**
 * Erzeugt aus der (bereits vorberechneten) Analyse ein kompaktes Fakten-JSON,
 * das dem KI-Modell als einzige Wahrheitsgrundlage dient. Keine schweren
 * Berechnungen mehr im Main-Thread — alles kommt aus dataset.analysis.
 */
export function calculateFactsForPrompt(
  prompt: string,
  ds1: GTFSDataSet | null,
  ds2: GTFSDataSet | null
): string {
  const p = prompt.toLowerCase();
  const facts: Record<string, any> = {};
  const targetDs = ds2 || ds1;

  const summarize = (ds: GTFSDataSet) => {
    const s = ds.analysis?.summary;
    return {
      name: ds.name,
      linien: ds.routes.length,
      haltestellen: ds.stops.length,
      fahrten: ds.totalTripsCount,
      fahrtenWerktag: s?.weekdayTripCount ?? null,
      oeTaktWerktag: s?.avgWeekdayHeadway ?? null,
      gueltigVon: s?.feedStart ? ymdToIso(s.feedStart) : null,
      gueltigBis: s?.feedEnd ? ymdToIso(s.feedEnd) : null,
    };
  };

  if (ds1) facts.fahrplan1 = summarize(ds1);
  if (ds2) facts.fahrplan2 = summarize(ds2);

  if (targetDs?.analysis) {
    facts.stichtage = {
      werktag: ymdToIso(targetDs.analysis.representativeDates.weekday),
      samstag: ymdToIso(targetDs.analysis.representativeDates.saturday),
      sonntag: ymdToIso(targetDs.analysis.representativeDates.sunday),
    };
  }

  // 1. Vergleich zweier Fahrpläne
  if (ds1 && ds2) {
    const diff = compareGTFSDataSets(ds1, ds2);
    const stopsDiff = analyzeStopsDiff(ds1, ds2);
    facts.vergleich = {
      neueLinien: diff.addedRoutes.map((r) => `L${r.route_short_name} (${r.route_long_name})`).slice(0, 15),
      entfalleneLinien: diff.removedRoutes.map((r) => `L${r.route_short_name} (${r.route_long_name})`).slice(0, 15),
      geaenderteLinien: diff.modifiedRoutes.length,
      neueHaltestellen: stopsDiff.addedStopStems.length,
      entfalleneHaltestellen: stopsDiff.removedStopStems.length,
    };
  }

  // 2. Umstiege (falls in der Frage eine Haltestelle genannt wird)
  if (targetDs?.analysis) {
    let stopId: string | null = null;
    const named = targetDs.stops.find(
      (s) => s.stop_name.length > 4 && p.includes(s.stop_name.toLowerCase())
    );
    if (named) stopId = named.stop_id;
    else {
      const hub = targetDs.stops.find((s) => /hauptbahnhof|hbf|rathaus|zob|busbahnhof/i.test(s.stop_name));
      if (hub && (p.includes("umstieg") || p.includes("anschluss") || p.includes("verbindung"))) {
        stopId = hub.stop_id;
      }
    }
    if (stopId) {
      const repDate = ymdToDate(targetDs.analysis.representativeDates.weekday);
      const transfers = getTransferConnectionsAtStop(targetDs, stopId, "14:00", repDate);
      const stop = targetDs.stops.find((s) => s.stop_id === stopId);
      if (transfers.length > 0) {
        facts.umstiege = {
          haltestelle: stop?.stop_name,
          verbindungen: transfers.slice(0, 8).map((t) => ({
            an: `${t.arrivingTrip.arrivalTime} L${t.arrivingTrip.routeShortName}`,
            wartezeit: `${t.waitTimeMinutes} Min`,
            ab: `${t.departingTrip.departureTime} L${t.departingTrip.routeShortName}`,
            richtung: t.departingTrip.toStopName,
          })),
        };
      }
    }
  }

  // 3. Linientaktung (Top-Linien nach Werktagsfahrten)
  if (targetDs?.analysis) {
    const day: DayType = p.includes("samstag") ? "saturday" : p.includes("sonntag") ? "sunday" : "weekday";
    facts.linien = targetDs.analysis.routeFrequency
      .filter((r) => r.days[day].trips > 0)
      .sort((a, b) => b.days[day].trips - a.days[day].trips)
      .slice(0, 12)
      .map((r) => ({
        linie: `L${r.shortName}`,
        verlauf: r.longName,
        fahrten: r.days[day].trips,
        takt: r.days[day].headway,
      }));
  }

  // 4. Bedienungslücken
  if (targetDs?.analysis && (p.includes("lücke") || p.includes("luecke") || p.includes("abend") || p.includes("sonntag") || p.includes("nacht"))) {
    facts.bedienungsluecken = targetDs.analysis.serviceGaps.slice(0, 12).map((g) => ({
      haltestelle: g.stopNameStem,
      letzteAbfahrtWerktag: g.lastDepartureWeekday,
      fahrtenSonntag: g.tripsSunday,
    }));
  }

  const json = JSON.stringify(facts);
  return json.length > 3500 ? json.slice(0, 3500) : json;
}
