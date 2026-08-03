// Minimaler CDP-Screenshot-Treiber (nutzt Node-24-Globals fetch + WebSocket).
// Aufruf: node scripts/shot.mjs <url> <outPng> <waitMs> [width] [height] [fullPage]
import fs from "node:fs";

const [, , url, out, waitMsStr, wStr, hStr, fullStr] = process.argv;
const waitMs = parseInt(waitMsStr || "12000", 10);
const width = parseInt(wStr || "1600", 10);
const height = parseInt(hStr || "1000", 10);
const fullPage = fullStr === "full";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9222/json");
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("Kein CDP-Page-Target gefunden");
}

async function main() {
  const wsUrl = await getWs();
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });

  await new Promise((r) => ws.addEventListener("open", r));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await send("Page.navigate", { url });
  await sleep(waitMs);

  // Optional: aktuelle Statuszeile / Marker-Anzahl ausgeben (Debug)
  try {
    const r = await send("Runtime.evaluate", {
      expression: `(() => {
        const path = document.querySelectorAll('.leaflet-interactive').length;
        const kpi = document.querySelector('.tabular-nums')?.textContent || '';
        const err = document.body.innerText.includes('Fehler beim Laden');
        return JSON.stringify({ markers: path, kpi, err });
      })()`,
      returnByValue: true,
    });
    console.log("Seitenzustand:", r?.result?.value);
  } catch {}

  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: fullPage,
    ...(fullPage ? { clip: undefined } : {}),
  });
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("Screenshot:", out);
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("shot error:", e.message);
  process.exit(1);
});
