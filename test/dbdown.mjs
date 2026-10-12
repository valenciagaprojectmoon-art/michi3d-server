// Con la base de datos caída el servidor NO debe caerse: los invitados siguen jugando y las rutas que la necesitan dan 500.
import { spawn } from "node:child_process";
import fs from "node:fs";
import WebSocket from "ws";
const PORT = 8093, SECRET = "secreto-largo-de-prueba-123456";
const TERMS = fs.readFileSync("src/protocol.ts", "utf8").match(/TERMS_VERSION = "([^"]+)"/)[1];
let fails = 0; const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { signToken } = await import("../src/auth.ts");
const token = signToken({ t: "s", uid: "cuenta-1", exp: Date.now() + 1e9 }, SECRET);
const server = spawn("npx", ["tsx", "src/server.ts"], { detached: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(PORT), ADMIN_KEY: "k", SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", AUTH_REQUIRED: "false", FRONTEND_URL: "http://localhost:5173", DATABASE_URL: "postgres://u:p@127.0.0.1:1/db", PGSSLMODE: "disable" } });
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 40 && !log.includes("escuchando"); i++) await sleep(250);
const base = `http://localhost:${PORT}`;
const alive = async () => { try { return (await fetch(base + "/health")).status === 200; } catch { return false; } };
try {
  ok(await alive(), "arranca aunque la base de datos esté caída");
  const me = await fetch(base + "/auth/me", { headers: { Authorization: "Bearer " + token } });
  ok(me.status === 500, "/auth/me con la base caída responde 500 (antes tumbaba el servidor)");
  ok(await alive(), "el servidor sigue vivo tras esa consulta");
  ok((await fetch(base + "/auth/providers")).status === 200, "/auth/providers no necesita la base y sigue respondiendo");
  const adm = await fetch(base + "/admin/users", { headers: { Authorization: "Bearer k" } });
  ok(adm.status === 500 && (await alive()), "el panel de cuentas con la base caída da 500 y el servidor sigue vivo");
  // un invitado sigue pudiendo jugar y escribir en el chat
  const ws = new WebSocket(`ws://localhost:${PORT}`); const inbox = []; ws.on("message", (d) => inbox.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "create_room", playerName: "Ana", acceptedTerms: TERMS })); await sleep(400);
  ok(!!inbox.find((m) => m.type === "room_created"), "un invitado crea sala aunque la base esté caída");
  ws.send(JSON.stringify({ type: "send_chat", text: "hola" })); await sleep(500);
  ok(!!inbox.find((m) => m.type === "chat_message") && (await alive()), "el chat sigue funcionando (solo falla el guardado, que se registra y se ignora)");
  const withToken = new WebSocket(`ws://localhost:${PORT}`); const inbox2 = []; withToken.on("message", (d) => inbox2.push(JSON.parse(d.toString())));
  await new Promise((r) => withToken.on("open", r));
  withToken.send(JSON.stringify({ type: "create_room", playerName: "Beto", acceptedTerms: TERMS, sessionToken: token })); await sleep(500);
  ok(!!inbox2.find((m) => m.type === "error") && (await alive()), "con sesión y la base caída: aviso de error en vez de caerse");
  ws.close(); withToken.close();
} catch (e) { console.log("EXCEPCIÓN", e); fails++; }
try { process.kill(-server.pid); } catch {}
console.log(fails === 0 ? "\nDBDOWN OK" : `\n${fails} FALLO(S)`); process.exit(fails ? 1 : 0);
