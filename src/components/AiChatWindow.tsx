import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage, GTFSDataSet, AIStatus } from "../types";
import { sendAIAnalysisRequest } from "../lib/aiService";
import { calculateFactsForPrompt } from "../lib/factCalculator";
import {
  Send,
  Sparkles,
  Bot,
  User,
  Copy,
  Check,
  RefreshCw,
  HelpCircle,
} from "lucide-react";

interface AiChatWindowProps {
  ds1: GTFSDataSet | null;
  ds2: GTFSDataSet | null;
  ollamaUrl: string;
  ollamaModel: string;
  aiStatus?: AIStatus | null;
  initialPrompt?: string;
  onClearInitialPrompt?: () => void;
}

export const AiChatWindow: React.FC<AiChatWindowProps> = ({
  ds1,
  ds2,
  ollamaUrl,
  ollamaModel,
  aiStatus,
  initialPrompt,
  onClearInitialPrompt,
}) => {
  const isOllamaConnected = aiStatus?.ollama?.available;
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [inputPrompt, setInputPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialPrompt) {
      setInputPrompt(initialPrompt);
      if (onClearInitialPrompt) {
        onClearInitialPrompt();
      }
    }
  }, [initialPrompt, onClearInitialPrompt]);

  const quickPrompts = [
    ...(ds1 && ds2 ? ["Wie hat sich der Fahrplan verändert?"] : []),
    "Welche Anschlüsse gibt es nach 12:40 ab Heilbronn Hbf?",
    "Umstiege am Hauptbahnhof Heilbronn?",
    "Fasse das Fahrplanangebot zusammen",
  ];

  const handleSendPrompt = async (promptToSend?: string) => {
    const text = promptToSend || inputPrompt;
    if (!text.trim() || loading) return;

    const userMsgId = `user_${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: "user",
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    const thinkingMsgId = `ai_think_${Date.now()}`;
    const thinkingMsg: ChatMessage = {
      id: thinkingMsgId,
      sender: "ai",
      text: "KI analysiert HNV Fahrplandaten und berechnet Umstiege...",
      isThinking: true,
      timestamp: new Date().toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMsg, thinkingMsg]);
    setInputPrompt("");
    setLoading(true);

    try {
      const ds1Summary = ds1
        ? `${ds1.name}: ${ds1.routes.length} Linien, ${ds1.stops.length} Haltestellen, ${ds1.totalTripsCount} Fahrten`
        : undefined;

      const ds2Summary = ds2
        ? `${ds2.name}: ${ds2.routes.length} Linien, ${ds2.stops.length} Haltestellen, ${ds2.totalTripsCount} Fahrten`
        : undefined;

      const contextInfo = `Analysierte Linien: ${
        ds1?.routes.map((r) => r.route_short_name).join(", ") || "HNV standard"
      }`;

      const factsData = calculateFactsForPrompt(text.trim(), ds1, ds2);

      const res = await sendAIAnalysisRequest({
        prompt: text.trim(),
        "facts": factsData,
        dataset1Summary: ds1Summary,
        dataset2Summary: ds2Summary,
        context: contextInfo,
        customOllamaUrl: ollamaUrl,
        customModel: ollamaModel,
      });

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        sender: "ai",
        text: res.answer,
        engine: res.engine,
        timestamp: new Date().toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setMessages((prev) => prev.filter((m) => m.id !== thinkingMsgId).concat(aiMsg));
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: "ai",
        text: `Fehler bei der Anfrage: ${err.message || "Der KI-Server konnte die Fahrplandaten nicht verarbeiten."}`,
        engine: "System",
        timestamp: new Date().toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => prev.filter((m) => m.id !== thinkingMsgId).concat(errorMsg));
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="card overflow-hidden flex flex-col h-[560px] lg:h-[calc(100vh-330px)] min-h-[460px]">
      {/* Header */}
      <div className="p-3.5 border-b border-[var(--border)] flex items-center justify-between shrink-0" style={{ background: "linear-gradient(180deg,#ffffff,#f9fafc)" }}>
        <div className="flex items-center gap-2.5">
          <span className="section-badge shrink-0" style={{ ["--c" as any]: "var(--rail)" }}>
            <Sparkles className="w-4 h-4" />
          </span>
          <h3 className="text-heading text-gray-900">KI Fahrplan-Assistent</h3>
        </div>

        <span className="chip-soft text-meta font-mono text-gray-600 bg-white px-2 py-0.5 truncate max-w-[130px]">
          {ollamaModel}
        </span>
      </div>

      {/* Quick Suggestions Chips */}
      <div className="p-2 bg-gray-50 border-b border-gray-100 flex items-center gap-1.5 overflow-x-auto shrink-0">
        <HelpCircle className="w-3 h-3 text-gray-400 shrink-0 ml-2" />
        {quickPrompts.map((qp, idx) => (
          <button
            key={idx}
            onClick={() => handleSendPrompt(qp)}
            className="gel gel-light text-body px-2.5 py-1 whitespace-nowrap shrink-0"
          >
            {qp}
          </button>
        ))}
      </div>

      {/* Messages Scroll Area - eingelassener Verlauf (Well) */}
      <div
        className="p-4 space-y-4 flex-1 overflow-y-auto min-h-[220px]"
        style={{ background: "linear-gradient(180deg,#f6f8fa 0%,#fafbfc 100%)", boxShadow: "inset 0 4px 6px -4px rgba(18,44,82,0.12)" }}
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 py-10">
            <Sparkles className="w-8 h-8 text-gray-300 mb-2" />
            <p className="text-body font-medium text-gray-500">Fragen Sie die KI zu Ihren Fahrplandaten</p>
            <p className="text-meta text-gray-400 mt-0.5 max-w-[19rem]">
              Zwei Fahrpläne vergleichen · Umstiege &amp; Anschlüsse · welche Busse nach einer Uhrzeit fahren
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-2.5 ${
                msg.sender === "user" ? "flex-row-reverse" : ""
              }`}
            >
              <div
                className="w-7 h-7 rounded-[9px] flex items-center justify-center shrink-0 text-body font-medium"
                style={
                  msg.sender === "user"
                    ? { background: "linear-gradient(180deg,#2b313a,#171b22)", color: "#fff", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 1px 2px rgba(0,0,0,0.18)" }
                    : { background: "color-mix(in srgb, var(--rail) 12%, #fff)", color: "var(--rail)", border: "1px solid color-mix(in srgb, var(--rail) 22%, transparent)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)" }
                }
              >
                {msg.sender === "user" ? (
                  <User className="w-3.5 h-3.5" />
                ) : (
                  <Bot className="w-3.5 h-3.5" />
                )}
              </div>

              <div
                className={`flex flex-col max-w-[88%] ${
                  msg.sender === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`rounded-2xl p-3 text-body leading-relaxed ${
                    msg.sender === "user" ? "text-white" : "text-gray-900"
                  }`}
                  style={
                    msg.sender === "user"
                      ? {
                          background: "linear-gradient(180deg,#2b313a 0%,#171b22 100%)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 2px rgba(0,0,0,0.15), 0 4px 12px rgba(18,44,82,0.12)",
                          borderBottomRightRadius: "6px",
                        }
                      : {
                          background: "linear-gradient(180deg,#ffffff 0%,#f7f9fb 100%)",
                          border: "1px solid var(--border)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(18,44,82,0.05), 0 4px 12px rgba(18,44,82,0.05)",
                          borderBottomLeftRadius: "6px",
                        }
                  }
                >
                  {msg.isThinking ? (
                    <div className="flex items-center gap-2 py-0.5">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--rail)" }} />
                      <span>{msg.text}</span>
                    </div>
                  ) : msg.sender === "user" ? (
                    <div className="whitespace-pre-wrap">{msg.text}</div>
                  ) : (
                    <div className="max-w-none text-body text-gray-800 space-y-1.5 [&_p]:mb-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_h3]:text-heading [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h4]:text-heading [&_h4]:font-semibold [&_h4]:mt-2 [&_h4]:mb-1 [&_strong]:font-semibold [&_em]:text-gray-500 [&_em]:not-italic [&_table]:w-full [&_table]:border-collapse [&_table]:my-1.5 [&_table]:text-meta [&_thead]:bg-gray-100 [&_th]:border [&_th]:border-gray-200 [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-gray-200 [&_td]:px-1.5 [&_td]:py-1 [&_td]:tabular-nums [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1 px-1 text-meta text-gray-400">
                  <span>{msg.timestamp}</span>
                  {msg.engine && <span className="font-mono text-[10px] text-gray-400">({msg.engine})</span>}
                  {msg.sender === "ai" && !msg.isThinking && (
                    <button
                      onClick={() => copyToClipboard(msg.text, msg.id)}
                      className="hover:text-gray-700 flex items-center gap-0.5 transition-colors cursor-pointer ml-auto"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-2.5 h-2.5 text-emerald-600" /> Kopiert
                        </>
                      ) : (
                        <>
                          <Copy className="w-2.5 h-2.5" /> Kopieren
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input Form */}
      <div className="p-3 border-t border-gray-100 bg-gray-50 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendPrompt();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            placeholder={
              isOllamaConnected === false
                ? "KI nur im Amtsnetz erreichbar – Antworten erscheinen als Direktausgabe"
                : "Frage stellen..."
            }
            className="flex-1 px-3.5 py-2.5 bg-white border border-[var(--border-strong)] rounded-xl text-body focus:outline-none text-gray-900 placeholder:text-gray-400"
            disabled={loading}
          />

          <button
            type="submit"
            disabled={!inputPrompt.trim() || loading}
            title="Senden"
            className="gel gel-fab gel-aqua shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
