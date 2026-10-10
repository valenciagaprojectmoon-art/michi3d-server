import { signToken, verifyToken, makeSession, checkSession, validateGoogleClaims, loadAuthConfig, buildStartUrl, decodeJwtPayload } from "../src/auth.js";
import { createMemoryUserStore } from "../src/users.js";
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const SECRET = "un-secreto-largo-de-prueba-123";
const cfg = (env: Record<string, string> = {}) => loadAuthConfig({ SESSION_SECRET: SECRET, ...env } as any);

// config
ok(cfg().required === false && cfg().discord === null && cfg().google === null, "sin proveedores configurados: no se exige sesión (nadie podría entrar)");
ok(cfg({ DISCORD_CLIENT_ID: "a", DISCORD_CLIENT_SECRET: "b" }).required === true, "con un proveedor configurado: sesión obligatoria por defecto");
ok(cfg({ DISCORD_CLIENT_ID: "a", DISCORD_CLIENT_SECRET: "b", AUTH_REQUIRED: "false" }).required === false, "AUTH_REQUIRED=false la hace opcional");
ok(cfg({ DISCORD_CLIENT_ID: "a" }).discord === null, "un proveedor a medias (sin secreto) no cuenta como configurado");
ok(cfg().requireApproval === true && cfg({ AUTH_REQUIRE_APPROVAL: "false" }).requireApproval === false, "las cuentas nuevas quedan pendientes por defecto");
ok(loadAuthConfig({} as any).sessionSecretIsRandom === true && loadAuthConfig({ SESSION_SECRET: "corto" } as any).sessionSecretIsRandom === true && cfg().sessionSecretIsRandom === false, "sin SESSION_SECRET válida (>=16) se avisa que será aleatoria");

// tokens
const now = 1_000_000;
const tok = signToken({ t: "s", uid: "u1", exp: now + 1000 }, SECRET);
ok((verifyToken(tok, SECRET, now) as any)?.uid === "u1", "token válido se verifica");
ok(verifyToken(tok, SECRET, now + 2000) === null, "token caducado se rechaza");
ok(verifyToken(tok, "otro-secreto-distinto-123", now) === null, "firmado con otro secreto se rechaza");
ok(verifyToken(tok.slice(0, -2) + "xx", SECRET, now) === null, "firma alterada se rechaza");
{ const [body, sig] = tok.split("."); const forged = Buffer.from(JSON.stringify({ t: "s", uid: "admin", exp: now + 1e9 })).toString("base64url");
  ok(verifyToken(`${forged}.${sig}`, SECRET, now) === null, "contenido alterado con la firma vieja se rechaza"); void body; }
ok(verifyToken("basura", SECRET) === null && verifyToken(undefined, SECRET) === null && verifyToken("a.b.c", SECRET) === null && verifyToken("x".repeat(5000), SECRET) === null, "basura, vacío y tokens enormes se rechazan");

// sesiones contra cuentas
const users = createMemoryUserStore();
const c = cfg();
const u = await users.upsertLogin("discord", "123", "Ana", "pending");
const s = makeSession(c, u.id);
ok((await checkSession(c, users, s)).ok === false && (await checkSession(c, users, s) as any).reason === "pending", "cuenta pendiente: no entra");
await users.setStatus(u.id, "approved");
ok((await checkSession(c, users, s)).ok === true, "cuenta aprobada: entra");
await users.setStatus(u.id, "banned", "insultos");
ok((await checkSession(c, users, s) as any).reason === "banned", "cuenta baneada: el baneo surte efecto al instante con la MISMA sesión");
await users.setStatus(u.id, "approved");
ok((await checkSession(c, users, s)).ok === true, "tras desbanear vuelve a entrar sin cambiar de sesión");
ok((await checkSession(c, users, undefined) as any).reason === "missing" && (await checkSession(c, users, "") as any).reason === "missing", "sin sesión: missing");
ok((await checkSession(c, users, "basura") as any).reason === "expired", "sesión inválida: expired");
const stateTok = signToken({ t: "o", p: "discord", n: "x", exp: Date.now() + 1000 }, SECRET);
ok((await checkSession(c, users, stateTok) as any).reason === "expired", "un token de OAuth (state) no sirve como sesión");
ok((await checkSession(c, users, makeSession(c, "no-existe")) as any).reason === "expired", "sesión de una cuenta que ya no existe: expired");

// cuentas: el estado se conserva al volver a entrar
{ const a = await users.upsertLogin("google", "g1", "Beto", "pending");
  await users.setStatus(a.id, "banned", "x");
  const again = await users.upsertLogin("google", "g1", "Beto Nuevo", "approved");
  ok(again.id === a.id && again.status === "banned" && again.displayName === "Beto Nuevo", "volver a iniciar sesión no desbanea ni duplica la cuenta, pero actualiza el nombre");
  const same = await users.upsertLogin("discord", "g1", "Otro", "pending");
  ok(same.id !== a.id, "el mismo id en otro proveedor es otra cuenta");
  ok((await users.list("banned", 10)).length === 1 && (await users.list(null, 10)).length >= 3, "listado por estado");
  const long = await users.upsertLogin("discord", "n", "  " + "x".repeat(100) + "\u0007", "pending");
  ok(long.displayName.length <= 40 && !/[\u0000-\u001f]/.test(long.displayName), "el nombre se limpia (sin caracteres de control y máximo 40)");
}

// Google claims
const good = { iss: "https://accounts.google.com", aud: "CID", sub: "123", name: "Ana", exp: Math.floor(Date.now() / 1000) + 3600 };
ok(validateGoogleClaims(good, "CID")?.id === "123", "google: claims válidos");
ok(validateGoogleClaims({ ...good, iss: "accounts.google.com" }, "CID") !== null, "google: emisor sin https también es válido");
ok(validateGoogleClaims({ ...good, aud: "OTRO" }, "CID") === null, "google: destinatario distinto se rechaza");
ok(validateGoogleClaims({ ...good, aud: ["x", "CID"] }, "CID") !== null, "google: aud como lista que incluye el nuestro");
ok(validateGoogleClaims({ ...good, iss: "https://evil.example" }, "CID") === null, "google: emisor falso se rechaza");
ok(validateGoogleClaims({ ...good, exp: 1 }, "CID") === null, "google: caducado se rechaza");
ok(validateGoogleClaims({ ...good, sub: "" }, "CID") === null && validateGoogleClaims({ ...good, sub: undefined }, "CID") === null && validateGoogleClaims(null, "CID") === null, "google: sin sub o sin claims se rechaza");
ok(decodeJwtPayload("a.b") === null && decodeJwtPayload("a.%%%.c") === null, "jwt mal formado: null");

// URLs de inicio
const full = cfg({ DISCORD_CLIENT_ID: "DID", DISCORD_CLIENT_SECRET: "s", GOOGLE_CLIENT_ID: "GID", GOOGLE_CLIENT_SECRET: "s" });
const d = new URL(buildStartUrl(full, "discord", "https://srv/auth/discord/callback", "ST")!);
ok(d.hostname === "discord.com" && d.searchParams.get("scope") === "identify" && d.searchParams.get("client_id") === "DID" && d.searchParams.get("state") === "ST" && d.searchParams.get("response_type") === "code", "discord: pide solo el permiso identify");
const g = new URL(buildStartUrl(full, "google", "https://srv/auth/google/callback", "ST")!);
ok(g.hostname === "accounts.google.com" && g.searchParams.get("scope") === "openid profile" && !g.searchParams.get("scope")!.includes("email"), "google: pide openid y profile, nunca el correo");
ok(buildStartUrl(cfg(), "discord", "x", "s") === null, "proveedor no configurado: sin URL");

console.log(fails === 0 ? "\nAUTH OK" : `\n${fails} FALLO(S)`); process.exit(fails ? 1 : 0);
