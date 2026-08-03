export interface GTFSStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  parent_station?: string;
  stop_code?: string;
  wheelchair_boarding?: number;
  zone_id?: string;
  platform_code?: string;
  lines?: string[];
}

export interface GTFSRoute {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: number; // 3 = Bus, 0 = Tram/Stadtbahn, 2 = Rail
  route_color?: string;
  route_text_color?: string;
  agency_id?: string;
}

export interface GTFSTrip {
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign?: string;
  direction_id?: number;
  shape_id?: string;
}

export interface GTFSStopTime {
  trip_id: string;
  stop_id: string;
  stop_sequence: number;
  arrMins?: number;
  depMins?: number;
  // Rohzeit-Strings werden bewusst NICHT gespeichert (arrMins/depMins genügen);
  // optional gehalten für Demo-/Fremddaten.
  arrival_time?: string;
  departure_time?: string;
  pickup_type?: number;
  drop_off_type?: number;
}

export interface GTFSShapePoint {
  shape_id: string;
  shape_pt_lat: number;
  shape_pt_lon: number;
  shape_pt_sequence: number;
}

export interface GTFSTransfer {
  from_stop_id: string;
  to_stop_id: string;
  transfer_type: number;
  min_transfer_time?: number;
}

export interface GTFSCalendar {
  service_id: string;
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
  start_date: string; // YYYYMMDD
  end_date: string;   // YYYYMMDD
}

export interface GTFSCalendarDate {
  service_id: string;
  date: string; // YYYYMMDD
  exception_type: number; // 1 = added, 2 = removed
}

export interface GTFSDataSet {
  id: string;
  name: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  routes: GTFSRoute[];
  stops: GTFSStop[];
  trips: GTFSTrip[];
  stopTimes: GTFSStopTime[];
  shapes: Record<string, GTFSShapePoint[]>;
  transfers: GTFSTransfer[];
  agencies: string[];
  totalTripsCount: number;
  calendar?: GTFSCalendar[];
  calendarDates?: GTFSCalendarDate[];
  filteredStopsCount?: number;
  feedStart?: string | null;
  feedEnd?: string | null;
  /** Vorberechnete Analyse (im Worker erzeugt). */
  analysis?: GTFSAnalysis;
  // Indizes (nicht serialisierbar, werden bei Bedarf lokal aufgebaut)
  stopTimesByStopId?: Map<string, GTFSStopTime[]>;
  tripFirstStopMap?: Map<string, string>;
  tripLastStopMap?: Map<string, string>;
  _indices?: unknown;
}

export type DayType = "weekday" | "saturday" | "sunday";

export interface DayFrequency {
  trips: number;
  firstDeparture: string | null;
  lastDeparture: string | null;
  headway: number | null; // HVZ-Takt in Minuten
}

export interface RouteFrequencyRow {
  routeId: string;
  shortName: string;
  longName: string;
  routeType: number;
  representativeStopName: string | null;
  days: Record<DayType, DayFrequency>;
}

export interface ServiceGapItem {
  stopNameStem: string;
  representativeStop: GTFSStop;
  stopIds: string[];
  lastDepartureWeekday: string | null;
  tripsSaturday: number;
  tripsSunday: number;
  hasNightGap: boolean;
  hasSundayGap: boolean;
}

export interface GTFSAnalysisSummary {
  routeCount: number;
  busCount: number;
  tramCount: number;
  railCount: number;
  otherCount: number;
  stopCount: number;
  stopGroupCount: number;
  tripCount: number;
  weekdayTripCount: number;
  saturdayTripCount: number;
  sundayTripCount: number;
  avgWeekdayHeadway: number | null;
  gapCount: number;
  nightGapCount: number;
  sundayGapCount: number;
  feedStart: string | null;
  feedEnd: string | null;
  agencies: string[];
}

export interface GTFSAnalysis {
  representativeDates: Record<DayType, string>; // YYYYMMDD
  routeFrequency: RouteFrequencyRow[];
  serviceGaps: ServiceGapItem[];
  summary: GTFSAnalysisSummary;
}

export interface GTFSComparisonResult {
  addedRoutes: GTFSRoute[];
  removedRoutes: GTFSRoute[];
  modifiedRoutes: {
    route: GTFSRoute;
    tripDelta: number;
    description: string;
  }[];
  addedStops: GTFSStop[];
  removedStops: GTFSStop[];
  summaryText: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "ai" | "system";
  text: string;
  engine?: string;
  timestamp: string;
  isThinking?: boolean;
}

export interface AIStatus {
  ollama: {
    url: string;
    model: string;
    available: boolean;
    message: string;
  };
  gemini: {
    available: boolean;
  };
  activeFallback: boolean;
}

export interface TransferConnectionQuery {
  fromStopId: string;
  toStopId?: string;
  time: string;
  lineFilter?: string;
}

export interface TransferOption {
  arrivingTrip: {
    routeShortName: string;
    headsign: string;
    arrivalTime: string;
    fromStopName: string;
  };
  departingTrip: {
    routeShortName: string;
    headsign: string;
    departureTime: string;
    toStopName: string;
  };
  waitTimeMinutes: number;
  transferType: "direkt" | "fußweg";
  platformNote?: string;
}
