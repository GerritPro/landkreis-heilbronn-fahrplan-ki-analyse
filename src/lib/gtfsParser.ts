import JSZip from "jszip";
import {
  GTFSDataSet,
  GTFSRoute,
  GTFSStop,
  GTFSTrip,
  GTFSStopTime,
  GTFSCalendar,
} from "../types";
import {
  parseGtfsTexts,
  computeAnalysis,
  buildIndices,
  ensureStopTimesIndexed,
  isServiceActiveOn,
  getStopNameStem,
  getStopGroupKey,
  getTransferConnectionsAtStop,
  analyzeStopsDiff,
  GtfsTexts,
} from "./gtfsEngine";

// Re-Exports: die Engine ist die einzige Quelle der Wahrheit; Komponenten
// importieren diese Helfer weiterhin aus dem Parser (Rückwärtskompatibilität).
export {
  ensureStopTimesIndexed,
  isServiceActiveOn,
  getStopNameStem,
  getStopGroupKey,
  getTransferConnectionsAtStop,
  analyzeStopsDiff,
  buildIndices,
  computeAnalysis,
};
export type { StopsDiffResult } from "./gtfsEngine";

/**
 * Main-Thread-Fallback (falls Web-Worker nicht verfügbar): entpackt das ZIP
 * und nutzt dieselbe Engine wie der Worker, inkl. vorberechneter Analyse.
 */
export async function parseGTFSZip(
  file: File,
  datasetId: string,
  onProgress?: (step: string, percent: number) => void
): Promise<GTFSDataSet> {
  const progress = onProgress || (() => {});
  progress("Entpacke ZIP-Archiv…", 10);
  const zip = new JSZip();
  const loaded = await zip.loadAsync(file);

  const required = ["routes", "stops", "trips", "stop_times"];
  const missing: string[] = [];
  for (const name of required) {
    if (loaded.file(new RegExp(`${name}\\.txt$`, "i")).length === 0) {
      missing.push(`${name}.txt`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Ungültige ZIP-Datei: Es fehlen folgende Pflichtdateien: ${missing.join(", ")}`
    );
  }

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
    onProgress: progress,
  });
  progress("Berechne Netz-Analyse…", 92);
  dataset.analysis = computeAnalysis(dataset);
  return dataset;
}

function generateSampleStopTimes(trips: GTFSTrip[], stops: GTFSStop[]): GTFSStopTime[] {
  const stopTimes: GTFSStopTime[] = [];
  const harmonieStop = stops.find((s) => s.stop_id === "hnv_harmonie") || stops[0];
  const hbfStop = stops.find((s) => s.stop_id === "hnv_hbf") || stops[0];
  const sontheimStop = stops.find((s) => s.stop_id === "hnv_sontheim_hs") || stops[0];
  const neckarsulmStop = stops.find((s) => s.stop_id === "hnv_neckarsulm_hbf") || stops[0];

  const baseMins = 300; // 05:00
  // Jede Demo-Fahrt läuft über den Hauptbahnhof als Mittel-Knoten. Die Hbf-Zeit
  // liegt auf einem sauberen 15-Min-Raster (05:00, 05:15, …), damit der Hbf zu
  // vollen Viertelstunden bedient wird und Umstiegsabfragen (z.B. 14:00) treffen.
  trips.forEach((trip, idx) => {
    const hub = baseMins + (idx % 72) * 15; // 05:00–22:45
    const chain =
      idx % 2 === 0
        ? [
            { s: sontheimStop, off: -12 },
            { s: harmonieStop, off: -6 },
            { s: hbfStop, off: 0 },
            { s: neckarsulmStop, off: 6 },
          ]
        : [
            { s: neckarsulmStop, off: -6 },
            { s: hbfStop, off: 0 },
            { s: harmonieStop, off: 6 },
            { s: sontheimStop, off: 12 },
          ];
    chain.forEach(({ s, off }, i) => {
      const m = hub + off;
      const hh = Math.floor((m / 60) % 24).toString().padStart(2, "0");
      const mm = Math.floor(m % 60).toString().padStart(2, "0");
      stopTimes.push({
        trip_id: trip.trip_id,
        arrival_time: `${hh}:${mm}:00`,
        departure_time: `${hh}:${mm}:00`,
        stop_id: s.stop_id,
        stop_sequence: i + 1,
        arrMins: m,
        depMins: m,
      });
    });
  });

  return stopTimes;
}

// Demo-Kalender: Werktags- und Wochenend-Dienst über ein volles Jahr, damit
// die datengetriebene Repräsentativtag-Wahl auch im Demo-Modus greift.
function demoCalendar(): GTFSCalendar[] {
  return [
    {
      service_id: "service_weekday",
      monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1,
      saturday: 0, sunday: 0,
      start_date: "20260101", end_date: "20261231",
    },
    {
      service_id: "service_weekend",
      monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0,
      saturday: 1, sunday: 1,
      start_date: "20260101", end_date: "20261231",
    },
  ];
}

export function createSampleHNVDatesets(): {
  ds1: GTFSDataSet;
  ds2: GTFSDataSet;
} {
  const defaultRoutes = createDefaultHNVRoutes();
  const defaultStops = createDefaultHNVStops();

  const trips1 = generateSampleTrips(defaultRoutes, 24);
  const stopTimes1 = generateSampleStopTimes(trips1, defaultStops);

  const ds1: GTFSDataSet = {
    id: "ds_hnv_2024",
    name: "HNV Soll-Fahrplan 2024 (Basis Stand)",
    fileName: "HNV_GTFS_Soll_2024.zip",
    fileSize: 1420500,
    uploadedAt: "08:00",
    routes: defaultRoutes,
    stops: defaultStops,
    trips: trips1,
    stopTimes: stopTimes1,
    shapes: {},
    transfers: [],
    agencies: ["HNV - Heilbronner Nahverkehr GmbH", "Stadtwerke Heilbronn (SWH)"],
    totalTripsCount: 284,
    calendar: demoCalendar(),
    calendarDates: [],
    feedStart: "20260101",
    feedEnd: "20261231",
  };
  ensureStopTimesIndexed(ds1);
  ds1.analysis = computeAnalysis(ds1);

  const ds2Routes = defaultRoutes.map((r) => {
    if (r.route_short_name === "601") {
      return { ...r, route_long_name: "Sontheim - Hbf - Neckarsulm (15-Min-Takt Neu)" };
    }
    return r;
  });

  const trips2 = generateSampleTrips(ds2Routes, 36);
  const stopTimes2 = generateSampleStopTimes(trips2, defaultStops);

  const ds2: GTFSDataSet = {
    id: "ds_hnv_2025",
    name: "HNV Soll-Fahrplan 2025 (Soll-Änderung)",
    fileName: "HNV_GTFS_Soll_2025_Planung.zip",
    fileSize: 1512300,
    uploadedAt: "08:05",
    routes: ds2Routes,
    stops: [
      ...defaultStops,
      {
        stop_id: "hnv_stop_neckarsulm_kaufland",
        stop_name: "Neckarsulm Kaufland Gewerbegebiet",
        stop_lat: 49.1985,
        stop_lon: 9.2312,
        lines: ["601", "641"],
      },
    ],
    trips: trips2,
    stopTimes: stopTimes2,
    shapes: {},
    transfers: [],
    agencies: ["HNV - Heilbronner Nahverkehr GmbH", "Stadtwerke Heilbronn (SWH)"],
    totalTripsCount: 342,
    calendar: demoCalendar(),
    calendarDates: [],
    feedStart: "20260101",
    feedEnd: "20261231",
  };
  ensureStopTimesIndexed(ds2);
  ds2.analysis = computeAnalysis(ds2);

  return { ds1, ds2 };
}

export function createDefaultHNVRoutes(): GTFSRoute[] {
  return [
    // Stadtbus Heilbronn (SWH)
    {
      route_id: "r_1",
      route_short_name: "1",
      route_long_name: "Stadtbus: Trappensee - Hbf - Böckingen - Schuchmannstraße",
      route_type: 3,
      route_color: "#E30613",
    },
    {
      route_id: "r_2",
      route_short_name: "2",
      route_long_name: "Stadtbus: Trappensee - Hbf - Neckargartach - Böllinger Höfe",
      route_type: 3,
      route_color: "#E30613",
    },
    {
      route_id: "r_5",
      route_short_name: "5",
      route_long_name: "Stadtbus: Sontheim - Hbf - Industriegebiet - Neckargartach",
      route_type: 3,
      route_color: "#0088CC",
    },
    {
      route_id: "r_8",
      route_short_name: "8",
      route_long_name: "Stadtbus: Hbf - Theresienwiese - Wertwiesen - Sontheim",
      route_type: 3,
      route_color: "#0088CC",
    },
    {
      route_id: "r_10",
      route_short_name: "10",
      route_long_name: "Stadtbus: Hbf - Wollhaus - Pentaloberg / Staufenberg",
      route_type: 3,
      route_color: "#009944",
    },
    {
      route_id: "r_11",
      route_short_name: "11",
      route_long_name: "Stadtbus: Hbf - Wollhaus - Rampachertal - Flein",
      route_type: 3,
      route_color: "#009944",
    },
    {
      route_id: "r_12",
      route_short_name: "12",
      route_long_name: "Stadtbus: Hbf - Wollhaus - Rampachertal - Flein Sommerhöhe",
      route_type: 3,
      route_color: "#009944",
    },
    {
      route_id: "r_13",
      route_short_name: "13",
      route_long_name: "Stadtbus: Sontheim - Wertwiesen - Hbf - Allee",
      route_type: 3,
      route_color: "#009944",
    },
    {
      route_id: "r_31",
      route_short_name: "31",
      route_long_name: "Stadtbus: Hbf - Böckingen - Frankenbach",
      route_type: 3,
      route_color: "#82B822",
    },
    {
      route_id: "r_32",
      route_short_name: "32",
      route_long_name: "Stadtbus: Hbf - Böckingen - Neckargartach",
      route_type: 3,
      route_color: "#82B822",
    },
    {
      route_id: "r_33",
      route_short_name: "33",
      route_long_name: "Stadtbus: Hbf - Böckingen - Böllinger Höfe",
      route_type: 3,
      route_color: "#82B822",
    },
    {
      route_id: "r_41",
      route_short_name: "41",
      route_long_name: "Stadtbus: Hbf - Wollhaus - Sontheim",
      route_type: 3,
      route_color: "#FF8C00",
    },
    {
      route_id: "r_42",
      route_short_name: "42",
      route_long_name: "Stadtbus: Hbf - Wollhaus - Horkheim",
      route_type: 3,
      route_color: "#FF8C00",
    },
    {
      route_id: "r_61",
      route_short_name: "61",
      route_long_name: "Stadtbus: Hbf - Neckarsulm - Amorbach",
      route_type: 3,
      route_color: "#7209B7",
    },
    {
      route_id: "r_62",
      route_short_name: "62",
      route_long_name: "Stadtbus: Hbf - Neckarsulm - Obereisesheim",
      route_type: 3,
      route_color: "#7209B7",
    },
    {
      route_id: "r_64",
      route_short_name: "64",
      route_long_name: "Stadtbus: Hbf - Gewerbegebiet Böllinger Höfe",
      route_type: 3,
      route_color: "#7209B7",
    },
    {
      route_id: "r_b",
      route_short_name: "B",
      route_long_name: "Nachtbus: Heilbronn Hbf - Allee - Sontheim - Flein",
      route_type: 3,
      route_color: "#1E1B4B",
    },
    {
      route_id: "r_fw1",
      route_short_name: "FW1",
      route_long_name: "Feuerwehr-Shuttle: Heilbronn Hbf - Theresienwiese",
      route_type: 3,
      route_color: "#DC2626",
    },
    // Regionalbus HNV (600er Korridor)
    {
      route_id: "r_601",
      route_short_name: "601",
      route_long_name: "Regiobus: Heilbronn Sontheim - Hbf - Harmonie - Neckarsulm",
      route_type: 3,
      route_color: "#E30613",
    },
    {
      route_id: "r_602",
      route_short_name: "602",
      route_long_name: "Regiobus: Frankenbach - Klinikum - Hbf - Harmonie - Flein",
      route_type: 3,
      route_color: "#0066CC",
    },
    {
      route_id: "r_611",
      route_short_name: "611",
      route_long_name: "Regiobus: Heilbronn Hbf - Untereisesheim - Bad Wimpfen",
      route_type: 3,
      route_color: "#2563EB",
    },
    {
      route_id: "r_612",
      route_short_name: "612",
      route_long_name: "Regiobus: Heilbronn - Neckarsulm - Amorbach - Dahenfeld",
      route_type: 3,
      route_color: "#2563EB",
    },
    {
      route_id: "r_620",
      route_short_name: "620",
      route_long_name: "Regiobus: Heilbronn Hbf - Leingarten - Massenbachhausen",
      route_type: 3,
      route_color: "#059669",
    },
    {
      route_id: "r_621",
      route_short_name: "621",
      route_long_name: "Regiobus: Heilbronn - Massenbachhausen - Kirchardt",
      route_type: 3,
      route_color: "#059669",
    },
    {
      route_id: "r_622",
      route_short_name: "622",
      route_long_name: "Regiobus: Heilbronn - Leingarten - Schwaigern",
      route_type: 3,
      route_color: "#059669",
    },
    {
      route_id: "r_631",
      route_short_name: "631",
      route_long_name: "Regiobus: Heilbronn Hbf - Harmonie - Trappensee - Weinsberg",
      route_type: 3,
      route_color: "#993399",
    },
    {
      route_id: "r_632",
      route_short_name: "632",
      route_long_name: "Regiobus: Heilbronn - Erlenbach - Binswangen",
      route_type: 3,
      route_color: "#993399",
    },
    {
      route_id: "r_640",
      route_short_name: "640",
      route_long_name: "Regiobus: Heilbronn - Neckarsulm - Bad Friedrichshall - Bad Wimpfen",
      route_type: 3,
      route_color: "#82B822",
    },
    {
      route_id: "r_641",
      route_short_name: "641",
      route_long_name: "Regiobus Bottwartal: Heilbronn Hbf - Sontheim - Flein - Untergruppenbach - Abstatt - Ilsfeld - Beilstein",
      route_type: 3,
      route_color: "#82B822",
    },
    {
      route_id: "r_642",
      route_short_name: "642",
      route_long_name: "Regiobus: Beilstein - Oberstenfeld - Marbach / Bad Friedrichshall - Oedheim",
      route_type: 3,
      route_color: "#82B822",
    },
    {
      route_id: "r_651",
      route_short_name: "651",
      route_long_name: "Regiobus: Bad Friedrichshall - Gundelsheim - Möckmühl",
      route_type: 3,
      route_color: "#FF8C00",
    },
    {
      route_id: "r_652",
      route_short_name: "652",
      route_long_name: "Regiobus: Möckmühl - Widdern - Jagsthausen",
      route_type: 3,
      route_color: "#FF8C00",
    },
    {
      route_id: "r_661",
      route_short_name: "661",
      route_long_name: "Regiobus: Heilbronn Hbf - Untergruppenbach - Abstatt - Ilsfeld",
      route_type: 3,
      route_color: "#00A896",
    },
    {
      route_id: "r_662",
      route_short_name: "662",
      route_long_name: "Regiobus: Heilbronn - Flein - Talheim - Lauffen",
      route_type: 3,
      route_color: "#00A896",
    },
    {
      route_id: "r_670",
      route_short_name: "670",
      route_long_name: "Regiobus: Heilbronn Hbf - Donnbronn - Untergruppenbach",
      route_type: 3,
      route_color: "#D97706",
    },
    {
      route_id: "r_671",
      route_short_name: "671",
      route_long_name: "Regiobus: Heilbronn - Flein - Untergruppenbach",
      route_type: 3,
      route_color: "#D97706",
    },
    {
      route_id: "r_680",
      route_short_name: "680",
      route_long_name: "Zabergäubus: Lauffen (Neckar) - Brackenheim - Güglingen - Zaberfeld",
      route_type: 3,
      route_color: "#E6D815",
    },
    {
      route_id: "r_681",
      route_short_name: "681",
      route_long_name: "Zabergäubus: Lauffen - Nordheim - Brackenheim",
      route_type: 3,
      route_color: "#E6D815",
    },
    {
      route_id: "r_682",
      route_short_name: "682",
      route_long_name: "Zabergäubus: Lauffen - Talheim - Lauffen Ost",
      route_type: 3,
      route_color: "#E6D815",
    },
    {
      route_id: "r_691",
      route_short_name: "691",
      route_long_name: "Kraichgaubus: Eppingen - Gemmingen - Schwaigern - Leingarten",
      route_type: 3,
      route_color: "#7209B7",
    },
    {
      route_id: "r_692",
      route_short_name: "692",
      route_long_name: "Kraichgaubus: Eppingen - Ittlingen - Reihen / Sinsheim",
      route_type: 3,
      route_color: "#7209B7",
    },
    // Stadtbahn AVG / HNV
    {
      route_id: "r_s4",
      route_short_name: "S4",
      route_long_name: "Stadtbahn: Karlsruhe - Eppingen - Schwaigern - Heilbronn - Öhringen",
      route_type: 0,
      route_color: "#D91E27",
    },
    {
      route_id: "r_s41",
      route_short_name: "S41",
      route_long_name: "Stadtbahn: Heilbronn Hbf - Harmonie - Neckarsulm - Mosbach",
      route_type: 0,
      route_color: "#009944",
    },
    {
      route_id: "r_s42",
      route_short_name: "S42",
      route_long_name: "Stadtbahn: Heilbronn Hbf - Neckarsulm - Bad Friedrichshall - Bad Rappenau - Sinsheim",
      route_type: 0,
      route_color: "#0088CC",
    },
    // Regionalzüge & Express
    {
      route_id: "r_re8",
      route_short_name: "RE8",
      route_long_name: "Regional-Express: Stuttgart Hbf - Heilbronn Hbf - Bad Friedrichshall - Würzburg Hbf",
      route_type: 2,
      route_color: "#1A365D",
    },
    {
      route_id: "r_rb18",
      route_short_name: "RB18",
      route_long_name: "Regionalbahn: Stuttgart Hbf - Bietigheim-Bissingen - Heilbronn Hbf - Osterburken",
      route_type: 2,
      route_color: "#2B6CB0",
    },
    {
      route_id: "r_re45",
      route_short_name: "RE45",
      route_long_name: "Regional-Express: Karlsruhe Hbf - Bretten - Eppingen - Heilbronn Hbf",
      route_type: 2,
      route_color: "#1E3A8A",
    },
    {
      route_id: "r_rb83",
      route_short_name: "RB83",
      route_long_name: "Westfrankenbahn: Heilbronn Hbf - Öhringen - Schwäbisch Hall-Hessental",
      route_type: 2,
      route_color: "#047857",
    },
    {
      route_id: "r_mex12",
      route_short_name: "MEX 12",
      route_long_name: "Metropolexpress: Tübingen - Stuttgart - Bietigheim - Heilbronn - Mosbach",
      route_type: 2,
      route_color: "#B91C1C",
    },
    {
      route_id: "r_mex18",
      route_short_name: "MEX 18",
      route_long_name: "Metropolexpress: Tübingen - Stuttgart - Heilbronn - Osterburken",
      route_type: 2,
      route_color: "#C2410C",
    },
  ];
}

function createDefaultHNVStops(): GTFSStop[] {
  return [
    {
      stop_id: "hnv_hbf",
      stop_name: "Heilbronn Hauptbahnhof",
      stop_lat: 49.1427,
      stop_lon: 9.2109,
      lines: ["1", "2", "5", "10", "12", "31", "32", "41", "42", "61", "62", "601", "602", "631", "641", "661", "S4", "S41", "S42", "RE8", "RB18"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_harmonie",
      stop_name: "Heilbronn Harmonie / Kunstverein",
      stop_lat: 49.1415,
      stop_lon: 9.2223,
      lines: ["1", "2", "10", "12", "41", "42", "601", "602", "631", "661", "S4", "S41"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_rathaus",
      stop_name: "Heilbronn Rathaus",
      stop_lat: 49.1410,
      stop_lon: 9.2185,
      lines: ["1", "2", "5", "601", "S4"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_wollhaus",
      stop_name: "Heilbronn Wollhausplatz",
      stop_lat: 49.1398,
      stop_lon: 9.2205,
      lines: ["10", "12", "41", "42", "601", "602", "631", "661"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_sontheim_hs",
      stop_name: "Heilbronn Sontheim Hochschule",
      stop_lat: 49.1221,
      stop_lon: 9.2125,
      lines: ["5", "41", "601", "661"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_sontheim_wertwiesen",
      stop_name: "Heilbronn Sontheim Wertwiesen",
      stop_lat: 49.1305,
      stop_lon: 9.2115,
      lines: ["5", "41", "601"],
    },
    {
      stop_id: "hnv_frankenbach",
      stop_name: "Heilbronn Frankenbach",
      stop_lat: 49.1620,
      stop_lon: 9.1720,
      lines: ["31", "602"],
    },
    {
      stop_id: "hnv_klinikum",
      stop_name: "Heilbronn Klinikum am Gesundbrunnen",
      stop_lat: 49.1550,
      stop_lon: 9.1950,
      lines: ["31", "602"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_flein_mitte",
      stop_name: "Flein Mitte",
      stop_lat: 49.1025,
      stop_lon: 9.2130,
      lines: ["12", "602"],
    },
    {
      stop_id: "hnv_neckarsulm_hbf",
      stop_name: "Neckarsulm Bahnhof",
      stop_lat: 49.1917,
      stop_lon: 9.2308,
      lines: ["61", "62", "601", "641", "S41", "S42", "RE8"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_neckarsulm_sued",
      stop_name: "Neckarsulm Süd",
      stop_lat: 49.1820,
      stop_lon: 9.2290,
      lines: ["61", "601", "S41"],
    },
    {
      stop_id: "hnv_neckarsulm_kaufland",
      stop_name: "Neckarsulm Kaufland / Gewerbegebiet",
      stop_lat: 49.1985,
      stop_lon: 9.2312,
      lines: ["61", "601", "641"],
    },
    {
      stop_id: "hnv_neckarsulm_audi",
      stop_name: "Neckarsulm Audi Tor 1",
      stop_lat: 49.1950,
      stop_lon: 9.2250,
      lines: ["62", "601", "641"],
    },
    {
      stop_id: "hnv_bad_friedrichshall",
      stop_name: "Bad Friedrichshall Hauptbahnhof",
      stop_lat: 49.2312,
      stop_lon: 9.2145,
      lines: ["641", "651", "S41", "S42", "RE8", "RB18"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_bad_wimpfen",
      stop_name: "Bad Wimpfen Bahnhof",
      stop_lat: 49.2310,
      stop_lon: 9.1620,
      lines: ["641", "S42"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_bad_rappenau",
      stop_name: "Bad Rappenau Bahnhof",
      stop_lat: 49.2405,
      stop_lon: 9.1020,
      lines: ["S42"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_gundelsheim",
      stop_name: "Gundelsheim Bahnhof",
      stop_lat: 49.2820,
      stop_lon: 9.1550,
      lines: ["651", "S41"],
    },
    {
      stop_id: "hnv_moeckmuehl",
      stop_name: "Möckmühl Bahnhof",
      stop_lat: 49.3230,
      stop_lon: 9.3580,
      lines: ["651"],
    },
    {
      stop_id: "hnv_lauffen",
      stop_name: "Lauffen (Neckar) Bahnhof",
      stop_lat: 49.0763,
      stop_lon: 9.1583,
      lines: ["680", "RB18"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_brackenheim",
      stop_name: "Brackenheim Busbahnhof",
      stop_lat: 49.0782,
      stop_lon: 9.0664,
      lines: ["680"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_gueglingen",
      stop_name: "Güglingen Rathaus",
      stop_lat: 49.0665,
      stop_lon: 9.0010,
      lines: ["680"],
    },
    {
      stop_id: "hnv_zaberfeld",
      stop_name: "Zaberfeld Mitte",
      stop_lat: 49.0580,
      stop_lon: 8.9280,
      lines: ["680"],
    },
    {
      stop_id: "hnv_eppingen",
      stop_name: "Eppingen Bahnhof",
      stop_lat: 49.1368,
      stop_lon: 8.9103,
      lines: ["691", "S4"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_schwaigern",
      stop_name: "Schwaigern Bahnhof",
      stop_lat: 49.1405,
      stop_lon: 9.0550,
      lines: ["691", "S4"],
    },
    {
      stop_id: "hnv_leingarten",
      stop_name: "Leingarten West",
      stop_lat: 49.1430,
      stop_lon: 9.1120,
      lines: ["691", "S4"],
    },
    {
      stop_id: "hnv_weinsberg",
      stop_name: "Weinsberg Bahnhof",
      stop_lat: 49.1512,
      stop_lon: 9.2885,
      lines: ["631", "S4"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_obersulm",
      stop_name: "Obersulm Bahnhof / Eschenau",
      stop_lat: 49.1370,
      stop_lon: 9.3810,
      lines: ["S4"],
    },
    {
      stop_id: "hnv_oehringen",
      stop_name: "Öhringen Hauptbahnhof",
      stop_lat: 49.2040,
      stop_lon: 9.5020,
      lines: ["S4"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_untergruppenbach",
      stop_name: "Untergruppenbach Rathaus",
      stop_lat: 49.0880,
      stop_lon: 9.2740,
      lines: ["641", "661", "670", "671"],
    },
    {
      stop_id: "hnv_abstatt",
      stop_name: "Abstatt Bosch Entwicklungszentrum / Rathaus",
      stop_lat: 49.0680,
      stop_lon: 9.2980,
      lines: ["641", "661"],
    },
    {
      stop_id: "hnv_ilsfeld",
      stop_name: "Ilsfeld Rathaus / Schulzentrum",
      stop_lat: 49.0560,
      stop_lon: 9.2450,
      lines: ["641", "661"],
    },
    {
      stop_id: "hnv_beilstein_busbahnhof",
      stop_name: "Beilstein Busbahnhof",
      stop_lat: 49.0410,
      stop_lon: 9.3130,
      lines: ["641", "642"],
      wheelchair_boarding: 1,
    },
    {
      stop_id: "hnv_beilstein_langhans",
      stop_name: "Beilstein Schulzentrum / Kelter",
      stop_lat: 49.0425,
      stop_lon: 9.3145,
      lines: ["641", "642"],
    },
    {
      stop_id: "hnv_auenstein",
      stop_name: "Auenstein Mitte",
      stop_lat: 49.0620,
      stop_lon: 9.2950,
      lines: ["641"],
    },
    {
      stop_id: "hnv_oberstenfeld",
      stop_name: "Oberstenfeld Bank",
      stop_lat: 49.0230,
      stop_lon: 9.3180,
      lines: ["641", "642"],
    },
    {
      stop_id: "hnv_trappensee",
      stop_name: "Heilbronn Trappensee",
      stop_lat: 49.1380,
      stop_lon: 9.2510,
      lines: ["1", "2", "631"],
    },
  ];
}

function generateSampleTrips(routes: GTFSRoute[], countPerRoute: number): GTFSTrip[] {
  const trips: GTFSTrip[] = [];
  let tripIdCount = 1000;

  routes.forEach((route) => {
    for (let i = 0; i < countPerRoute; i++) {
      trips.push({
        trip_id: `trip_${tripIdCount++}`,
        route_id: route.route_id,
        service_id: i % 2 === 0 ? "service_weekday" : "service_weekend",
        trip_headsign: `Richtung ${route.route_long_name.split("-").pop()?.trim() || "Endstation"}`,
        direction_id: i % 2,
      });
    }
  });

  return trips;
}

export function compareGTFSDataSets(ds1: GTFSDataSet, ds2: GTFSDataSet) {
  const ds1RoutesMap = new Map<string, GTFSRoute>();
  ds1.routes.forEach((r) => ds1RoutesMap.set(r.route_short_name, r));

  const ds2RoutesMap = new Map<string, GTFSRoute>();
  ds2.routes.forEach((r) => ds2RoutesMap.set(r.route_short_name, r));

  const addedRoutes: GTFSRoute[] = [];
  const removedRoutes: GTFSRoute[] = [];
  const modifiedRoutes: {
    route: GTFSRoute;
    tripDiff: number;
    tripDelta: number;
    oldTrips: number;
    newTrips: number;
    description: string;
  }[] = [];

  ds2.routes.forEach((r2) => {
    const r1 = ds1RoutesMap.get(r2.route_short_name);
    if (!r1) {
      addedRoutes.push(r2);
    } else {
      const oldTrips = ds1.trips.filter((t) => t.route_id === r1.route_id).length || 24;
      const newTrips = ds2.trips.filter((t) => t.route_id === r2.route_id).length || 36;
      if (oldTrips !== newTrips || r1.route_long_name !== r2.route_long_name) {
        const delta = newTrips - oldTrips;
        modifiedRoutes.push({
          route: r2,
          tripDiff: delta,
          tripDelta: delta,
          oldTrips,
          newTrips,
          description: r1.route_long_name !== r2.route_long_name ? `Streckenanpassung: ${r2.route_long_name}` : `Fahrplanfrequenz angepasst (${delta > 0 ? "+" : ""}${delta} Fahrten/Tag)`,
        });
      }
    }
  });

  ds1.routes.forEach((r1) => {
    if (!ds2RoutesMap.has(r1.route_short_name)) {
      removedRoutes.push(r1);
    }
  });

  const ds1StopsMap = new Map<string, GTFSStop>();
  ds1.stops.forEach((s) => ds1StopsMap.set(s.stop_id, s));

  const ds2StopsMap = new Map<string, GTFSStop>();
  ds2.stops.forEach((s) => ds2StopsMap.set(s.stop_id, s));

  const addedStops: GTFSStop[] = [];
  const removedStops: GTFSStop[] = [];

  ds2.stops.forEach((s2) => {
    if (!ds1StopsMap.has(s2.stop_id)) {
      addedStops.push(s2);
    }
  });

  ds1.stops.forEach((s1) => {
    if (!ds2StopsMap.has(s1.stop_id)) {
      removedStops.push(s1);
    }
  });

  return {
    addedRoutes,
    removedRoutes,
    modifiedRoutes,
    addedStops,
    removedStops,
    summary: `Vergleich von ${ds1.name} mit ${ds2.name}: ${addedRoutes.length} neue Linien, ${modifiedRoutes.length} geänderte Taktungen, ${addedStops.length} neue Haltestellen.`,
  };
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number | boolean)[][]) {
  const csvContent = "\uFEFF" + [
    headers.join(";"),
    ...rows.map((row) =>
      row.map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`).join(";")
    ),
  ].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}



