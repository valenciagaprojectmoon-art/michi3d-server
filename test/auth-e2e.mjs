// Recorrido completo con Discord y Google FALSOS: login, aprobación, baneo con expulsión y suplantación de nombres.
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import WebSocket from "ws";
const PORT = 8095, MOCK = 9100, KEY = "clave-test", FRONT = "http://localhost:5173", BASE = `http://localhost:${PORT}`;
const TERMS = fs.readFileSync("src/protocol.ts", "utf8").match(/TERMS_VERSION = "([^"]+)"/)[1];
let fails = 0; const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- proveedores falsos ---
const jwt = (claims) => ["x", Buffer.from(JSON.stringify(claims)).toString("base64url"), "y"].join(".");
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const url = new URL(req.url, "http://x"); res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/oauth2/token") { const code = new URLSearchParams(body).get("code"); return code === "denied" ? (res.statusCode = 400, res.end("{}")) : res.end(JSON.stringify({ access_token: "tok-" + code })); }
    if (url.pathname === "/users/@me") { const n = (req.headers.authorization || "").replace("Bearer tok-", ""); return res.end(JSON.stringify({ id: "disc-" + n, username: "user_" + n, global_name: n })); }
    if (url.pathname === "/token") {
      const code = new URLSearchParams(body).get("code"); const exp = Math.floor(Date.now() / 1000) + 3600;
      return res.end(JSON.stringify({ id_token: jwt({ iss: "https://accounts.google.com", aud: code === "badaud" ? "OTRO" : "GID", sub: "goog-" + code, name: code, exp }) }));
    }
    res.statusCode = 404; res.end("{}");
  });
});
await new Promise((r) => mock.listen(MOCK, r));

// --- servidor real con esas variables ---
const server = spawn("npx", ["tsx", "src/server.ts"], { env: { ...process.env, PORT: String(PORT), ADMIN_KEY: KEY, SESSION_SECRET: "secreto-largo-de-prueba-123456", FRONTEND_URL: FRONT, PUBLIC_SERVER_URL: BASE,
  DISCORD_CLIENT_ID: "DID", DISCORD_CLIENT_SECRET: "ds", GOOGLE_CLIENT_ID: "GID", GOOGLE_CLIENT_SECRET: "gs", DISCORD_API_BASE: `http://localhost:${MOCK}`, GOOGLE_TOKEN_URL: `http://localhost:${MOCK}/token` }, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 60 && !log.includes("[auth] Cuentas"); i++) await sleep(250);
if (!log.includes("[auth] Cuentas") || log.includes("EADDRINUSE")) { console.log("FAIL el servidor de prueba no arrancó limpio (puerto ocupado?)\n" + log.slice(0, 400)); try { process.kill(-server.pid); } catch {} process.exit(1); }
const finish = () => { console.log(fails === 0 ? "\nAUTH-E2E OK" : `\n${fails} FALLO(S)`); try { process.kill(-server.pid); } catch {} mock.close(); setTimeout(() => process.exit(fails ? 1 : 0), 200); };

const get = (path, h = {}) => fetch(BASE + path, { redirect: "manual", headers: h });
const admin = (path, method = "GET") => fetch(BASE + path, { method, headers: { Authorization: `Bearer ${KEY}` } });
async function login(provider, code) {
  const start = await get(`/auth/${provider}/start`); const state = new URL(start.headers.get("location")).searchParams.get("state");
  const cb = await get(`/auth/${provider}/callback?code=${code}&state=${encodeURIComponent(state)}`);
  const loc = cb.headers.get("location") || ""; const m = loc.match(/#session=(.+)$/);
  return { location: loc, token: m ? m[1] : null, state, start };
}
function client() { return new Promise((res) => { const ws = new WebSocket(`ws://localhost:${PORT}`); const c = { ws, inbox: [], closed: null, send: (m) => ws.send(JSON.stringify(m)) };
  ws.on("message", (d) => c.inbox.push(JSON.parse(d.toString()))); ws.on("close", (code) => (c.closed = code)); ws.on("error", () => {}); ws.on("open", () => res(c)); }); }
const lastErr = (c) => [...c.inbox].reverse().find((m) => m.type === "error")?.message;
const create = async (token, name = "Ana") => { const c = await client(); c.send({ type: "create_room", playerName: name, acceptedTerms: TERMS, ...(token ? { sessionToken: token } : {}) }); await sleep(250); return c; };
const join = async (token, code, name) => { const c = await client(); c.send({ type: "join_room", roomCode: code, playerName: name, acceptedTerms: TERMS, ...(token ? { sessionToken: token } : {}) }); await sleep(250); return c; };

try {
  ok(log.includes("OBLIGATORIO") && log.includes("discord y google") && log.includes("pendientes de aprobación"), "el servidor arranca con sesión obligatoria, ambos proveedores y aprobación");
  const prov = await (await get("/auth/providers")).json();
  ok(prov.discord && prov.google && prov.required, "/auth/providers informa de lo configurado");

  const s = await get("/auth/discord/start"); const loc = new URL(s.headers.get("location"));
  ok(s.status === 302 && loc.hostname === "discord.com" && loc.searchParams.get("client_id") === "DID" && loc.searchParams.get("redirect_uri") === `${BASE}/auth/discord/callback`, "discord start: redirige a Discord con nuestro client_id y redirect_uri");

  const ana = await login("discord", "ana");
  ok(ana.location.startsWith(`${FRONT}/#session=`) && ana.token, "callback: vuelve al juego con la sesión en el fragmento (#session=)");
  ok((await (await get("/auth/me", { Authorization: `Bearer ${ana.token}` })).json()).status === "pending", "cuenta nueva: pendiente de aprobación");

  let c = await create(ana.token);
  ok(lastErr(c) === "tu cuenta está pendiente de aprobación." && !c.inbox.find((m) => m.type === "room_created"), "WS: cuenta pendiente no puede crear sala"); c.ws.close();
  c = await create(null);
  ok(lastErr(c) === "tienes que iniciar sesión para jugar online.", "WS: sin sesión no se puede jugar online"); c.ws.close();
  c = await create(ana.token.slice(0, -3) + "abc");
  ok(lastErr(c) === "tu sesión caducó, vuelve a iniciar sesión.", "WS: sesión alterada se rechaza"); c.ws.close();
  ok((await get("/auth/me", { Authorization: "Bearer basura" })).status === 401 && (await get("/auth/me")).status === 401, "/auth/me: sin sesión o con basura, 401");

  const bad = await get(`/auth/discord/callback?code=x&state=falso`);
  ok((bad.headers.get("location") || "").endsWith("#auth_error=state"), "callback con state falso: error");
  const dState = new URL((await get("/auth/discord/start")).headers.get("location")).searchParams.get("state");
  const cross = await get(`/auth/google/callback?code=x&state=${encodeURIComponent(dState)}`);
  ok((cross.headers.get("location") || "").endsWith("#auth_error=state"), "un state de Discord no vale en el callback de Google");
  ok((await get("/auth/discord/callback?error=access_denied")).headers.get("location").endsWith("#auth_error=cancelled"), "el usuario cancela en el proveedor: error cancelled");
  ok((await login("discord", "denied")).location.endsWith("#auth_error=provider"), "el proveedor rechaza el código: error provider");
  ok((await login("google", "badaud")).location.endsWith("#auth_error=provider"), "google con id_token para otra aplicación (aud): rechazado");

  ok((await admin("/admin/users")).status === 200 && (await fetch(BASE + "/admin/users")).status === 401, "admin/users exige la clave");
  const pending = await (await admin("/admin/users?status=pending")).json();
  ok(pending.length === 1 && pending[0].displayName === "ana" && pending[0].provider === "discord" && !("email" in pending[0]), "admin ve la cuenta pendiente (sin correo)");
  const anaId = pending[0].id;
  ok((await admin(`/admin/users/${anaId}/approve`)).status === 405, "aprobar exige POST");
  ok((await admin(`/admin/users/${anaId}/approve`, "POST")).status === 200, "admin aprueba la cuenta");

  const room = await create(ana.token, "Ana"); const created = room.inbox.find((m) => m.type === "room_created");
  ok(!!created, "cuenta aprobada: crea sala"); const code = created.roomCode;

  const beto = await login("google", "beto"); const bj = await (await get("/auth/me", { Authorization: `Bearer ${beto.token}` })).json();
  await admin(`/admin/users/${bj.id}/approve`, "POST");
  const betoWs = await join(beto.token, code, "Beto");
  ok(!!betoWs.inbox.find((m) => m.type === "room_joined"), "cuenta de Google aprobada: se une a la sala");
  betoWs.send({ type: "send_chat", text: "hola desde google" }); await sleep(300);
  const rooms = await (await admin("/admin/chat/rooms")).json();
  const msgs = await (await admin(`/admin/chat/room/${encodeURIComponent(rooms[0].roomId)}`)).json();
  ok(msgs.length === 1 && msgs[0].userId === bj.id, "el chat guarda la cuenta de quien escribió");

  // suplantación: Beto se va y otra cuenta intenta quedarse con su sitio escribiendo su nombre
  betoWs.ws.close(); await sleep(300);
  const carol = await login("discord", "carol"); const cj = await (await get("/auth/me", { Authorization: `Bearer ${carol.token}` })).json();
  await admin(`/admin/users/${cj.id}/approve`, "POST");
  const thief = await join(carol.token, code, "Beto");
  ok(lastErr(thief) === "ese nombre ya lo usa otra cuenta en la sala." && !thief.inbox.find((m) => m.type === "room_joined"), "otra cuenta no puede ocupar el sitio de Beto escribiendo su nombre"); thief.ws.close();
  const back = await join(beto.token, code, "Beto");
  ok(!!back.inbox.find((m) => m.type === "room_joined"), "Beto sí puede volver a su sitio con su cuenta");

  // baneo: expulsa al instante y no deja volver
  const banRes = await admin(`/admin/users/${bj.id}/ban?reason=insultos`, "POST");
  ok(banRes.status === 200 && (await banRes.json()).banReason === "insultos", "admin banea con motivo");
  await sleep(300);
  ok(back.closed === 1008 && lastErr(back) === "tu cuenta está baneada.", "el baneo expulsa al instante a la cuenta conectada (cierre 1008 con aviso)");
  ok((await (await get("/auth/me", { Authorization: `Bearer ${beto.token}` })).json()).status === "banned", "/auth/me indica baneada");
  c = await join(beto.token, code, "Beto");
  ok(lastErr(c) === "tu cuenta está baneada." && !c.inbox.find((m) => m.type === "room_joined"), "cuenta baneada no puede volver a entrar con la misma sesión"); c.ws.close();
  const again = await login("google", "beto");
  ok(again.token && (await (await get("/auth/me", { Authorization: `Bearer ${again.token}` })).json()).status === "banned", "volver a iniciar sesión con Google no la desbanea");
  ok(!!room.inbox.length && room.ws.readyState === WebSocket.OPEN, "los demás jugadores de la sala siguen conectados");
  ok((await admin(`/admin/users/${bj.id}/unban`, "POST")).status === 200, "admin desbanea");
  c = await join(beto.token, code, "Beto");
  ok(!!c.inbox.find((m) => m.type === "room_joined"), "tras desbanear vuelve a entrar con la misma sesión"); c.ws.close();
  ok((await admin(`/admin/users/00000000-0000-0000-0000-000000000000/ban`, "POST")).status === 404, "banear una cuenta que no existe: 404");

  // CORS
  const pre = await fetch(BASE + "/auth/me", { method: "OPTIONS", headers: { Origin: FRONT } });
  ok(pre.status === 204 && pre.headers.get("access-control-allow-origin") === FRONT, "CORS: el origen del juego está permitido");
  const evil = await fetch(BASE + "/auth/providers", { headers: { Origin: "https://evil.example" } });
  ok(!evil.headers.get("access-control-allow-origin"), "CORS: otros orígenes no reciben permiso");
  const preAdmin = await fetch(BASE + "/admin/users", { method: "OPTIONS", headers: { Origin: FRONT } });
  ok(preAdmin.status === 204 && preAdmin.headers.get("access-control-allow-headers")?.includes("Authorization"), "CORS: el panel de cuentas puede llamar con la clave");
  room.ws.close();
} catch (e) { console.log("EXCEPCIÓN", e); fails++; }
finish();
