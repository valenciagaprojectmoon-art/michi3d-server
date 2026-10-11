// El frontend tiene COPIAS de logic.ts, abilities.ts y protocol.ts del servidor (solo cambia la extensión ".js" de los imports).
// Si se desincronizan, el juego se rompe sin avisar (p. ej. el frontend mandaba una versión de términos vieja y el servidor lo echaba).
import fs from "node:fs";
import path from "node:path";
let fails = 0; const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const front = path.resolve("..", "michi3d", "src", "game");
if (!fs.existsSync(front)) { console.log("(frontend no encontrado junto al servidor: se omite)"); process.exit(0); }
const norm = (s: string) => s.replace(/\.\/(logic|abilities)\.js/g, "./$1");
for (const f of ["logic.ts", "abilities.ts", "protocol.ts"]) {
  const a = norm(fs.readFileSync(path.join("src", f), "utf8")), b = fs.readFileSync(path.join(front, f), "utf8");
  ok(a === b, `${f}: la copia del frontend es idéntica a la del servidor`);
}
const v = (p: string) => fs.readFileSync(p, "utf8").match(/TERMS_VERSION = "([^"]+)"/)?.[1];
ok(!!v("src/protocol.ts") && v("src/protocol.ts") === v(path.join(front, "protocol.ts")), `versión de términos igual en servidor y frontend (${v("src/protocol.ts")})`);
// Sin puntos "·" ni viñetas "•" en nada de lo que se muestra en el sitio
{ const bad: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") walk(f); }
    else if (/\.(tsx?|html|css|md)$/.test(e.name) && /[·•]/.test(fs.readFileSync(f, "utf8"))) bad.push(f); } };
  for (const d of [path.resolve("src"), path.resolve("..", "michi3d", "src"), path.resolve("..", "michi3d", "public")]) if (fs.existsSync(d)) walk(d);
  ok(bad.length === 0, "ningún archivo del sitio contiene puntos \"·\" ni viñetas \"•\"" + (bad.length ? ": " + bad.join(", ") : "")); }
console.log(fails === 0 ? "\nSYNC OK" : `\n${fails} FALLO(S)`); process.exit(fails ? 1 : 0);
