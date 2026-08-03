import { createSampleHNVDatesets } from "../src/lib/gtfsParser";
import { ymdToIso, getTransferConnectionsAtStop } from "../src/lib/gtfsEngine";

const { ds1, ds2 } = createSampleHNVDatesets();

// Umstiegs-Check am Hbf (Demo-Standardknoten)
const rep = ds1.analysis!.representativeDates.weekday;
const repDate = new Date(+rep.slice(0, 4), +rep.slice(4, 6) - 1, +rep.slice(6, 8));
const tf = getTransferConnectionsAtStop(ds1, "hnv_hbf", "14:00", repDate);
console.log(`Demo-Umstiege am Hbf (${ymdToIso(rep)} 14:00): ${tf.length}`);
tf.slice(0, 3).forEach((t) => console.log(`  ${t.arrivingTrip.arrivalTime} L${t.arrivingTrip.routeShortName} → ${t.waitTimeMinutes}min → ${t.departingTrip.departureTime} L${t.departingTrip.routeShortName}`));
if (tf.length === 0) throw new Error("Demo: keine Umstiege am Hbf!");
for (const [name, ds] of [["ds1", ds1], ["ds2", ds2]] as const) {
  const a = ds.analysis!;
  const nonZero = a.routeFrequency.filter((r) => r.days.weekday.trips > 0).length;
  console.log(`\n${name}: ${ds.name}`);
  console.log(`  Stichtage: Wt ${ymdToIso(a.representativeDates.weekday)}, Sa ${ymdToIso(a.representativeDates.saturday)}, So ${ymdToIso(a.representativeDates.sunday)}`);
  console.log(`  Linien mit >0 Werktagsfahrten: ${nonZero}/${a.routeFrequency.length}`);
  console.log(`  Fahrten aktiv: Wt ${a.summary.weekdayTripCount}, Sa ${a.summary.saturdayTripCount}, So ${a.summary.sundayTripCount}`);
  console.log(`  Ø Takt: ${a.summary.avgWeekdayHeadway} min, Lücken: ${a.summary.gapCount}`);
  if (nonZero === 0) throw new Error(`${name}: KEINE Fahrten — Demo-Analyse defekt!`);
}
console.log("\n=== Demo OK ===");
