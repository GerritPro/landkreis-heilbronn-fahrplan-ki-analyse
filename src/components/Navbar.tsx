import React from "react";
import { Logo } from "./Logo";
import { AIStatus, GTFSDataSet } from "../types";
import {
  MessageSquare,
  GitCompare,
  ArrowLeftRight,
  Settings,
  Upload,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";

interface NavbarProps {
  ds1: GTFSDataSet | null;
  ds2: GTFSDataSet | null;
  aiStatus: AIStatus | null;
  isDemo?: boolean;
  onOpenSettings: () => void;
  isUploadOpen: boolean;
  onToggleUpload: () => void;
  onDeleteDs1?: () => void;
  onDeleteDs2?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  ds1,
  ds2,
  aiStatus,
  isDemo,
  onOpenSettings,
  isUploadOpen,
  onToggleUpload,
  onDeleteDs1,
  onDeleteDs2,
}) => {
  const isOllamaConnected = aiStatus?.ollama.available;

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200 h-16">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 h-full">
        <div className="flex items-center justify-between h-full gap-2">
          {/* Left: Logo & Title */}
          <div className="flex items-center gap-3 shrink-0">
            <Logo size="md" />
            <div className="hidden xl:block h-6 w-px bg-gray-200" />
            <div className="hidden xl:block">
              <h1 className="text-heading text-gray-900">
                Soll-Fahrplan KI-Analyse
              </h1>
              <p className="text-meta">
                Landkreis Heilbronn • HNV & NVBW
              </p>
            </div>
          </div>

          {/* Center: Anchor Scroll Buttons */}
          <nav className="flex items-center gap-1 bg-gray-100 p-1 rounded-md border border-gray-200 shrink-0">
            <button
              onClick={() => scrollToSection("section-transfers")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-body font-medium text-gray-700 hover:text-gray-900 hover:bg-white transition-colors cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-600" />
              <span>Umstiege</span>
            </button>

            <button
              onClick={() => scrollToSection("section-chat")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-body font-medium text-gray-700 hover:text-gray-900 hover:bg-white transition-colors cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
              <span>KI-Assistent</span>
            </button>

            <button
              onClick={() => scrollToSection("section-diff")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-body font-medium text-gray-700 hover:text-gray-900 hover:bg-white transition-colors cursor-pointer"
            >
              <GitCompare className="w-3.5 h-3.5 text-amber-600" />
              <span>Vergleich & Diffs</span>
            </button>
          </nav>

          {/* Right: Fahrplan Status plain text, Upload Toggle & Settings with Ollama Dot */}
          <div className="flex items-center gap-4 py-1">
            {/* Fahrplan Status in plain text without borders, boxes or dots */}
            <div className="hidden sm:flex items-center gap-3 text-meta text-gray-600">
              <div className="flex items-center gap-1">
                <span>
                  {ds1
                    ? `Fahrplan 1: ${ds1.name}${isDemo ? " (Demo)" : ""} · ${ds1.routes.length} Linien`
                    : "Fahrplan 1: –"}
                </span>
                {ds1 && onDeleteDs1 && (
                  <button
                    onClick={onDeleteDs1}
                    className="p-1 hover:text-red-600 text-gray-400 transition-colors cursor-pointer"
                    title="Fahrplan 1 löschen"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              <span>·</span>

              <div className="flex items-center gap-1">
                <span>
                  {ds2
                    ? `Fahrplan 2: ${ds2.name}${isDemo ? " (Demo)" : ""} · ${ds2.routes.length} Linien`
                    : "Fahrplan 2: –"}
                </span>
                {ds2 && onDeleteDs2 && (
                  <button
                    onClick={onDeleteDs2}
                    className="p-1 hover:text-red-600 text-gray-400 transition-colors cursor-pointer"
                    title="Fahrplan 2 löschen"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Toggle Upload Bar Button */}
            <button
              onClick={onToggleUpload}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-body font-medium transition-colors border cursor-pointer ${
                isUploadOpen
                  ? "bg-red-600 text-white border-red-700"
                  : "bg-gray-50 text-gray-800 border-gray-200 hover:bg-gray-100"
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Fahrpläne</span>
              {isUploadOpen ? (
                <ChevronUp className="w-3.5 h-3.5 ml-0.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 ml-0.5" />
              )}
            </button>

            {/* Ollama Status Dot (The ONLY dot in the entire app) */}
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-100 rounded-md transition-colors text-[12px] text-gray-700 font-medium cursor-pointer"
              title="KI-Einstellungen"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isOllamaConnected ? "bg-emerald-500" : "bg-gray-400"
                }`}
              />
              <span>KI</span>
            </button>

            {/* Settings Button */}
            <button
              onClick={onOpenSettings}
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors shrink-0 cursor-pointer"
              title="Einstellungen"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

