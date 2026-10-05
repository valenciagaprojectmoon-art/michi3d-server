/**
 * Servidor WebSocket de Michi 3D multijugador.
 * Traduce mensajes del protocolo (protocol.ts) a llamadas sobre RoomManager,
 * y retransmite el estado resultante a todos los sockets conectados a la sala.
 */

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { RoomManager } from "./rooms.js";
import type { Room } from "./rooms.js";
import type { ClientMessage, ServerMessage, PublicRoomState, ChatMessage } from "./protocol.js";
import { TERMS_VERSION } from "./protocol.js";
import type { Lang } from "./protocol.js";
import { translateServer } from "./servertext.js";
import { errorText, pickLang, renderErrorPage } from "./errorpages.js";
import { createChatLogStore, retentionConfig, DAY_MS } from "./chatlog.js";
import type { ChatLogStore } from "./chatlog.js";
import {
  IpGuard,
  KeyedLimiter,
  ConnectionLimiter,
  TokenBucket,
  clientIp,
  loadLimits,
} from "./ratelimit.js";
import type { ActiveEffect } from "./abilities.js";

const PORT = Number(process.env.PORT) || 8080;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const TIMER_CHECK_INTERVAL_MS = 1000; // resolución de 1s para detectar fin de turno

const roomManager = new RoomManager();

// ---------- Registro del chat (moderación + protocolo general) ----------
const chatLog: ChatLogStore = createChatLogStore(process.env.DATABASE_URL);
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const CHAT_PURGE_INTERVAL_MS = 60 * 60 * 1000; // 1 h
const MAX_REPORT_REASON_LENGTH = 300;

// ---------- Límites de peticiones (anti-bombardeo). Ver ratelimit.ts ----------
const limits = loadLimits();
const ipGuard = new IpGuard(limits.maxConnectionsPerIp, limits.connBurst, limits.connRefillPerSec);
const reportLimiter = new KeyedLimiter(limits.reportBurst, limits.reportRefillPerSec); // por IP
const createRoomLimiter = new KeyedLimiter(limits.createRoomBurst, limits.createRoomRefillPerSec); // por IP
const failedJoinLimiter = new KeyedLimiter(limits.failedJoinBurst, limits.failedJoinRefillPerSec); // por IP
const httpLimiter = new KeyedLimiter(limits.httpBurst, limits.httpRefillPerSec); // por IP
const adminFailLimiter = new KeyedLimiter(limits.adminFailBurst, limits.adminFailRefillPerSec); // por IP
const LIMITED_NOTICE_EVERY_MS = 2000; // no avisar más de una vez cada 2 s por conexión (evita amplificación)
// Códigos de cierre WebSocket que el cliente reconoce para explicar el motivo.
const WS_CLOSE_POLICY = 1008; // baneo temporal / abuso
const WS_CLOSE_TRY_LATER = 1013; // demasiadas conexiones o demasiado rápido
const reportedKeys = new Set<string>(); // evita reportar dos veces el mismo mensaje desde el mismo jugador

function roomIdOf(room: Room): string {
  return `${room.code}:${room.createdAt}`;
}

function logError(what: string, err: unknown) {
  console.error(`[chatlog] ${what}:`, err instanceof Error ? err.message : err);
}

function checkTerms(accepted: string | undefined): string | null {
  return accepted === TERMS_VERSION
    ? null
    : "Debes aceptar los Términos de Servicio y la Política de Privacidad para jugar online.";
}

async function runPurge() {
  const { chatDays, reportDays } = retentionConfig();
  try {
    const res = await chatLog.purge(chatDays * DAY_MS, reportDays * DAY_MS);
    if (res.messages > 0 || res.reports > 0) {
      console.log(`[chatlog] Purga: ${res.messages} mensaje(s) y ${res.reports} reporte(s) eliminados por retención.`);
    }
  } catch (err) {
    logError("purga", err);
  }
}

// ---------- HTTP: salud + consulta de administrador ----------
function isAdmin(req: http.IncomingMessage): boolean {
  if (!ADMIN_KEY) return false;
  const header = req.headers["authorization"] ?? "";
  const expected = Buffer.from(`Bearer ${ADMIN_KEY}`);
  const given = Buffer.from(Array.isArray(header) ? header[0] : header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
}

// Dirección del juego (frontend), opcional: las páginas de error muestran un botón "Volver al juego".
const FRONTEND_URL = process.env.FRONTEND_URL || "";

/**
 * Respuesta de error HTTP 4XX/500. Los navegadores (Accept: text/html) reciben una página
 * en español o inglés (ver errorpages.ts); curl y el panel reciben JSON.
 */
function respondError(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  url: URL,
  extraHeaders: Record<string, string> = {}
) {
  const lang = pickLang(req.headers["accept-language"], url.searchParams.get("lang"));
  const wantsHtml = (req.headers["accept"] ?? "").includes("text/html");
  const headers = { "Cache-Control": "no-store", ...extraHeaders };
  if (req.method === "HEAD") {
    res.writeHead(status, headers);
    return res.end();
  }
  if (wantsHtml) {
    res.writeHead(status, { ...headers, "Content-Type": "text/html; charset=utf-8" });
    return res.end(renderErrorPage(status, lang, FRONTEND_URL || undefined));
  }
  const { title, text } = errorText(status, lang);
  res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ status, error: title, message: text }));
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const httpIp = clientIp(req, limits.trustedProxyHops);
  const httpNow = Date.now();

  if (ipGuard.isBanned(httpIp, httpNow) || !httpLimiter.tryTake(httpIp, httpNow)) {
    return respondError(req, res, 429, url, { "Retry-After": "30" });
  }

  if (!path.startsWith("/admin/")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return respondError(req, res, 405, url, { Allow: "GET, HEAD" });
    }
    if (path === "/" || path === "/health") {
      // Health check de Render y respuesta a visitas directas.
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Michi 3D server");
      return;
    }
    return respondError(req, res, 404, url);
  }

  // Sin ADMIN_KEY configurada el panel no existe; con ella, solo con Authorization: Bearer <clave>.
  if (!ADMIN_KEY) return respondError(req, res, 404, url);
  // Anti fuerza bruta de la clave: tras varios fallos seguidos desde una IP, se bloquea un rato (aunque acierte).
  if (!adminFailLimiter.canTake(httpIp, httpNow)) {
    return respondError(req, res, 429, url, { "Retry-After": "60" });
  }
  if (!isAdmin(req)) {
    adminFailLimiter.tryTake(httpIp, httpNow);
    return respondError(req, res, 401, url, { "WWW-Authenticate": 'Bearer realm="admin"' });
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 5000);
  try {
    if (req.method === "GET" && path === "/admin/ip") {
      // Diagnóstico: ¿qué IP está viendo el servidor para ESTA petición? Si no coincide con tu IP real,
      // ajusta TRUST_PROXY_HOPS; si no, todos los jugadores compartirían los mismos límites por IP.
      return sendJson(res, 200, {
        ipQueUsaElServidor: httpIp,
        xForwardedFor: req.headers["x-forwarded-for"] ?? null,
        ipDelSocket: req.socket.remoteAddress ?? null,
        trustProxyHops: limits.trustedProxyHops,
      });
    }
    if (req.method === "GET" && path === "/admin/chat/rooms") {
      return sendJson(res, 200, await chatLog.listRooms(limit));
    }
    if (req.method === "GET" && path === "/admin/chat/reports") {
      return sendJson(res, 200, await chatLog.listReports(limit));
    }
    const roomMatch = path.match(/^\/admin\/chat\/room\/(.+)$/);
    if (roomMatch) {
      const roomId = decodeURIComponent(roomMatch[1]);
      if (req.method === "GET") {
        const messages = await chatLog.listRoom(roomId, limit);
        if (url.searchParams.get("format") === "txt") {
          const text = messages
            .map((m) => `[${new Date(m.sentAt).toISOString()}] ${m.playerName} (#${m.playerId}): ${m.text}`)
            .join("\n");
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          return res.end(text);
        }
        return sendJson(res, 200, messages);
      }
      if (req.method === "DELETE") {
        // Derecho de cancelación/supresión: borra el chat y los reportes de esa sala.
        return sendJson(res, 200, await chatLog.deleteRoom(roomId));
      }
    }
    return respondError(req, res, 404, url);
  } catch (err) {
    logError("admin", err);
    return respondError(req, res, 500, url);
  }
});

// Peticiones que ni llegan a ser HTTP válido (cabeceras enormes, tiempo agotado, basura): sin esto Node
// responde un 400 mudo. Aquí no hay cabeceras que leer, así que el texto va en los dos idiomas.
httpServer.on("clientError", (err: NodeJS.ErrnoException, socket) => {
  if (!socket.writable || socket.destroyed) return;
  const status = err.code === "HPE_HEADER_OVERFLOW" ? 431 : err.code === "ERR_HTTP_REQUEST_TIMEOUT" ? 408 : 400;
  const body = `${status} — ${errorText(status, "es").title} / ${errorText(status, "en").title}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? "Error"}\r\nContent-Type: text/plain; charset=utf-8\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
  );
});

// maxPayload: un mensaje mayor cierra la conexión (código 1009) antes de procesarse.
const wss = new WebSocketServer({ server: httpServer, maxPayload: limits.maxPayloadBytes });

// Cada socket real se asocia a un id interno estable y, una vez en una sala, a su código.
interface SocketMeta {
  socketId: string;
  roomCode: string | null;
  lang: Lang; // idioma de los mensajes del servidor para esta conexión (español hasta que el cliente diga otro)
}
const socketMeta = new WeakMap<WebSocket, SocketMeta>();

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    // Los errores se escriben en español en todo el código y se traducen aquí según el idioma de ESTA conexión.
    const lang = socketMeta.get(ws)?.lang ?? "es";
    const out: ServerMessage = msg.type === "error" ? { ...msg, message: translateServer(lang, msg.message) } : msg;
    ws.send(JSON.stringify(out));
  }
}

function asLang(value: unknown): Lang | null {
  return value === "es" || value === "en" ? value : null;
}

function toPublicState(room: Room): PublicRoomState {
  const host = room.players.find((p) => p.isHost);
  return {
    game: room.game,
    roomCode: room.code,
    connectedPlayerIds: room.players.filter((p) => p.connected).map((p) => p.id),
    hostId: host ? host.id : 0,
    locked: room.locked,
    maxPlayers: 4,
    abilitiesConfig: room.abilities.config,
    assignedAbilities: room.abilities.assigned,
    shuffle: room.abilities.shuffle,
    noConsumeUsesRemaining: room.abilities.noConsumeUsesRemaining,
    papaCaliente: room.abilities.papaCaliente,
    acelerador: room.abilities.acelerador,
    globalTurnIndex: room.abilities.globalTurnIndex,
    chatHistory: room.chatHistory,
  };
}

/** Envía el estado actualizado a todos los sockets conectados de una sala. */
function broadcastState(room: Room) {
  const state = toPublicState(room);
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const ws = socketsById.get(player.socketId);
    if (ws) send(ws, { type: "state_update", state });
  }
}

function broadcastToRoom(room: Room, msg: ServerMessage) {
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const ws = socketsById.get(player.socketId);
    if (ws) send(ws, msg);
  }
}

/**
 * Envía efectos consumidos SOLO al jugador afectado (no a toda la sala —
 * "tu pantalla se desorienta" es información personal del objetivo, no algo
 * que le interese a los demás como broadcast). Agrupa por targetPlayerId
 * porque consumeEffectsForTurn puede devolver varios efectos a la vez.
 */
function notifyConsumedEffects(room: Room, effects: ActiveEffect[]) {
  if (effects.length === 0) return;
  const byTarget = new Map<number, ActiveEffect[]>();
  for (const effect of effects) {
    const list = byTarget.get(effect.targetPlayerId) ?? [];
    list.push(effect);
    byTarget.set(effect.targetPlayerId, list);
  }
  for (const [targetId, targetEffects] of byTarget) {
    const player = room.players.find((p) => p.id === targetId);
    if (!player?.connected || !player.socketId) continue;
    const ws = socketsById.get(player.socketId);
    if (ws) send(ws, { type: "effects_applied", effects: targetEffects });
  }
}

// Índice inverso: socketId (string estable) -> conexión ws real.
const socketsById = new Map<string, WebSocket>();

wss.on("connection", (ws, req) => {
  const ip = clientIp(req, limits.trustedProxyHops);
  const admission = ipGuard.admit(ip, Date.now());
  if (admission !== "ok") {
    // Rechazada antes de registrar nada: no cuenta como conexión abierta.
    ws.close(admission === "banned" ? WS_CLOSE_POLICY : WS_CLOSE_TRY_LATER, `rate_limit:${admission}`);
    return;
  }

  const socketId = randomUUID();
  socketMeta.set(ws, { socketId, roomCode: null, lang: "es" });
  socketsById.set(socketId, ws);

  const connLimiter = new ConnectionLimiter(
    limits.msgBurst,
    limits.msgRefillPerSec,
    limits.maxStrikes,
    limits.strikeWindowMs,
    Date.now()
  );
  const chatBucket = new TokenBucket(limits.chatBurst, limits.chatRefillPerSec, Date.now());
  let lastLimitedNoticeAt = 0;

  // IMPRESCINDIBLE: sin este escuchador, un 'error' del socket (mensaje mayor que maxPayload,
  // trama malformada, conexión rota…) sería una excepción no capturada y TUMBARÍA TODO EL SERVIDOR.
  // ws ya cierra la conexión por sí mismo; aquí solo evitamos la caída.
  ws.on("error", (err) => {
    console.warn(`[ws] Error de socket (se cierra esa conexión): ${err.message}`);
  });

  ws.on("message", (raw) => {
    // Primera barrera: ritmo general por conexión. Cuenta TODO (también JSON basura).
    const nowMs = Date.now();
    const verdict = connLimiter.check(nowMs);
    if (verdict === "abusive") {
      ipGuard.ban(ip, nowMs, limits.banMs);
      console.warn(`[ratelimit] Conexión cerrada y IP baneada ${Math.round(limits.banMs / 1000)} s por inundación de mensajes.`);
      ws.close(WS_CLOSE_POLICY, "rate_limit:flood");
      return;
    }
    if (verdict === "limited") {
      if (nowMs - lastLimitedNoticeAt >= LIMITED_NOTICE_EVERY_MS) {
        lastLimitedNoticeAt = nowMs;
        send(ws, { type: "error", message: "Vas demasiado rápido. Espera un momento." });
      }
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "Mensaje mal formado." });
      return;
    }

    const meta = socketMeta.get(ws);
    if (!meta) return;

    switch (msg.type) {
      case "create_room": {
        meta.lang = asLang(msg.lang) ?? meta.lang; // antes que nada: hasta los errores de este mensaje salen en su idioma
        const termsError = checkTerms(msg.acceptedTerms);
        if (termsError) {
          send(ws, { type: "error", message: termsError });
          return;
        }
        if (roomManager.roomCount() >= limits.maxRooms) {
          send(ws, { type: "error", message: "El servidor está lleno ahora mismo. Inténtalo en unos minutos." });
          return;
        }
        if (!createRoomLimiter.tryTake(ip, nowMs)) {
          send(ws, { type: "error", message: "Estás creando salas demasiado rápido. Espera un momento." });
          return;
        }
        const { room, player } = roomManager.createRoom(
          msg.playerName,
          socketId,
          msg.timerConfig,
          msg.lifeConfig,
          msg.abilitiesConfig,
          msg.shuffleConfig
        );
        meta.roomCode = room.code;
        send(ws, {
          type: "room_created",
          roomCode: room.code,
          playerId: player.id,
          state: toPublicState(room),
        });
        break;
      }

      case "join_room": {
        meta.lang = asLang(msg.lang) ?? meta.lang;
        const termsError = checkTerms(msg.acceptedTerms);
        if (termsError) {
          send(ws, { type: "error", message: termsError });
          return;
        }
        // Anti fuerza bruta de códigos de sala: solo los intentos FALLIDOS consumen cupo.
        if (!failedJoinLimiter.canTake(ip, nowMs)) {
          send(ws, { type: "error", message: "Demasiados intentos con códigos inválidos. Espera un momento." });
          return;
        }
        const result = roomManager.joinRoom(msg.roomCode, msg.playerName, socketId);
        if ("error" in result) {
          failedJoinLimiter.tryTake(ip, nowMs);
          send(ws, { type: "error", message: result.error });
          return;
        }
        meta.roomCode = result.room.code;
        send(ws, {
          type: "room_joined",
          roomCode: result.room.code,
          playerId: result.player.id,
          state: toPublicState(result.room),
        });
        // Avisar al resto de la sala que alguien (re)entró, y sincronizar su estado (por si se sumó como jugador nuevo).
        if (result.reconnected) {
          broadcastToRoom(result.room, { type: "player_reconnected", playerName: result.player.name });
        }
        broadcastState(result.room);
        break;
      }

      case "play_move": {
        if (!meta.roomCode) {
          send(ws, { type: "error", message: "No estás en ninguna sala." });
          return;
        }
        const room = roomManager.getRoom(meta.roomCode);
        const player = room?.players.find((p) => p.socketId === socketId);
        if (!room || !player) {
          send(ws, { type: "error", message: "No se encontró tu jugador en la sala." });
          return;
        }
        const result = roomManager.playMove(meta.roomCode, player.id, msg.index);
        if ("error" in result) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        broadcastState(result.room);
        notifyConsumedEffects(result.room, result.consumedEffects);
        break;
      }

      case "reset_game": {
        if (!meta.roomCode) return;
        const result = roomManager.resetGame(meta.roomCode);
        if ("error" in result) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        broadcastState(result.room);
        break;
      }

      case "end_game": {
        if (!meta.roomCode) return;
        const room = roomManager.getRoom(meta.roomCode);
        const player = room?.players.find((p) => p.socketId === socketId);
        if (!room || !player) return;
        const result = roomManager.endGame(meta.roomCode, player.id);
        if ("error" in result) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        broadcastState(result.room);
        break;
      }

      case "set_locked": {
        if (!meta.roomCode) return;
        const room = roomManager.getRoom(meta.roomCode);
        const player = room?.players.find((p) => p.socketId === socketId);
        if (!room || !player) return;
        const result = roomManager.setLocked(meta.roomCode, player.id, msg.locked);
        if ("error" in result) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        broadcastState(result.room);
        break;
      }

      case "use_ability": {
        if (!meta.roomCode) {
          send(ws, { type: "error", message: "No estás en ninguna sala." });
          return;
        }
        const room = roomManager.getRoom(meta.roomCode);
        const player = room?.players.find((p) => p.socketId === socketId);
        if (!room || !player) {
          send(ws, { type: "error", message: "No se encontró tu jugador en la sala." });
          return;
        }

        // Despacho según qué habilidad se pide usar. Cada método de RoomManager
        // valida por su cuenta (turno correcto, habilidad asignada, parámetros
        // configurados, objetivo válido cuando aplica) y devuelve error si algo falla.
        let result: ReturnType<typeof roomManager.useChicharron>;
        switch (msg.ability) {
          case "chicharron":
            result = roomManager.useChicharron(meta.roomCode, player.id);
            break;
          case "goyslop":
            result = roomManager.useGoyslop(meta.roomCode, player.id);
            break;
          case "balanza":
            result = roomManager.useBalanza(meta.roomCode, player.id);
            break;
          case "globo_pintura":
            if (msg.targetPlayerId === undefined) {
              send(ws, { type: "error", message: "Globo de Pintura necesita un objetivo." });
              return;
            }
            result = roomManager.useGloboPintura(meta.roomCode, player.id, msg.targetPlayerId);
            break;
          case "malversion_fondos":
            if (msg.targetCellIndex === undefined) {
              send(ws, { type: "error", message: "Malversión de Fondos necesita una casilla objetivo." });
              return;
            }
            result = roomManager.useMalversionFondos(meta.roomCode, player.id, msg.targetCellIndex);
            break;
          case "postcognicion":
            if (msg.targetPlayerId === undefined) {
              send(ws, { type: "error", message: "Postcognición necesita un objetivo." });
              return;
            }
            result = roomManager.usePostcognicion(
              meta.roomCode,
              player.id,
              msg.targetPlayerId,
              msg.secondaryTargetPlayerId,
              msg.secondaryTargetCellIndex,
              msg.stepsBack
            );
            break;
          case "reloj_roto":
            result = roomManager.useRelojRoto(meta.roomCode, player.id);
            break;
          case "acelerador_particulas":
            result = roomManager.useAcelerador(meta.roomCode, player.id);
            break;
          case "brujula_mal_imantada":
            if (msg.stepsBack === undefined) {
              send(ws, { type: "error", message: "Brújula Mal Imantada necesita un número de turnos." });
              return;
            }
            result = roomManager.useBrujula(meta.roomCode, player.id, msg.stepsBack);
            break;
          case "papa_caliente":
            if (msg.papaCalienteAction === "activate") {
              result = roomManager.useActivatePapaCaliente(meta.roomCode, player.id);
            } else if (msg.papaCalienteAction === "pass") {
              if (msg.targetPlayerId === undefined) {
                send(ws, { type: "error", message: "Pasar la Papa Caliente necesita un objetivo." });
                return;
              }
              result = roomManager.usePassPapaCaliente(meta.roomCode, player.id, msg.targetPlayerId);
            } else {
              send(ws, { type: "error", message: "Papa Caliente: indica si quieres tomarla o pasarla." });
              return;
            }
            break;
          default:
            send(ws, { type: "error", message: "Esa habilidad todavía no está disponible." });
            return;
        }

        if ("error" in result) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        broadcastState(result.room);
        notifyConsumedEffects(result.room, result.consumedEffects);
        break;
      }

      case "send_chat": {
        if (!meta.roomCode) {
          send(ws, { type: "error", message: "No estás en ninguna sala." });
          return;
        }
        if (!chatBucket.tryTake(nowMs)) {
          send(ws, { type: "error", message: "Estás escribiendo demasiado rápido. Espera un momento." });
          return;
        }
        const room = roomManager.getRoom(meta.roomCode);
        const player = room?.players.find((p) => p.socketId === socketId);
        if (!room || !player) {
          send(ws, { type: "error", message: "No se encontró tu jugador en la sala." });
          return;
        }
        const result = roomManager.sendChatMessage(meta.roomCode, player.id, msg.text);
        if ("error" in result) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        // Chat de sala completa: todos ven todo, sin importar el turno.
        broadcastToRoom(result.room, { type: "chat_message", message: result.message });
        // Registro persistente. Sin await: un fallo de base de datos nunca debe frenar el juego.
        chatLog
          .append({
            roomId: roomIdOf(result.room),
            roomCode: result.room.code,
            playerId: result.message.playerId,
            playerName: result.message.playerName,
            text: result.message.text,
            sentAt: result.message.sentAt,
            termsVersion: TERMS_VERSION,
          })
          .catch((err) => logError("guardar mensaje", err));
        break;
      }

      case "set_language": {
        const lang = asLang(msg.lang);
        if (lang) meta.lang = lang;
        break;
      }

      case "report_message": {
        if (!meta.roomCode) {
          send(ws, { type: "error", message: "No estás en ninguna sala." });
          return;
        }
        if (!reportLimiter.tryTake(ip, nowMs)) {
          send(ws, { type: "error", message: "Estás reportando demasiado rápido. Espera un momento." });
          return;
        }
        const room = roomManager.getRoom(meta.roomCode);
        const reporter = room?.players.find((p) => p.socketId === socketId);
        if (!room || !reporter) {
          send(ws, { type: "error", message: "No se encontró tu jugador en la sala." });
          return;
        }
        if (msg.reportedPlayerId === reporter.id) {
          send(ws, { type: "error", message: "No puedes reportar tus propios mensajes." });
          return;
        }
        const reported = room.chatHistory.find(
          (m) => m.playerId === msg.reportedPlayerId && m.sentAt === msg.messageSentAt
        );
        if (!reported) {
          send(ws, { type: "error", message: "Ese mensaje ya no está disponible para reportar." });
          return;
        }
        const key = `${roomIdOf(room)}:${reporter.id}:${reported.playerId}:${reported.sentAt}`;
        if (reportedKeys.has(key)) {
          send(ws, { type: "error", message: "Ya reportaste ese mensaje." });
          return;
        }
        reportedKeys.add(key);
        const reason =
          typeof msg.reason === "string" && msg.reason.trim().length > 0
            ? msg.reason.trim().slice(0, MAX_REPORT_REASON_LENGTH)
            : "(sin motivo)";
        chatLog
          .report({
            roomId: roomIdOf(room),
            roomCode: room.code,
            reporterId: reporter.id,
            reporterName: reporter.name,
            reportedPlayerId: reported.playerId,
            reportedPlayerName: reported.playerName,
            messageSentAt: reported.sentAt,
            messageText: reported.text,
            reason,
          })
          .then(() => send(ws, { type: "report_received" }))
          .catch((err) => {
            logError("guardar reporte", err);
            reportedKeys.delete(key);
            send(ws, { type: "error", message: "No se pudo registrar el reporte. Inténtalo de nuevo." });
          });
        break;
      }

      case "leave_room": {
        handleDisconnect(socketId, meta);
        break;
      }
    }
  });

  ws.on("close", () => {
    const meta = socketMeta.get(ws);
    if (meta) handleDisconnect(socketId, meta);
    socketsById.delete(socketId);
    ipGuard.onClose(ip); // libera el cupo de conexiones simultáneas de esta IP
  });
});

function handleDisconnect(socketId: string, meta: SocketMeta) {
  const result = roomManager.disconnectBySocketId(socketId);
  if (result) {
    broadcastToRoom(result.room, { type: "player_disconnected", playerName: result.player.name });
    broadcastState(result.room);
  }
  meta.roomCode = null;
}

// Barrido de los contadores de límites (las IPs solo viven en memoria y se descartan tras inactividad).
setInterval(() => {
  const now = Date.now();
  ipGuard.sweep(now);
  for (const l of [reportLimiter, createRoomLimiter, failedJoinLimiter, httpLimiter, adminFailLimiter]) {
    l.sweep(now, 10 * 60 * 1000);
  }
}, CLEANUP_INTERVAL_MS);

// Limpieza periódica de salas vacías (nadie conectado tras el TTL).
setInterval(() => {
  const removed = roomManager.cleanupEmptyRooms();
  if (removed > 0) {
    console.log(`Limpieza: ${removed} sala(s) vacía(s) eliminada(s). Salas activas: ${roomManager.roomCount()}`);
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Revisión periódica de temporizadores de turno: para cada sala con partida en
 * curso y un modo de tiempo activo, compara cuánto ha pasado desde que empezó
 * el turno actual (game.turnStartedAt) contra el límite configurado
 * (timerConfig.secondsPerTurn). Si se pasó, aplica el timeout y notifica a la sala.
 *
 * La resolución de 1 segundo (TIMER_CHECK_INTERVAL_MS) significa que el timeout
 * puede aplicarse hasta ~1s tarde respecto al límite exacto — aceptable para
 * un juego de mesa por turnos, no para algo que necesite precisión de milisegundos.
 */
setInterval(() => {
  const now = Date.now();
  for (const room of roomManager.roomsWithActiveTimers()) {
    const config = room.game.timerConfig;
    if (config.mode === "none") continue; // ya filtrado por roomsWithActiveTimers, pero TS necesita el narrowing aquí
    const elapsedSeconds = (now - room.game.turnStartedAt) / 1000;
    if (elapsedSeconds >= config.secondsPerTurn) {
      const result = roomManager.applyTurnTimeout(room.code);
      if ("room" in result) {
        broadcastState(result.room);
        notifyConsumedEffects(result.room, result.consumedEffects);
      }
    }
  }
}, TIMER_CHECK_INTERVAL_MS);

// Efectos que dependen del reloj (Acelerador en vivo, ventana de la Papa Caliente).
setInterval(() => {
  for (const { room, consumedEffects } of roomManager.tickLiveEffects()) {
    broadcastState(room);
    notifyConsumedEffects(room, consumedEffects);
  }
}, TIMER_CHECK_INTERVAL_MS);

chatLog
  .init()
  .then(() => {
    const { chatDays, reportDays } = retentionConfig();
    console.log(
      `[chatlog] Almacén: ${chatLog.kind}. Retención: ${chatDays} días (chat), ${reportDays} días (chats reportados).`
    );
    if (chatLog.kind === "memory") {
      console.warn("[chatlog] AVISO: sin DATABASE_URL el registro del chat es solo en memoria y se pierde al reiniciar.");
    }
    if (!ADMIN_KEY) {
      console.warn("[chatlog] AVISO: sin ADMIN_KEY no hay consulta de administrador (/admin/...).");
    }
    void runPurge();
    setInterval(() => void runPurge(), CHAT_PURGE_INTERVAL_MS);
  })
  .catch((err) => logError("inicializar", err));

httpServer.listen(PORT, () => {
  console.log(`Servidor Michi 3D escuchando en el puerto ${PORT}`);
});
