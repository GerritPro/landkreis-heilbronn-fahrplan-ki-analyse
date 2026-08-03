/**
 * gtfsEngine.ts — Reine GTFS-Parsing- und Analyse-Engine.
 *
 * Bewusst frei von DOM- und Bundler-Abhängigkeiten, damit derselbe Code
 * im Web-Worker (Browser) UND in einem Node-Testharness gegen echte
 * Feeds laufen kann. JSZip wird NICHT hier importiert — die Aufrufer
 * (Worker / Node-Harness) entpacken das ZIP und übergeben reine Texte.
 */

import {
  GTFSDataSet,
  GTFSRoute,
  GTFSStop,
  GTFSTrip,
  GTFSStopTime,
  GTFSTransfer,
  GTFSCalendar,
  GTFSCalendarDate,
  GTFSAnalysis,
  RouteFrequencyRow,
  ServiceGapItem,
  DayType,
  TransferOption,
} from "../types";

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

// Bounding-Box Region Landkreis Heilbronn (großzügig, inkl. Nachbarn)
export const GEO_BBOX = {
  minLat: 48.85,
  maxLat: 49.55,
  minLon: 8.7,
  maxLon: 9.85,
};

// Nacht-Grenze für Bedienungslücken (letzte Abfahrt vor dieser Zeit = Frühschluss)
const NIGHT_GAP_MINUTES = 20 * 60; // 20:00 Uhr

// ---------------------------------------------------------------------------
// CSV-Parsing (robust, RFC-4180-nah: Quotes, "" -> ", eingebettete Kommas)
// ---------------------------------------------------------------------------

/** Zerlegt EINE CSV-Zeile in Felder. */
export function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Streaming-CSV: ruft `onRow(fields, headerIndex)` je Datenzeile auf, ohne
 * ein komplettes Objekt-Array im Speicher zu halten. Gibt die (lowercase,
 * BOM-bereinigten) Header zurück.
 */
export function forEachCSVRow(
  text: string,
  onRow: (fields: string[], idx: (name: string) => number) => void
): { headers: string[]; count: number } {
  let start = 0;
  const n = text.length;
  let headers: string[] | null = null;
  let headerIndex: Map<string, number> | null = null;
  let count = 0;

  const idxFn = (name: string): number => headerIndex!.get(name) ?? -1;

  while (start < n) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = n;
    // Zeile ohne trailing \r
    let lineEnd = end;
    if (lineEnd > start && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;

    if (lineEnd > start) {
      const line = text.slice(start, lineEnd);
      if (!headers) {
        headers = parseCSVLine(line).map((h) =>
          h.replace(/^﻿/, "").trim().toLowerCase()
        );
        headerIndex = new Map();
        headers.forEach((h, i) => headerIndex!.set(h, i));
      } else {
        const fields = parseCSVLine(line);
        onRow(fields, idxFn);
        count++;
      }
    }
    start = end + 1;
  }

  return { headers: headers || [], count };
}

const cleanField = (v: string | undefined): string =>
  v === undefined ? "" : v.trim().replace(/^"|"$/g, "");

// ---------------------------------------------------------------------------
// Zeit-Helfer
// ---------------------------------------------------------------------------

/** "HH:MM[:SS]" -> Minuten seit Mitternacht (auch >24h für Nachtfahrten). */
export function parseTimeToMinutes(timeStr: string | undefined): number | null {
  if (!timeStr) return null;
  const s = timeStr.trim();
  if (!s) return null;
  const c1 = s.indexOf(":");
  if (c1 < 0) return null;
  const c2 = s.indexOf(":", c1 + 1);
  const h = parseInt(s.slice(0, c1), 10);
  const m = parseInt(s.slice(c1 + 1, c2 < 0 ? s.length : c2), 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/** Minuten -> "HH:MM" (normalisiert 24h, Nachtfahrten > 24h werden umgebrochen). */
export function formatMinutesToHHMM(totalMinutes: number): string {
  const norm = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(norm / 60);
  const m = Math.floor(norm % 60);
  return `${h < 10 ? "0" : ""}${h}:${m < 10 ? "0" : ""}${m}`;
}

// ---------------------------------------------------------------------------
// Datums-Helfer (arbeiten mit YYYYMMDD-Strings, ohne Zeitzone-Fallen)
// ---------------------------------------------------------------------------

/** JS Date -> "YYYYMMDD". */
export function dateToYmd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}${m < 10 ? "0" : ""}${m}${day < 10 ? "0" : ""}${day}`;
}

/** "YYYYMMDD" -> Wochentag (0=So .. 6=Sa), über eine lokale Date-Konstruktion. */
export function ymdWeekday(ymd: string): number {
  const y = parseInt(ymd.slice(0, 4), 10);
  const m = parseInt(ymd.slice(4, 6), 10);
  const d = parseInt(ymd.slice(6, 8), 10);
  return new Date(y, m - 1, d).getDay();
}

/** "YYYYMMDD" -> "YYYY-MM-DD" (für input[type=date]). */
export function ymdToIso(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

// ---------------------------------------------------------------------------
// Haltestellen-Gruppierung
// ---------------------------------------------------------------------------

/** Entfernt Steig-/Gleis-Suffixe aus einem Haltestellennamen. */
export function getStopNameStem(name: string): string {
  if (!name) return "";
  return name
    .replace(
      /\s*(\/|\()?(\s*(Steig|Bussteig|Gleis|Bstg\.?|Haltestelle)\s*([A-Z0-9]+|\d+).*|\bSteig\b.*|\bGleis\b.*)/i,
      ""
    )
    .trim();
}

/**
 * Gruppen-Schlüssel für Haltestellen: bevorzugt die DHID-Basis
 * (de:08125:1234:0:1 -> de:08125:1234), sonst parent_station, sonst Namensstamm.
 */
export function getStopGroupKey(stop: GTFSStop): string {
  if (stop.parent_station && stop.parent_station.trim().length > 0) {
    return stop.parent_station.trim();
  }
  if (stop.stop_id) {
    const id = stop.stop_id.trim();
    // DHID: de:LAND:ORT[:STEIG[:...]] -> auf die ersten drei Segmente kürzen
    if (id.toLowerCase().startsWith("de:") || id.toLowerCase().startsWith("at:")) {
      const parts = id.split(":");
      if (parts.length >= 3) return parts.slice(0, 3).join(":");
      return id;
    }
    if (/:\d+:\d+$/.test(id)) return id.replace(/:\d+:\d+$/, "");
    if (/:\d+$/.test(id) && id.includes(":")) return id.replace(/:\d+$/, "");
  }
  return getStopNameStem(stop.stop_name) || stop.stop_name.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Parsing der einzelnen GTFS-Dateien (aus reinem Text)
// ---------------------------------------------------------------------------

export interface GtfsTexts {
  agency?: string;
  routes?: string;
  stops?: string;
  trips?: string;
  stop_times?: string;
  calendar?: string;
  calendar_dates?: string;
  transfers?: string;
  feed_info?: string;
}

export interface ParseOptions {
  datasetId: string;
  fileName: string;
  fileSize: number;
  geofilter?: boolean; // default true
  onProgress?: (step: string, percent: number) => void;
}

/**
 * Parst reine GTFS-Texte zu einem GTFSDataSet (ohne Analyse).
 * Speichersparend: stop_times werden zeilenweise direkt gefiltert eingelesen,
 * ohne ein Zwischen-Array aller Rohzeilen aufzubauen.
 */
export function parseGtfsTexts(texts: GtfsTexts, opts: ParseOptions): GTFSDataSet {
  const geofilter = opts.geofilter !== false;
  const progress = opts.onProgress || (() => {});

  const routes: GTFSRoute[] = [];
  const stops: GTFSStop[] = [];
  const trips: GTFSTrip[] = [];
  const stopTimes: GTFSStopTime[] = [];
  const transfers: GTFSTransfer[] = [];
  const agencies: string[] = [];
  const calendar: GTFSCalendar[] = [];
  const calendarDates: GTFSCalendarDate[] = [];

  const validStopIds = new Set<string>();
  let filteredStopsCount = 0;
  let feedStart: string | null = null;
  let feedEnd: string | null = null;

  // --- agency.txt ---
  progress("Lese agency.txt & routes.txt…", 22);
  if (texts.agency) {
    forEachCSVRow(texts.agency, (f, idx) => {
      const name = cleanField(f[idx("agency_name")]);
      if (name) agencies.push(name);
    });
  }

  // --- feed_info.txt ---
  if (texts.feed_info) {
    forEachCSVRow(texts.feed_info, (f, idx) => {
      const s = cleanField(f[idx("feed_start_date")]);
      const e = cleanField(f[idx("feed_end_date")]);
      if (s) feedStart = s;
      if (e) feedEnd = e;
    });
  }

  // --- routes.txt ---
  if (texts.routes) {
    forEachCSVRow(texts.routes, (f, idx) => {
      const rid = cleanField(f[idx("route_id")]);
      const shortName = cleanField(f[idx("route_short_name")]);
      const longName = cleanField(f[idx("route_long_name")]);
      const colorRaw = cleanField(f[idx("route_color")]);
      routes.push({
        route_id: rid || shortName || `r_${routes.length}`,
        route_short_name: shortName || longName || "Linie",
        route_long_name: longName || shortName || "",
        route_type: parseInt(cleanField(f[idx("route_type")]), 10) || 3,
        route_color: colorRaw ? `#${colorRaw.replace(/^#/, "")}` : undefined,
        route_text_color: cleanField(f[idx("route_text_color")]) || undefined,
        agency_id: cleanField(f[idx("agency_id")]) || undefined,
      });
    });
  }

  // --- stops.txt (mit Geofilter) ---
  progress("Lese stops.txt & wende Geofilter an…", 38);
  if (texts.stops) {
    forEachCSVRow(texts.stops, (f, idx) => {
      const lat = parseFloat(cleanField(f[idx("stop_lat")]));
      const lon = parseFloat(cleanField(f[idx("stop_lon")]));
      if (isNaN(lat) || isNaN(lon)) return;
      // location_type 1 = Station, 2 = Zugang/Ausgang: nur echte Halte (0/leer)
      const locType = cleanField(f[idx("location_type")]);
      if (locType === "1" || locType === "2" || locType === "3" || locType === "4") {
        // Stationen/Zugänge nicht als eigenständige Halte führen
        return;
      }
      if (
        geofilter &&
        (lat < GEO_BBOX.minLat ||
          lat > GEO_BBOX.maxLat ||
          lon < GEO_BBOX.minLon ||
          lon > GEO_BBOX.maxLon)
      ) {
        filteredStopsCount++;
        return;
      }
      const sid = cleanField(f[idx("stop_id")]);
      validStopIds.add(sid);
      stops.push({
        stop_id: sid,
        stop_name: cleanField(f[idx("stop_name")]) || sid,
        stop_lat: lat,
        stop_lon: lon,
        parent_station: cleanField(f[idx("parent_station")]) || undefined,
        stop_code: cleanField(f[idx("stop_code")]) || undefined,
        wheelchair_boarding:
          parseInt(cleanField(f[idx("wheelchair_boarding")]), 10) || 0,
        zone_id: cleanField(f[idx("zone_id")]) || undefined,
        platform_code: cleanField(f[idx("platform_code")]) || undefined,
        lines: [],
      });
    });
  }

  // --- calendar.txt ---
  progress("Lese Kalender & Fahrten…", 55);
  if (texts.calendar) {
    forEachCSVRow(texts.calendar, (f, idx) => {
      const sid = cleanField(f[idx("service_id")]);
      if (!sid) return;
      calendar.push({
        service_id: sid,
        monday: parseInt(cleanField(f[idx("monday")]), 10) || 0,
        tuesday: parseInt(cleanField(f[idx("tuesday")]), 10) || 0,
        wednesday: parseInt(cleanField(f[idx("wednesday")]), 10) || 0,
        thursday: parseInt(cleanField(f[idx("thursday")]), 10) || 0,
        friday: parseInt(cleanField(f[idx("friday")]), 10) || 0,
        saturday: parseInt(cleanField(f[idx("saturday")]), 10) || 0,
        sunday: parseInt(cleanField(f[idx("sunday")]), 10) || 0,
        start_date: cleanField(f[idx("start_date")]),
        end_date: cleanField(f[idx("end_date")]),
      });
    });
  }

  // --- calendar_dates.txt ---
  if (texts.calendar_dates) {
    forEachCSVRow(texts.calendar_dates, (f, idx) => {
      const sid = cleanField(f[idx("service_id")]);
      const date = cleanField(f[idx("date")]);
      if (!sid || !date) return;
      calendarDates.push({
        service_id: sid,
        date,
        exception_type: parseInt(cleanField(f[idx("exception_type")]), 10) || 1,
      });
    });
  }

  // --- trips.txt ---
  const routeIds = new Set(routes.map((r) => r.route_id));
  if (texts.trips) {
    forEachCSVRow(texts.trips, (f, idx) => {
      const tid = cleanField(f[idx("trip_id")]);
      const rid = cleanField(f[idx("route_id")]);
      if (!tid) return;
      trips.push({
        trip_id: tid,
        route_id: rid,
        service_id: cleanField(f[idx("service_id")]),
        trip_headsign: cleanField(f[idx("trip_headsign")]) || undefined,
        direction_id: parseInt(cleanField(f[idx("direction_id")]), 10) || 0,
        shape_id: cleanField(f[idx("shape_id")]) || undefined,
      });
    });
  }

  // --- transfers.txt ---
  if (texts.transfers) {
    forEachCSVRow(texts.transfers, (f, idx) => {
      const from = cleanField(f[idx("from_stop_id")]);
      const to = cleanField(f[idx("to_stop_id")]);
      if (!from || !to) return;
      const mtt = cleanField(f[idx("min_transfer_time")]);
      transfers.push({
        from_stop_id: from,
        to_stop_id: to,
        transfer_type: parseInt(cleanField(f[idx("transfer_type")]), 10) || 0,
        min_transfer_time: mtt ? parseInt(mtt, 10) : undefined,
      });
    });
  }

  // --- stop_times.txt (zeilenweise gefiltert; der Speicher-kritische Teil) ---
  progress("Indiziere Fahrzeiten (stop_times.txt)…", 78);
  const tripRoute = new Map<string, string>();
  trips.forEach((t) => tripRoute.set(t.trip_id, t.route_id));
  const routeShort = new Map<string, string>();
  routes.forEach((r) => routeShort.set(r.route_id, r.route_short_name));
  const stopLines = new Map<string, Set<string>>();

  if (texts.stop_times) {
    let processed = 0;
    forEachCSVRow(texts.stop_times, (f, idx) => {
      const sid = cleanField(f[idx("stop_id")]);
      if (geofilter && validStopIds.size > 0 && !validStopIds.has(sid)) return;

      const arrM = parseTimeToMinutes(cleanField(f[idx("arrival_time")])) ?? undefined;
      const depM = parseTimeToMinutes(cleanField(f[idx("departure_time")])) ?? arrM;
      const tid = cleanField(f[idx("trip_id")]);

      // Rohzeit-Strings werden NICHT gespeichert — spart ~50% der Payload
      // (326k×2 Strings) bei structured-clone und Speicher.
      stopTimes.push({
        trip_id: tid,
        stop_id: sid,
        stop_sequence: parseInt(cleanField(f[idx("stop_sequence")]), 10) || 0,
        arrMins: arrM,
        depMins: depM,
      });

      const rid = tripRoute.get(tid);
      if (rid) {
        const ln = routeShort.get(rid);
        if (ln) {
          let set = stopLines.get(sid);
          if (!set) {
            set = new Set();
            stopLines.set(sid, set);
          }
          set.add(ln);
        }
      }
      processed++;
      if (processed % 80000 === 0) {
        progress(`Indiziere Fahrzeiten (${processed.toLocaleString("de-DE")})…`, 85);
      }
    });
  }

  // Linien je Haltestelle zuordnen
  stops.forEach((s) => {
    const set = stopLines.get(s.stop_id);
    s.lines = set ? Array.from(set).sort(sortLinesCmp) : [];
  });

  if (routes.length === 0) {
    throw new Error("Ungültiger GTFS-Feed: keine Routen (routes.txt).");
  }
  if (stops.length === 0) {
    throw new Error(
      "Ungültiger GTFS-Feed: keine Haltestellen in der Region gefunden."
    );
  }

  const dataset: GTFSDataSet = {
    id: opts.datasetId,
    name: opts.fileName.replace(/\.zip$/i, ""),
    fileName: opts.fileName,
    fileSize: opts.fileSize,
    uploadedAt: nowHHMM(),
    routes,
    stops,
    trips,
    stopTimes,
    shapes: {},
    transfers,
    agencies: agencies.length > 0 ? Array.from(new Set(agencies)) : ["Unbekannt"],
    totalTripsCount: trips.length,
    calendar,
    calendarDates,
    filteredStopsCount,
    feedStart,
    feedEnd,
  };

  return dataset;
}

function nowHHMM(): string {
  try {
    return new Date().toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Linien-Sortierung: numerisch wo möglich, sonst alphabetisch. */
export function sortLinesCmp(a: string, b: string): number {
  return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
}

// ---------------------------------------------------------------------------
// Indizes (einmalig aufbauen, danach O(1)-Zugriffe)
// ---------------------------------------------------------------------------

export interface GtfsIndices {
  stopTimesByStop: Map<string, GTFSStopTime[]>; // sortiert nach Zeit
  stopTimesByTrip: Map<string, GTFSStopTime[]>; // sortiert nach stop_sequence
  tripById: Map<string, GTFSTrip>;
  routeById: Map<string, GTFSRoute>;
  tripFirstStopName: Map<string, string>;
  tripLastStopName: Map<string, string>;
  stopById: Map<string, GTFSStop>;
  // service_id -> (YYYYMMDD -> exception_type) für O(1) calendar_dates-Lookups
  calDateExc: Map<string, Map<string, number>>;
  calById: Map<string, GTFSCalendar>;
}

/** Baut (und cached am Dataset) alle Indizes für schnelle Abfragen. */
export function buildIndices(ds: GTFSDataSet): GtfsIndices {
  if (ds._indices) return ds._indices as GtfsIndices;

  const stopTimesByStop = new Map<string, GTFSStopTime[]>();
  const stopTimesByTrip = new Map<string, GTFSStopTime[]>();

  for (let i = 0; i < ds.stopTimes.length; i++) {
    const st = ds.stopTimes[i];
    if (st.arrMins === undefined) st.arrMins = parseTimeToMinutes(st.arrival_time) ?? undefined;
    if (st.depMins === undefined) st.depMins = parseTimeToMinutes(st.departure_time) ?? st.arrMins;

    let a = stopTimesByStop.get(st.stop_id);
    if (!a) {
      a = [];
      stopTimesByStop.set(st.stop_id, a);
    }
    a.push(st);

    let b = stopTimesByTrip.get(st.trip_id);
    if (!b) {
      b = [];
      stopTimesByTrip.set(st.trip_id, b);
    }
    b.push(st);
  }

  stopTimesByStop.forEach((list) =>
    list.sort((x, y) => (x.arrMins ?? x.depMins ?? 0) - (y.arrMins ?? y.depMins ?? 0))
  );

  const stopById = new Map<string, GTFSStop>();
  ds.stops.forEach((s) => stopById.set(s.stop_id, s));

  const tripFirstStopName = new Map<string, string>();
  const tripLastStopName = new Map<string, string>();
  stopTimesByTrip.forEach((list, tid) => {
    list.sort((x, y) => x.stop_sequence - y.stop_sequence);
    if (list.length > 0) {
      const first = stopById.get(list[0].stop_id);
      if (first) tripFirstStopName.set(tid, first.stop_name);
      const last = stopById.get(list[list.length - 1].stop_id);
      if (last) tripLastStopName.set(tid, last.stop_name);
    }
  });

  const tripById = new Map<string, GTFSTrip>();
  ds.trips.forEach((t) => tripById.set(t.trip_id, t));
  const routeById = new Map<string, GTFSRoute>();
  ds.routes.forEach((r) => routeById.set(r.route_id, r));

  const calDateExc = new Map<string, Map<string, number>>();
  (ds.calendarDates || []).forEach((cd) => {
    let m = calDateExc.get(cd.service_id);
    if (!m) {
      m = new Map();
      calDateExc.set(cd.service_id, m);
    }
    m.set(cd.date, cd.exception_type);
  });

  const calById = new Map<string, GTFSCalendar>();
  (ds.calendar || []).forEach((c) => calById.set(c.service_id, c));

  const indices: GtfsIndices = {
    stopTimesByStop,
    stopTimesByTrip,
    tripById,
    routeById,
    tripFirstStopName,
    tripLastStopName,
    stopById,
    calDateExc,
    calById,
  };

  ds._indices = indices;
  // Rückwärtskompatibilität mit altem Code
  ds.stopTimesByStopId = stopTimesByStop;
  ds.tripFirstStopMap = tripFirstStopName;
  ds.tripLastStopMap = tripLastStopName;
  return indices;
}

/** Kompatibilitäts-Wrapper: früher hieß dies ensureStopTimesIndexed(). */
export function ensureStopTimesIndexed(ds: GTFSDataSet): Map<string, GTFSStopTime[]> {
  return buildIndices(ds).stopTimesByStop;
}

// ---------------------------------------------------------------------------
// Fahrplan-Gültigkeit an einem Datum (O(1) über Indizes)
// ---------------------------------------------------------------------------

export function isServiceActiveOnYmd(
  idx: GtfsIndices,
  serviceId: string,
  ymd: string
): boolean {
  // 1. calendar_dates-Ausnahme hat Vorrang
  const exc = idx.calDateExc.get(serviceId);
  if (exc) {
    const t = exc.get(ymd);
    if (t !== undefined) return t === 1;
  }
  // 2. regulärer calendar-Eintrag
  const cal = idx.calById.get(serviceId);
  if (cal) {
    if (cal.start_date && ymd < cal.start_date) return false;
    if (cal.end_date && ymd > cal.end_date) return false;
    switch (ymdWeekday(ymd)) {
      case 1: return cal.monday === 1;
      case 2: return cal.tuesday === 1;
      case 3: return cal.wednesday === 1;
      case 4: return cal.thursday === 1;
      case 5: return cal.friday === 1;
      case 6: return cal.saturday === 1;
      case 0: return cal.sunday === 1;
    }
  }
  return false;
}

/** Kompatibilitäts-Wrapper mit JS-Date (für UI-Code, der Date verwendet). */
export function isServiceActiveOn(ds: GTFSDataSet | null, serviceId: string, date: Date): boolean {
  if (!ds) {
    const day = date.getDay();
    if (serviceId === "service_weekday") return day >= 1 && day <= 5;
    if (serviceId === "service_weekend") return day === 0 || day === 6;
    return true;
  }
  const idx = buildIndices(ds);
  return isServiceActiveOnYmd(idx, serviceId, dateToYmd(date));
}

// ---------------------------------------------------------------------------
// Repräsentative Analyse-Tage (datengetrieben statt hartcodiert!)
// ---------------------------------------------------------------------------

export interface RepresentativeDates {
  weekday: string; // YYYYMMDD
  saturday: string;
  sunday: string;
}

/**
 * Wählt je einen typischen Betriebstag (Werktag / Sa / So) INNERHALB des
 * tatsächlichen Feed-Zeitraums, indem die tripgewichtete Betriebsdichte je
 * Datum berechnet und das jeweils dichteste Datum gewählt wird. Damit ist die
 * Analyse robust gegen out-of-range-Daten und Ferien-/Feiertagslücken.
 */
export function pickRepresentativeDates(ds: GTFSDataSet): RepresentativeDates {
  const idx = buildIndices(ds);

  // Fahrten je service_id
  const tripsPerService = new Map<string, number>();
  ds.trips.forEach((t) => {
    tripsPerService.set(t.service_id, (tripsPerService.get(t.service_id) || 0) + 1);
  });

  // Kandidaten-Daten sammeln: alle in calendar_dates genannten Daten (+ optional
  // reguläre calendar-Spannen). Für DELFI/NVBW-Feeds ist calendar_dates maßgeblich.
  const dateTrips = new Map<string, number>(); // YYYYMMDD -> aktive Fahrten

  const addForDate = (ymd: string) => {
    if (dateTrips.has(ymd)) return; // schon berechnet
    let total = 0;
    tripsPerService.forEach((count, sid) => {
      if (isServiceActiveOnYmd(idx, sid, ymd)) total += count;
    });
    dateTrips.set(ymd, total);
  };

  const candidateDates = new Set<string>();
  (ds.calendarDates || []).forEach((cd) => {
    if (cd.exception_type === 1) candidateDates.add(cd.date);
  });

  // Falls (fast) keine calendar_dates: aus calendar-Spannen Kandidaten erzeugen
  if (candidateDates.size < 3 && ds.calendar && ds.calendar.length > 0) {
    const start = ds.feedStart || minDate(ds.calendar.map((c) => c.start_date));
    const end = ds.feedEnd || maxDate(ds.calendar.map((c) => c.end_date));
    if (start && end) {
      // bis zu 90 Tage ab Start abtasten (reicht, um je Wochentag Kandidaten zu haben)
      const s = ymdToDate(start);
      for (let i = 0; i < 120; i++) {
        const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
        const y = dateToYmd(d);
        if (end && y > end) break;
        candidateDates.add(y);
      }
    }
  }

  candidateDates.forEach(addForDate);

  let best = { weekday: "", saturday: "", sunday: "" };
  let bestScore = { weekday: -1, saturday: -1, sunday: -1 };

  dateTrips.forEach((count, ymd) => {
    const dow = ymdWeekday(ymd);
    if (dow >= 1 && dow <= 5) {
      if (count > bestScore.weekday) {
        bestScore.weekday = count;
        best.weekday = ymd;
      }
    } else if (dow === 6) {
      if (count > bestScore.saturday) {
        bestScore.saturday = count;
        best.saturday = ymd;
      }
    } else if (dow === 0) {
      if (count > bestScore.sunday) {
        bestScore.sunday = count;
        best.sunday = ymd;
      }
    }
  });

  // Fallbacks: falls ein Tagestyp fehlt, den dichtesten vorhandenen Tag nehmen
  const anyBest =
    best.weekday || best.saturday || best.sunday || ds.feedStart || "20260101";
  if (!best.weekday) best.weekday = anyBest;
  if (!best.saturday) best.saturday = best.weekday;
  if (!best.sunday) best.sunday = best.saturday;

  return best;
}

function ymdToDate(ymd: string): Date {
  return new Date(
    parseInt(ymd.slice(0, 4), 10),
    parseInt(ymd.slice(4, 6), 10) - 1,
    parseInt(ymd.slice(6, 8), 10)
  );
}
function minDate(arr: string[]): string | null {
  let m: string | null = null;
  for (const d of arr) if (d && (m === null || d < m)) m = d;
  return m;
}
function maxDate(arr: string[]): string | null {
  let m: string | null = null;
  for (const d of arr) if (d && (m === null || d > m)) m = d;
  return m;
}

// ---------------------------------------------------------------------------
// Vollständige Analyse (linear, einmalig — im Worker vorberechnet)
// ---------------------------------------------------------------------------

const DAY_KEYS: DayType[] = ["weekday", "saturday", "sunday"];

export function computeAnalysis(ds: GTFSDataSet): GTFSAnalysis {
  const idx = buildIndices(ds);
  const rep = pickRepresentativeDates(ds);
  const repYmd: Record<DayType, string> = {
    weekday: rep.weekday,
    saturday: rep.saturday,
    sunday: rep.sunday,
  };

  // Aktive Trip-Sets je Tagestyp (einmal über trips)
  const activeTrips: Record<DayType, Set<string>> = {
    weekday: new Set(),
    saturday: new Set(),
    sunday: new Set(),
  };
  const tripCountByRoute: Record<DayType, Map<string, number>> = {
    weekday: new Map(),
    saturday: new Map(),
    sunday: new Map(),
  };
  for (const t of ds.trips) {
    for (const day of DAY_KEYS) {
      if (isServiceActiveOnYmd(idx, t.service_id, repYmd[day])) {
        activeTrips[day].add(t.trip_id);
        tripCountByRoute[day].set(
          t.route_id,
          (tripCountByRoute[day].get(t.route_id) || 0) + 1
        );
      }
    }
  }

  // Repräsentative Haltestelle je Route (globaler Zähler über stop_times)
  const tripRoute = new Map<string, string>();
  ds.trips.forEach((t) => tripRoute.set(t.trip_id, t.route_id));
  const routeStopCount = new Map<string, Map<string, number>>();
  for (const st of ds.stopTimes) {
    const rid = tripRoute.get(st.trip_id);
    if (!rid) continue;
    let m = routeStopCount.get(rid);
    if (!m) {
      m = new Map();
      routeStopCount.set(rid, m);
    }
    m.set(st.stop_id, (m.get(st.stop_id) || 0) + 1);
  }
  const repStopByRoute = new Map<string, string>();
  routeStopCount.forEach((m, rid) => {
    let bestStop = "";
    let bestC = -1;
    m.forEach((c, sid) => {
      if (c > bestC) {
        bestC = c;
        bestStop = sid;
      }
    });
    repStopByRoute.set(rid, bestStop);
  });

  // Abfahrtszeiten an der Repräsentativhaltestelle je (route, tagestyp)
  const depTimes: Record<DayType, Map<string, number[]>> = {
    weekday: new Map(),
    saturday: new Map(),
    sunday: new Map(),
  };
  for (const st of ds.stopTimes) {
    const rid = tripRoute.get(st.trip_id);
    if (!rid) continue;
    if (repStopByRoute.get(rid) !== st.stop_id) continue;
    const m = st.depMins ?? st.arrMins;
    if (m === undefined || m === null) continue;
    for (const day of DAY_KEYS) {
      if (activeTrips[day].has(st.trip_id)) {
        let arr = depTimes[day].get(rid);
        if (!arr) {
          arr = [];
          depTimes[day].set(rid, arr);
        }
        arr.push(m);
      }
    }
  }

  // Frequenz je Route zusammensetzen
  const routeFrequency: RouteFrequencyRow[] = ds.routes
    .map((r) => {
      const repStopId = repStopByRoute.get(r.route_id);
      const repStopName = repStopId ? idx.stopById.get(repStopId)?.stop_name || null : null;
      const perDay: RouteFrequencyRow["days"] = {
        weekday: freqForDay(depTimes.weekday.get(r.route_id), tripCountByRoute.weekday.get(r.route_id) || 0),
        saturday: freqForDay(depTimes.saturday.get(r.route_id), tripCountByRoute.saturday.get(r.route_id) || 0),
        sunday: freqForDay(depTimes.sunday.get(r.route_id), tripCountByRoute.sunday.get(r.route_id) || 0),
      };
      return {
        routeId: r.route_id,
        shortName: r.route_short_name,
        longName: r.route_long_name,
        routeType: r.route_type,
        representativeStopName: repStopName,
        days: perDay,
      };
    })
    .sort((a, b) => sortLinesCmp(a.shortName, b.shortName));

  // Bedienungslücken je Haltestellen-Gruppe (ein Pass über stop_times)
  interface GapAcc {
    stem: string;
    rep: GTFSStop;
    stopIds: string[];
    lastWeekday: number | null;
    sat: number;
    sun: number;
  }
  const groups = new Map<string, GapAcc>();
  const stopGroup = new Map<string, string>(); // stop_id -> groupKey
  const groupStem = new Map<string, string>();
  for (const s of ds.stops) {
    const key = getStopGroupKey(s);
    stopGroup.set(s.stop_id, key);
    if (!groups.has(key)) {
      groups.set(key, {
        stem: getStopNameStem(s.stop_name) || s.stop_name,
        rep: s,
        stopIds: [s.stop_id],
        lastWeekday: null,
        sat: 0,
        sun: 0,
      });
      groupStem.set(key, getStopNameStem(s.stop_name) || s.stop_name);
    } else {
      groups.get(key)!.stopIds.push(s.stop_id);
    }
  }

  for (const st of ds.stopTimes) {
    const key = stopGroup.get(st.stop_id);
    if (!key) continue;
    const g = groups.get(key)!;
    const m = st.depMins ?? st.arrMins;
    if (activeTrips.weekday.has(st.trip_id) && m !== undefined && m !== null) {
      if (g.lastWeekday === null || m > g.lastWeekday) g.lastWeekday = m;
    }
    if (activeTrips.saturday.has(st.trip_id)) g.sat++;
    if (activeTrips.sunday.has(st.trip_id)) g.sun++;
  }

  const serviceGaps: ServiceGapItem[] = [];
  let nightGapCount = 0;
  let sundayGapCount = 0;
  groups.forEach((g) => {
    // Nur Gruppen mit werktäglichem Verkehr betrachten (sonst irrelevant)
    const hasWeekday = g.lastWeekday !== null;
    const hasNightGap = hasWeekday && g.lastWeekday! < NIGHT_GAP_MINUTES;
    const hasSundayGap = g.sun === 0;
    if (!hasWeekday) return; // Haltestellen ohne Werktagsverkehr überspringen
    if (hasNightGap || hasSundayGap) {
      if (hasNightGap) nightGapCount++;
      if (hasSundayGap) sundayGapCount++;
      serviceGaps.push({
        stopNameStem: g.stem,
        representativeStop: g.rep,
        stopIds: g.stopIds,
        lastDepartureWeekday: g.lastWeekday !== null ? formatMinutesToHHMM(g.lastWeekday) : null,
        tripsSaturday: g.sat,
        tripsSunday: g.sun,
        hasNightGap,
        hasSundayGap,
      });
    }
  });
  serviceGaps.sort((a, b) => a.stopNameStem.localeCompare(b.stopNameStem, "de"));

  // Netz-Kennzahlen
  let bus = 0, tram = 0, rail = 0, other = 0;
  ds.routes.forEach((r) => {
    if (r.route_type === 3) bus++;
    else if (r.route_type === 0 || r.route_type === 1) tram++;
    else if (r.route_type === 2) rail++;
    else other++;
  });

  const weekdayHeadways = routeFrequency
    .map((r) => r.days.weekday.headway)
    .filter((h): h is number => h !== null && h > 0);
  const avgWeekdayHeadway =
    weekdayHeadways.length > 0
      ? Math.round(weekdayHeadways.reduce((a, b) => a + b, 0) / weekdayHeadways.length)
      : null;

  const analysis: GTFSAnalysis = {
    representativeDates: {
      weekday: rep.weekday,
      saturday: rep.saturday,
      sunday: rep.sunday,
    },
    routeFrequency,
    serviceGaps,
    summary: {
      routeCount: ds.routes.length,
      busCount: bus,
      tramCount: tram,
      railCount: rail,
      otherCount: other,
      stopCount: ds.stops.length,
      stopGroupCount: groups.size,
      tripCount: ds.trips.length,
      weekdayTripCount: activeTrips.weekday.size,
      saturdayTripCount: activeTrips.saturday.size,
      sundayTripCount: activeTrips.sunday.size,
      avgWeekdayHeadway,
      gapCount: serviceGaps.length,
      nightGapCount,
      sundayGapCount,
      feedStart: ds.feedStart || null,
      feedEnd: ds.feedEnd || null,
      agencies: ds.agencies,
    },
  };

  return analysis;
}

function freqForDay(times: number[] | undefined, tripCount: number): RouteFrequencyRow["days"]["weekday"] {
  if (!times || times.length === 0) {
    return { trips: tripCount, firstDeparture: null, lastDeparture: null, headway: null };
  }
  const sorted = times.slice().sort((a, b) => a - b);
  const first = formatMinutesToHHMM(sorted[0]);
  const last = formatMinutesToHHMM(sorted[sorted.length - 1]);

  // HVZ-Takt: Intervalle in den Spitzenzeiten (06–09 & 15–18 Uhr)
  const peak = sorted.filter((m) => (m >= 360 && m <= 540) || (m >= 900 && m <= 1080));
  let headway: number | null = null;
  if (peak.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < peak.length; i++) {
      const d = peak[i] - peak[i - 1];
      if (d > 0 && d <= 120) intervals.push(d);
    }
    if (intervals.length > 0) {
      // Median statt Mittelwert: robuster gegen Ausreißer
      intervals.sort((a, b) => a - b);
      headway = intervals[Math.floor(intervals.length / 2)];
    }
  }
  return { trips: tripCount || sorted.length, firstDeparture: first, lastDeparture: last, headway };
}

// ---------------------------------------------------------------------------
// Vergleich zweier Datasets
// ---------------------------------------------------------------------------

export interface StopsDiffResult {
  removedStopStems: { stem: string; stops: GTFSStop[] }[];
  addedStopStems: { stem: string; stops: GTFSStop[] }[];
}

export function analyzeStopsDiff(ds1: GTFSDataSet, ds2: GTFSDataSet): StopsDiffResult {
  const groupByKey = (ds: GTFSDataSet) => {
    const m = new Map<string, { stem: string; stops: GTFSStop[] }>();
    ds.stops.forEach((s) => {
      const key = getStopGroupKey(s);
      const stem = getStopNameStem(s.stop_name) || s.stop_name;
      if (!m.has(key)) m.set(key, { stem, stops: [s] });
      else m.get(key)!.stops.push(s);
    });
    return m;
  };
  const m1 = groupByKey(ds1);
  const m2 = groupByKey(ds2);

  const removed: { stem: string; stops: GTFSStop[] }[] = [];
  const added: { stem: string; stops: GTFSStop[] }[] = [];
  m1.forEach((v, k) => {
    if (!m2.has(k)) removed.push(v);
  });
  m2.forEach((v, k) => {
    if (!m1.has(k)) added.push(v);
  });
  return {
    removedStopStems: removed.sort((a, b) => a.stem.localeCompare(b.stem, "de")),
    addedStopStems: added.sort((a, b) => a.stem.localeCompare(b.stem, "de")),
  };
}

// ---------------------------------------------------------------------------
// Umstiegs-/Anschlussanalyse an einer Haltestelle (on-demand, schnell)
// ---------------------------------------------------------------------------

export function getTransferConnectionsAtStop(
  ds: GTFSDataSet | null,
  stopId: string,
  arrivalTime: string = "14:15",
  selectedDate: Date = new Date(),
  targetFilter?: string
): TransferOption[] {
  if (!ds || !ds.stopTimes || ds.stopTimes.length === 0) return [];
  const idx = buildIndices(ds);

  const target =
    idx.stopById.get(stopId) ||
    ds.stops.find((s) => s.stop_name.toLowerCase() === stopId.toLowerCase());
  if (!target) return [];

  // Gruppe: alle Halte mit gleichem Gruppen-Schlüssel (Steige eines Bahnhofs)
  const targetKey = getStopGroupKey(target);
  const stopGroup = ds.stops.filter((s) => getStopGroupKey(s) === targetKey);
  if (stopGroup.length === 0) return [];

  const dateYmd = dateToYmd(selectedDate);
  const targetArr = parseTimeToMinutes(arrivalTime);
  if (targetArr === null) return [];

  const transfersMap = new Map<string, number>();
  (ds.transfers || []).forEach((tr) => {
    if (tr.min_transfer_time !== undefined) {
      transfersMap.set(`${tr.from_stop_id}->${tr.to_stop_id}`, tr.min_transfer_time);
    }
  });

  const minArr = targetArr - 5;
  const maxArr = targetArr + 5;
  const tf = (targetFilter || "").trim().toLowerCase();

  interface Arr {
    st: GTFSStopTime;
    stop: GTFSStop;
    mins: number;
    trip: GTFSTrip;
    routeShort: string;
    fromName: string;
  }
  const arrivals: Arr[] = [];
  for (const arrStop of stopGroup) {
    const list = idx.stopTimesByStop.get(arrStop.stop_id) || [];
    for (const st of list) {
      const mins = st.arrMins ?? st.depMins;
      if (mins === undefined || mins === null || mins < minArr || mins > maxArr) continue;
      const trip = idx.tripById.get(st.trip_id);
      if (!trip || !isServiceActiveOnYmd(idx, trip.service_id, dateYmd)) continue;
      const route = idx.routeById.get(trip.route_id) || null;
      arrivals.push({
        st,
        stop: arrStop,
        mins,
        trip,
        routeShort: route?.route_short_name || trip.route_id,
        fromName: idx.tripFirstStopName.get(trip.trip_id) || arrStop.stop_name,
      });
    }
  }

  interface Opt extends TransferOption {
    depMins: number;
    sameLine: boolean;
  }
  const diffLine: Opt[] = [];
  const sameLine: Opt[] = [];
  const seen = new Set<string>();

  for (const a of arrivals) {
    const minDep = a.mins + 1;
    const maxDep = a.mins + 30;
    for (const depStop of stopGroup) {
      const list = idx.stopTimesByStop.get(depStop.stop_id) || [];
      for (const st of list) {
        if (st.trip_id === a.trip.trip_id) continue;
        const depM = st.depMins ?? st.arrMins;
        if (depM === undefined || depM === null || depM < minDep || depM > maxDep) continue;
        const trip = idx.tripById.get(st.trip_id);
        if (!trip || !isServiceActiveOnYmd(idx, trip.service_id, dateYmd)) continue;
        const route = idx.routeById.get(trip.route_id);
        const routeShort = route?.route_short_name || trip.route_id;

        const key = `${a.stop.stop_id}->${depStop.stop_id}`;
        const minReq = transfersMap.has(key) ? transfersMap.get(key)! : 120; // 2 min default
        const bufferSec = (depM - a.mins) * 60;
        if (bufferSec < minReq) continue;

        const destName =
          idx.tripLastStopName.get(trip.trip_id) || trip.trip_headsign || depStop.stop_name;

        // Zielfilter (optional): nur Anschlüsse Richtung Ziel
        if (tf) {
          const hay = `${destName} ${trip.trip_headsign || ""}`.toLowerCase();
          if (!hay.includes(tf)) continue;
        }

        const combo = `${a.trip.trip_id}_${trip.trip_id}_${a.stop.stop_id}_${depStop.stop_id}`;
        if (seen.has(combo)) continue;
        seen.add(combo);

        const isSame = routeShort.trim().toLowerCase() === a.routeShort.trim().toLowerCase();
        const opt: Opt = {
          arrivingTrip: {
            routeShortName: a.routeShort,
            headsign: a.trip.trip_headsign || "",
            arrivalTime: formatMinutesToHHMM(a.mins),
            fromStopName: a.fromName,
          },
          departingTrip: {
            routeShortName: routeShort,
            headsign: trip.trip_headsign || route?.route_long_name || "",
            departureTime: formatMinutesToHHMM(depM),
            toStopName: destName,
          },
          waitTimeMinutes: depM - a.mins,
          transferType: a.stop.stop_id === depStop.stop_id ? "direkt" : "fußweg",
          platformNote:
            a.stop.stop_id === depStop.stop_id
              ? `Selbe Haltestelle: ${a.stop.stop_name}`
              : `${a.stop.stop_name} → ${depStop.stop_name}`,
          depMins: depM,
          sameLine: isSame,
        };
        (isSame ? sameLine : diffLine).push(opt);
      }
    }
  }

  diffLine.sort((a, b) => a.depMins - b.depMins || a.waitTimeMinutes - b.waitTimeMinutes);
  sameLine.sort((a, b) => a.depMins - b.depMins || a.waitTimeMinutes - b.waitTimeMinutes);
  const chosen = diffLine.length > 0 ? diffLine : sameLine;
  return chosen.slice(0, 8).map(({ depMins, sameLine, ...rest }) => rest);
}
