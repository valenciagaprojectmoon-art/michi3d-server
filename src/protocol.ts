/**
 * Protocolo de mensajes WebSocket entre cliente y servidor.
 * Este archivo es la "fuente de verdad" del contrato: se copia idéntico
 * tanto al servidor como al frontend para que ambos lados tipen igual.
 */

import type { GameState, TimerConfig, LifeConfig } from "./logic.js";
import type { AbilitiesConfig, AbilityId, ActiveEffect, ShuffleConfig } from "./abilities.js";

// ---------- Mensajes que el CLIENTE envía al servidor ----------

export type ClientMessage =
  | {
      type: "create_room";
      playerName: string;
      timerConfig?: TimerConfig;
      lifeConfig?: LifeConfig;
      abilitiesConfig?: AbilitiesConfig;
      shuffleConfig?: ShuffleConfig | null; // null o ausente = sistema de Shuffle desactivado
    }
  | { type: "join_room"; roomCode: string; playerName: string }
  | { type: "play_move"; index: number }
  | { type: "reset_game" }
  | { type: "leave_room" }
  | { type: "end_game" } // solo el host puede; el servidor valida
  | { type: "set_locked"; locked: boolean } // solo el host puede; el servidor valida
  | {
      type: "use_ability";
      ability: AbilityId;
      targetPlayerId?: number; // usado por habilidades con objetivo de jugador (ej. Globo de Pintura)
      targetCellIndex?: number; // usado por habilidades con objetivo de casilla (ej. Malversión de Fondos)
    }
  | { type: "send_chat"; text: string };

// ---------- Mensajes que el SERVIDOR envía al cliente ----------

export type ServerMessage =
  | { type: "room_created"; roomCode: string; playerId: number; state: PublicRoomState }
  | { type: "room_joined"; roomCode: string; playerId: number; state: PublicRoomState }
  | { type: "state_update"; state: PublicRoomState }
  | { type: "player_disconnected"; playerName: string }
  | { type: "player_reconnected"; playerName: string }
  | { type: "effects_applied"; effects: ActiveEffect[] } // avisa efectos que acaban de aplicarse a TI (ej. pantalla desorientada)
  | { type: "chat_message"; message: ChatMessage }
  | { type: "error"; message: string };

/** Un mensaje de chat de sala completa: lo ve todo el mundo, sin importar el turno. */
export interface ChatMessage {
  playerId: number;
  playerName: string;
  text: string;
  sentAt: number; // timestamp (ms) de cuándo el servidor lo recibió
}

/**
 * Estado de la sala tal como lo ve el cliente: el GameState del juego
 * (incluye vida, ya que currentLife/maxLife/lifeConfig viven ahí), más
 * metadata de sala y el estado de habilidades.
 */
export interface PublicRoomState {
  game: GameState;
  roomCode: string;
  connectedPlayerIds: number[]; // ids de jugadores actualmente conectados (no desconectados)
  hostId: number; // id del jugador creador de la sala
  locked: boolean; // true = nadie nuevo puede unirse
  maxPlayers: number;
  abilitiesConfig: AbilitiesConfig; // sin Shuffle: qué habilidades están habilitadas. Con Shuffle: el POOL completo (Y)
  assignedAbilities: Record<number, AbilityId[]>; // sin Shuffle: asignación fija. Con Shuffle: la MANO actual (X) de cada jugador
  shuffle: ShuffleConfig | null; // null = sistema de Shuffle desactivado
  noConsumeUsesRemaining: number; // Z restantes en el turno actual (solo relevante si shuffle no es null)
  chatHistory: ChatMessage[]; // últimos mensajes de chat de la sala, para que quien se une vea el contexto
}
