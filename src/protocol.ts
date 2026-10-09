/**
 * Protocolo de mensajes WebSocket entre cliente y servidor.
 * Este archivo es la "fuente de verdad" del contrato: se copia idéntico
 * tanto al servidor como al frontend para que ambos lados tipen igual.
 */

import type { GameState, TimerConfig, LifeConfig, BoardConfig } from "./logic.js";
import type { AbilitiesConfig, AbilityId, ActiveEffect, ShuffleConfig, PapaCalienteState, AceleradorState } from "./abilities.js";

/**
 * Versión vigente de los Términos de Servicio y la Política de Privacidad
 * (michi3d/public/terminos.html y privacidad.html). El cliente envía la versión
 * que el jugador aceptó y el servidor la exige antes de crear/unirse a una sala.
 * SI CAMBIAS LOS TEXTOS LEGALES de forma sustancial, cambia esta fecha: así todos
 * tendrán que volver a aceptar.
 */
export const TERMS_VERSION = "2026-10-02";

/** Idiomas que entiende el servidor para sus mensajes (el español es el idioma base). */
export type Lang = "es" | "en" | "de";

// ---------- Mensajes que el CLIENTE envía al servidor ----------

export type ClientMessage =
  | {
      type: "create_room";
      playerName: string;
      timerConfig?: TimerConfig;
      lifeConfig?: LifeConfig;
      abilitiesConfig?: AbilitiesConfig;
      shuffleConfig?: ShuffleConfig | null; // null o ausente = sistema de Shuffle desactivado
      acceptedTerms: string; // versión de ToS/Privacidad aceptada (debe ser TERMS_VERSION)
      lang?: Lang; // idioma de los mensajes del servidor para este jugador (por defecto español)
      boardConfig?: BoardConfig; // dimensión del cubo y de la línea (por defecto 3 y 3; el servidor la valida)
    }
  | { type: "join_room"; roomCode: string; playerName: string; acceptedTerms: string; lang?: Lang }
  | { type: "rematch" } // pide revancha; cuando todos los conectados la piden, se reinicia la partida
  | { type: "set_language"; lang: Lang } // cambia el idioma de los mensajes del servidor durante la sesión
  | { type: "play_move"; index: number }
  | { type: "reset_game" }
  | { type: "leave_room" }
  | { type: "end_game" } // solo el host puede; el servidor valida
  | { type: "set_locked"; locked: boolean } // solo el host puede; el servidor valida
  | {
      type: "use_ability";
      ability: AbilityId;
      targetPlayerId?: number; // usado por habilidades con objetivo de jugador (ej. Globo de Pintura, Postcognición)
      targetCellIndex?: number; // usado por habilidades con objetivo de casilla (ej. Malversión de Fondos)
      secondaryTargetPlayerId?: number; // solo Postcognición: objetivo de jugador de la habilidad COPIADA, si la necesita
      secondaryTargetCellIndex?: number; // solo Postcognición: objetivo de casilla de la habilidad COPIADA, si la necesita
      stepsBack?: number; // solo Brújula Mal Imantada: cuántos jugadores retroceder en el historial de turnos
      papaCalienteAction?: "activate" | "pass"; // solo Papa Caliente: tomarla (activate) o pasarla a targetPlayerId (pass)
    }
  | { type: "send_chat"; text: string }
  | { type: "report_message"; reportedPlayerId: number; messageSentAt: number; reason?: string }; // reporta un mensaje del chat a moderación

// ---------- Mensajes que el SERVIDOR envía al cliente ----------

export type ServerMessage =
  | { type: "room_created"; roomCode: string; playerId: number; state: PublicRoomState }
  | { type: "room_joined"; roomCode: string; playerId: number; state: PublicRoomState }
  | { type: "state_update"; state: PublicRoomState }
  | { type: "player_disconnected"; playerName: string }
  | { type: "player_reconnected"; playerName: string }
  | { type: "effects_applied"; effects: ActiveEffect[] } // avisa efectos que acaban de aplicarse a TI (ej. pantalla desorientada)
  | { type: "chat_message"; message: ChatMessage }
  | { type: "report_received" }
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
  papaCaliente: PapaCalienteState; // quién tiene la Papa Caliente y hace cuántos turnos (holderId null = nadie)
  acelerador: AceleradorState; // votos del Acelerador de Partículas y si el efecto ya está vivo
  rematchVotes: number[]; // ids de los jugadores que ya pidieron revancha
  globalTurnIndex: number; // turnos absolutos jugados (el Acelerador aparece al llegar a su turnoDeAparicion)
  chatHistory: ChatMessage[]; // últimos mensajes de chat de la sala, para que quien se une vea el contexto
}
