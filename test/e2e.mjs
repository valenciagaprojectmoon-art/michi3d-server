import WebSocket from "ws";
const PORT = 8099, URLWS = `ws://localhost:${PORT}`, KEY = "clave-test";
let fails = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  return new Promise((res) => {
    const ws = new WebSocket(URLWS); const inbox = [];
    ws.on("message", (d) => inbox.push(JSON.parse(d.toString())));
    ws.on("open", () => res({ ws, inbox, send: (m) => ws.send(JSON.stringify(m)) }));
  });
}
const find = (c, t) => c.inbox.find((m) => m.type === t);
const admin = (path, method = "GET", key = KEY) =>
  fetch(`http://localhost:${PORT}${path}`, { method, headers: key ? { Authorization: `Bearer ${key}` } : {} });

// consentimiento
const a = await client();
a.send({ type: "create_room", playerName: "Ana" });                       // sin acceptedTerms
await sleep(150);
ok(find(a, "error")?.message.includes("Términos"), "crear sala sin aceptar términos se rechaza");
a.inbox.length = 0;
a.send({ type: "create_room", playerName: "Ana", acceptedTerms: "1999-01-01" });
await sleep(150);
ok(!!find(a, "error") && !find(a, "room_created"), "versión de términos incorrecta se rechaza");
a.inbox.length = 0;
a.send({ type: "create_room", playerName: "Ana", acceptedTerms: "2026-10-02" });
await sleep(150);
const created = find(a, "room_created");
ok(!!created, "crear sala con términos aceptados funciona");
const code = created.roomCode;

const b = await client();
b.send({ type: "join_room", roomCode: code, playerName: "Beto" });
await sleep(150);
ok(!!find(b, "error") && !find(b, "room_joined"), "unirse sin aceptar términos se rechaza");
b.inbox.length = 0;
b.send({ type: "join_room", roomCode: code, playerName: "Beto", acceptedTerms: "2026-10-02" });
await sleep(150);
const bId = find(b, "room_joined")?.playerId;
ok(bId !== undefined, "unirse con términos aceptados funciona");

// chat registrado
a.send({ type: "send_chat", text: "hola Beto" });
b.send({ type: "send_chat", text: "mensaje ofensivo de prueba" });
await sleep(250);
const msgB = b.inbox.find((m) => m.type === "chat_message" && m.message.playerName === "Beto");
ok(!!msgB, "el chat sigue llegando a la sala");

// admin: auth
ok((await admin("/admin/chat/rooms", "GET", null)).status === 401, "admin sin clave: 401");
ok((await admin("/admin/chat/rooms", "GET", "mala")).status === 401, "admin con clave mala: 401");
ok((await fetch(`http://localhost:${PORT}/`)).status === 200, "health check en / responde 200");
const rooms = await (await admin("/admin/chat/rooms")).json();
ok(rooms.length === 1 && rooms[0].messages === 2 && rooms[0].held === false, "admin lista la sala con 2 mensajes, sin retención");
const roomId = rooms[0].roomId;
const msgs = await (await admin(`/admin/chat/room/${encodeURIComponent(roomId)}`)).json();
ok(msgs.length === 2 && msgs[0].termsVersion === "2026-10-02", "mensajes guardados con versión de términos");
const txt = await (await admin(`/admin/chat/room/${encodeURIComponent(roomId)}?format=txt`)).text();
ok(txt.includes("Ana (#0): hola Beto"), "exportación en texto");

// reportes
a.inbox.length = 0;
a.send({ type: "report_message", reportedPlayerId: msgB.message.playerId, messageSentAt: msgB.message.sentAt, reason: "insultos" });
await sleep(250);
ok(!!find(a, "report_received"), "el reportante recibe confirmación");
a.inbox.length = 0;
a.send({ type: "report_message", reportedPlayerId: msgB.message.playerId, messageSentAt: msgB.message.sentAt });
await sleep(150);
ok(find(a, "error")?.message.includes("Ya reportaste"), "no se puede reportar dos veces");
a.inbox.length = 0;
const own = a.inbox; 
b.inbox.length = 0;
b.send({ type: "report_message", reportedPlayerId: bId, messageSentAt: msgB.message.sentAt });
await sleep(150);
ok(find(b, "error")?.message.includes("propios"), "no se pueden reportar mensajes propios");
const reports = await (await admin("/admin/chat/reports")).json();
ok(reports.length === 1 && reports[0].reason === "insultos" && reports[0].reportedPlayerName === "Beto", "reporte guardado con motivo y autor");
const rooms2 = await (await admin("/admin/chat/rooms")).json();
ok(rooms2[0].held === true, "tras el reporte el chat de la sala queda retenido");

// borrado
const del = await (await admin(`/admin/chat/room/${encodeURIComponent(roomId)}`, "DELETE")).json();
ok(del.messages === 2 && del.reports === 1, "DELETE borra mensajes y reportes de la sala");
ok((await (await admin("/admin/chat/rooms")).json()).length === 0, "ya no queda nada de esa sala");

console.log(fails === 0 ? "\nE2E OK" : `\n${fails} FALLO(S)`);
a.ws.close(); b.ws.close();
process.exit(fails ? 1 : 0);
