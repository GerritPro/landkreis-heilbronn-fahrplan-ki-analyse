import React from "react";
import { motion } from "motion/react";
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

type TabId = "transfers" | "chat" | "diff";

interface NavbarProps {
  ds1: GTFSDataSet | null;
  ds2: GTFSDataSet | null;
  aiStatus: AIStatus | null;
  isDemo?: boolean;
  activeTab: TabId;
  onSetTab: (t: TabId) => void;
  onOpenSettings: () => void;
  isUploadOpen: boolean;
  onToggleUpload: () => void;
  onDeleteDs1?: () => void;
  onDeleteDs2?: () => void;
}

const navItems: { id: TabId; label: string; Icon: typeof ArrowLeftRight; color: string }[] = [
  { id: "transfers", label: "Umstiege", Icon: ArrowLeftRight, color: "var(--bus)" },
  { id: "chat", label: "KI-Assistent", Icon: MessageSquare, color: "var(--rail)" },
  { id: "diff", label: "Vergleich", Icon: GitCompare, color: "var(--warn)" },
];

export const Navbar: React.FC<NavbarProps> = ({
  ds1,
  ds2,
  aiStatus,
  isDemo,
  activeTab,
  onSetTab,
  onOpenSettings,
  isUploadOpen,
  onToggleUpload,
  onDeleteDs1,
  onDeleteDs2,
}) => {
  const isOllamaConnected = aiStatus?.ollama.available;
  const hasData = Boolean(ds1 || ds2 || isDemo);

  const planLabel = (ds: GTFSDataSet | null) =>
    ds ? `${ds.name}${isDemo ? " (Demo)" : ""} · ${ds.routes.length} Linien` : "–";

  return (
    <header className="sticky top-0 z-40 h-16 bg-white/85 backdrop-blur-md border-b border-[var(--border)] shadow-[var(--shadow-xs)]">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 h-full">
        <div className="flex items-center justify-between h-full gap-2">
          {/* Left: Logo & Title */}
          <div className="flex items-center gap-3 shrink-0">
            <Logo size="md" />
            <div className="hidden xl:block h-7 w-px bg-[var(--border-strong)]" />
            <div className="hidden xl:block">
              <h1 className="text-heading text-gray-900 leading-tight">Soll-Fahrplan KI-Analyse</h1>
              <p className="text-meta">Landkreis Heilbronn · HNV & NVBW</p>
            </div>
          </div>

          {/* Center: Tab-Switcher */}
          {hasData && (
            <nav className="flex items-center gap-0.5 bg-[var(--surface-2)] p-1 rounded-xl border border-[var(--border)] shrink-0">
              {navItems.map(({ id, label, Icon, color }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => onSetTab(id)}
                    aria-selected={active}
                    className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body font-medium cursor-pointer transition-colors ${
                      active ? "text-gray-900" : "text-gray-500 hover:text-gray-800"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 rounded-lg pill-thumb"
                        transition={{ type: "spring", stiffness: 480, damping: 34 }}
                      />
                    )}
                    <Icon className="relative z-10 w-3.5 h-3.5" style={{ color }} />
                    <span className="relative z-10 hidden sm:inline">{label}</span>
                  </button>
                );
              })}
            </nav>
          )}

          {/* Right: Status, Upload, Settings */}
          <div className="flex items-center gap-3 py-1">
            <div className="hidden lg:flex items-center gap-2 text-meta">
              {[
                { n: "1", ds: ds1, del: onDeleteDs1 },
                { n: "2", ds: ds2, del: onDeleteDs2 },
              ].map(({ n, ds, del }) => (
                <div
                  key={n}
                  title={ds ? ds.name : undefined}
                  className={`group chip-soft flex items-center gap-1.5 pl-2 pr-1.5 py-1 ${ds ? "bg-white" : "bg-[var(--surface-2)]"}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ds ? "bg-emerald-500" : "bg-gray-300"}`} />
                  <span className="text-[12px] whitespace-nowrap">
                    <span className="text-gray-400 font-medium">FP{n}</span>{" "}
                    {ds ? (
                      <span className="text-gray-700 font-medium">
                        {ds.routes.length} Linien{isDemo ? " · Demo" : ""}
                      </span>
                    ) : (
                      <span className="text-gray-400">leer</span>
                    )}
                  </span>
                  {ds && del && (
                    <button
                      onClick={del}
                      className="p-0.5 text-gray-300 hover:text-red-500 rounded shrink-0 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                      title={`Fahrplan ${n} löschen`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={onToggleUpload}
              className={`gel text-body px-3 py-1.5 ${isUploadOpen ? "gel-blue" : "gel-light"}`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Fahrpläne</span>
              {isUploadOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onOpenSettings}
              className="gel gel-light pl-2 pr-2.5 py-1.5 text-[12px]"
              title="KI-Einstellungen"
            >
              <span className="relative flex w-2 h-2">
                {isOllamaConnected && (
                  <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                )}
                <span className={`relative inline-flex w-2 h-2 rounded-full ${isOllamaConnected ? "bg-emerald-500" : "bg-gray-400"}`} />
              </span>
              KI
            </button>

            <button
              onClick={onOpenSettings}
              className="gel gel-light p-2 shrink-0 text-gray-500"
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
