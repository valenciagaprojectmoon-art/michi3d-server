/**
 * Inicio de sesión con Discord y Google, y sesiones firmadas.
 *
 * Flujo (código de autorización, el servidor guarda los secretos):
 *   navegador -> GET /auth/<proveedor>/start -> el proveedor -> GET /auth/<proveedor>/callback
 *   -> el servidor canjea el código, lee el id estable de la persona, crea o actualiza su cuenta
 *   -> redirige al juego con la sesión en el fragmento de la URL (#session=...), que no viaja a ningún servidor.
 *
 * El id estable es el `id` de Discord y el `sub` de Google (documentación oficial de ambos: permanente, nunca se reutiliza).
 * No pedimos el correo: solo `identify` en Discord y `openid profile` en Google.
 *
 * Sesiones: un token firmado con HMAC-SHA256 (sin dependencias) que el cliente manda al crear o entrar en una sala.
 * El estado de la cuenta (pendiente, aprobada, baneada) se consulta SIEMPRE en la base de datos, no va en el token,
 * así un baneo surte efecto al instante.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import type { Provider, UserStatus, UserStore, User } from "./users.js";

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  discord: ProviderConfig | null;
  google: ProviderConfig | null;
  sessionSecret: string;
  sessionSecretIsRandom: boolean; // true si no se configuró SESSION_SECRET: las sesiones mueren al reiniciar
  frontendUrl: string; // dirección del juego (a donde se vuelve tras iniciar sesión)
  publicServerUrl: string; // dirección pública de este servidor (para los redirect_uri)
  requireApproval: boolean; // las cuentas nuevas quedan "pendientes" hasta que las apruebes
  required: boolean; // si hace falta iniciar sesión para jugar online
  sessionDays: number;
  discordApiBase: string; // configurables solo para poder probar con un proveedor falso
  googleAuthUrl: string;
  googleTokenUrl: string;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const pair = (id?: string, secret?: string): ProviderConfig | null => (id && secret ? { clientId: id, clientSecret: secret } : null);
  const discord = pair(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET);
  const google = pair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  const hasProvider = !!(discord || google);
  const sessionSecret = env.SESSION_SECRET && env.SESSION_SECRET.length >= 16 ? env.SESSION_SECRET : randomBytes(32).toString("hex");
  const days = Number(env.SESSION_DAYS);
  return {
    discord,
    google,
    sessionSecret,
    sessionSecretIsRandom: !(env.SESSION_SECRET && env.SESSION_SECRET.length >= 16),
    frontendUrl: (env.FRONTEND_URL || "").replace(/\/+$/, ""),
    publicServerUrl: (env.PUBLIC_SERVER_URL || "").replace(/\/+$/, ""),
    requireApproval: env.AUTH_REQUIRE_APPROVAL !== "false",
    // Sin ningún proveedor configurado nadie podría entrar: en ese caso no se exige (como antes de existir las cuentas).
    required: hasProvider && env.AUTH_REQUIRED !== "false",
    sessionDays: Number.isFinite(days) && days > 0 ? days : 30,
    discordApiBase: env.DISCORD_API_BASE || "https://discord.com/api",
    googleAuthUrl: env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
    googleTokenUrl: env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
  };
}

// ---------- tokens firmados ----------

type TokenPayload = { t: "s"; uid: string; exp: number } | { t: "o"; p: Provider; n: string; exp: number };

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function signToken(payload: TokenPayload, secret: string): string {
  const body = b64(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest();
  return `${body}.${b64(sig)}`;
}

/** Devuelve el contenido si la firma es válida y no ha caducado; si no, null. */
export function verifyToken(token: unknown, secret: string, now: number = Date.now()): TokenPayload | null {
  if (typeof token !== "string" || token.length > 2000) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  let given: Buffer;
  try {
    given = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function makeSession(cfg: AuthConfig, userId: string, now: number = Date.now()): string {
  return signToken({ t: "s", uid: userId, exp: now + cfg.sessionDays * 86400000 }, cfg.sessionSecret);
}

// ---------- resultado de comprobar una sesión (para el WebSocket) ----------

export type SessionCheck =
  | { ok: true; user: User }
  | { ok: false; reason: "missing" | "expired" | "pending" | "banned" };

export async function checkSession(cfg: AuthConfig, users: UserStore, token: unknown, now: number = Date.now()): Promise<SessionCheck> {
  if (typeof token !== "string" || token === "") return { ok: false, reason: "missing" };
  const payload = verifyToken(token, cfg.sessionSecret, now);
  if (!payload || payload.t !== "s") return { ok: false, reason: "expired" };
  const user = await users.get(payload.uid);
  if (!user) return { ok: false, reason: "expired" };
  if (user.status === "banned") return { ok: false, reason: "banned" };
  if (user.status === "pending") return { ok: false, reason: "pending" };
  return { ok: true, user };
}

// ---------- proveedores ----------

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * El id_token de Google lo recibimos DIRECTAMENTE del endpoint de tokens de Google por TLS y con nuestro secreto,
 * así que (como permite OpenID Connect y explica Google) no hace falta comprobar su firma, pero sí quién es el
 * destinatario (aud), el emisor (iss) y la caducidad (exp).
 */
export function validateGoogleClaims(claims: Record<string, unknown> | null, clientId: string, now: number = Date.now()): { id: string; name: string } | null {
  if (!claims) return null;
  const iss = claims.iss;
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") return null;
  const aud = claims.aud;
  if (!(aud === clientId || (Array.isArray(aud) && aud.includes(clientId)))) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  if (typeof claims.sub !== "string" || claims.sub === "") return null;
  return { id: claims.sub, name: typeof claims.name === "string" ? claims.name : "jugador" };
}

type FetchFn = typeof fetch;

export async function exchangeDiscord(cfg: AuthConfig, code: string, redirectUri: string, fetchFn: FetchFn = fetch): Promise<{ id: string; name: string }> {
  const p = cfg.discord;
  if (!p) throw new Error("discord no configurado");
  const tokenRes = await fetchFn(`${cfg.discordApiBase}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!tokenRes.ok) throw new Error(`discord token ${tokenRes.status}`);
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("discord sin access_token");
  const meRes = await fetchFn(`${cfg.discordApiBase}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!meRes.ok) throw new Error(`discord users/@me ${meRes.status}`);
  const me = (await meRes.json()) as { id?: string; username?: string; global_name?: string | null };
  if (!me.id) throw new Error("discord sin id");
  return { id: me.id, name: me.global_name || me.username || "jugador" };
}

export async function exchangeGoogle(cfg: AuthConfig, code: string, redirectUri: string, fetchFn: FetchFn = fetch, now: number = Date.now()): Promise<{ id: string; name: string }> {
  const p = cfg.google;
  if (!p) throw new Error("google no configurado");
  const res = await fetchFn(cfg.googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error("google sin id_token");
  const identity = validateGoogleClaims(decodeJwtPayload(body.id_token), p.clientId, now);
  if (!identity) throw new Error("google id_token no válido");
  return identity;
}

export function buildStartUrl(cfg: AuthConfig, provider: Provider, redirectUri: string, state: string): string | null {
  if (provider === "discord" && cfg.discord) {
    const q = new URLSearchParams({ response_type: "code", client_id: cfg.discord.clientId, scope: "identify", state, redirect_uri: redirectUri, prompt: "consent" });
    return `https://discord.com/oauth2/authorize?${q}`;
  }
  if (provider === "google" && cfg.google) {
    const q = new URLSearchParams({ response_type: "code", client_id: cfg.google.clientId, scope: "openid profile", state, redirect_uri: redirectUri, prompt: "select_account" });
    return `${cfg.googleAuthUrl}?${q}`;
  }
  return null;
}

// ---------- CORS (el juego en Vercel llama a este servidor) ----------

export function allowedOrigin(req: http.IncomingMessage, cfg: AuthConfig): string | null {
  const origin = req.headers.origin;
  if (typeof origin !== "string") return null;
  const allowed = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
  try {
    if (cfg.frontendUrl) allowed.add(new URL(cfg.frontendUrl).origin);
  } catch {
    // FRONTEND_URL mal escrita: solo se admite localhost
  }
  return allowed.has(origin) ? origin : null;
}

export function applyCors(req: http.IncomingMessage, res: http.ServerResponse, cfg: AuthConfig): void {
  const origin = allowedOrigin(req, cfg);
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

// ---------- rutas HTTP /auth/* ----------

export interface AuthDeps {
  cfg: AuthConfig;
  users: UserStore;
  fetchFn?: FetchFn;
  now?: () => number;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function redirect(res: http.ServerResponse, location: string) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

/** Devuelve true si la ruta era de /auth y ya se respondió. */
export async function handleAuthHttp(req: http.IncomingMessage, res: http.ServerResponse, url: URL, deps: AuthDeps): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/auth/")) return false;
  const { cfg, users } = deps;
  const now = deps.now ? deps.now() : Date.now();
  applyCors(req, res, cfg);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  if (req.method !== "GET") {
    json(res, 405, { error: "method not allowed" });
    return true;
  }

  if (path === "/auth/providers") {
    json(res, 200, { discord: !!cfg.discord, google: !!cfg.google, required: cfg.required });
    return true;
  }

  if (path === "/auth/me") {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const check = await checkSession(cfg, users, token, now);
    if (check.ok) json(res, 200, { id: check.user.id, displayName: check.user.displayName, status: check.user.status });
    else if (check.reason === "banned" || check.reason === "pending") {
      const payload = verifyToken(token, cfg.sessionSecret, now);
      const user = payload && payload.t === "s" ? await users.get(payload.uid) : null;
      json(res, 200, { id: user?.id ?? null, displayName: user?.displayName ?? "", status: check.reason });
    } else json(res, 401, { error: "no session" });
    return true;
  }

  const m = path.match(/^\/auth\/(discord|google)\/(start|callback)$/);
  if (!m) {
    json(res, 404, { error: "not found" });
    return true;
  }
  const provider = m[1] as Provider;
  const action = m[2];
  const base = cfg.publicServerUrl || `https://${req.headers.host ?? "localhost"}`;
  const redirectUri = `${base}/auth/${provider}/callback`;
  const back = (fragment: string) => (cfg.frontendUrl ? redirect(res, `${cfg.frontendUrl}/#${fragment}`) : json(res, 400, { error: fragment }));

  if (action === "start") {
    const state = signToken({ t: "o", p: provider, n: randomBytes(12).toString("hex"), exp: now + 10 * 60 * 1000 }, cfg.sessionSecret);
    const target = buildStartUrl(cfg, provider, redirectUri, state);
    if (!target) json(res, 404, { error: "provider not configured" });
    else redirect(res, target);
    return true;
  }

  // callback
  if (url.searchParams.get("error")) {
    back("auth_error=cancelled");
    return true;
  }
  const state = verifyToken(url.searchParams.get("state"), cfg.sessionSecret, now);
  const code = url.searchParams.get("code");
  if (!state || state.t !== "o" || state.p !== provider || !code) {
    back("auth_error=state");
    return true;
  }
  try {
    const fetchFn = deps.fetchFn ?? fetch;
    const identity = provider === "discord" ? await exchangeDiscord(cfg, code, redirectUri, fetchFn) : await exchangeGoogle(cfg, code, redirectUri, fetchFn, now);
    const newStatus: UserStatus = cfg.requireApproval ? "pending" : "approved";
    const user = await users.upsertLogin(provider, identity.id, identity.name, newStatus);
    back(`session=${makeSession(cfg, user.id, now)}`);
  } catch (err) {
    console.error(`[auth] fallo en ${provider}:`, err instanceof Error ? err.message : err);
    back("auth_error=provider");
  }
  return true;
}
