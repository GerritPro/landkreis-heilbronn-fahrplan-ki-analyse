// Klickt einen Button per Textinhalt, wartet, scrollt zum Ziel, Screenshot.
// node scripts/click-shot.mjs <outPng> <buttonText> <scrollSelector> <waitMs>
import fs from "node:fs";
const [, , out, btnText, scrollSel, waitStr] = process.argv;
const waitMs = parseInt(waitStr || "5000", 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch("http://127.0.0.1:9222/json");
const all = await res.json();
const page =
  all.find((t) => t.type === "page" && t.webSocketDebuggerUrl && (t.url || "").includes("localhost:3000")) ||
  all.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("kein Page-Target — Edge/Seite nicht offen");
console.log("target:", page.url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));

const clickExpr = `(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => x.textContent.trim().includes(${JSON.stringify(btnText)}));
  if (b) { b.click(); return 'clicked: ' + b.textContent.trim(); }
  return 'NOT FOUND';
})()`;
const cr = await send("Runtime.evaluate", { expression: clickExpr, returnByValue: true });
console.log("click:", cr?.result?.value);
await sleep(waitMs);
if (scrollSel && scrollSel !== "-") {
  await send("Runtime.evaluate", { expression: `document.querySelector('${scrollSel}')?.scrollIntoView({block:'start'})` });
  await sleep(600);
}
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("Screenshot:", out);
ws.close();
process.exit(0);
