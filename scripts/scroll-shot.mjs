// Verbindet sich mit der BEREITS geladenen Seite (kein Navigate/Re-Parse),
// scrollt ein Element in den Blick und macht einen Screenshot.
// node scripts/scroll-shot.mjs <outPng> <selector|px> [waitMs]
import fs from "node:fs";

const [, , out, target, waitMsStr] = process.argv;
const waitMs = parseInt(waitMsStr || "1200", 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch("http://127.0.0.1:9222/json");
const targets = await res.json();
const page =
  targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl && (t.url || "").includes("localhost:3000")) ||
  targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("kein Page-Target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener("open", r));

const expr = /^\d+$/.test(target)
  ? `(() => { const c = document.querySelector('.lg\\\\:overflow-y-auto'); if (c) c.scrollTop = ${target}; return 'px'; })()`
  : `(() => { const el = document.querySelector('${target}'); if (el) el.scrollIntoView({block:'start'}); return el ? 'ok' : 'missing'; })()`;
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log("scroll:", r?.result?.value);
await sleep(waitMs);

const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("Screenshot:", out);
ws.close();
process.exit(0);
