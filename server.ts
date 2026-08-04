import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Environment variables
const OLLAMA_URL = process.env.OLLAMA_URL || "http://10.132.67.90:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:30b";

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "Landkreis Heilbronn - Fahrplan KI" });
});

// AI Server Status check
app.get("/api/ai/status", async (req, res) => {
  const customOllamaUrl = (req.query.ollamaUrl as string) || OLLAMA_URL;
  let ollamaOk = false;
  let ollamaDetails = "";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${customOllamaUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      ollamaOk = true;
      ollamaDetails = `Ollama erreichbar (${customOllamaUrl})`;
    } else {
      ollamaDetails = `Ollama HTTP ${response.status}`;
    }
  } catch (err: any) {
    ollamaDetails = err.name === "AbortError" ? "Ollama Timeout (10.132.67.90 ist intern)" : "Ollama nicht erreichbar";
  }

  res.json({
    ollama: {
      url: customOllamaUrl,
      model: OLLAMA_MODEL,
      available: ollamaOk,
      message: ollamaDetails,
    },
    activeFallback: !ollamaOk,
  });
});

// Formatiert das berechnete Fakten-JSON als lesbares Markdown (Direktausgabe,
// wenn keine KI erreichbar ist — der zuverlässige Offline-Pfad).
function formatFactsAsMarkdown(factsStr: string): string {
  let data: any = null;
  try {
    data = JSON.parse(factsStr);
  } catch {
    data = null;
  }
  if (!data || Object.keys(data).length === 0) {
    return "Für diese Anfrage konnten keine Fakten aus dem Fahrplan berechnet werden.";
  }

  let md = "### Fahrplan-Auswertung\n\n";

  const ds = data.fahrplan2 || data.fahrplan1;
  if (ds) {
    md += `**${ds.name}** — ${ds.linien} Linien, ${ds.haltestellen} Haltestellen, ${ds.fahrten} Fahrten`;
    if (ds.gueltigVon) md += ` · gültig ${ds.gueltigVon} bis ${ds.gueltigBis}`;
    md += "\n\n";
  }
  if (data.stichtage) {
    md += `_Analyse-Stichtage: Werktag ${data.stichtage.werktag}, Samstag ${data.stichtage.samstag}, Sonntag ${data.stichtage.sonntag}._\n\n`;
  }

  if (data.vergleich) {
    const v = data.vergleich;
    md += "#### Vergleich der Fahrpläne\n";
    md += "| Kennzahl | Wert |\n| :--- | :--- |\n";
    if (v.neueLinien?.length) md += `| Neue Linien | ${v.neueLinien.join(", ")} |\n`;
    if (v.entfalleneLinien?.length) md += `| Entfallene Linien | ${v.entfalleneLinien.join(", ")} |\n`;
    md += `| Geänderte Linien | ${v.geaenderteLinien} |\n`;
    md += `| Neue / entfallene Haltestellen | +${v.neueHaltestellen} / −${v.entfalleneHaltestellen} |\n\n`;
  }

  if (data.umstiege?.verbindungen?.length) {
    md += `#### Anschlüsse an ${data.umstiege.haltestelle}\n`;
    md += "| Ankunft | Wartezeit | Abfahrt | Richtung |\n| :--- | :--- | :--- | :--- |\n";
    for (const t of data.umstiege.verbindungen) {
      md += `| ${t.an} | ${t.wartezeit} | ${t.ab} | ${t.richtung} |\n`;
    }
    md += "\n";
  }

  if (Array.isArray(data.linien) && data.linien.length > 0) {
    md += "#### Linien mit den meisten Fahrten\n";
    md += "| Linie | Verlauf | Fahrten | Takt |\n| :--- | :--- | :--- | :--- |\n";
    for (const r of data.linien) {
      md += `| ${r.linie} | ${r.verlauf || "-"} | ${r.fahrten} | ${r.takt ? r.takt + " min" : "-"} |\n`;
    }
    md += "\n";
  }

  if (Array.isArray(data.bedienungsluecken) && data.bedienungsluecken.length > 0) {
    md += "#### Bedienungslücken\n";
    md += "| Haltestelle | Letzte Abfahrt Mo-Fr | Fahrten Sonntag |\n| :--- | :--- | :--- |\n";
    for (const g of data.bedienungsluecken) {
      md += `| ${g.haltestelle} | ${g.letzteAbfahrtWerktag || "keine"} | ${g.fahrtenSonntag} |\n`;
    }
    md += "\n";
  }

  return md.trim();
}

// Main AI Analysis Endpoint
app.post("/api/ai/analyze", async (req, res) => {
  try {
    const {
      prompt,
      facts,
      customOllamaUrl,
      customModel,
    } = req.body;

    const targetOllamaUrl = customOllamaUrl || OLLAMA_URL;
    const targetModel = customModel || OLLAMA_MODEL;

    const factsStr = typeof facts === "string" ? facts : JSON.stringify(facts || {});

    const systemPrompt = `Du bist ein hilfsbereiter Nahverkehrs-Experte für den Landkreis Heilbronn und erklärst Kolleginnen und Kollegen den Soll-Fahrplan.

So antwortest du:
- Antworte natürlich und flüssig, wie ein Mensch, der die Zahlen kurz erklärt – nicht wie ein Amtsbericht. Steig direkt mit der Antwort auf die Frage ein, dann die wichtigsten Details.
- Schreib in ganzen Sätzen. Eine Markdown-Tabelle nur, wenn sie den Überblick echt erleichtert (z.B. mehrere Linien nebeneinander) – sonst lieber Fließtext oder eine kurze Aufzählung.
- Stütz dich AUSSCHLIESSLICH auf die berechneten Fakten unten. Erfinde nie Linien, Uhrzeiten, Haltestellen, Bussteige oder Zahlen. Was dort nicht steht, weißt du nicht – dann sag das ehrlich und locker (z.B. „Dazu liegen mir keine Daten vor.").
- Zahlen darfst du einordnen (z.B. „ein dichter 10-Minuten-Takt"), aber nichts hinzudichten.
- Halt dich kurz, sei freundlich und konkret. Verzichte auf Floskeln wie „Basierend auf den vorliegenden Daten". Antworte auf Deutsch. /no_think

BERECHNETE FAKTEN:
${factsStr}`;

    let aiResponseText = "";
    let usedEngine = "";

    // Schneller Erreichbarkeits-Vorcheck (2s): verhindert, dass Offline-Nutzer
    // (Ollama nicht im Netz) bei jeder Anfrage in den langen Generate-Timeout laufen.
    let ollamaReachable = false;
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 2000);
      const ping = await fetch(`${targetOllamaUrl}/api/tags`, { signal: c.signal });
      clearTimeout(t);
      ollamaReachable = ping.ok;
    } catch {
      ollamaReachable = false;
    }

    // 1. Ollama nur versuchen, wenn erreichbar — dann großzügiger Timeout (lokales LLM)
    if (ollamaReachable) try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      const ollamaRes = await fetch(`${targetOllamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          prompt: `${systemPrompt}\n\nFRAGE: ${prompt}`,
          stream: false,
        }),
      });

      clearTimeout(timeoutId);

      if (ollamaRes.ok) {
        const data = await ollamaRes.json();
        if (data.response) {
          // Remove everything between <think> and </think>
          aiResponseText = data.response.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          usedEngine = `Ollama (${targetModel} @ ${targetOllamaUrl})`;
        }
      }
    } catch (ollamaErr) {
      console.log("Ollama execute note:", (ollamaErr as Error).message);
    }

    // 2. Try Gemini 2.5 Flash (Preview Fallback) if Ollama not available
    if (!aiResponseText && process.env.GEMINI_API_KEY) {
      try {
        const aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const geminiRes = await aiClient.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `${systemPrompt}\n\nFRAGE: ${prompt}`,
        });
        if (geminiRes.text) {
          aiResponseText = geminiRes.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          usedEngine = "Gemini 2.5 Flash (Preview Fallback)";
        }
      } catch (geminiErr: any) {
        console.log("Gemini fallback note:", geminiErr?.message);
      }
    }

    // 3. Direct fallback output if neither Ollama nor Gemini was available
    if (!aiResponseText) {
      aiResponseText = formatFactsAsMarkdown(factsStr);
      usedEngine = "Direktausgabe (KI nur im Amtsnetz)";
    }

    res.json({
      answer: aiResponseText,
      engine: usedEngine,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({
      error: "Fehler bei der KI-Analyse",
      message: error.message || "Unbekannter Fehler",
    });
  }
});

// Start Server with Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
