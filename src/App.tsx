import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Navbar } from "./components/Navbar";
import { FileUploadSection } from "./components/FileUploadSection";
import { InteractiveMap } from "./components/InteractiveMap";
import { AiChatWindow } from "./components/AiChatWindow";
import { GtfsDiffView } from "./components/GtfsDiffView";
import { TransferAnalyzer } from "./components/TransferAnalyzer";
import { NetworkSummary } from "./components/NetworkSummary";
import { SettingsModal } from "./components/SettingsModal";
import { GTFSDataSet, AIStatus, GTFSStop } from "./types";
import { createSampleHNVDatesets } from "./lib/gtfsParser";
import { fetchAIStatus } from "./lib/aiService";
import { Upload, RefreshCw } from "lucide-react";

export default function App() {
  const [ds1, setDs1] = useState<GTFSDataSet | null>(null);
  const [ds2, setDs2] = useState<GTFSDataSet | null>(null);
  const [isDemo, setIsDemo] = useState<boolean>(false);

  const [ollamaUrl, setOllamaUrl] = useState("http://10.132.67.90:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen3:30b");
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Upload drawer state (bei ?autoload=… für den QA-Testpfad initial geöffnet — nur Dev)
  const [isUploadOpen, setIsUploadOpen] = useState(
    () =>
      import.meta.env.DEV &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("autoload")
  );

  // Dev/QA: Schublade nach erfolgreichem Auto-Load wieder schließen
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).has("autoload") && ds1) {
      setIsUploadOpen(false);
    }
  }, [ds1]);

  // Toast message state for status notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Selected stop ID for synchronization across Map & TransferAnalyzer
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [hoveredStopStem, setHoveredStopStem] = useState<string | null>(null);

  // Map highlight markers
  const [gapStopStems, setGapStopStems] = useState<Set<string> | undefined>(undefined);
  const [removedStopStems, setRemovedStopStems] = useState<Set<string> | undefined>(undefined);
  const [addedStopStems, setAddedStopStems] = useState<Set<string> | undefined>(undefined);

  // AI initial prompt
  const [initialAiPrompt, setInitialAiPrompt] = useState<string | undefined>(undefined);

  // Aktiver Analyse-Tab im rechten Panel
  const [activeTab, setActiveTab] = useState<"transfers" | "chat" | "diff">("transfers");

  // Poll AI status every 30 seconds
  useEffect(() => {
    fetchAIStatus(ollamaUrl).then((status) => {
      setAiStatus(status);
    });

    const interval = setInterval(() => {
      fetchAIStatus(ollamaUrl).then((newStatus) => {
        setAiStatus((prev) => {
          if (prev && prev.ollama.available !== newStatus.ollama.available) {
            const isOnlineNow = newStatus.ollama.available;
            setToastMessage(
              isOnlineNow
                ? "KI-Verbindung wiederhergestellt (Ollama online)"
                : "KI-Verbindung unterbrochen (Ollama offline)"
            );
            setTimeout(() => setToastMessage(null), 5000);
          }
          return newStatus;
        });
      });
    }, 30000);

    return () => clearInterval(interval);
  }, [ollamaUrl]);

  const handleStartDemo = () => {
    const { ds1: sample1, ds2: sample2 } = createSampleHNVDatesets();
    setDs1(sample1);
    setDs2(sample2);
    setIsDemo(true);
    setIsUploadOpen(false);
  };

  const handleStopDemo = () => {
    setDs1(null);
    setDs2(null);
    setIsDemo(false);
  };

  const handleDeleteDs1 = () => {
    setDs1(null);
    if (!ds2 && isDemo) {
      setIsDemo(false);
    }
  };

  const handleDeleteDs2 = () => {
    setDs2(null);
    if (!ds1 && isDemo) {
      setIsDemo(false);
    }
  };

  const handleSelectStopForAI = (stop: GTFSStop) => {
    setInitialAiPrompt(
      `Bitte analysieren Sie die Verbindungen, Taktung und Anschlüsse an der Haltestelle "${stop.stop_name}".`
    );
    setActiveTab("chat");
  };

  const handleSelectStopForTransfer = (stop: GTFSStop) => {
    setSelectedStopId(stop.stop_id);
    setActiveTab("transfers");
  };

  const handleShowGapsOnMap = (stems: Set<string>) => {
    setGapStopStems(stems);
    setRemovedStopStems(undefined);
    setAddedStopStems(undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleShowDiffOnMap = (removed: Set<string>, added: Set<string>) => {
    setGapStopStems(undefined);
    setRemovedStopStems(removed);
    setAddedStopStems(added);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleStartAIChatWithFacts = (factsText: string) => {
    setInitialAiPrompt(factsText);
    setActiveTab("chat");
  };

  return (
    <div className="min-h-screen flex flex-col font-sans text-gray-900" style={{ background: "var(--bg)" }}>
      {/* Header / Navbar */}
      <Navbar
        ds1={ds1}
        ds2={ds2}
        aiStatus={aiStatus}
        isDemo={isDemo}
        activeTab={activeTab}
        onSetTab={setActiveTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isUploadOpen={isUploadOpen}
        onToggleUpload={() => setIsUploadOpen(!isUploadOpen)}
        onDeleteDs1={handleDeleteDs1}
        onDeleteDs2={handleDeleteDs2}
      />

      {/* Persistent Demo Mode Banner */}
      {isDemo && (
        <div className="bg-amber-50 text-amber-900 border-b border-amber-200 px-4 py-2 text-body font-medium flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 max-w-[1800px] mx-auto w-full">
            <span className="px-2 py-0.5 bg-amber-500 text-white rounded-md text-label">
              Demo
            </span>
            <span className="text-amber-800">Fiktive Beispieldaten – keine echten Fahrpläne.</span>
          </div>
          <button onClick={handleStopDemo} className="gel gel-amber text-body px-3.5 py-1.5 shrink-0">
            Demo beenden
          </button>
        </div>
      )}

      {/* Collapsible Upload Strip directly under header */}
      {isUploadOpen && (
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <FileUploadSection
              ds1={ds1}
              ds2={ds2}
              setDs1={(ds) => {
                setDs1(ds);
                if (ds) {
                  if (isDemo) setIsDemo(false);
                  setIsUploadOpen(false); // nach Laden einklappen → mehr Platz
                }
              }}
              setDs2={(ds) => {
                setDs2(ds);
                if (ds) {
                  if (isDemo) setIsDemo(false);
                  setIsUploadOpen(false);
                }
              }}
              onStartDemoMode={handleStartDemo}
            />
          </div>
        </div>
      )}

      {/* Main One-Page Dashboard Area */}
      <main className="flex-1 max-w-[1800px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-6">
        {/* Responsive Grid: Karte 58% / Analyse 42%, 1-spaltig auf mobil.
            Karte füllt auf Desktop die volle Viewport-Höhe (sticky). */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-7 items-start">
          {/* LEFT COLUMN: Sticky Interactive Map, volle Höhe */}
          <div className="lg:col-span-7 lg:sticky lg:top-[72px] lg:h-[calc(100vh-88px)] min-h-[440px] h-[560px]">
            <InteractiveMap
              ds1={ds1}
              ds2={ds2}
              setDs1={setDs1}
              setDs2={setDs2}
              onSelectStopForAI={handleSelectStopForAI}
              onSelectStopForTransfer={handleSelectStopForTransfer}
              selectedStopId={selectedStopId}
              gapStopStems={gapStopStems}
              removedStopStems={removedStopStems}
              addedStopStems={addedStopStems}
              hoveredStopStem={hoveredStopStem}
            />
          </div>

          {/* RIGHT COLUMN: Scrollable Analysis Sections (42% width = col-span-5) */}
          <div className="lg:col-span-5 space-y-6 lg:overflow-y-auto lg:h-[calc(100vh-88px)] pr-1 stagger">
            {/* Netz-Kennzahlen (nur wenn Daten geladen) */}
            <NetworkSummary ds1={ds1} ds2={ds2} />

            {/* Start Welcome Card when no dataset is loaded */}
            {!ds1 && !ds2 && !isDemo && (
              <div className="card rise p-5 overflow-hidden relative">
                <div
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ background: "linear-gradient(90deg, var(--brand), #82B822, #E6D815)" }}
                />
                <div className="flex items-center gap-3 mb-3 mt-1">
                  <div className="p-2.5 rounded-xl" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-heading text-gray-900 text-[15px]">
                      Willkommen zur Fahrplan-Analyse
                    </h3>
                    <p className="text-meta">Landkreis Heilbronn · GTFS-Analyse & Vorher-Nachher-Vergleich</p>
                  </div>
                </div>
                <p className="text-body text-gray-600 mb-4 max-w-prose">
                  Laden Sie Ihre GTFS-Soll-Fahrplandaten (.zip) hoch – Karte, Takt-Analyse, Bedienungslücken
                  und Umstiege werden automatisch berechnet. Oder starten Sie mit interaktiven Beispieldaten.
                </p>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button onClick={() => setIsUploadOpen(true)} className="flex-1 gel gel-pill gel-blue">
                    <Upload className="w-4 h-4" />
                    Fahrplan-ZIP laden
                  </button>
                  <button onClick={handleStartDemo} className="flex-1 gel gel-pill gel-light">
                    <RefreshCw className="w-4 h-4 text-gray-500" />
                    Demo-Daten ansehen
                  </button>
                </div>
              </div>
            )}

            {/* Analyse-Panels (Tab-Umschaltung über die Navbar, weicher Übergang,
                Panels bleiben gemountet → Zustand bleibt erhalten) */}
            {(ds1 || ds2 || isDemo) &&
              (
                [
                  { id: "transfers" as const, node: (
                    <TransferAnalyzer
                      ds1={ds1}
                      ds2={ds2}
                      externalSelectedStopId={selectedStopId}
                      onSelectStop={(stop) => setSelectedStopId(stop.stop_id)}
                      onOpenUpload={() => setIsUploadOpen(true)}
                    />
                  ) },
                  { id: "chat" as const, node: (
                    <AiChatWindow
                      ds1={ds1}
                      ds2={ds2}
                      ollamaUrl={ollamaUrl}
                      ollamaModel={ollamaModel}
                      aiStatus={aiStatus}
                      initialPrompt={initialAiPrompt}
                      onClearInitialPrompt={() => setInitialAiPrompt(undefined)}
                    />
                  ) },
                  { id: "diff" as const, node: (
                    <GtfsDiffView
                      ds1={ds1}
                      ds2={ds2}
                      onShowGapsOnMap={handleShowGapsOnMap}
                      onShowDiffOnMap={handleShowDiffOnMap}
                      onStartAIChatWithFacts={handleStartAIChatWithFacts}
                      onHoverStopStem={setHoveredStopStem}
                      onOpenUpload={() => setIsUploadOpen(true)}
                    />
                  ) },
                ] as const
              ).map(({ id, node }) => {
                const active = activeTab === id;
                return (
                  <motion.section
                    key={id}
                    id={`section-${id}`}
                    initial={false}
                    animate={active ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y: 10, filter: "blur(2px)" }}
                    transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
                    style={{ display: active ? "block" : "none" }}
                  >
                    {node}
                  </motion.section>
                );
              })}
          </div>
        </div>
      </main>

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="fixed bottom-5 right-5 z-50 bg-gray-900 text-white px-4 py-3 rounded-xl shadow-[var(--shadow-lg)] text-body flex items-center gap-2.5"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="bg-white border-t border-[var(--border)] py-4 text-center text-meta mt-auto">
        <div className="max-w-[1800px] mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-body text-gray-600">
            <span className="text-heading text-gray-900">Landkreis Heilbronn</span>
            <span className="text-gray-300">·</span>
            <span>Soll-Fahrplan KI-Analyse</span>
          </div>
          <div className="text-meta">HNV Heilbronner Nahverkehr & NVBW GTFS-Format</div>
        </div>
      </footer>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        ollamaUrl={ollamaUrl}
        setOllamaUrl={setOllamaUrl}
        ollamaModel={ollamaModel}
        setOllamaModel={setOllamaModel}
        aiStatus={aiStatus}
        setAiStatus={setAiStatus}
      />
    </div>
  );
}
