/**
 * Gestión de salas de juego. No depende de WebSocket ni de red:
 * es un módulo de estado en memoria, testeable de forma aislada.
 */

import { createInitialState, playMove, resetGame, applyTurnTimeout, nextEligiblePlayerIndex } from "./logic.js";
import type { GameState, Player, TimerConfig, LifeConfig } from "./logic.js";
import {
  createInitialAbilitiesState,
  useChicharron as abilityChicharron,
  useGoyslop as abilityGoyslop,
  useBalanza as abilityBalanza,
  useGloboPintura as abilityGloboPintura,
  useRelojRoto as abilityRelojRoto,
  useMalversionFondos as abilityMalversionFondos,
  usePostcognicion as abilityPostcognicion,
  useBrujula as abilityBrujula,
  useAcelerador as abilityAcelerador,
  applyAceleradorLateness,
  tickAcelerador,
  checkPapaCalienteSlow,
  useActivatePapaCaliente as abilityActivatePapa,
  usePassPapaCaliente as abilityPassPapa,
  settlePapaCalienteAfterTurn,
  consumeEffectsForTurn,
  reshuffleHandForTurn,
} from "./abilities.js";
import type { AbilitiesState, AbilitiesConfig, AbilityId, ActiveEffect, ShuffleConfig } from "./abilities.js";
import type { ChatMessage } from "./protocol.js";

export const MAX_PLAYERS_PER_ROOM = 4;
const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O/0/I/1 para evitar confusión al escribir el código
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000; // sala vacía se borra tras 5 min sin nadie conectado
const CHAT_MESSAGE_MAX_LENGTH = 500; // recorta mensajes larguísimos, no bloquea el envío
const CHAT_HISTORY_LIMIT = 100; // mensajes más viejos se descartan al superar este límite

const PLAYER_COLORS = ["#ff5c5c", "#5c9dff", "#5cff8f", "#ffd75c"];

export interface RoomPlayer {
  id: number;
  name: string;
  connected: boolean;
  socketId: string | null; // referencia externa (id de conexión), null si desconectado
  isHost: boolean; // el creador original de la sala; único que puede cerrar/reabrir/terminar la partida
}

/**
 * Una sala une dos sistemas independientes: `game` (el núcleo del juego -
 * tablero, turnos, vida, definido en logic.ts) y `abilities` (la capa de
 * habilidades, definida en abilities.ts, que opera SOBRE game sin que
 * logic.ts necesite saber que las habilidades existen). Esto evita una
 * dependencia circular entre los dos módulos.
 */
export interface Room {
  code: string;
  game: GameState;
  abilities: AbilitiesState;
  players: RoomPlayer[];
  createdAt: number;
  emptyAt: number | null; // timestamp desde el que la sala quedó sin nadie conectado, o null si hay alguien
  locked: boolean; // true = nadie nuevo puede unirse (excepto el host, que siempre puede reentrar)
  chatHistory: ChatMessage[]; // últimos mensajes de la sala, para que un jugador que se une vea el contexto
}

/** Devuelve el conjunto de playerIds actualmente desconectados en la sala. */
function disconnectedIds(room: Room): Set<number> {
  return new Set(room.players.filter((p) => !p.connected).map((p) => p.id));
}

/**
 * Tras cualquier avance de turno (jugada normal, timeout, o uso de habilidad),
 * limpia los efectos temporales que le tocaban al jugador cuyo turno EMPIEZA
 * ahora (ver consumeEffectsForTurn en abilities.ts para el razonamiento del
 * timing). Se llama de forma centralizada en un único lugar para no duplicar
 * esta lógica en cada método de RoomManager que avanza el turno.
 *
 * Devuelve los efectos consumidos para que el servidor pueda avisar al cliente
 * (ej. "tu pantalla se desorienta este turno").
 */
/**
 * Se llama tras cualquier avance de turno (jugada, timeout, o uso de
 * habilidad) para dos cosas relacionadas con "el turno de alguien empieza":
 *
 * 1. Limpia los efectos temporales pendientes del jugador cuyo turno EMPIEZA
 *    ahora (ver consumeEffectsForTurn en abilities.ts para el razonamiento
 *    del timing).
 * 2. Si el sistema de Shuffle está activo Y el turno CAMBIÓ de dueño respecto
 *    a antes de esta llamada, vuelve a sortear la mano del nuevo jugador
 *    actual. La comparación contra `previousPlayerId` es necesaria porque
 *    esta función se llama también tras usos sin-consumo de turno (donde
 *    currentPlayerIndex NO cambia) - sin esa comparación, la mano se
 *    resortearía a mitad del propio turno del jugador cada vez que usa algo,
 *    contradiciendo "se sortea al EMPEZAR cada turno tuyo".
 *
 * Se llama de forma centralizada en un único lugar para no duplicar esta
 * lógica en cada método de RoomManager que avanza el turno.
 *
 * Devuelve los efectos consumidos para que el servidor pueda avisar al cliente
 * (ej. "tu pantalla se desorienta este turno").
 */
function consumeEffectsForNewTurn(room: Room, previousPlayerId: number | null = null): ActiveEffect[] {
  if (room.game.status.kind !== "playing") return [];
  const currentPlayer = room.game.players[room.game.currentPlayerIndex];

  if (room.abilities.shuffle && previousPlayerId !== null && previousPlayerId !== currentPlayer.id) {
    room.abilities = reshuffleHandForTurn(room.abilities, currentPlayer.id);
  }

  const result = consumeEffectsForTurn(room.abilities, currentPlayer.id);
  room.abilities = result.abilities;
  return result.consumed;
}

/**
 * Si el turno de `endedPlayerId` terminó de verdad (turnHistory creció respecto
 * a `historyLenBefore`): aplica el daño por tardanza del Acelerador (si está vivo)
 * y, salvo `skipPapa`, el conteo/explosión de Papa Caliente. `skipPapa` es para
 * tomar/pasar la papa: ese turno no cuenta como turno sosteniéndola.
 */
function settleTurnEnd(
  room: Room,
  endedPlayerId: number | null,
  historyLenBefore: number,
  turnStartedBefore: number,
  skipPapa = false
): void {
  if (endedPlayerId === null) return;
  if (room.abilities.turnHistory.length <= historyLenBefore) return;
  room.game = applyAceleradorLateness(room.game, room.abilities, endedPlayerId, turnStartedBefore, Date.now());
  if (skipPapa) return;
  const settled = settlePapaCalienteAfterTurn(room.game, room.abilities, endedPlayerId, turnStartedBefore, Date.now());
  room.game = settled.game;
  room.abilities = settled.abilities;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  /** Genera un código de sala único de 4 caracteres, reintentando si colisiona. */
  private generateRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    // Extremadamente improbable con 33^4 ≈ 1.19M combinaciones, pero por si acaso:
    throw new Error("No se pudo generar un código de sala único.");
  }

  createRoom(
    hostName: string,
    socketId: string,
    timerConfig: TimerConfig = { mode: "none" },
    lifeConfig: LifeConfig = { startingLife: 3 },
    abilitiesConfig: AbilitiesConfig = {},
    shuffleConfig: ShuffleConfig | null = null
  ): { room: Room; player: RoomPlayer } {
    const code = this.generateRoomCode();
    const hostPlayer: RoomPlayer = {
      id: 0,
      name: hostName.slice(0, 20) || "Jugador 1",
      connected: true,
      socketId,
      isHost: true,
    };

    const gamePlayers: Player[] = [
      { id: 0, name: hostPlayer.name, color: PLAYER_COLORS[0], eliminated: false },
    ];

    let abilities = createInitialAbilitiesState(abilitiesConfig, shuffleConfig);
    abilities = shuffleConfig
      ? reshuffleHandForTurn(abilities, 0) // mano inicial sorteada
      : { ...abilities, assigned: { 0: Object.keys(abilitiesConfig) as AbilityId[] } }; // pool completo fijo

    const room: Room = {
      code,
      game: createInitialState(gamePlayers, timerConfig, lifeConfig),
      abilities,
      players: [hostPlayer],
      createdAt: Date.now(),
      emptyAt: null,
      locked: false,
      chatHistory: [],
    };

    this.rooms.set(code, room);
    return { room, player: hostPlayer };
  }

  /**
   * Intenta unir un jugador a una sala existente.
   * - Si la sala no existe: error.
   * - Si la sala está cerrada (locked) y quien pide unirse no es el host original: error.
   * - Si hay un jugador desconectado con el mismo nombre: lo reconecta en su mismo slot
   *   (permite recargar la página sin perder tu lugar en la partida). El host SIEMPRE
   *   puede reconectar así, incluso con la sala cerrada.
   * - Si no, y hay cupo, y la sala no está cerrada: agrega un jugador nuevo.
   * - Si está llena: error.
   */
  joinRoom(
    code: string,
    playerName: string,
    socketId: string
  ): { room: Room; player: RoomPlayer; reconnected: boolean } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: `No existe ninguna sala con el código "${code}".` };

    const trimmedName = playerName.slice(0, 20) || "Jugador";

    // Reconexión: mismo nombre, estaba desconectado. Permitida siempre (incluso con
    // la sala cerrada), porque es "volver a tu propio lugar", no "unirse de nuevo".
    const existing = room.players.find((p) => !p.connected && p.name === trimmedName);
    if (existing) {
      existing.connected = true;
      existing.socketId = socketId;
      room.emptyAt = null;
      return { room, player: existing, reconnected: true };
    }

    // Sala cerrada: solo el host (si por algún motivo no está ya en `players` como
    // desconectado, caso extremadamente raro) podría entrar; para cualquier otro, error.
    if (room.locked) {
      return { error: "El creador de la sala ha deshabilitado nuevos ingresos." };
    }

    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      return { error: "La sala ya está llena (máximo 4 jugadores)." };
    }

    const newId = room.players.length;
    const newPlayer: RoomPlayer = {
      id: newId,
      name: trimmedName,
      connected: true,
      socketId,
      isHost: false,
    };
    room.players.push(newPlayer);
    room.game = {
      ...room.game,
      players: [
        ...room.game.players,
        { id: newId, name: newPlayer.name, color: PLAYER_COLORS[newId], eliminated: false },
      ],
      currentLife: { ...room.game.currentLife, [newId]: room.game.lifeConfig.startingLife },
      maxLife: { ...room.game.maxLife, [newId]: room.game.lifeConfig.startingLife },
    };
    room.abilities = room.abilities.shuffle
      ? reshuffleHandForTurn(room.abilities, newId)
      : {
          ...room.abilities,
          assigned: { ...room.abilities.assigned, [newId]: Object.keys(room.abilities.config) as AbilityId[] },
        };
    room.emptyAt = null;

    return { room, player: newPlayer, reconnected: false };
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /**
   * Aplica una jugada, validando que quien la hace sea efectivamente
   * el jugador cuyo turno es. Devuelve error en vez de aplicar si no.
   */
  playMove(code: string, playerId: number, index: number): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };

    if (room.game.status.kind !== "playing") {
      return { error: "La partida ya terminó." };
    }
    const currentPlayer = room.game.players[room.game.currentPlayerIndex];
    if (currentPlayer.id !== playerId) {
      return { error: "No es tu turno." };
    }
    if (currentPlayer.eliminated) {
      return { error: "Estás eliminado y ya no puedes jugar." };
    }

    const cellBefore = room.game.board[index];
    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    room.game = playMove(room.game, index, disconnectedIds(room));
    // Si la celda pasó de vacía a ocupada, la jugada fue válida y cuenta como
    // turno jugado: registrarlo en turnHistory (Brújula lo necesita).
    if (cellBefore == null && room.game.board[index] != null) {
      room.abilities = {
        ...room.abilities,
        turnHistory: [...room.abilities.turnHistory, currentPlayer.id],
        globalTurnIndex: room.abilities.globalTurnIndex + 1,
      };
    }
    settleTurnEnd(room, currentPlayer.id, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, currentPlayer.id);
    return { room, consumedEffects };
  }

  /**
   * Aplica el efecto de que se acabó el tiempo del turno actual. El servidor
   * es responsable de decidir CUÁNDO llamar esto (con un temporizador basado en
   * game.turnStartedAt + secondsPerTurn); esta función solo aplica el efecto.
   * No hace nada si el modo de tiempo es "none" o la partida ya no está en curso.
   */
  applyTurnTimeout(code: string): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const previousPlayerId = room.game.players[room.game.currentPlayerIndex]?.id ?? null;
    const indexBefore = room.game.currentPlayerIndex;
    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    room.game = applyTurnTimeout(room.game, disconnectedIds(room));
    // Si el turno cambió de jugador por el timeout, ese turno cuenta en el historial.
    if (previousPlayerId !== null && room.game.currentPlayerIndex !== indexBefore) {
      room.abilities = {
        ...room.abilities,
        turnHistory: [...room.abilities.turnHistory, previousPlayerId],
        globalTurnIndex: room.abilities.globalTurnIndex + 1,
      };
    }
    settleTurnEnd(room, previousPlayerId, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, previousPlayerId);
    return { room, consumedEffects };
  }

  resetGame(code: string): { room: Room } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    room.game = resetGame(room.game);
    room.abilities = createInitialAbilitiesState(room.abilities.config, room.abilities.shuffle);

    if (room.abilities.shuffle) {
      // Con Shuffle activo: cada jugador arranca con una mano nueva sorteada,
      // no con el pool completo (eso sería el comportamiento sin Shuffle).
      for (const p of room.players) {
        room.abilities = reshuffleHandForTurn(room.abilities, p.id);
      }
    } else {
      // Sin Shuffle: comportamiento clásico, reasignar todo el pool configurado
      // a todos los jugadores, igual que se hace al crear la sala.
      const assigned: Record<number, AbilityId[]> = {};
      for (const p of room.players) {
        assigned[p.id] = Object.keys(room.abilities.config) as AbilityId[];
      }
      room.abilities = { ...room.abilities, assigned };
    }

    return { room };
  }

  /** Valida sala + turno del jugador; devuelve el error correspondiente o `null` si todo está bien. */
  private validateOwnTurn(room: Room, playerId: number): string | null {
    if (room.game.status.kind !== "playing") return "La partida ya terminó.";
    const currentPlayer = room.game.players[room.game.currentPlayerIndex];
    if (currentPlayer.id !== playerId) return "No es tu turno.";
    if (currentPlayer.eliminated) return "Estás eliminado y ya no puedes jugar.";
    return null;
  }

  /** Chicharrón: omite el turno para curar al usuario. Ver useChicharron en abilities.ts. */
  useChicharron(code: string, playerId: number): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityChicharron(room.game, room.abilities, playerId, disconnectedIds(room));
    if (!result) return { error: "No puedes usar Chicharrón ahora mismo." };
    room.game = result.game;
    room.abilities = result.abilities;
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /** Goyslop: cura y reduce vida máxima. Ver useGoyslop en abilities.ts. */
  useGoyslop(code: string, playerId: number): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityGoyslop(room.game, room.abilities, playerId, disconnectedIds(room));
    if (!result) return { error: "No puedes usar Goyslop ahora mismo." };
    room.game = result.game;
    room.abilities = result.abilities;
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /** Balanza: promedia la vida de todos los jugadores activos. Ver useBalanza en abilities.ts. */
  useBalanza(code: string, playerId: number): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityBalanza(room.game, room.abilities, playerId, disconnectedIds(room));
    if (!result) return { error: "No puedes usar Balanza ahora mismo." };
    room.game = result.game;
    room.abilities = result.abilities;
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /** Globo de Pintura: desorienta la pantalla de un objetivo elegido. Ver useGloboPintura en abilities.ts. */
  useGloboPintura(
    code: string,
    playerId: number,
    targetPlayerId: number
  ): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityGloboPintura(room.game, room.abilities, playerId, targetPlayerId, disconnectedIds(room));
    if (!result) return { error: "No puedes usar Globo de Pintura sobre ese objetivo." };
    room.game = result.game;
    room.abilities = result.abilities;
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /** Malversión de Fondos: cambia una casilla ocupada por otro jugador a tu marca. Ver useMalversionFondos en abilities.ts. */
  useMalversionFondos(
    code: string,
    playerId: number,
    targetCellIndex: number
  ): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityMalversionFondos(room.game, room.abilities, playerId, targetCellIndex, disconnectedIds(room));
    if (!result) return { error: "No puedes usar Malversión de Fondos sobre esa casilla." };
    room.game = result.game;
    room.abilities = result.abilities;
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /**
   * Postcognición: copia la habilidad activa de un jugador objetivo y la
   * ejecuta con quien usa Postcognición como actor. Ver usePostcognicion en
   * abilities.ts para el detalle completo (incluye qué habilidades son
   * copiables y por qué). secondaryTargetPlayerId/secondaryTargetCellIndex
   * solo aplican si la habilidad copiada a su vez necesita un objetivo.
   */
  usePostcognicion(
    code: string,
    playerId: number,
    targetPlayerId: number,
    secondaryTargetPlayerId?: number,
    secondaryTargetCellIndex?: number,
    secondaryStepsBack?: number
  ): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityPostcognicion(
      room.game,
      room.abilities,
      playerId,
      targetPlayerId,
      secondaryTargetPlayerId,
      secondaryTargetCellIndex,
      secondaryStepsBack,
      disconnectedIds(room)
    );
    if (!result) return { error: "No puedes usar Postcognición sobre ese objetivo." };
    room.game = result.game;
    room.abilities = result.abilities;
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /** Reloj Roto: protege al usuario de Brújula hasta su siguiente turno. Ver useRelojRoto en abilities.ts. */
  useRelojRoto(code: string, playerId: number): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityRelojRoto(room.game, room.abilities, playerId, disconnectedIds(room));
    if (!result) return { error: "No puedes usar Reloj Roto ahora mismo." };
    room.game = result.game;
    room.abilities = result.abilities;
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /** Brújula Mal Imantada: retrocede el turno `stepsBack` jugadores. Ver useBrujula en abilities.ts. */
  useBrujula(
    code: string,
    playerId: number,
    stepsBack: number
  ): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityBrujula(room.game, room.abilities, playerId, stepsBack, disconnectedIds(room));
    if (!result) return { error: "No puedes usar Brújula Mal Imantada con ese número de turnos." };
    room.game = result.game;
    room.abilities = result.abilities;
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /** Papa Caliente (tomarla): solo si nadie la tiene. Ver useActivatePapaCaliente en abilities.ts. */
  useActivatePapaCaliente(code: string, playerId: number): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityActivatePapa(room.game, room.abilities, playerId, disconnectedIds(room));
    if (!result) return { error: "No puedes tomar la Papa Caliente ahora mismo." };
    room.game = result.game;
    room.abilities = result.abilities;
    // skipPapa: el turno en que se toma la papa no cuenta como turno sostenido.
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore, true);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /** Papa Caliente (pasarla): solo el dueño actual, a un objetivo válido. Ver usePassPapaCaliente en abilities.ts. */
  usePassPapaCaliente(
    code: string,
    playerId: number,
    targetPlayerId: number
  ): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityPassPapa(room.game, room.abilities, playerId, targetPlayerId, disconnectedIds(room));
    if (!result) return { error: "No puedes pasar la Papa Caliente a ese jugador." };
    room.game = result.game;
    room.abilities = result.abilities;
    // skipPapa: pasarla es precisamente no sostenerla.
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore, true);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /** Acelerador de Partículas: vota para activar el efecto colectivo. Ver useAcelerador en abilities.ts. */
  useAcelerador(code: string, playerId: number): { room: Room; consumedEffects: ActiveEffect[] } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };
    const turnError = this.validateOwnTurn(room, playerId);
    if (turnError) return { error: turnError };

    const historyLenBefore = room.abilities.turnHistory.length;
    const turnStartedBefore = room.game.turnStartedAt;
    const result = abilityAcelerador(room.game, room.abilities, playerId, disconnectedIds(room));
    if (!result) return { error: "No puedes usar el Acelerador de Partículas ahora mismo." };
    room.game = result.game;
    room.abilities = result.abilities;
    settleTurnEnd(room, playerId, historyLenBefore, turnStartedBefore);
    const consumedEffects = consumeEffectsForNewTurn(room, playerId);
    return { room, consumedEffects };
  }

  /**
   * Chat de sala completa: cualquier jugador conectado puede mandar un mensaje
   * en cualquier momento, sin importar de quién es el turno (así se definió).
   * No pasa por validateOwnTurn - solo valida que el texto no esté vacío tras
   * recortar espacios, y lo recorta a un largo razonable para evitar abuso.
   * El historial se limita a los últimos CHAT_HISTORY_LIMIT mensajes (se
   * descartan los más viejos), para no acumular memoria indefinidamente en
   * una partida de larga duración.
   */
  sendChatMessage(code: string, playerId: number, text: string): { room: Room; message: ChatMessage } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { error: "No se encontró tu jugador en la sala." };

    const trimmed = text.trim().slice(0, CHAT_MESSAGE_MAX_LENGTH);
    if (trimmed.length === 0) return { error: "El mensaje no puede estar vacío." };

    const message: ChatMessage = {
      playerId,
      playerName: player.name,
      text: trimmed,
      sentAt: Date.now(),
    };

    room.chatHistory = [...room.chatHistory, message].slice(-CHAT_HISTORY_LIMIT);
    return { room, message };
  }

  /**
   * Termina la partida manualmente. Solo el host puede hacerlo.
   * No borra la sala (los jugadores pueden seguir viendo el resultado y reiniciar).
   */
  endGame(code: string, requestingPlayerId: number): { room: Room } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };

    const requester = room.players.find((p) => p.id === requestingPlayerId);
    if (!requester?.isHost) {
      return { error: "Solo el creador de la sala puede terminar la partida." };
    }

    if (room.game.status.kind === "playing") {
      room.game = { ...room.game, status: { kind: "ended_by_host" } };
    }
    return { room };
  }

  /**
   * Cierra o abre la sala a nuevos jugadores. Solo el host puede hacerlo.
   * Cerrar la sala nunca afecta a quienes ya están dentro, ni impide que
   * el host mismo (o cualquier jugador ya presente) se reconecte.
   */
  setLocked(code: string, requestingPlayerId: number, locked: boolean): { room: Room } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "La sala ya no existe." };

    const requester = room.players.find((p) => p.id === requestingPlayerId);
    if (!requester?.isHost) {
      return { error: "Solo el creador de la sala puede cambiar esto." };
    }

    room.locked = locked;
    return { room };
  }

  /** Marca a un jugador como desconectado (por socketId) sin borrarlo de la sala. */
  disconnectBySocketId(socketId: string): { room: Room; player: RoomPlayer } | null {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (player) {
        player.connected = false;
        player.socketId = null;
        if (room.players.every((p) => !p.connected)) {
          room.emptyAt = Date.now();
        }
        return { room, player };
      }
    }
    return null;
  }

  /** Elimina salas que llevan vacías más del TTL configurado. Llamar periódicamente. */
  cleanupEmptyRooms(): number {
    const now = Date.now();
    let removed = 0;
    for (const [code, room] of this.rooms.entries()) {
      if (room.emptyAt !== null && now - room.emptyAt > EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }

  /** Salas activas con partida en curso (status "playing") y modo de tiempo activo. Usado por el servidor para revisar timeouts. */
  roomsWithActiveTimers(): Room[] {
    return [...this.rooms.values()].filter(
      (r) => r.game.status.kind === "playing" && r.game.timerConfig.mode !== "none"
    );
  }

  /**
   * Efectos que corren con el reloj (no con las jugadas): cobro en vivo del
   * Acelerador de Partículas y ventana de segundosParaJugar de la Papa Caliente.
   * El servidor lo llama cada segundo; devuelve solo las salas que cambiaron.
   * Si el daño elimina a quien tenía el turno (y la partida sigue), el turno avanza.
   */
  tickLiveEffects(now: number = Date.now()): { room: Room; consumedEffects: ActiveEffect[] }[] {
    const changed: { room: Room; consumedEffects: ActiveEffect[] }[] = [];
    for (const room of this.rooms.values()) {
      if (room.game.status.kind !== "playing") continue;
      const gameBefore = room.game;
      const abilitiesBefore = room.abilities;

      const acc = tickAcelerador(room.game, room.abilities, now);
      room.game = acc.game;
      room.abilities = acc.abilities;
      if (room.game.status.kind === "playing") {
        const slow = checkPapaCalienteSlow(room.game, room.abilities, now);
        room.game = slow.game;
        room.abilities = slow.abilities;
      }

      if (room.game === gameBefore && room.abilities === abilitiesBefore) continue;

      let consumedEffects: ActiveEffect[] = [];
      if (room.game.status.kind === "playing") {
        const current = room.game.players[room.game.currentPlayerIndex];
        if (current && current.eliminated) {
          // El efecto eliminó a quien tenía el turno: se salta, como al auto-eliminarse con Goyslop.
          const next = nextEligiblePlayerIndex(room.game.players, room.game.currentPlayerIndex, disconnectedIds(room));
          room.abilities = {
            ...room.abilities,
            turnHistory: [...room.abilities.turnHistory, current.id],
            globalTurnIndex: room.abilities.globalTurnIndex + 1,
          };
          room.game = {
            ...room.game,
            currentPlayerIndex: next !== null ? next : room.game.currentPlayerIndex,
            turnStartedAt: Date.now(),
          };
          consumedEffects = consumeEffectsForNewTurn(room, current.id);
        }
      }
      changed.push({ room, consumedEffects });
    }
    return changed;
  }

  roomCount(): number {
    return this.rooms.size;
  }
}
