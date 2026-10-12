// Ejecuta el JavaScript REAL de public/admin.html (con un DOM mínimo de pega) contra un servidor real con un chat y un reporte.
import { spawn } from "node:child_process";
import fs from "node:fs";
import WebSocket from "ws";
const PORT = 8094, BASE = `http://localhost:${PORT}`, KEY = "clave-test";
const TERMS = fs.readFileSync("src/protocol.ts", "utf8").match(/TERMS_VERSION = "([^"]+)"/)[1];
let fails = 0; const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn("npx", ["tsx", "src/server.ts"], { env: { ...process.env, PORT: String(PORT), ADMIN_KEY: KEY }, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 60 && !log.includes("escuchando"); i++) await sleep(250);
const finish = () => { console.log(fails === 0 ? "\nADMIN-PANEL OK" : `\n${fails} FALLO(S)`); try { process.kill(-server.pid); } catch {} setTimeout(() => process.exit(fails ? 1 : 0), 200); };
const client = () => new Promise((res) => { const ws = new WebSocket(`ws://localhost:${PORT}`); const c = { ws, inbox: [], send: (m) => ws.send(JSON.stringify(m)) }; ws.on("message", (d) => c.inbox.push(JSON.parse(d.toString()))); ws.on("open", () => res(c)); });
try {
  // datos: sala con dos jugadores, chat y un reporte
  const a = await client(); a.send({ type: "create_room", playerName: "Ana", acceptedTerms: TERMS }); await sleep(250);
  const code = a.inbox.find((m) => m.type === "room_created").roomCode;
  const b = await client(); b.send({ type: "join_room", roomCode: code, playerName: "Beto", acceptedTerms: TERMS }); await sleep(250);
  b.send({ type: "send_chat", text: "mensaje <b>feo</b> de prueba" }); await sleep(250);
  const msg = a.inbox.find((m) => m.type === "chat_message").message;
  a.send({ type: "report_message", reportedPlayerId: msg.playerId, messageSentAt: msg.sentAt, reason: "insultos" }); await sleep(400);

  // DOM mínimo
  const html = fs.readFileSync("../michi3d/public/admin.html", "utf8");
  const ids = {}; for (const m of html.matchAll(/id="(\w+)"/g)) ids[m[1]] = true;
  const mk = (tag) => { const e = { tag, children: [], handlers: {}, _text: "", className: "", value: "", style: {}, type: "",
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); return c; }, addEventListener(n, f) { this.handlers[n] = f; }, scrollIntoView() {},
    set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); } };
    if (tag === "div") e.classList._s.add("hidden-init"); return e; };
  const byId = {}; for (const id of Object.keys(ids)) { byId[id] = mk("div"); }
  byId.chat.classList._s.add("hidden"); byId.server.value = BASE; byId.key.value = KEY;
  const store = { "michi3d-admin-key": KEY }; const calls = []; // la página recupera la clave guardada en la pestaña y arranca sola
  const realFetch = fetch;
  globalThis.document = { getElementById: (id) => byId[id], createElement: mk };
  globalThis.sessionStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) };
  globalThis.fetch = (u, o) => { calls.push((o?.method || "GET") + " " + u.replace(BASE, "")); return realFetch(u, o); };
  globalThis.prompt = () => "motivo"; globalThis.confirm = () => true;
  const script = html.match(/<script>(.*?)<\/script>/s)[1];
  new Function(script)();                                  // la página se arranca sola porque ya hay clave guardada en el campo
  await sleep(1200);

  const all = (e) => e.textContent;
  ok(calls.some((c) => c.startsWith("GET /admin/users")) && calls.some((c) => c.startsWith("GET /admin/chat/reports")) && calls.some((c) => c.startsWith("GET /admin/chat/rooms")), "al cargar pide cuentas, reportes y salas");
  ok(all(byId.rooms).includes("sala " + code) && all(byId.rooms).includes("1 mensajes") && all(byId.rooms).includes("con reportes"), "lista la sala con su número de mensajes y marca que tiene reportes");
  ok(all(byId.reports).includes("Beto") && all(byId.reports).includes("insultos") && all(byId.reports).includes("invitado") && all(byId.reports).includes("reportado por Ana"), "lista el reporte con quién, a quién, motivo y que son invitados");
  ok(all(byId.pending).includes("nada") && all(byId.banned).includes("nada"), "sin cuentas: las listas dicen nada");
  ok(byId.key.value === KEY && store["michi3d-admin-key"] === KEY, "recupera y guarda la clave solo en la pestaña (sessionStorage)");

  // abrir el chat de la sala desde la lista
  const roomCard = byId.rooms.children[0]; const viewBtn = roomCard.children[1];
  viewBtn.handlers.click(); await sleep(800);
  ok(all(byId.chatTitle).includes("chat de la sala " + code) && !byId.chat.classList.contains("hidden"), "ver chat abre el panel con el título");
  const lines = byId.chatLines.children;
  ok(lines.length === 1 && all(lines[0]).includes("Beto") && all(lines[0]).includes("mensaje <b>feo</b> de prueba") && all(lines[0]).includes("invitado"), "muestra el mensaje con su autor, y el HTML se ve como texto (no se ejecuta)");
  ok(calls.some((c) => c.startsWith("GET /admin/chat/room/")), "pidió el chat de esa sala");

  // borrar el chat
  byId.chatDelete.handlers.click(); await sleep(1200);
  ok(calls.some((c) => c.startsWith("DELETE /admin/chat/room/")) && byId.chat.classList.contains("hidden"), "borrar este chat llama a DELETE y cierra el panel");
  ok(all(byId.rooms).includes("nada") && all(byId.reports).includes("nada"), "tras borrar, salas y reportes quedan vacíos");

  // clave incorrecta
  byId.key.value = "mala"; byId.load.handlers.click(); await sleep(600);
  ok(all(byId.msg).includes("clave incorrecta"), "con clave incorrecta avisa");
  a.ws.close(); b.ws.close();
} catch (e) { console.log("EXCEPCIÓN", e); fails++; }
finish();
