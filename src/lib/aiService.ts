import { AIStatus } from "../types";

export interface AIAnalyzeParams {
  prompt: string;
  "facts"?: string;
  dataset1Summary?: string;
  dataset2Summary?: string;
  context?: string;
  customOllamaUrl?: string;
  customModel?: string;
}

export interface AIAnalyzeResult {
  answer: string;
  engine: string;
  timestamp: string;
}

export async function fetchAIStatus(customOllamaUrl?: string): Promise<AIStatus> {
  try {
    const url = customOllamaUrl
      ? `/api/ai/status?ollamaUrl=${encodeURIComponent(customOllamaUrl)}`
      : `/api/ai/status`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Status check failed");
    return await res.json();
  } catch (err) {
    return {
      ollama: {
        url: customOllamaUrl || "http://10.132.67.90:11434",
        model: "qwen3:30b",
        available: false,
        message: "Ollama Offline / Server nicht erreichbar",
      },
      gemini: {
        available: true,
      },
      activeFallback: true,
    };
  }
}

export async function sendAIAnalysisRequest(
  params: AIAnalyzeParams
): Promise<AIAnalyzeResult> {
  const res = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || "Anfrage an KI-Server fehlgeschlagen");
  }

  return await res.json();
}
