// Lädt eine ZIP über den echten Datei-Input (CDP) und inspiziert die Karte.
// node scripts/upload-inspect.mjs <zipPath> <outPrefix>
import fs from "node:fs";
const [, , zipPath, prefix] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = all.find((t) => t.type === "page" && (t.url || "").includes("localhost:3000")) || all.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable"); await send("DOM.enable"); await send("Runtime.enable");

const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${prefix}-${name}.png`, Buffer.from(s.data, "base64"));
  console.log("shot:", name);
};
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true }))?.result?.value;

// Upload-Schublade öffnen
console.log("open drawer:", await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Fahrplan-ZIP laden|Fahrpläne/.test(x.textContent));if(b){b.click();return b.textContent.trim();}return 'no btn';})()`));
await sleep(1200);

// Datei-Input finden & Datei setzen
const doc = await send("DOM.getDocument", { depth: -1 });
const q = await send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
console.log("file inputs:", q.nodeIds.length);
await send("DOM.setFileInputFiles", { nodeId: q.nodeIds[0], files: [zipPath] });
console.log("Datei gesetzt, parse läuft…");

// Auf Analyse warten (KPI erscheint)
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const kpi = await evalJs(`(()=>{const e=document.querySelectorAll('.tabular-nums');return e.length?e[0].textContent:'';})()`);
  if (kpi && /\d/.test(kpi)) { console.log(`fertig nach ~${i + 1}s, KPI=${kpi}`); break; }
}
await sleep(1500);
await shot("all");

// Karten-Diagnose im ALL-View
console.log("ALL-view diag:", await evalJs(`(()=>{
  const sel=document.querySelector('select');
  const opts=sel?sel.options.length:0;
  return JSON.stringify({routeOptions:opts});
})()`));

// Eine echte Linie wählen (641)
console.log("select 641:", await evalJs(`(()=>{
  const sel=document.querySelector('select'); if(!sel)return 'no sel';
  const opt=[...sel.options].find(o=>/(^|\\D)641( |—|$)/.test(o.textContent))||sel.options[3];
  const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
  setter.call(sel,opt.value); sel.dispatchEvent(new Event('change',{bubbles:true}));
  return opt.textContent.slice(0,50);
})()`));
await sleep(2500);
await shot("route641");

// Diagnose: wie viele Marker-Halte hat die gewählte Route wirklich?
console.log("route diag:", await evalJs(`(()=>{
  const canvas=document.querySelector('.leaflet-container canvas');
  return JSON.stringify({hasCanvas:!!canvas});
})()`));

ws.close();
process.exit(0);
