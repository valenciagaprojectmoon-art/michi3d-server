import WebSocket from "ws";
const PORT = 8098, KEY = "clave-test";
let fails = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Cada prueba usa su propia "IP" vía X-Forwarded-For (el servidor confía en 1 salto: la última).
function client(ip) {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`, { headers: { "x-forwarded-for": ip } });
    const c = { ws, inbox: [], closed: null, send: (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m)) };
    ws.on("message", (d) => c.inbox.push(JSON.parse(d.toString())));
    ws.on("close", (code, reason) => { c.closed = { code, reason: reason.toString() }; });
    ws.on("error", () => {});
    ws.on("open", () => res(c));
    ws.on("unexpected-response", () => res(c));
  });
}
const T = "2026-10-02";
const errors = (c) => c.inbox.filter((m) => m.type === "error").map((m) => m.message);

// 1) Mensaje demasiado grande
{ const c = await client("10.0.0.1");
  c.send(JSON.stringify({ type: "send_chat", text: "x".repeat(5000) }));
  await sleep(300);
  ok(c.closed?.code === 1009, "mensaje de 5 KB (>2 KB) cierra la conexión con 1009");
}
// 2) Conexiones simultáneas por IP (máx 3)
{ const cs = [];
  for (let i = 0; i < 3; i++) cs.push(await client("10.0.0.2"));
  const fourth = await client("10.0.0.2");
  await sleep(300);
  ok(fourth.closed?.code === 1013 && fourth.closed.reason.includes("too_many"), "la 4ª conexión simultánea de la misma IP se rechaza (1013)");
  const other = await client("10.0.0.3");
  await sleep(150);
  ok(other.closed === null, "otra IP no se ve afectada");
  cs[0].ws.close(); await sleep(200);
  const again = await client("10.0.0.2");
  await sleep(200);
  ok(again.closed === null, "al cerrar una conexión se libera cupo");
  [...cs, other, again].forEach((c) => c.ws.close());
}
// 3) Chat rápido (ráfaga 2)
{ const c = await client("10.0.0.4");
  c.send({ type: "create_room", playerName: "A", acceptedTerms: T });
  await sleep(200);
  for (let i = 0; i < 4; i++) c.send({ type: "send_chat", text: "m" + i });
  await sleep(300);
  const delivered = c.inbox.filter((m) => m.type === "chat_message").length;
  ok(delivered === 2 && errors(c).some((e) => e.includes("escribiendo demasiado rápido")), "chat: 2 mensajes pasan y el resto se frena con aviso");
  c.ws.close();
}
// 4) Crear salas demasiado rápido (ráfaga 2)
{ const c = await client("10.0.0.5");
  for (let i = 0; i < 3; i++) { c.send({ type: "create_room", playerName: "B" + i, acceptedTerms: T }); await sleep(120); }
  ok(c.inbox.filter((m) => m.type === "room_created").length === 2 && errors(c).some((e) => e.includes("creando salas")), "crear salas: 2 pasan, la 3ª se frena");
  c.ws.close();
}
// 5) Fuerza bruta de códigos de sala (ráfaga 3 fallos)
{ const c = await client("10.0.0.6");
  for (let i = 0; i < 6; i++) { c.send({ type: "join_room", roomCode: "ZZ" + String.fromCharCode(65 + i) + "Q", playerName: "Z", acceptedTerms: T }); await sleep(120); }
  const errs = errors(c);
  ok(errs.filter((e) => e.includes("inválidos")).length >= 2, "fuerza bruta de códigos: tras 3 fallos se bloquean los intentos");
  c.ws.close();
}
// 6) Inundación -> cierre y baneo temporal (ráfaga 5, 10 faltas, ban 3 s)
{ const c = await client("10.0.0.7");
  for (let i = 0; i < 60; i++) c.send("basura-" + i);
  await sleep(400);
  const notices = errors(c).filter((e) => e.includes("demasiado rápido")).length;
  ok(c.closed?.code === 1008 && c.closed.reason.includes("flood"), "inundación: la conexión se cierra con 1008");
  ok(notices <= 2, `inundación: los avisos no se amplifican (${notices} aviso/s para 60 mensajes)`);
  const retry = await client("10.0.0.7");
  await sleep(300);
  ok(retry.closed?.code === 1008 && retry.closed.reason.includes("banned"), "reconexión inmediata: IP baneada (1008)");
  const other = await client("10.0.0.8");
  await sleep(200);
  ok(other.closed === null, "otra IP sigue pudiendo conectar durante el baneo");
  other.ws.close();
  await sleep(3200);
  const later = await client("10.0.0.7");
  await sleep(200);
  ok(later.closed === null, "el baneo expira y la IP puede volver a conectar");
  later.ws.close();
}
// 7) Cabecera falsificada: lo que escribe el cliente a la izquierda no cuenta
{ const a = await client("6.6.6.6, 10.0.0.9");  // IP real (la última) = 10.0.0.9
  for (let i = 0; i < 60; i++) a.send("x");
  await sleep(400);
  const b = await client("7.7.7.7, 10.0.0.9");   // distinto prefijo falso, misma IP real -> sigue baneada
  await sleep(300);
  ok(b.closed?.reason.includes("banned"), "falsificar el principio de X-Forwarded-For no evita el baneo");
}
// 8) Admin: fuerza bruta de la clave (ráfaga 3)
{ const hit = (key) => fetch(`http://localhost:${PORT}/admin/chat/rooms`, { headers: { "x-forwarded-for": "10.0.0.20", Authorization: `Bearer ${key}` } });
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await hit("mala" + i)).status);
  ok(codes.slice(0, 3).every((c) => c === 401) && codes[3] === 429, `admin: 3 fallos -> 401 y el 4º -> 429 (${codes.join(",")})`);
  ok((await hit(KEY)).status === 429, "admin: bloqueado también con la clave correcta mientras dura el castigo");
  const fresh = await fetch(`http://localhost:${PORT}/admin/chat/rooms`, { headers: { "x-forwarded-for": "10.0.0.21", Authorization: `Bearer ${KEY}` } });
  ok(fresh.status === 200, "admin: otra IP con la clave correcta entra normal");
}
console.log(fails === 0 ? "\nFLOOD OK" : `\n${fails} FALLO(S)`);
process.exit(fails ? 1 : 0);
