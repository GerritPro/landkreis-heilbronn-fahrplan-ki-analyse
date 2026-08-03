/**
 * Node-Testharness: lässt die reine GTFS-Engine gegen einen echten Feed laufen.
 * Aufruf:  npx tsx scripts/test-engine.ts <pfad-zur.zip>
 */
import fs from "node:fs";
import JSZip from "jszip";
import {
  parseGtfsTexts,
  computeAnalysis,
  buildIndices,
  getTransferConnectionsAtStop,
  ymdToIso,
  GtfsTexts,
} from "../src/lib/gtfsEngine";

const zipPath = process.argv[2] || "C:/Users/gelle/Downloads/hnv.zip";

function ms(t: number): string {
  return `${(performance.now() - t).toFixed(0)} ms`;
}

async function main() {
  console.log(`\n=== GTFS Engine Test: ${zipPath} ===\n`);
  const buf = fs.readFileSync(zipPath);
  console.log(`ZIP-Größe: ${(buf.length / 1e6).toFixed(1)} MB`);

  let t = performance.now();
  const zip = await JSZip.loadAsync(buf);
  console.log(`JSZip geladen in ${ms(t)}`);

  const names = ["agency", "routes", "stops", "trips", "stop_times", "calendar", "calendar_dates", "transfers", "feed_info"];
  const texts: GtfsTexts = {};
  t = performance.now();
  for (const name of names) {
    const file = zip.file(new RegExp(`${name}\\.txt$`, "i"))[0];
    if (file) (texts as any)[name] = await file.async("text");
  }
  console.log(`Textextraktion (ohne shapes) in ${ms(t)}`);

  t = performance.now();
  const ds = parseGtfsTexts(texts, {
    datasetId: "test",
    fileName: "hnv.zip",
    fileSize: buf.length,
  });
  console.log(`\nparseGtfsTexts in ${ms(t)}`);
  console.log(`  Linien:        ${ds.routes.length}`);
  console.log(`  Haltestellen:  ${ds.stops.length} (${ds.filteredStopsCount} außerhalb Region gefiltert)`);
  console.log(`  Fahrten:       ${ds.trips.length}`);
  console.log(`  stop_times:    ${ds.stopTimes.length.toLocaleString("de-DE")}`);
  console.log(`  transfers:     ${ds.transfers.length}`);
  console.log(`  calendar:      ${ds.calendar?.length}, calendar_dates: ${ds.calendarDates?.length}`);
  console.log(`  Feed-Fenster:  ${ds.feedStart} … ${ds.feedEnd}`);
  console.log(`  Agenturen:     ${ds.agencies.slice(0, 5).join(", ")}${ds.agencies.length > 5 ? " …" : ""}`);

  t = performance.now();
  buildIndices(ds);
  console.log(`\nbuildIndices in ${ms(t)}`);

  t = performance.now();
  const analysis = computeAnalysis(ds);
  ds.analysis = analysis;
  console.log(`computeAnalysis in ${ms(t)}`);

  const rd = analysis.representativeDates;
  console.log(`\nRepräsentativtage (datengetrieben):`);
  console.log(`  Werktag:  ${ymdToIso(rd.weekday)}`);
  console.log(`  Samstag:  ${ymdToIso(rd.saturday)}`);
  console.log(`  Sonntag:  ${ymdToIso(rd.sunday)}`);

  const s = analysis.summary;
  console.log(`\nNetz-Kennzahlen:`);
  console.log(`  Linien: ${s.routeCount} (Bus ${s.busCount}, Bahn ${s.tramCount}, Zug ${s.railCount}, sonst ${s.otherCount})`);
  console.log(`  Fahrten aktiv:  Werktag ${s.weekdayTripCount}, Sa ${s.saturdayTripCount}, So ${s.sundayTripCount}`);
  console.log(`  Ø HVZ-Takt (Werktag): ${s.avgWeekdayHeadway ?? "-"} min`);
  console.log(`  Bedienungslücken: ${s.gapCount} (Nacht ${s.nightGapCount}, Sonntag ${s.sundayGapCount})`);

  // Sanity: es MÜSSEN Linien mit >0 Fahrten existieren
  const nonZero = analysis.routeFrequency.filter((r) => r.days.weekday.trips > 0);
  console.log(`\nLinien mit >0 Werktagsfahrten: ${nonZero.length} / ${analysis.routeFrequency.length}`);
  console.log(`\nTop 12 Linien nach Werktagsfahrten:`);
  analysis.routeFrequency
    .slice()
    .sort((a, b) => b.days.weekday.trips - a.days.weekday.trips)
    .slice(0, 12)
    .forEach((r) => {
      const w = r.days.weekday;
      console.log(
        `  L${r.shortName.padEnd(6)} ${String(w.trips).padStart(4)} Fahrten  Takt ${String(w.headway ?? "-").padStart(3)}m  ${w.firstDeparture ?? "--"}–${w.lastDeparture ?? "--"}  @ ${r.representativeStopName ?? "?"}`
      );
    });

  // Transfer-Test an der stärksten Haltestelle
  const busiest = [...buildIndices(ds).stopTimesByStop.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (busiest) {
    const stop = buildIndices(ds).stopById.get(busiest[0])!;
    console.log(`\nUmstiegstest an "${stop.stop_name}" (${busiest[1].length} Fahrten) am ${ymdToIso(rd.weekday)} 14:00:`);
    const repDate = new Date(
      parseInt(rd.weekday.slice(0, 4)), parseInt(rd.weekday.slice(4, 6)) - 1, parseInt(rd.weekday.slice(6, 8))
    );
    t = performance.now();
    const transfers = getTransferConnectionsAtStop(ds, stop.stop_id, "14:00", repDate);
    console.log(`  ${transfers.length} Anschlüsse in ${ms(t)}`);
    transfers.slice(0, 5).forEach((tr) => {
      console.log(
        `    ${tr.arrivingTrip.arrivalTime} L${tr.arrivingTrip.routeShortName} → ${tr.waitTimeMinutes}min → ${tr.departingTrip.departureTime} L${tr.departingTrip.routeShortName} → ${tr.departingTrip.toStopName}`
      );
    });
  }

  // Speicher
  const mem = process.memoryUsage();
  console.log(`\nSpeicher: heapUsed ${(mem.heapUsed / 1e6).toFixed(0)} MB, rss ${(mem.rss / 1e6).toFixed(0)} MB`);
  console.log(`\n=== OK ===\n`);
}

main().catch((e) => {
  console.error("FEHLER:", e);
  process.exit(1);
});
