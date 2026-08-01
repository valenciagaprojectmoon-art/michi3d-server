/**
 * Servidor WebSocket de Michi 3D multijugador.
 * Traduce mensajes del protocolo (protocol.ts) a llamadas sobre RoomManager,
 * y retransmite el estado resultante a todos los sockets conectados a la sala.
 */

import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { RoomManager } from "./rooms.js";
import type { Room } from "./rooms.js";
import type { ClientMessage, ServerMessage, PublicRoomState, ChatMessage } from "./protocol.js";
import type { ActiveEffect } from "./abilities.js";

const PORT = Number(process.env.PORT) || 8080;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const TIMER_CHECK_INTERVAL_MS = 1000; // resolución de 1s para detectar fin de turno

const roomManager = new RoomManager();
const wss = new WebSocketServer({ port: PORT });

// Cada socket real se asocia a un id interno estable y, una vez en una sala, a su código.
interface SocketMeta {
  socketId: string;
  roomCode: string | null;
}
const socketMeta = new WeakMap<WebSocket, SocketMeta>();

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
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

wss.on("connection", (ws) => {
  const socketId = randomUUID();
  socketMeta.set(ws, { socketId, roomCode: null });
  socketsById.set(socketId, ws);

  ws.on("message", (raw) => {
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
        const result = roomManager.joinRoom(msg.roomCode, msg.playerName, socketId);
        if ("error" in result) {
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
          case "reloj_roto":
            result = roomManager.useRelojRoto(meta.roomCode, player.id);
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

console.log(`Servidor Michi 3D escuchando en el puerto ${PORT}`);
