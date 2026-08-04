// Lädt hnv, wählt Linie "2", Screenshot "Beide" + "Hinfahrt".
// node scripts/route-clarity.mjs <zipPath> <outPrefix>
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
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true }))?.result?.value;
const shot = async (n) => { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${prefix}-${n}.png`, Buffer.from(s.data, "base64")); console.log("shot:", n); };

await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Fahrplan-ZIP laden|Fahrpläne/.test(x.textContent));b&&b.click();})()`);
await sleep(1200);
const doc = await send("DOM.getDocument", { depth: -1 });
const q = await send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
await send("DOM.setFileInputFiles", { nodeId: q.nodeIds[0], files: [zipPath] });
for (let i = 0; i < 50; i++) { await sleep(1000); const k = await evalJs(`(()=>{const e=document.querySelectorAll('.tabular-nums');return e.length?e[0].textContent:'';})()`); if (k && /\d/.test(k)) { console.log("geladen", k); break; } }
await sleep(1500);

// Linie "2" wählen (exakt Liniennummer 2, nicht 20/200…)
console.log("select 2:", await evalJs(`(()=>{const s=document.querySelector('select');const o=[...s.options].find(o=>/^2\\s+—/.test(o.textContent.trim()))||[...s.options].find(o=>/(^|\\D)2( |—)/.test(o.textContent));const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));return o.textContent.slice(0,30);})()`));
await sleep(2500);
await shot("both");

// Hinfahrt-Button klicken (erster Richtungs-Button, beginnt mit "→")
console.log("hin:", await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim().startsWith('→'));if(b[0]){b[0].click();return b[0].textContent.trim().slice(0,30);}return 'no dir btn';})()`));
await sleep(2000);
await shot("hin");
ws.close();
process.exit(0);
