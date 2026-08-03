// Führt beliebiges JS aus, wartet, Screenshot. node scripts/eval-shot.mjs <outPng> <jsFile|-> <waitMs>
import fs from "node:fs";
const [, , out, jsArg, waitStr] = process.argv;
const waitMs = parseInt(waitStr || "2500", 10);
const js = jsArg && jsArg !== "-" && fs.existsSync(jsArg) ? fs.readFileSync(jsArg, "utf8") : jsArg;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = all.find((t) => t.type === "page" && (t.url || "").includes("localhost:3000")) || all.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
const r = await send("Runtime.evaluate", { expression: js, returnByValue: true });
console.log("eval:", JSON.stringify(r?.result?.value));
await sleep(waitMs);
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("Screenshot:", out);
ws.close();
process.exit(0);
