import WebSocket from "ws";
import net from "node:net";
const PORT = 8097, BASE = `http://localhost:${PORT}`, KEY = "clave-test";
let fails = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (path, headers = {}, method = "GET", ip = "10.1.0.1") =>
  fetch(BASE + path, { method, headers: { "x-forwarded-for": ip, ...headers } });
const HTML = { Accept: "text/html,application/xhtml+xml" };

// ---------- Páginas de error HTTP ----------
{ const r = await get("/no-existe", { ...HTML, "Accept-Language": "en-US,en;q=0.9" });
  const body = await r.text();
  ok(r.status === 404 && r.headers.get("content-type").includes("text/html") && body.includes("page not found") && body.includes('lang="en"'), "404 navegador con Accept-Language en → página HTML en inglés");
  const r2 = await get("/no-existe", { ...HTML, "Accept-Language": "es-PE,es;q=0.9" });
  ok(r2.status === 404 && (await r2.text()).includes("página no encontrada"), "404 navegador en español → página en español");
  const r3 = await get("/no-existe?lang=en", { ...HTML, "Accept-Language": "es" });
  ok((await r3.text()).includes("page not found"), "404: ?lang=en manda sobre Accept-Language");
  const r4 = await get("/no-existe");
  const j = await r4.json();
  ok(r4.status === 404 && r4.headers.get("content-type").includes("application/json") && j.status === 404, "404 sin Accept text/html (curl) → JSON");
}
{ const r = await get("/", {}, "POST");
  ok(r.status === 405 && r.headers.get("allow") === "GET, HEAD", "POST / → 405 con cabecera Allow");
  const h = await get("/no-existe", {}, "HEAD");
  ok(h.status === 404 && (await h.text()) === "", "HEAD → 404 sin cuerpo");
  const ok200 = await get("/health");
  ok(ok200.status === 200 && (await ok200.text()) === "Michi 3D server", "/health y / siguen devolviendo 200 (health check)");
  const root = await get("/");
  ok(root.status === 200, "/ devuelve 200");
}
{ const r = await get("/admin/chat/rooms", { ...HTML, "Accept-Language": "en" }, "GET", "10.1.0.2");
  ok(r.status === 401 && r.headers.get("www-authenticate")?.startsWith("Bearer") && (await r.text()).includes("unauthorized"), "401 admin para navegador: página en inglés + WWW-Authenticate");
  const r2 = await get("/admin/chat/rooms", { Authorization: `Bearer ${KEY}` }, "GET", "10.1.0.3");
  ok(r2.status === 200, "admin con clave correcta sigue funcionando");
  const r3 = await get("/admin/otra-cosa", { Authorization: `Bearer ${KEY}` }, "GET", "10.1.0.3");
  ok(r3.status === 404, "ruta de admin desconocida → 404");
}
{ let last; for (let i = 0; i < 16; i++) last = await get("/x", { ...HTML, "Accept-Language": "en" }, "GET", "10.1.0.4");
  const body = await last.text();
  ok(last.status === 429 && last.headers.get("retry-after") === "30" && body.includes("too many requests"), "429 al superar el ritmo HTTP: página + Retry-After");
}
const raw = (data, ms = 600) => new Promise((res) => {
  const s = net.connect(PORT, "localhost", () => s.write(data));
  let out = ""; s.on("data", (d) => (out += d)); s.on("close", () => res(out)); s.on("error", () => res(out)); setTimeout(() => { s.destroy(); res(out); }, ms);
});
{ const out = await raw("ESTO NO ES HTTP\r\n\r\n");
  ok(out.startsWith("HTTP/1.1 400") && out.includes("petición incorrecta") && out.includes("bad request"), "basura que no es HTTP → 400 bilingüe (clientError)");
  const big = await raw("GET / HTTP/1.1\r\nHost: x\r\nX-Big: " + "a".repeat(40000) + "\r\n\r\n");
  ok(big.startsWith("HTTP/1.1 431") && big.includes("request header fields too large"), "cabeceras gigantes → 431 bilingüe");
}

// ---------- Idioma de los mensajes por WebSocket ----------
function client(ip) {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`, { headers: { "x-forwarded-for": ip } });
    const c = { ws, inbox: [], send: (m) => ws.send(JSON.stringify(m)) };
    ws.on("message", (d) => c.inbox.push(JSON.parse(d.toString())));
    ws.on("open", () => res(c));
  });
}
const lastError = (c) => [...c.inbox].reverse().find((m) => m.type === "error")?.message;
{ const en = await client("10.2.0.1");
  en.send({ type: "create_room", playerName: "A", lang: "en" });          // sin términos → error en inglés
  await sleep(150);
  ok(lastError(en) === "you need to accept the terms and the privacy policy to play online.", "WS: error de términos en inglés si lang=en");
  const es = await client("10.2.0.2");
  es.send({ type: "create_room", playerName: "A", lang: "es" });
  await sleep(150);
  ok(lastError(es).startsWith("tienes que aceptar los términos"), "WS: error en español si lang=es");
  const def = await client("10.2.0.3");
  def.send({ type: "join_room", roomCode: "ZZZZ", playerName: "A", acceptedTerms: "2026-10-02" });
  await sleep(150);
  ok(lastError(def) === 'no existe ninguna sala con el código "ZZZZ".', "WS: sin lang el servidor responde en español (por defecto)");
  const en2 = await client("10.2.0.4");
  en2.send({ type: "join_room", roomCode: "ZZZZ", playerName: "A", acceptedTerms: "2026-10-02", lang: "en" });
  await sleep(150);
  ok(lastError(en2) === 'there is no room with the code "ZZZZ".', "WS: error con código de sala traducido al inglés");
  const sw = await client("10.2.0.5");
  sw.send({ type: "send_chat", text: "hola" });
  await sleep(150);
  ok(lastError(sw) === "no estás en ninguna sala.", "WS: por defecto español…");
  sw.send({ type: "set_language", lang: "en" });
  sw.send({ type: "send_chat", text: "hola" });
  await sleep(150);
  ok(lastError(sw) === "you're not in any room.", "WS: set_language cambia el idioma en mitad de la sesión");
  sw.send({ type: "set_language", lang: "fr" });                              // inválido: se ignora
  sw.send({ type: "send_chat", text: "hola" });
  await sleep(150);
  ok(lastError(sw) === "you're not in any room.", "WS: idioma inválido se ignora y se conserva el anterior");
  [en, es, def, en2, sw].forEach((c) => c.ws.close());
}
console.log(fails === 0 ? "\nERRORS+LANG OK" : `\n${fails} FALLO(S)`);
process.exit(fails ? 1 : 0);
