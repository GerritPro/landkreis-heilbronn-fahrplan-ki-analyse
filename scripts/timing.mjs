// Navigiert, erfasst Worker-Console (Auto-Attach) und pollt bis die Analyse
// gerendert ist. node scripts/timing.mjs <url> [maxMs]
const [, , url, maxStr] = process.argv;
const maxMs = parseInt(maxStr || "60000", 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch("http://127.0.0.1:9222/json");
const page = (await res.json()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) =>
  new Promise((r) => {
    const m = ++id;
    pending.set(m, r);
    ws.send(JSON.stringify({ id: m, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled") {
    const args = (m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (args.includes("[worker]") || args.includes("[engine]")) console.log("  ▸", args);
  }
  if (m.method === "Target.attachedToTarget") {
    const sid = m.params.sessionId;
    send("Runtime.enable", {}, sid);
  }
});
await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Runtime.enable");
await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

const t0 = Date.now();
await send("Page.navigate", { url });
let done = false;
while (Date.now() - t0 < maxMs) {
  await sleep(500);
  const r = await send("Runtime.evaluate", {
    expression: `(() => { const e=document.querySelectorAll('.tabular-nums'); return e.length?e[0].textContent:''; })()`,
    returnByValue: true,
  });
  if (r?.result?.value && /\d/.test(r.result.value)) {
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] FERTIG — KPI = ${r.result.value}`);
    done = true;
    break;
  }
}
if (!done) console.log("TIMEOUT");
ws.close();
process.exit(0);
