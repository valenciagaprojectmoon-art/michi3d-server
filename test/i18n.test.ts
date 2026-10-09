// Comprueba que NINGÚN texto se quede sin traducir (servidor y frontend) y que los {parámetros} cuadren.
import fs from "node:fs";
import path from "node:path";
import { SERVER_EN, SERVER_DE, translateServer } from "../src/servertext.js";
import { pickLang, renderErrorPage, errorText } from "../src/errorpages.js";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const unescape = (s: string) => JSON.parse(`"${s.replace(/"/g, '\\"').replace(/\\\\"/g, '\\"')}"`);

// ---------- Servidor ----------
const serverFiles = ["rooms.ts", "server.ts"].map((f) => path.join("src", f));
const messages = new Set<string>();
for (const f of serverFiles) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:error|message): "((?:[^"\\]|\\.)*)"/g)) messages.add(unescape(m[1]));
  for (const m of src.matchAll(/(?:error|message): `((?:[^`\\]|\\.)*)`/g)) messages.add(unescape(m[1]).replace(/\$\{[^}]*\}/g, "X"));
  // Además: CUALQUIER frase entre comillas que termine en . ? ! (p. ej. `return "No es tu turno."`),
  // salvo líneas de log (console.*) y comentarios, que no llegan al jugador.
  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || line.includes("console.")) continue;
    for (const m of line.matchAll(/"((?:[^"\\]|\\.)*[.!?])"/g)) if (/[A-Za-zÁ-ú¿¡]+ [A-Za-zÁ-ú]+/.test(m[1])) messages.add(unescape(m[1]));
  }
}
const userFacing = [...messages].filter((m) => /[a-záéíóúñ]+ [a-záéíóúñ]+/i.test(m));
ok(userFacing.length >= 40, `servidor: se detectaron ${userFacing.length} mensajes de usuario en el código`);
const missingServer = userFacing.filter((m) => translateServer("en", m) === m.toLowerCase());
ok(missingServer.length === 0, "servidor: todos los mensajes tienen traducción al inglés" + (missingServer.length ? "\n      SIN TRADUCIR: " + missingServer.join("\n      SIN TRADUCIR: ") : ""));
const missingDe = userFacing.filter((m) => translateServer("de", m) === m.toLowerCase());
ok(missingDe.length === 0, "servidor: todos los mensajes tienen traducción al alemán" + (missingDe.length ? "\n      SIN TRADUCIR (de): " + missingDe.join("\n      SIN TRADUCIR (de): ") : ""));
const orphanDe = Object.keys(SERVER_DE).filter((k) => !userFacing.includes(k));
ok(orphanDe.length === 0, "servidor: no hay traducciones al alemán huérfanas" + (orphanDe.length ? "\n      HUÉRFANAS (de): " + orphanDe.join(" | ") : ""));
const orphanServer = Object.keys(SERVER_EN).filter((k) => !userFacing.includes(k));
ok(orphanServer.length === 0, "servidor: no hay traducciones huérfanas (sin mensaje en el código)" + (orphanServer.length ? "\n      HUÉRFANAS: " + orphanServer.join(" | ") : ""));
ok(translateServer("es", "No es tu turno.") === "no es tu turno.", "servidor: en español se muestra en minúsculas");
ok(translateServer("de", 'No existe ninguna sala con el código "AB12".') === 'es gibt keinen raum mit dem code "AB12".', "servidor: mensaje con código de sala en alemán");
ok(translateServer("en", 'No existe ninguna sala con el código "AB12".') === 'there is no room with the code "AB12".', "servidor: mensaje con código de sala se traduce");
ok(translateServer("en", "Texto desconocido que no existe") === "texto desconocido que no existe", "servidor: sin traducción cae al español");

// ---------- Páginas de error ----------
for (const status of [400, 401, 403, 404, 405, 408, 413, 414, 429, 431, 500]) {
  const es = errorText(status, "es"), en = errorText(status, "en");
  const html = renderErrorPage(status, "en", "https://juego.example");
  ok(es.title !== en.title && html.includes(String(status)) && html.includes(en.title) && html.includes("https://juego.example"), `página ${status}: ES/EN distintos y HTML correcto`);
}
ok(pickLang("en-US,en;q=0.9,es;q=0.8") === "en" && pickLang("es-PE,es;q=0.9") === "es" && pickLang(undefined) === "es" && pickLang("fr-FR") === "es", "pickLang: Accept-Language");
ok(pickLang("de-DE,de;q=0.9,en;q=0.5") === "de" && pickLang("es", "de") === "de", "pickLang: alemán");
ok(pickLang("es", "en") === "en" && pickLang("en", "xx") === "en", "pickLang: ?lang= manda sobre la cabecera y se ignora si es inválido");
ok(!renderErrorPage(404, "es", '"><script>alert(1)</script>').includes("<script>alert(1)"), "página de error: la URL del juego se escapa (sin inyección HTML)");

// ---------- Frontend ----------
const frontSrc = path.join("..", "michi3d", "src");
if (fs.existsSync(frontSrc)) {
  const { EN } = await import(path.resolve(frontSrc, "i18n/en.ts"));
  const { DE } = await import(path.resolve(frontSrc, "i18n/de.ts"));
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.(tsx?|ts)$/.test(e.name) ? [path.join(d, e.name)] : []);
  const keys = new Set<string>();
  for (const f of walk(frontSrc)) {
    if (f.includes(path.join("i18n", "en.ts"))) continue;
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(?:t|tx|tr)\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(unescape(m[1]));
    for (const m of src.matchAll(/\bt\(\s*[^"`\s][^,)]*\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) { keys.add(unescape(m[1])); keys.add(unescape(m[2])); }
    // nombres de habilidades y etiquetas que se traducen con t(variable)
    const lab = src.match(/const ABILITY_LABELS[^{]*\{([\s\S]*?)\};/);
    if (lab) for (const m of lab[1].matchAll(/: "((?:[^"\\]|\\.)*)"/g)) keys.add(unescape(m[1]));
    for (const m of src.matchAll(/"(🥔 (?:Tomar|Pasar) Papa Caliente)"/g)) keys.add(m[1]);
    const info = src.match(/const ABILITY_INFO[^{]*\{([\s\S]*?)\n\};/);
    if (info) for (const m of info[1].matchAll(/: "((?:[^"\\]|\\.)*)"/g)) keys.add(unescape(m[1]));
  }
  // Textos que se traducen con t(...) sobre una expresión: se declaran aquí explícitamente.
  for (const k of ["Tienes {n} habilidad activada, la mano incluirá todas, no {hand}.", "Tienes {n} habilidades activadas, la mano incluirá todas, no {hand}."]) keys.add(k);
  ok(keys.size >= 90, `frontend: se detectaron ${keys.size} textos traducibles`);
  const missing = [...keys].filter((k) => !(k in EN));
  ok(missing.length === 0, "frontend: todos los textos tienen traducción al inglés" + (missing.length ? "\n      SIN TRADUCIR: " + missing.join("\n      SIN TRADUCIR: ") : ""));
  const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const bad = Object.entries(EN as Record<string, string>).filter(([k, v]) => params(k) !== params(v));
  ok(bad.length === 0, "frontend: los {parámetros} de cada traducción coinciden con el original" + (bad.length ? "\n      DESCUADRADOS: " + bad.map(([k]) => k).join(" | ") : ""));
  const missingDeFront = [...keys].filter((k) => !(k in DE));
  ok(missingDeFront.length === 0, "frontend: todos los textos tienen traducción al alemán" + (missingDeFront.length ? "\n      SIN TRADUCIR (de): " + missingDeFront.join("\n      SIN TRADUCIR (de): ") : ""));
  const badDe = Object.entries(DE as Record<string, string>).filter(([k, v]) => params(k) !== params(v));
  ok(badDe.length === 0, "frontend: los {parámetros} del alemán coinciden con el original" + (badDe.length ? "\n      DESCUADRADOS (de): " + badDe.map(([k]) => k).join(" | ") : ""));
  const orphanDeFront = Object.keys(DE).filter((k) => !keys.has(k));
  ok(orphanDeFront.length === 0, "frontend: no hay traducciones al alemán huérfanas" + (orphanDeFront.length ? "\n      HUÉRFANAS (de): " + orphanDeFront.join(" | ") : ""));
  // Solo tuteo: ni "Sie" ni sus formas en ningún texto alemán (UI, mensajes, páginas de error ni textos legales)
  const formal = /\b(Sie|Ihnen|Ihr|Ihre|Ihrem|Ihren|Ihrer|Ihres)\b/;
  const germanTexts: Record<string, string> = {
    "de.ts": fs.readFileSync(path.resolve(frontSrc, "i18n/de.ts"), "utf8"),
    "servertext.ts": fs.readFileSync("src/servertext.ts", "utf8"),
    "errorpages.ts": fs.readFileSync("src/errorpages.ts", "utf8"),
    "nutzungsbedingungen.html": fs.readFileSync(path.resolve("..", "michi3d", "public", "nutzungsbedingungen.html"), "utf8"),
    "datenschutz.html": fs.readFileSync(path.resolve("..", "michi3d", "public", "datenschutz.html"), "utf8"),
    "404.html": fs.readFileSync(path.resolve("..", "michi3d", "public", "404.html"), "utf8"),
  };
  const sieHits = Object.entries(germanTexts).filter(([, txt]) => formal.test(txt)).map(([n]) => n);
  ok(sieHits.length === 0, "alemán: solo tuteo (ningún \"Sie\" ni formas de cortesía)" + (sieHits.length ? "\n      FORMAL EN: " + sieHits.join(", ") : ""));
  const duHits = Object.entries(germanTexts).filter(([n, txt]) => /\b(du|dein|dir|dich)\b/i.test(txt) || n === "404.html");
  ok(duHits.length >= 5, "alemán: los textos usan el tuteo (du/dein/dir/dich)");
  const used = new Set(keys);
  const orphan = Object.keys(EN).filter((k) => !used.has(k));
  ok(orphan.length === 0, "frontend: no hay traducciones huérfanas" + (orphan.length ? "\n      HUÉRFANAS: " + orphan.join(" | ") : ""));
} else {
  console.log("(frontend no encontrado junto al servidor: se omiten las comprobaciones del frontend)");
}
console.log(fails === 0 ? "\nI18N OK" : `\n${fails} FALLO(S)`);
process.exit(fails ? 1 : 0);
