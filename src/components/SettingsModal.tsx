import React, { useState } from "react";
import { motion } from "motion/react";
import { Server, CheckCircle2, AlertCircle, RefreshCw, X, Cpu } from "lucide-react";
import { AIStatus } from "../types";
import { fetchAIStatus } from "../lib/aiService";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  ollamaUrl: string;
  setOllamaUrl: (url: string) => void;
  ollamaModel: string;
  setOllamaModel: (model: string) => void;
  aiStatus: AIStatus | null;
  setAiStatus: (status: AIStatus) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  ollamaUrl,
  setOllamaUrl,
  ollamaModel,
  setOllamaModel,
  aiStatus,
  setAiStatus,
}) => {
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setTesting(true);
    setTestMessage(null);
    try {
      const status = await fetchAIStatus(ollamaUrl);
      setAiStatus(status);
      if (status.ollama.available) {
        setTestMessage(`Erfolgreich verbunden mit Ollama (${ollamaUrl})`);
      } else {
        setTestMessage(`Ollama nicht erreichbar (${status.ollama.message}). Automatischer Fallback zu Gemini / HNV Analytics ist aktiv.`);
      }
    } catch (err: any) {
      setTestMessage("Fehler beim Prüfen der Verbindung");
    } finally {
      setTesting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="card shadow-[var(--shadow-lg)] max-w-lg w-full overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-gray-700" />
            <h3 className="text-heading text-gray-900">KI & Ollama Konfiguration</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-gray-50 p-3 rounded-md border border-gray-200 text-body space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-700">Vorgegebene Ollama-KI:</span>
              <span className="font-mono text-meta bg-white px-2 py-0.5 rounded-md border border-gray-200 text-gray-800">
                qwen3:30b
              </span>
            </div>
            <div className="text-meta text-gray-500 leading-relaxed">
              Voreingestellt ist die angegebene Ollama IP <code className="bg-white px-1 py-0.5 rounded-sm border border-gray-200 text-gray-800 font-mono">http://10.132.67.90:11434</code>. Sollte diese in der Cloud-Run Umgebung nicht erreichbar sein, schaltet das System nahtlos auf Gemini / lokale GTFS-Analysen um.
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-heading text-gray-700 mb-1.5">
                Ollama Server URL
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://10.132.67.90:11434"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-data font-mono focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 text-gray-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-heading text-gray-700 mb-1.5">
                Modell Name
              </label>
              <input
                type="text"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                placeholder="qwen3:30b"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-data font-mono focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 text-gray-900"
              />
            </div>
          </div>

          {testMessage && (
            <div className={`p-3 rounded-md text-body flex items-start gap-2 border ${
              aiStatus?.ollama.available
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-amber-50 text-amber-800 border-amber-200"
            }`}>
              {aiStatus?.ollama.available ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              <span>{testMessage}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-100">
          <button type="button" onClick={handleTestConnection} disabled={testing} className="gel gel-light text-body px-3 py-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? "animate-spin" : ""}`} />
            Verbindung testen
          </button>

          <button type="button" onClick={onClose} className="gel gel-blue text-body px-4 py-1.5">
            Speichern & Schließen
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
