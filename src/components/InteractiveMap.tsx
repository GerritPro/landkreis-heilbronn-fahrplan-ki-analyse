import React, { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import { GTFSDataSet, GTFSStop, GTFSRoute, GTFSTrip, GTFSStopTime } from "../types";
import { getStopNameStem, getStopGroupKey } from "../lib/gtfsParser";
import {
  Filter,
  MapPin,
  Navigation,
  X,
  Search,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ArrowRight,
  Layers,
  Info,
} from "lucide-react";

interface InteractiveMapProps {
  ds1: GTFSDataSet | null;
  ds2: GTFSDataSet | null;
  setDs1?: React.Dispatch<React.SetStateAction<GTFSDataSet | null>>;
  setDs2?: React.Dispatch<React.SetStateAction<GTFSDataSet | null>>;
  onSelectStopForAI?: (stop: GTFSStop) => void;
  onSelectStopForTransfer?: (stop: GTFSStop) => void;
  selectedStopId?: string | null;
  gapStopStems?: Set<string>;
  removedStopStems?: Set<string>;
  addedStopStems?: Set<string>;
  hoveredStopStem?: string | null;
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({
  ds1,
  ds2,
  setDs1,
  setDs2,
  onSelectStopForAI,
  onSelectStopForTransfer,
  selectedStopId,
  gapStopStems,
  removedStopStems,
  addedStopStems,
  hoveredStopStem,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const polylinesGroupRef = useRef<L.LayerGroup | null>(null);

  // State
  const [selectedRouteId, setSelectedRouteId] = useState<string>("ALL");
  const [directionFilter, setDirectionFilter] = useState<"BOTH" | "0" | "1">("BOTH");
  const [tileLayerType, setTileLayerType] = useState<"light" | "osm" | "satellite">("light");
  const [selectedStop, setSelectedStop] = useState<GTFSStop | null>(null);
  const [isAsymmetricListOpen, setIsAsymmetricListOpen] = useState(false);

  // Floating Stop Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Combine stops from both ds1 and ds2 (merge by stop_id)
  const stopsToRender = useMemo(() => {
    const stopsMap = new Map<string, GTFSStop>();
    [...(ds1?.stops || []), ...(ds2?.stops || [])].forEach((s) => {
      if (!stopsMap.has(s.stop_id)) {
        stopsMap.set(s.stop_id, { ...s, lines: s.lines ? [...s.lines] : [] });
      } else {
        const existing = stopsMap.get(s.stop_id)!;
        const mergedLines = Array.from(
          new Set([...(existing.lines || []), ...(s.lines || [])])
        ).sort();
        stopsMap.set(s.stop_id, { ...existing, lines: mergedLines });
      }
    });
    return Array.from(stopsMap.values());
  }, [ds1, ds2]);

  // Combine routes from both ds1 and ds2 (by route_id)
  const routesToRender = useMemo(() => {
    const routesMap = new Map<string, GTFSRoute>();
    [...(ds1?.routes || []), ...(ds2?.routes || [])].forEach((r) => {
      if (r.route_id && !routesMap.has(r.route_id)) {
        routesMap.set(r.route_id, r);
      }
    });
    return Array.from(routesMap.values()).sort((a, b) => {
      const nameA = a.route_short_name || a.route_id;
      const nameB = b.route_short_name || b.route_id;
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [ds1, ds2]);

  // Trips for selected route
  const tripsForSelectedRoute = useMemo(() => {
    if (selectedRouteId === "ALL") return [];
    const allTrips = [...(ds1?.trips || []), ...(ds2?.trips || [])];
    return allTrips.filter((t) => t.route_id === selectedRouteId);
  }, [selectedRouteId, ds1, ds2]);

  // Direction trips
  const dir0Trips = useMemo(
    () => tripsForSelectedRoute.filter((t) => (t.direction_id ?? 0) === 0),
    [tripsForSelectedRoute]
  );
  const dir1Trips = useMemo(
    () => tripsForSelectedRoute.filter((t) => t.direction_id === 1),
    [tripsForSelectedRoute]
  );

  // Headsigns per direction
  const headsignDir0 = useMemo(() => {
    const counts = new Map<string, number>();
    dir0Trips.forEach((t) => {
      if (t.trip_headsign) {
        counts.set(t.trip_headsign, (counts.get(t.trip_headsign) || 0) + 1);
      }
    });
    let best = "";
    let max = 0;
    counts.forEach((c, sign) => {
      if (c > max) {
        max = c;
        best = sign;
      }
    });
    return best;
  }, [dir0Trips]);

  const headsignDir1 = useMemo(() => {
    const counts = new Map<string, number>();
    dir1Trips.forEach((t) => {
      if (t.trip_headsign) {
        counts.set(t.trip_headsign, (counts.get(t.trip_headsign) || 0) + 1);
      }
    });
    let best = "";
    let max = 0;
    counts.forEach((c, sign) => {
      if (c > max) {
        max = c;
        best = sign;
      }
    });
    return best;
  }, [dir1Trips]);

  const hasDir0 = dir0Trips.length > 0;
  const hasDir1 = dir1Trips.length > 0;
  const hasMultipleDirections = hasDir0 && hasDir1;

  // Stops serving selectedRouteId via trips -> stop_times
  const { routeStopIdsSet, stopsDir0, stopsDir1 } = useMemo(() => {
    if (selectedRouteId === "ALL") {
      return { routeStopIdsSet: null, stopsDir0: new Set<string>(), stopsDir1: new Set<string>() };
    }

    const dir0TripIds = new Set(dir0Trips.map((t) => t.trip_id));
    const dir1TripIds = new Set(dir1Trips.map((t) => t.trip_id));
    const allTripIds = new Set(tripsForSelectedRoute.map((t) => t.trip_id));

    const routeStopIds = new Set<string>();
    const d0 = new Set<string>();
    const d1 = new Set<string>();

    const processStopTimes = (stopTimes?: GTFSStopTime[]) => {
      if (!stopTimes) return;
      for (let i = 0; i < stopTimes.length; i++) {
        const st = stopTimes[i];
        if (allTripIds.has(st.trip_id)) {
          routeStopIds.add(st.stop_id);
          if (dir0TripIds.has(st.trip_id)) d0.add(st.stop_id);
          if (dir1TripIds.has(st.trip_id)) d1.add(st.stop_id);
        }
      }
    };

    processStopTimes(ds1?.stopTimes);
    processStopTimes(ds2?.stopTimes);

    return { routeStopIdsSet: routeStopIds, stopsDir0: d0, stopsDir1: d1 };
  }, [selectedRouteId, tripsForSelectedRoute, dir0Trips, dir1Trips, ds1, ds2]);

  // Filter stops to render based on route and direction
  const filteredStops = useMemo(() => {
    if (selectedRouteId === "ALL" || !routeStopIdsSet) return stopsToRender;

    return stopsToRender.filter((stop) => {
      if (!routeStopIdsSet.has(stop.stop_id)) return false;
      if (!hasMultipleDirections) return true;
      if (directionFilter === "0") return stopsDir0.has(stop.stop_id);
      if (directionFilter === "1") return stopsDir1.has(stop.stop_id);
      return true; // BOTH
    });
  }, [selectedRouteId, routeStopIdsSet, stopsToRender, directionFilter, stopsDir0, stopsDir1, hasMultipleDirections]);

  // Calculate Asymmetric stop groups (served only in one direction on group level)
  const asymmetricStopsInfo = useMemo(() => {
    if (selectedRouteId === "ALL" || !hasMultipleDirections) return [];

    const groupsMap = new Map<
      string,
      {
        groupKey: string;
        representativeStop: GTFSStop;
        allStopsInGroup: GTFSStop[];
        servedIn0: boolean;
        servedIn1: boolean;
      }
    >();
    const keyAliasMap = new Map<string, string>(); // maps gKey or stemKey to canonical groupKey

    stopsToRender.forEach((stop) => {
      if (routeStopIdsSet?.has(stop.stop_id)) {
        const gKey = getStopGroupKey(stop);
        const stemKey = getStopNameStem(stop.stop_name).trim().toLowerCase();
        const in0 = stopsDir0.has(stop.stop_id);
        const in1 = stopsDir1.has(stop.stop_id);

        let targetKey = keyAliasMap.get(gKey) || (stemKey ? keyAliasMap.get(stemKey) : undefined);

        if (!targetKey) {
          targetKey = gKey;
          groupsMap.set(targetKey, {
            groupKey: targetKey,
            representativeStop: stop,
            allStopsInGroup: [stop],
            servedIn0: in0,
            servedIn1: in1,
          });
          keyAliasMap.set(gKey, targetKey);
          if (stemKey) keyAliasMap.set(stemKey, targetKey);
        } else {
          const group = groupsMap.get(targetKey)!;
          group.allStopsInGroup.push(stop);
          if (in0) group.servedIn0 = true;
          if (in1) group.servedIn1 = true;
          keyAliasMap.set(gKey, targetKey);
          if (stemKey) keyAliasMap.set(stemKey, targetKey);
        }
      }
    });

    const result: {
      groupKey: string;
      stop: GTFSStop;
      onlyDirection: "0" | "1";
      headsign: string;
    }[] = [];

    groupsMap.forEach((group) => {
      if (group.servedIn0 && !group.servedIn1) {
        result.push({
          groupKey: group.groupKey,
          stop: group.representativeStop,
          onlyDirection: "0",
          headsign: headsignDir0 ? `→ ${headsignDir0}` : "Hinfahrt",
        });
      } else if (!group.servedIn0 && group.servedIn1) {
        result.push({
          groupKey: group.groupKey,
          stop: group.representativeStop,
          onlyDirection: "1",
          headsign: headsignDir1 ? `→ ${headsignDir1}` : "Rückfahrt",
        });
      }
    });

    return result;
  }, [
    selectedRouteId,
    hasMultipleDirections,
    stopsToRender,
    routeStopIdsSet,
    stopsDir0,
    stopsDir1,
    headsignDir0,
    headsignDir1,
  ]);

  const asymmetricGroupKeysMap = useMemo(() => {
    const map = new Map<string, { onlyDirection: "0" | "1"; headsign: string }>();
    asymmetricStopsInfo.forEach((item) => {
      map.set(item.groupKey, { onlyDirection: item.onlyDirection, headsign: item.headsign });
      const stemKey = getStopNameStem(item.stop.stop_name).trim().toLowerCase();
      if (stemKey) {
        map.set(stemKey, { onlyDirection: item.onlyDirection, headsign: item.headsign });
      }
      if (item.stop.stop_id) {
        map.set(item.stop.stop_id, { onlyDirection: item.onlyDirection, headsign: item.headsign });
      }
    });
    return map;
  }, [asymmetricStopsInfo]);

  // Filtered stops for floating search
  const searchResults = searchQuery.trim().length >= 2
    ? stopsToRender
        .filter((s) =>
          s.stop_name.toLowerCase().includes(searchQuery.toLowerCase().trim())
        )
        .slice(0, 8)
    : [];

  // Center map on selected stop ID from props
  useEffect(() => {
    if (!selectedStopId) return;
    const targetStop = stopsToRender.find((s) => s.stop_id === selectedStopId);
    if (targetStop && mapInstanceRef.current) {
      setSelectedStop(targetStop);
      mapInstanceRef.current.setView([targetStop.stop_lat, targetStop.stop_lon], 15);
    }
  }, [selectedStopId, stopsToRender]);

  // Center map on hovered stop stem
  useEffect(() => {
    if (!hoveredStopStem) return;
    const targetStop = stopsToRender.find((s) => {
      const stem = getStopNameStem(s.stop_name) || s.stop_name;
      return stem.toLowerCase() === hoveredStopStem.toLowerCase();
    });
    if (targetStop && mapInstanceRef.current) {
      setSelectedStop(targetStop);
      mapInstanceRef.current.setView([targetStop.stop_lat, targetStop.stop_lon], 15);
    }
  }, [hoveredStopStem, stopsToRender]);

  // Fit map bounds when selecting a specific route
  useEffect(() => {
    if (selectedRouteId !== "ALL" && filteredStops.length > 0 && mapInstanceRef.current) {
      const bounds = L.latLngBounds(filteredStops.map((s) => [s.stop_lat, s.stop_lon]));
      mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [selectedRouteId, filteredStops]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [49.1427, 9.2109], // Heilbronn Hauptbahnhof
      zoom: 12,
      zoomControl: false,
      preferCanvas: true, // Canvas-Renderer: tausende Marker bleiben flüssig
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    mapInstanceRef.current = map;
    markersGroupRef.current = L.layerGroup().addTo(map);
    polylinesGroupRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markersGroupRef.current = null;
      polylinesGroupRef.current = null;
    };
  }, []);

  // Update Tile Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    let tileUrl = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
    let attribution = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap';

    if (tileLayerType === "osm") {
      tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
      attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    } else if (tileLayerType === "satellite") {
      tileUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      attribution = 'Tiles &copy; Esri';
    }

    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        map.removeLayer(layer);
      }
    });

    L.tileLayer(tileUrl, { attribution, maxZoom: 19 }).addTo(map);
  }, [tileLayerType]);

  // Helper function to extract ordered stop sequence for representative trip
  const getPolylineForDirection = (trips: GTFSTrip[], isOffset: boolean) => {
    if (trips.length === 0) return null;
    const tripIds = new Set(trips.map((t) => t.trip_id));

    let maxStops = 0;
    let bestStopTimes: GTFSStopTime[] = [];

    const checkDataset = (ds: GTFSDataSet | null) => {
      if (!ds || !ds.stopTimes) return;
      const grouped = new Map<string, GTFSStopTime[]>();
      ds.stopTimes.forEach((st) => {
        if (tripIds.has(st.trip_id)) {
          let arr = grouped.get(st.trip_id);
          if (!arr) {
            arr = [];
            grouped.set(st.trip_id, arr);
          }
          arr.push(st);
        }
      });
      grouped.forEach((stArr) => {
        if (stArr.length > maxStops) {
          maxStops = stArr.length;
          bestStopTimes = stArr;
        }
      });
    };

    checkDataset(ds1);
    checkDataset(ds2);

    if (bestStopTimes.length < 2) return null;

    const sortedSt = [...bestStopTimes].sort((a, b) => a.stop_sequence - b.stop_sequence);
    const stopLookup = new Map<string, GTFSStop>();
    stopsToRender.forEach((s) => stopLookup.set(s.stop_id, s));

    const latLons: [number, number][] = [];
    sortedSt.forEach((st) => {
      const s = stopLookup.get(st.stop_id);
      if (s) {
        const offsetVal = isOffset ? 0.00018 : 0;
        latLons.push([s.stop_lat + offsetVal, s.stop_lon + offsetVal]);
      }
    });

    return latLons;
  };

  // Render Markers & Polylines
  useEffect(() => {
    if (!mapInstanceRef.current || !markersGroupRef.current || !polylinesGroupRef.current) return;

    const markersGroup = markersGroupRef.current;
    const polylinesGroup = polylinesGroupRef.current;

    markersGroup.clearLayers();
    polylinesGroup.clearLayers();

    if (filteredStops.length === 0) return;

    // 1. Draw Polylines for selected route
    if (selectedRouteId !== "ALL") {
      const selectedRouteObj = routesToRender.find((r) => r.route_id === selectedRouteId);
      const routeColor = selectedRouteObj?.route_color
        ? `#${selectedRouteObj.route_color}`
        : selectedRouteObj?.route_short_name?.startsWith("S") || selectedRouteObj?.route_short_name?.startsWith("R")
        ? "#0066CC"
        : "#E30613";

      // Dir 0 (Hinfahrt)
      if ((directionFilter === "BOTH" || directionFilter === "0") && hasDir0) {
        const latLons0 = getPolylineForDirection(dir0Trips, false);
        if (latLons0 && latLons0.length > 1) {
          const poly0 = L.polyline(latLons0, {
            color: routeColor,
            weight: 4,
            opacity: 0.9,
          });
          polylinesGroup.addLayer(poly0);

          // Arrow markers for Direction 0
          for (let i = 0; i < latLons0.length - 1; i += 2) {
            const p1 = latLons0[i];
            const p2 = latLons0[i + 1];
            const midLat = (p1[0] + p2[0]) / 2;
            const midLon = (p1[1] + p2[1]) / 2;
            const angle = (Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180) / Math.PI;

            const arrowMarker = L.marker([midLat, midLon], {
              icon: L.divIcon({
                className: "dir-arrow",
                html: `<div style="
                  transform: rotate(${angle}deg);
                  color: ${routeColor};
                  font-size: 13px;
                  font-weight: 900;
                  text-shadow: 0 0 4px white, 0 0 4px white;
                  line-height: 1;
                ">▶</div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7],
              }),
              interactive: false,
            });
            polylinesGroup.addLayer(arrowMarker);
          }
        }
      }

      // Dir 1 (Rückfahrt)
      if ((directionFilter === "BOTH" || directionFilter === "1") && hasDir1) {
        const isOffset = directionFilter === "BOTH";
        const latLons1 = getPolylineForDirection(dir1Trips, isOffset);
        if (latLons1 && latLons1.length > 1) {
          const poly1 = L.polyline(latLons1, {
            color: directionFilter === "BOTH" ? "#2563EB" : routeColor,
            weight: 4,
            opacity: 0.9,
            dashArray: directionFilter === "BOTH" ? "8, 6" : undefined,
          });
          polylinesGroup.addLayer(poly1);

          // Arrow markers for Direction 1
          for (let i = 0; i < latLons1.length - 1; i += 2) {
            const p1 = latLons1[i];
            const p2 = latLons1[i + 1];
            const midLat = (p1[0] + p2[0]) / 2;
            const midLon = (p1[1] + p2[1]) / 2;
            const angle = (Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180) / Math.PI;

            const arrowMarker = L.marker([midLat, midLon], {
              icon: L.divIcon({
                className: "dir-arrow",
                html: `<div style="
                  transform: rotate(${angle}deg);
                  color: ${directionFilter === "BOTH" ? "#2563EB" : routeColor};
                  font-size: 13px;
                  font-weight: 900;
                  text-shadow: 0 0 4px white, 0 0 4px white;
                  line-height: 1;
                ">▶</div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7],
              }),
              interactive: false,
            });
            polylinesGroup.addLayer(arrowMarker);
          }
        }
      }
    }

    // 2. Draw Stop Markers als Canvas-CircleMarker (performant für tausende Halte)
    const stopStyle = (
      isTrain: boolean,
      isSelected: boolean,
      isGap: boolean,
      isRemoved: boolean,
      isAdded: boolean,
      isAsymmetric: boolean
    ): L.CircleMarkerOptions & { radius: number } => {
      let fill = isTrain ? "#0066CC" : "#16A34A";
      let stroke = "#ffffff";
      let radius = 5;
      let weight = 1.5;

      if (isSelected) {
        fill = "#E30613";
        radius = 8;
        weight = 2.5;
      } else if (isGap) {
        fill = "#EA580C";
        radius = 7;
      } else if (isRemoved) {
        fill = "#DC2626";
        radius = 7;
      } else if (isAdded) {
        fill = "#16A34A";
        radius = 7;
        stroke = "#065F46";
      } else if (isAsymmetric) {
        fill = "#D97706";
        stroke = "#FEF3C7";
        radius = 6.5;
      }
      return { radius, fillColor: fill, color: stroke, weight, fillOpacity: 0.92, opacity: 1 };
    };

    // Wenn viele Halte sichtbar sind: normale Halte kleiner zeichnen
    const dense = filteredStops.length > 900;

    filteredStops.forEach((stop) => {
      const stem = getStopNameStem(stop.stop_name) || stop.stop_name;
      const groupKey = getStopGroupKey(stop);
      const isTrain = stop.lines?.some((l) => /^(S|R|RE|RB|MEX|IC|EC)/i.test(l)) || false;
      const isSelected = selectedStop?.stop_id === stop.stop_id;
      const isGap = Boolean(gapStopStems?.has(stem));
      const isRemoved = Boolean(removedStopStems?.has(stem));
      const isAdded = Boolean(addedStopStems?.has(stem));

      const stemKey = stem.trim().toLowerCase();
      const asymInfo =
        asymmetricGroupKeysMap.get(groupKey) ||
        asymmetricGroupKeysMap.get(stemKey) ||
        asymmetricGroupKeysMap.get(stop.stop_id);
      const isAsymmetric = Boolean(asymInfo);

      const style = stopStyle(isTrain, isSelected, isGap, isRemoved, isAdded, isAsymmetric);
      const special = isSelected || isGap || isRemoved || isAdded || isAsymmetric;
      if (dense && !special) style.radius = 3.5;

      const marker = L.circleMarker([stop.stop_lat, stop.stop_lon], style);

      marker.on("click", () => {
        setSelectedStop(stop);
        if (onSelectStopForTransfer) {
          onSelectStopForTransfer(stop);
        }
      });

      // Popup Content
      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${stop.stop_lat},${stop.stop_lon}`;
      const googleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${stop.stop_lat},${stop.stop_lon}`;

      let statusBadge = "";
      if (isAsymmetric && asymInfo) {
        statusBadge = `<div style="background-color: #FEF3C7; color: #92400E; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 6px; margin-bottom: 6px; border: 1px solid #FDE68A;">
          ⚠️ nur Richtung ${asymInfo.headsign}
        </div>`;
      } else if (isGap) {
        statusBadge = `<div style="background-color: #FFEDD5; color: #C2410C; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 6px; margin-bottom: 6px; border: 1px solid #FED7AA;">
          ⚠️ Bedienungslücke (kein Bus nach 20h / So)
        </div>`;
      } else if (isRemoved) {
        statusBadge = `<div style="background-color: #FEE2E2; color: #B91C1C; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 6px; margin-bottom: 6px; border: 1px solid #FCA5A5;">
          ❌ Entfallene Haltestelle in Fahrplan 2
        </div>`;
      } else if (isAdded) {
        statusBadge = `<div style="background-color: #DCFCE7; color: #15803D; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 6px; margin-bottom: 6px; border: 1px solid #86EFAC;">
          ➕ Neue Haltestelle in Fahrplan 2
        </div>`;
      }

      const popupHtml = `
        <div style="font-family: inherit; padding: 4px; max-width: 250px;">
          <div style="font-size: 11px; font-weight: 600; color: #E30613; margin-bottom: 2px;">
            Haltestelle HNV
          </div>
          <h4 style="font-size: 13px; font-weight: 600; color: #111827; margin: 0 0 6px 0;">
            ${stop.stop_name}
          </h4>
          ${statusBadge}
          <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px;">
            ${(stop.lines && stop.lines.length > 0 ? stop.lines : ["HNV Bus"])
              .map(
                (l) => `<span style="
                  background-color: ${l.startsWith("S") || l.startsWith("R") ? "#FEE2E2" : "#ECFDF5"};
                  color: ${l.startsWith("S") || l.startsWith("R") ? "#991B1B" : "#065F46"};
                  font-size: 10px;
                  font-weight: 700;
                  padding: 2px 6px;
                  border-radius: 4px;
                ">${l}</span>`
              )
              .join("")}
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" style="
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 4px;
              background-color: #111827;
              color: white;
              padding: 6px 10px;
              border-radius: 8px;
              font-size: 11px;
              font-weight: 600;
              text-decoration: none;
            ">
              In Google Maps öffnen ↗
            </a>
            <a href="${googleDirectionsUrl}" target="_blank" rel="noopener noreferrer" style="
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 4px;
              background-color: #F3F4F6;
              color: #374151;
              padding: 5px 10px;
              border-radius: 8px;
              font-size: 11px;
              font-weight: 600;
              text-decoration: none;
            ">
              Google Routenplaner
            </a>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      markersGroup.addLayer(marker);
    });
  }, [
    filteredStops,
    selectedRouteId,
    directionFilter,
    routesToRender,
    hasDir0,
    hasDir1,
    dir0Trips,
    dir1Trips,
    selectedStop,
    gapStopStems,
    removedStopStems,
    addedStopStems,
    asymmetricStopsInfo,
  ]);

  const handleSelectSearchStop = (stop: GTFSStop) => {
    setSelectedStop(stop);
    setSearchQuery(stop.stop_name);
    setIsSearchOpen(false);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([stop.stop_lat, stop.stop_lon], 15);
    }
    if (onSelectStopForTransfer) {
      onSelectStopForTransfer(stop);
    }
  };

  return (
    <div className="relative w-full h-full min-h-[440px] rounded-lg overflow-hidden border border-gray-200 bg-gray-100 flex flex-col">
      {/* Floating Overlay Controls on Top of Map */}
      <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-wrap items-start justify-between gap-2 pointer-events-none">
        {/* Left Control Container */}
        <div className="pointer-events-auto flex flex-col gap-2 max-w-full sm:max-w-xl">
          {/* Main Controls Row */}
          <div className="bg-white p-2 rounded-lg border border-gray-200 shadow-md flex flex-wrap items-center gap-2 text-body">
            {/* Route Selector (by route_id) */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-md border border-gray-200">
              <Filter className="w-3.5 h-3.5 text-gray-500" />
              <span className="font-medium text-gray-600 hidden sm:inline">Route:</span>
              <select
                value={selectedRouteId}
                onChange={(e) => {
                  setSelectedRouteId(e.target.value);
                  setDirectionFilter("BOTH");
                }}
                className="bg-transparent font-medium text-gray-900 focus:outline-none cursor-pointer max-w-[200px] sm:max-w-[260px] truncate"
              >
                <option value="ALL">Alle Routen ({routesToRender.length})</option>
                {routesToRender.map((r) => {
                  const shortName = r.route_short_name || r.route_id;
                  const longName = r.route_long_name
                    ? r.route_long_name.length > 32
                      ? r.route_long_name.substring(0, 32) + "…"
                      : r.route_long_name
                    : "";
                  const label = longName ? `${shortName} — ${longName}` : shortName;
                  return (
                    <option key={r.route_id} value={r.route_id}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Stop Search Input */}
            <div className="relative">
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-md border border-gray-200 min-w-[150px] sm:min-w-[190px]">
                <Search className="w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Haltestelle suchen..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setIsSearchOpen(true);
                  }}
                  onFocus={() => setIsSearchOpen(true)}
                  className="bg-transparent font-normal text-gray-900 focus:outline-none w-full text-body"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setIsSearchOpen(false);
                    }}
                    className="text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Autocomplete Dropdown */}
              {isSearchOpen && searchResults.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-full bg-white rounded-md shadow-md border border-gray-200 py-1 z-50 max-h-56 overflow-y-auto">
                  {searchResults.map((st) => (
                    <button
                      key={st.stop_id}
                      onClick={() => handleSelectSearchStop(st)}
                      className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-body font-medium text-gray-800 flex items-center justify-between gap-2 border-b border-gray-50 last:border-none cursor-pointer"
                    >
                      <span className="truncate">{st.stop_name}</span>
                      <span className="text-meta font-mono shrink-0">
                        {st.lines?.slice(0, 2).join(", ")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Direction Toggle Row (only if route is selected) */}
          {selectedRouteId !== "ALL" && (
            <div className="bg-white p-2 rounded-lg border border-gray-200 shadow-md flex items-center gap-2">
              {hasMultipleDirections ? (
                <div className="flex items-center gap-1 w-full flex-wrap sm:flex-nowrap">
                  <span className="text-meta text-gray-500 font-medium mr-1 shrink-0">Richtung:</span>
                  <button
                    onClick={() => setDirectionFilter("0")}
                    className={`px-2.5 py-1 rounded-md text-meta font-medium transition-colors cursor-pointer truncate max-w-[170px] ${
                      directionFilter === "0"
                        ? "bg-red-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                    title={headsignDir0 ? `Hinfahrt: → ${headsignDir0}` : "Hinfahrt"}
                  >
                    {headsignDir0 ? `→ ${headsignDir0}` : "Hinfahrt"}
                  </button>

                  <button
                    onClick={() => setDirectionFilter("1")}
                    className={`px-2.5 py-1 rounded-md text-meta font-medium transition-colors cursor-pointer truncate max-w-[170px] ${
                      directionFilter === "1"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                    title={headsignDir1 ? `Rückfahrt: → ${headsignDir1}` : "Rückfahrt"}
                  >
                    {headsignDir1 ? `→ ${headsignDir1}` : "Rückfahrt"}
                  </button>

                  <button
                    onClick={() => setDirectionFilter("BOTH")}
                    className={`px-2 py-1 rounded-md text-meta font-medium transition-colors cursor-pointer shrink-0 ${
                      directionFilter === "BOTH"
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    Beide
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-meta text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200 font-medium">
                  <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Nur eine Richtung im Fahrplan hinterlegt</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Floating Box: Tile Layer Selector */}
        <div className="pointer-events-auto bg-white p-1 rounded-lg border border-gray-200 shadow-md flex items-center gap-1">
          <button
            onClick={() => setTileLayerType("light")}
            className={`px-2.5 py-1 rounded-md text-meta font-medium transition-colors cursor-pointer ${
              tileLayerType === "light"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Hell
          </button>
          <button
            onClick={() => setTileLayerType("osm")}
            className={`px-2.5 py-1 rounded-md text-meta font-medium transition-colors cursor-pointer ${
              tileLayerType === "osm"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            OSM
          </button>
          <button
            onClick={() => setTileLayerType("satellite")}
            className={`px-2.5 py-1 rounded-md text-meta font-medium transition-colors cursor-pointer ${
              tileLayerType === "satellite"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Satellit
          </button>
        </div>
      </div>

      {/* Map Canvas */}
      <div ref={mapContainerRef} className="w-full h-full flex-1 z-10" />

      {/* Bottom Panel: Asymmetric Stops Accordion / Success Banner */}
      {selectedRouteId !== "ALL" && hasMultipleDirections && (
        <div className="z-20 bg-white border-t border-gray-200 px-4 py-2 text-body">
          {asymmetricStopsInfo.length > 0 ? (
            <div>
              <button
                onClick={() => setIsAsymmetricListOpen((prev) => !prev)}
                className="w-full flex items-center justify-between text-left font-medium text-amber-800 hover:text-amber-900 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    <strong>
                      {asymmetricStopsInfo.length} Haltestelle{asymmetricStopsInfo.length > 1 ? "n" : ""}
                    </strong>{" "}
                    {asymmetricStopsInfo.length > 1 ? "werden" : "wird"} nur in einer Richtung bedient
                  </span>
                </div>
                {isAsymmetricListOpen ? (
                  <ChevronUp className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                )}
              </button>

              {isAsymmetricListOpen && (
                <div className="mt-2 pt-2 border-t border-gray-100 max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {asymmetricStopsInfo.map(({ groupKey, stop, headsign }) => {
                    const cleanName = getStopNameStem(stop.stop_name) || stop.stop_name;
                    return (
                      <button
                        key={groupKey}
                        onClick={() => {
                          setSelectedStop(stop);
                          if (mapInstanceRef.current) {
                            mapInstanceRef.current.setView([stop.stop_lat, stop.stop_lon], 15);
                          }
                        }}
                        className="text-left p-2 bg-amber-50 hover:bg-amber-100 rounded-md border border-amber-200 transition-colors cursor-pointer flex flex-col gap-0.5"
                      >
                        <span className="font-semibold text-gray-900 truncate">{cleanName}</span>
                        <span className="text-meta text-amber-800 font-medium">nur {headsign}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-md border border-emerald-200 font-medium text-body">
              <span className="text-emerald-600 font-bold text-base">✓</span>
              <span>Alle Haltestellen dieser Linie werden in beiden Richtungen bedient</span>
            </div>
          )}
        </div>
      )}

      {/* Selected Stop Floating Drawer */}
      {selectedStop && (
        <div className="absolute bottom-4 left-4 z-[1000] bg-white rounded-lg p-4 border border-gray-200 shadow-lg max-w-sm w-full">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-meta text-red-600 block font-semibold">
                Ausgewählte Haltestelle
              </span>
              <h4 className="text-heading text-gray-900">
                {selectedStop.stop_name}
              </h4>
            </div>
            <button
              onClick={() => setSelectedStop(null)}
              className="text-gray-400 hover:text-gray-600 p-1 text-body cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="mt-2.5 space-y-3">
            {/* Lines */}
            <div>
              <div className="text-meta text-gray-500 mb-1">Linien an dieser Haltestelle:</div>
              <div className="flex items-center gap-1.5 flex-wrap max-h-20 overflow-y-auto">
                {(selectedStop.lines || []).map((l) => (
                  <span
                    key={l}
                    className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-800 text-meta font-medium rounded-sm border border-gray-200"
                  >
                    {l}
                  </span>
                ))}
                {(!selectedStop.lines || selectedStop.lines.length === 0) && (
                  <span className="text-meta text-gray-400">Keine Linien hinterlegt</span>
                )}
              </div>
            </div>

            {/* Navigation & Action Buttons */}
            <div className="pt-2 border-t border-gray-100 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${selectedStop.stop_lat},${selectedStop.stop_lon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-md text-body font-medium transition-colors"
                >
                  <Navigation className="w-3.5 h-3.5 text-red-400" />
                  Google Maps
                </a>

                {onSelectStopForTransfer && (
                  <button
                    onClick={() => onSelectStopForTransfer(selectedStop)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-md text-body font-medium transition-colors cursor-pointer"
                  >
                    Umstiege
                  </button>
                )}
              </div>

              {onSelectStopForAI && (
                <button
                  onClick={() => onSelectStopForAI(selectedStop)}
                  className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-md text-body font-medium border border-red-200 transition-colors cursor-pointer"
                >
                  KI nach Verbindungen fragen
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
