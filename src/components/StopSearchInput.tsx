import React, { useState, useEffect, useRef } from "react";
import { MapPin, Search, Check } from "lucide-react";
import { GTFSStop } from "../types";

interface StopSearchInputProps {
  stops: GTFSStop[];
  selectedStopId: string;
  onSelectStop: (stop: GTFSStop) => void;
  placeholder?: string;
  label?: string;
}

// Helper to extract the core stem of a stop name, grouping platforms/steige
export function getStopNameStem(name: string): string {
  if (!name) return "";
  return name
    .replace(/\s*(\/|\()?(\s*(Steig|Bussteig|Gleis|Haltestelle)\s*([A-Z0-9]+|\d+).*|\bSteig\b.*|\bGleis\b.*)/i, "")
    .trim();
}

export const StopSearchInput: React.FC<StopSearchInputProps> = ({
  stops,
  selectedStopId,
  onSelectStop,
  placeholder = "Haltestelle suchen...",
  label,
}) => {
  const currentStop = stops.find((s) => s.stop_id === selectedStopId);
  const [query, setQuery] = useState(currentStop ? currentStop.stop_name : "");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync query string when selectedStopId changes externally
  useEffect(() => {
    const matched = stops.find((s) => s.stop_id === selectedStopId);
    if (matched) {
      setQuery(matched.stop_name);
    }
  }, [selectedStopId, stops]);

  // Handle click outside to close dropdown menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        if (currentStop) {
          setQuery(currentStop.stop_name);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [currentStop]);

  // Compute matching deduplicated stops (max 10)
  const getSuggestions = (): GTFSStop[] => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length < 2) return [];

    const matches: GTFSStop[] = [];
    const seenStems = new Set<string>();

    for (const stop of stops) {
      const nameLower = stop.stop_name.toLowerCase();
      if (nameLower.includes(trimmed)) {
        const stem = getStopNameStem(stop.stop_name).toLowerCase() || nameLower;
        if (!seenStems.has(stem)) {
          seenStems.add(stem);
          matches.push(stop);
          if (matches.length >= 10) break;
        }
      }
    }

    return matches;
  };

  const suggestions = getSuggestions();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setIsOpen(true);
    setHighlightedIndex(0);
  };

  const handleSelect = (stop: GTFSStop) => {
    onSelectStop(stop);
    setQuery(stop.stop_name);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === "ArrowDown" && query.trim().length >= 2) {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions[highlightedIndex]) {
        handleSelect(suggestions[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      if (currentStop) setQuery(currentStop.stop_name);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {label && (
        <label className="block text-label mb-1.5">
          {label}
        </label>
      )}

      <div className="relative">
        <MapPin className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => {
            if (query.trim().length >= 2) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 bg-white border border-[var(--border-strong)] rounded-xl text-body text-gray-900"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <Search className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && query.trim().length >= 2 && (
        <div className="card absolute z-50 left-0 right-0 mt-2 max-h-60 overflow-y-auto p-1.5 text-body shadow-[var(--shadow-lg)]">
          {suggestions.length === 0 ? (
            <div className="px-3 py-2 text-gray-400">
              Keine passende Haltestelle gefunden
            </div>
          ) : (
            suggestions.map((stop, idx) => {
              const isHighlighted = idx === highlightedIndex;
              const isSelected = stop.stop_id === selectedStopId;
              const stem = getStopNameStem(stop.stop_name);

              return (
                <div
                  key={stop.stop_id}
                  onClick={() => handleSelect(stop)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`px-2.5 py-2 rounded-lg cursor-pointer flex items-center justify-between transition-colors ${
                    isHighlighted ? "bg-[color-mix(in_srgb,var(--bus)_12%,#fff)] text-emerald-900 font-medium" : "text-gray-800"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate pr-2">
                    <MapPin className={`w-3.5 h-3.5 shrink-0 ${isHighlighted ? "text-emerald-600" : "text-gray-400"}`} />
                    <span className="truncate">{stem || stop.stop_name}</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
