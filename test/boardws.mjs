import WebSocket from "ws";
let fails = 0; const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function create(boardConfig, ip) {
  const ws = new WebSocket("ws://localhost:8096", { headers: { "x-forwarded-for": ip } });
  const inbox = []; ws.on("message", (d) => inbox.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "create_room", playerName: "A", acceptedTerms: "2026-10-09", ...(boardConfig ? { boardConfig } : {}) }));
  await sleep(300); ws.close();
  const m = inbox.find((x) => x.type === "room_created");
  return m?.state?.game;
}
const d = await create(undefined, "10.9.0.1");
ok(d?.boardConfig.size === 3 && d.boardConfig.lineLength === 3 && d.board.length === 27, "sin configuración: 3x3x3, línea 3, 27 casillas");
const a = await create({ size: 4, lineLength: 3 }, "10.9.0.2");
ok(a?.boardConfig.size === 4 && a.boardConfig.lineLength === 3 && a.board.length === 64, "cubo 4, línea 3: 64 casillas llegan al cliente");
const b = await create({ size: 99, lineLength: 99 }, "10.9.0.3");
ok(b?.boardConfig.size === 6 && b.boardConfig.lineLength === 6 && b.board.length === 216, "cubo 99 se limita a 6 (216 casillas)");
const c = await create({ size: 1, lineLength: 1 }, "10.9.0.4");
ok(c?.boardConfig.size === 2 && c.boardConfig.lineLength === 2 && c.board.length === 8, "cubo 1 sube al mínimo 2");
const e = await create({ size: "x", lineLength: null }, "10.9.0.5");
ok(e?.boardConfig.size === 3 && e.boardConfig.lineLength === 3, "valores basura caen al 3 por defecto");
console.log(fails === 0 ? "\nBOARD-WS OK" : `\n${fails} FALLO(S)`); process.exit(fails ? 1 : 0);
