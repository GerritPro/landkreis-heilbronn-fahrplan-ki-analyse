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

// Füllwörter/Frage-Vokabular, das keine Haltestelle identifiziert. Ortsteile wie
// „Bahnhof"/„Marktplatz" bleiben BEWUSST drin (helfen beim Disambiguieren, z.B.
// „Heilbronn Hauptbahnhof" schlägt das generische „Heilbronn").
const STOP_STOPWORDS = new Set([
  "welche", "gibt", "fahren", "fährt", "kommen", "kommt", "danach", "dann", "nach",
  "menschen", "leute", "schule", "wieviele", "viele", "können", "kann", "zwischen",
  "linie", "linien", "haltestelle", "station", "umstieg", "umstiege", "anschluss",
  "anschlüsse", "verbindung", "verbindungen", "fahrplan", "fahrpläne", "busse",
  "fasse", "zusammen", "angebot", "richtung", "abends", "sonntag", "samstag",
]);

/**
 * Findet die passende Haltestelle zur Frage. Zuerst exakter Namenstreffer;
 * sonst – nur bei Anschluss-/Zeit-Fragen – die Haltestelle mit der höchsten
 * Überlappung distinktiver Orts-Tokens (z.B. „Schwaigern" → „Schwaigern Leintalschule").
 */
function findStopForPrompt(
  stops: GTFSDataSet["stops"],
  p: string,
  allowTokenMatch: boolean
) {
  // Exakter Namenstreffer – möglichst SPEZIFISCH (längster enthaltener Name),
  // damit ein generisches „Heilbronn" nicht das „Heilbronn Hbf …" verdrängt.
  let exact: GTFSDataSet["stops"][number] | null = null;
  for (const s of stops) {
    if (s.stop_name.length > 4 && p.includes(s.stop_name.toLowerCase())) {
      if (!exact || s.stop_name.length > exact.stop_name.length) exact = s;
    }
  }
  if (!allowTokenMatch) return exact;

  const tokens = (p.match(/[a-zäöüß]{4,}/g) || []).filter((t) => !STOP_STOPWORDS.has(t));
  if (tokens.length === 0) return exact;

  // Synonyme: Feeds schreiben oft „Hbf" statt „Hauptbahnhof".
  const variantsOf = (t: string): string[] =>
    t === "hauptbahnhof" ? ["hauptbahnhof", "hbf"] : t === "bahnhof" ? ["bahnhof", "bhf"] : [t];

  // Generische Ortsteil-Wörter: helfen beim Verfeinern, sind aber allein kein
  // Ortsbezug. Ein Treffer MUSS mindestens ein distinktives Orts-Token enthalten
  // (sonst würde „Bahnhof" auf „Wien Hauptbahnhof" matchen).
  const QUALIFIERS = new Set(["hauptbahnhof", "hbf", "bahnhof", "bhf", "marktplatz", "platz", "strasse", "straße"]);
  const distinctive = tokens.filter((t) => !QUALIFIERS.has(t));
  if (distinctive.length === 0) return exact;

  const wantsHbf = /hauptbahnhof|\bhbf\b/.test(p);
  const wantsBhf = !wantsHbf && /bahnhof|\bbhf\b/.test(p);

  const pick = (allow: (name: string) => boolean): GTFSDataSet["stops"][number] | null => {
    let best: GTFSDataSet["stops"][number] | null = null;
    let bestScore = 0;
    for (const s of stops) {
      if (s.stop_name.length <= 4) continue;
      const name = s.stop_name.toLowerCase();
      if (!allow(name)) continue;
      let dScore = 0;
      for (const t of distinctive) if (variantsOf(t).some((v) => name.includes(v))) dScore++;
      if (dScore === 0) continue; // ohne Ortsbezug kein Treffer
      let score = dScore;
      for (const t of tokens) if (QUALIFIERS.has(t) && variantsOf(t).some((v) => name.includes(v))) score += 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  };

  let best: GTFSDataSet["stops"][number] | null = null;
  if (wantsHbf) best = pick((n) => /hauptbahnhof|hbf/.test(n));
  else if (wantsBhf) best = pick((n) => /bahnhof|bhf/.test(n));
  if (!best) best = pick(() => true); // Fallback ohne Qualifier-Filter
  return best || exact;
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
      neueLinien: diff.addedRoutes.map((r) => `Linie ${r.route_short_name}${r.route_long_name ? ` (${r.route_long_name})` : ""}`).slice(0, 15),
      entfalleneLinien: diff.removedRoutes.map((r) => `Linie ${r.route_short_name}${r.route_long_name ? ` (${r.route_long_name})` : ""}`).slice(0, 15),
      geaenderteLinien: diff.modifiedRoutes.length,
      neueHaltestellen: stopsDiff.addedStopStems.length,
      entfalleneHaltestellen: stopsDiff.removedStopStems.length,
    };
  }

  // 2. Umstiege / Anschlüsse (falls in der Frage eine Haltestelle genannt wird)
  if (targetDs?.analysis) {
    const wantsConnections = /umstie|anschl|verbind|\bbus|fahr|erreich|komm|\b\d{1,2}[:.]\d{2}\b/.test(p);
    let stopId: string | null = null;
    const named = findStopForPrompt(targetDs.stops, p, wantsConnections);
    if (named) stopId = named.stop_id;
    else if (wantsConnections) {
      const hub = targetDs.stops.find((s) => /hauptbahnhof|hbf|rathaus|zob|busbahnhof/i.test(s.stop_name));
      if (hub) stopId = hub.stop_id;
    }
    if (stopId) {
      // Zeit aus der Frage übernehmen (z.B. „nach 12:40", „um 7.15 Uhr").
      // Fällt auf 14:00 zurück, wenn keine Uhrzeit genannt ist. So beantwortet
      // die KI reale Szenarien wie „Schule aus um 12:40 – welche Busse fahren
      // danach ab Haltestelle X".
      const timeMatch = p.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
      const queryTime = timeMatch
        ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`
        : "14:00";
      const repDate = ymdToDate(targetDs.analysis.representativeDates.weekday);
      const transfers = getTransferConnectionsAtStop(targetDs, stopId, queryTime, repDate);
      const stop = targetDs.stops.find((s) => s.stop_id === stopId);
      if (transfers.length > 0) {
        facts.umstiege = {
          haltestelle: stop?.stop_name,
          abZeit: queryTime,
          verbindungen: transfers.slice(0, 8).map((t) => ({
            an: `${t.arrivingTrip.arrivalTime} Linie ${t.arrivingTrip.routeShortName}`,
            wartezeit: `${t.waitTimeMinutes} Min`,
            ab: `${t.departingTrip.departureTime} Linie ${t.departingTrip.routeShortName}`,
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
        linie: `Linie ${r.shortName}`,
        verlauf: r.longName || "",
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
