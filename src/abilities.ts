/**
 * Sistema de habilidades de "Michi 3D". Construido como capa aparte sobre
 * logic.ts: importa sus funciones de vida/turnos en vez de duplicarlas.
 *
 * Cada habilidad tiene su propia forma de parámetros (AbilityParams) y su
 * propio estado en progreso por jugador (AbilityRuntimeState) cuando hace
 * falta recordar algo entre turnos (ej. Papa Caliente recordando cuántos
 * turnos lleva sin pasarse).
 */

import type { GameState, Player } from "./logic.js";
import { applyDamage, applyHeal, reduceMaxLife, applyBalance, nextEligiblePlayerIndex, overwriteCell } from "./logic.js";

// ---------- Catálogo de habilidades ----------

export type AbilityId =
  | "papa_caliente"
  | "chicharron"
  | "postcognicion"
  | "acelerador_particulas"
  | "globo_pintura"
  | "balanza"
  | "reloj_roto"
  | "brujula_mal_imantada"
  | "goyslop"
  | "malversion_fondos";

/**
 * Parámetros configurables por el creador de la sala, uno por cada habilidad
 * que decida incluir. Todos los números son libres (sin valor por defecto
 * impuesto por el código) porque así lo pidió el diseño: el creador los define.
 */
export interface AbilityParamsMap {
  papa_caliente: { turnosParaPasar: number; segundosParaJugar: number; danoExplosion: number; turnosParaRepasar: number };
  chicharron: { curacion: number };
  postcognicion: Record<string, never>; // sin parámetros configurables
  acelerador_particulas: { turnoDeAparicion: number; segundosPorDano: number; danoPorTardanza: number; jugadoresParaActivar: number };
  globo_pintura: { divergencia: number };
  balanza: Record<string, never>; // sin parámetros configurables
  reloj_roto: Record<string, never>; // sin parámetros configurables
  brujula_mal_imantada: { maxTurnosAtras: number };
  goyslop: { curacion: number; perdidaMaxima: number };
  malversion_fondos: Record<string, never>; // sin parámetros configurables
}

export type AbilityParams<K extends AbilityId = AbilityId> = AbilityParamsMap[K];

/** Configuración completa de habilidades para una sala: cuáles están activas y con qué parámetros. */
export type AbilitiesConfig = {
  [K in AbilityId]?: AbilityParamsMap[K];
};

// ---------- Estado en progreso de habilidades (vive en GameState) ----------

/** Estado de la Papa Caliente: quién la tiene, hace cuántos turnos, y si está "en juego". */
export interface PapaCalienteState {
  holderId: number | null; // quién la tiene ahora mismo, null si nadie la ha activado todavía
  turnsHeld: number; // turnos que lleva EL DUEÑO ACTUAL sin pasarla ni recibirla-y-jugar
  awaitingPlay: boolean; // true si acaba de pasarse y el nuevo dueño debe jugar rápido (ventana de segundosParaJugar)
}

/** Estado de Acelerador de Partículas: votos acumulados para activar el efecto colectivo. */
export interface AceleradorState {
  activatedByPlayerIds: number[]; // ids de jugadores distintos que ya lo activaron (no se resetea en la partida)
  effectLive: boolean; // true una vez que se alcanzó jugadoresParaActivar — a partir de aquí el daño por tardanza aplica a todos
}

/**
 * Un efecto temporal aplicado a un jugador (Globo de Pintura, Reloj Roto activo).
 * A diferencia de un índice de turno fijo (que no sabe cuántos jugadores hay
 * entre quien lanza el efecto y el objetivo), estos efectos se consumen cuando
 * el propio afectado efectivamente juega su turno — ver consumeEffectsForTurn.
 */
export interface ActiveEffect {
  kind: "screen_distort" | "reloj_roto_active";
  targetPlayerId: number;
  divergence?: number; // solo para screen_distort
}

/**
 * Configuración del sistema de Shuffle (mano rotativa de habilidades), definida
 * por el creador de la sala. Cuando está activo, `AbilitiesConfig` (config)
 * pasa a representar el POOL completo de Y habilidades disponibles en la sala,
 * y `assigned` (ver AbilitiesState abajo) deja de ser una asignación fija:
 * pasa a ser la MANO actual de cada jugador, un subconjunto de tamaño X del
 * pool, que se vuelve a sortear al empezar cada turno de ese jugador.
 */
export interface ShuffleConfig {
  handSize: number; // X: cuántas habilidades ve el jugador a la vez
  noConsumeUsesPerTurn: number; // Z: cuántos usos sin-consumo de turno puede hacer antes de que termine su turno
}

/** Estado completo de habilidades, embebido dentro del GameState del juego. */
export interface AbilitiesState {
  config: AbilitiesConfig; // sin Shuffle: asignación fija. Con Shuffle: el POOL completo (Y habilidades)
  assigned: Record<number, AbilityId[]>; // sin Shuffle: fija. Con Shuffle: la MANO actual (tamaño X)
  shuffle: ShuffleConfig | null; // null = sistema de Shuffle desactivado, comportamiento clásico
  noConsumeUsesRemaining: number; // Z restantes en el turno actual (solo relevante si shuffle no es null)
  papaCaliente: PapaCalienteState;
  acelerador: AceleradorState;
  activeEffects: ActiveEffect[];
  turnHistory: number[]; // ids de jugador en el orden en que jugaron cada turno global (para Brújula)
  globalTurnIndex: number; // contador de turnos absolutos desde el inicio de la partida (para fase tardía y Brújula)
}

export function createInitialAbilitiesState(config: AbilitiesConfig, shuffle: ShuffleConfig | null = null): AbilitiesState {
  return {
    config,
    assigned: {},
    shuffle,
    noConsumeUsesRemaining: shuffle?.noConsumeUsesPerTurn ?? 0,
    papaCaliente: { holderId: null, turnsHeld: 0, awaitingPlay: false },
    acelerador: { activatedByPlayerIds: [], effectLive: false },
    activeEffects: [],
    turnHistory: [],
    globalTurnIndex: 0,
  };
}

/** ¿Esta sala tiene la habilidad `id` habilitada por el creador? */
export function isAbilityEnabled(state: AbilitiesState, id: AbilityId): boolean {
  return id in state.config;
}

/** Habilidades que un jugador tiene asignadas ahora mismo. */
export function getAssignedAbilities(state: AbilitiesState, playerId: number): AbilityId[] {
  return state.assigned[playerId] ?? [];
}

/** ¿El jugador tiene esta habilidad asignada ahora mismo? */
export function hasAbility(state: AbilitiesState, playerId: number, id: AbilityId): boolean {
  return getAssignedAbilities(state, playerId).includes(id);
}

// ---------- Sistema de Shuffle: mano rotativa de habilidades ----------

/**
 * Habilidades que SIEMPRE consumen el turno completo, sin importar si el
 * sistema de Shuffle está activo o cuántos usos-sin-consumo (Z) le queden al
 * jugador. Es una propiedad fija de cada habilidad, no algo que el creador
 * configure — hoy son Chicharrón y Balanza; el resto del catálogo no consume
 * turno cuando Shuffle está activo (sí lo consumen, como siempre, cuando
 * Shuffle está desactivado — ver shouldConsumeTurn más abajo).
 */
const ALWAYS_CONSUMES_TURN: ReadonlySet<AbilityId> = new Set(["chicharron", "balanza"]);

/**
 * Elige X habilidades al azar del pool de Y (sin repetir dentro de la mano).
 * Si el pool tiene menos de X habilidades, la mano simplemente incluye todo
 * el pool (no se puede repartir más de lo que existe).
 */
function drawHand(pool: AbilityId[], handSize: number): AbilityId[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(handSize, shuffled.length));
}

/**
 * Vuelve a sortear la mano de `playerId` a partir del pool completo (state.config),
 * y reinicia su cupo de usos-sin-consumo (Z) a full para el turno que empieza.
 * No hace nada si el sistema de Shuffle está desactivado (state.shuffle === null) —
 * en ese caso la asignación es fija y no rota.
 */
export function reshuffleHandForTurn(state: AbilitiesState, playerId: number): AbilitiesState {
  if (!state.shuffle) return state;
  const pool = Object.keys(state.config) as AbilityId[];
  const newHand = drawHand(pool, state.shuffle.handSize);
  return {
    ...state,
    assigned: { ...state.assigned, [playerId]: newHand },
    noConsumeUsesRemaining: state.shuffle.noConsumeUsesPerTurn,
  };
}

/**
 * ¿Usar `ability` ahora mismo debería consumir el turno completo?
 * - Sin Shuffle activo: SIEMPRE true (comportamiento clásico, sin cambios).
 * - Con Shuffle activo: Chicharrón/Balanza SIEMPRE consumen. El resto NO
 *   consume mientras queden usos en noConsumeUsesRemaining (Z); en cuanto
 *   se agota Z, hasta las habilidades "normales" empiezan a consumir turno
 *   también (evita que el jugador desborde el límite acordado por el host).
 */
export function shouldConsumeTurn(state: Pick<AbilitiesState, "shuffle" | "noConsumeUsesRemaining">, ability: AbilityId): boolean {
  if (!state.shuffle) return true;
  if (ALWAYS_CONSUMES_TURN.has(ability)) return true;
  return state.noConsumeUsesRemaining <= 0;
}

// ---------- Avance de turno tras usar una habilidad ----------

/**
 * Registra que `playerId` usó `ability`, y decide si eso consume su turno
 * completo (ver shouldConsumeTurn) o no:
 *
 * - SI consume (o si el usuario quedó ELIMINADO por el efecto de su propia
 *   habilidad — ver más abajo): registra el turno en el historial, avanza
 *   globalTurnIndex, y calcula a quién le toca después (reutilizando la misma
 *   función de logic.ts que usa playMove/applyTurnTimeout, para que el salto
 *   de jugadores desconectados/eliminados sea siempre idéntico en todo el juego).
 * - NO consume (solo posible con Shuffle activo, y el usuario sigue activo):
 *   el turno sigue siendo del mismo jugador — no se toca currentPlayerIndex,
 *   turnHistory ni globalTurnIndex. Se resta 1 de noConsumeUsesRemaining.
 *
 * CASO ESPECIAL — auto-eliminación (ej. Goyslop letal): si el efecto de la
 * habilidad dejó a `actingPlayerId` eliminado, el turno se fuerza a avanzar
 * SIEMPRE, sin importar shouldConsumeTurn ni cuántos usos Z le quedaran —
 * de lo contrario la partida quedaría esperando indefinidamente a alguien
 * que ya no puede volver a jugar.
 *
 * Devuelve el nuevo GameState y el nuevo AbilitiesState por separado, ya que
 * cada uno vive en su propio lugar dentro de Room.
 */
export function advanceTurnAfterAbility(
  game: GameState,
  abilities: AbilitiesState,
  actingPlayerId: number,
  ability: AbilityId,
  disconnectedIds: Set<number> = new Set()
): { game: GameState; abilities: AbilitiesState } {
  const actingPlayer = game.players.find((p) => p.id === actingPlayerId);
  const selfEliminated = actingPlayer?.eliminated ?? false;

  if (!selfEliminated && !shouldConsumeTurn(abilities, ability)) {
    return {
      game,
      abilities: { ...abilities, noConsumeUsesRemaining: abilities.noConsumeUsesRemaining - 1 },
    };
  }

  const turnHistory = [...abilities.turnHistory, actingPlayerId];
  const globalTurnIndex = abilities.globalTurnIndex + 1;

  let nextIndex = game.currentPlayerIndex;
  if (game.status.kind === "playing") {
    const next = nextEligiblePlayerIndex(game.players, game.currentPlayerIndex, disconnectedIds);
    if (next !== null) nextIndex = next;
  }

  return {
    game: { ...game, currentPlayerIndex: nextIndex, turnStartedAt: Date.now() },
    abilities: { ...abilities, turnHistory, globalTurnIndex },
  };
}

// ---------- Habilidades simples: Chicharrón, Goyslop, Balanza ----------

/**
 * Chicharrón: omite el turno del usuario para curarle `curacion` de vida.
 * No requiere objetivo (siempre se cura a sí mismo). Falla silenciosamente
 * (devuelve el mismo estado) si el jugador no tiene la habilidad asignada,
 * o si no es su turno — el llamador (rooms.ts) es responsable de dar el
 * error correspondiente al usuario; esta función solo aplica el efecto puro.
 */
export function useChicharron(
  game: GameState,
  abilities: AbilitiesState,
  playerId: number,
  disconnectedIds: Set<number> = new Set()
): { game: GameState; abilities: AbilitiesState } | null {
  if (!hasAbility(abilities, playerId, "chicharron")) return null;
  const params = abilities.config.chicharron;
  if (!params) return null;

  const healedGame = applyHeal(game, playerId, params.curacion);
  return advanceTurnAfterAbility(healedGame, abilities, playerId, "chicharron", disconnectedIds);
}

/**
 * Goyslop: cura `curacion` de vida, pero reduce `perdidaMaxima` de vida máxima.
 * Puede ser letal si el recorte de vida máxima empuja currentLife a 0 (ver
 * reduceMaxLife en logic.ts). El orden importa: primero cura, luego recorta el
 * máximo — así el diseño coincide con "cura X, pero pierde Y de vida máxima"
 * tal como se describió (la curación aplica sobre el máximo ANTES del recorte).
 */
export function useGoyslop(
  game: GameState,
  abilities: AbilitiesState,
  playerId: number,
  disconnectedIds: Set<number> = new Set()
): { game: GameState; abilities: AbilitiesState } | null {
  if (!hasAbility(abilities, playerId, "goyslop")) return null;
  const params = abilities.config.goyslop;
  if (!params) return null;

  let nextGame = applyHeal(game, playerId, params.curacion);
  nextGame = reduceMaxLife(nextGame, playerId, params.perdidaMaxima);
  return advanceTurnAfterAbility(nextGame, abilities, playerId, "goyslop", disconnectedIds);
}

/**
 * Balanza: promedia la vida de todos los jugadores activos (ver applyBalance
 * en logic.ts). Sin parámetros configurables, sin objetivo — afecta a todos
 * por igual, incluido quien la usa.
 */
export function useBalanza(
  game: GameState,
  abilities: AbilitiesState,
  playerId: number,
  disconnectedIds: Set<number> = new Set()
): { game: GameState; abilities: AbilitiesState } | null {
  if (!hasAbility(abilities, playerId, "balanza")) return null;

  const balancedGame = applyBalance(game);
  return advanceTurnAfterAbility(balancedGame, abilities, playerId, "balanza", disconnectedIds);
}

// ---------- Targeting: elegir a quién le mandas un efecto ----------

/**
 * Un objetivo válido para una habilidad dirigida a otro jugador es: otro
 * jugador (no uno mismo), que no esté eliminado, y que esté conectado —
 * apuntar a alguien desconectado no tiene un efecto sensato (ej. Globo de
 * Pintura desorientando la pantalla de alguien que ni siquiera está mirando).
 */
export function isValidTarget(
  game: GameState,
  actingPlayerId: number,
  targetPlayerId: number,
  disconnectedIds: Set<number>
): boolean {
  if (targetPlayerId === actingPlayerId) return false;
  const target = game.players.find((p: Player) => p.id === targetPlayerId);
  if (!target || target.eliminated) return false;
  if (disconnectedIds.has(targetPlayerId)) return false;
  return true;
}

/**
 * Un objetivo de CASILLA válido (distinto de isValidTarget, que valida
 * jugadores): la casilla debe estar dentro del tablero, ocupada, y con dueño
 * distinto a quien usa la habilidad (usado por Malversión de Fondos — no
 * tiene sentido "malversar" tu propia marca por la tuya).
 */
export function isValidCellTarget(game: GameState, actingPlayerId: number, cellIndex: number): boolean {
  if (cellIndex < 0 || cellIndex >= game.board.length) return false;
  const owner = game.board[cellIndex];
  if (owner === null) return false; // no se puede malversar una casilla vacía
  if (owner === actingPlayerId) return false; // no tiene sentido sobre tu propia marca
  return true;
}

// ---------- Habilidades con targeting simple: Globo de Pintura, Reloj Roto ----------

/**
 * Globo de Pintura: el usuario elige un enemigo; su pantalla se desorienta al
 * azar con divergencia `divergencia` durante SU próximo turno (el del objetivo,
 * no el de quien lo lanza). El efecto queda pendiente hasta que el objetivo
 * efectivamente juegue — ver consumeEffectsForTurn, que se llama cada vez que
 * alguien juega su turno (jugada normal, timeout, o uso de otra habilidad) y
 * limpia los efectos que le tocaban a esa persona en ese momento.
 */
export function useGloboPintura(
  game: GameState,
  abilities: AbilitiesState,
  playerId: number,
  targetPlayerId: number,
  disconnectedIds: Set<number> = new Set()
): { game: GameState; abilities: AbilitiesState } | null {
  if (!hasAbility(abilities, playerId, "globo_pintura")) return null;
  const params = abilities.config.globo_pintura;
  if (!params) return null;
  if (!isValidTarget(game, playerId, targetPlayerId, disconnectedIds)) return null;

  const effect: ActiveEffect = {
    kind: "screen_distort",
    targetPlayerId,
    divergence: params.divergencia,
  };
  const abilitiesWithEffect: AbilitiesState = {
    ...abilities,
    activeEffects: [...abilities.activeEffects, effect],
  };

  return advanceTurnAfterAbility(game, abilitiesWithEffect, playerId, "globo_pintura", disconnectedIds);
}

/**
 * Reloj Roto: SIN objetivo — protege al propio usuario. Mientras el efecto
 * esté presente en activeEffects, cualquier intento de Brújula Mal Imantada
 * que apunte a este jugador se bloquea (ver useBrujula, en la siguiente
 * tanda; Papa Caliente NO se anula con esto, según lo definido).
 *
 * IMPORTANTE: esta función NO decide cuándo expira el efecto — solo lo crea.
 * El efecto vive en activeEffects hasta que algo llame explícitamente a
 * consumeEffectsForTurn(abilities, playerId). Cuándo llamar eso es una
 * decisión de la capa que orquesta el flujo completo de turno (rooms.ts):
 * la protección debe durar "hasta que este jugador vuelva a jugar su propio
 * turno" (no el turno en que lo activó, que es el mismo instante), así que
 * consumeEffectsForTurn(abilities, playerId) debe llamarse en el momento en
 * que ESTE jugador efectivamente juega su SIGUIENTE turno — no en el turno
 * de activación. La función de esta tanda solo deja el efecto registrado;
 * la conexión con el flujo de turno completo se construye junto con Brújula.
 */
export function useRelojRoto(
  game: GameState,
  abilities: AbilitiesState,
  playerId: number,
  disconnectedIds: Set<number> = new Set()
): { game: GameState; abilities: AbilitiesState } | null {
  if (!hasAbility(abilities, playerId, "reloj_roto")) return null;

  const effect: ActiveEffect = {
    kind: "reloj_roto_active",
    targetPlayerId: playerId,
  };
  const abilitiesWithEffect: AbilitiesState = {
    ...abilities,
    activeEffects: [...abilities.activeEffects, effect],

  };

  return advanceTurnAfterAbility(game, abilitiesWithEffect, playerId, "reloj_roto", disconnectedIds);
}

/**
 * ¿El jugador `playerId` tiene un efecto Reloj Roto activo ahora mismo?
 * Se usa antes de aplicar Brújula: si el objetivo está protegido, Brújula
 * no se puede usar sobre él (ver useBrujula, en la siguiente tanda).
 */
export function hasActiveRelojRoto(abilities: AbilitiesState, playerId: number): boolean {
  return abilities.activeEffects.some((e) => e.kind === "reloj_roto_active" && e.targetPlayerId === playerId);
}

/**
 * Limpia del estado los efectos que le correspondían a `playerId` en este
 * punto del juego:
 * - screen_distort: se consume cuando el objetivo efectivamente juega su
 *   turno (ya "vivió" el turno desorientado).
 * - reloj_roto_active: se consume cuando ESTE jugador vuelve a jugar DESPUÉS
 *   de haberlo activado (protege "hasta que vuelva a jugar" — un turno
 *   completo de protección, no el instante en que se activó).
 *
 * ADVERTENCIA DE USO: no llamar esto con el id de quien acaba de usar Reloj
 * Roto en el mismo turno en que lo activó — eso lo borraría de inmediato y
 * lo volvería inútil. Se llama con el id del jugador cuyo turno EMPIEZA
 * ahora (antes de resolver esa jugada), para limpiar lo que le tocaba desde
 * la vez anterior. rooms.ts es responsable de este orden exacto.
 *
 * Devuelve tanto los efectos consumidos (para que rooms.ts sepa qué avisar al
 * cliente, ej. "tu pantalla se desorienta") como el AbilitiesState limpio.
 */
export function consumeEffectsForTurn(
  abilities: AbilitiesState,
  playerId: number
): { abilities: AbilitiesState; consumed: ActiveEffect[] } {
  const consumed = abilities.activeEffects.filter((e) => e.targetPlayerId === playerId);
  if (consumed.length === 0) return { abilities, consumed: [] };
  const activeEffects = abilities.activeEffects.filter((e) => e.targetPlayerId !== playerId);
  return { abilities: { ...abilities, activeEffects }, consumed };
}

// ---------- Malversión de Fondos: cambia una casilla ajena a tu marca ----------

/**
 * Malversión de Fondos: cambia una casilla YA OCUPADA por otro jugador a la
 * marca de quien usa la habilidad. Revisa victoria/empate normal (si el
 * cambio completa una línea, se gana la partida — igual que cualquier jugada).
 *
 * IMPORTANTE sobre el avance de turno: a diferencia de las demás habilidades
 * (que usan advanceTurnAfterAbility), aquí usamos overwriteCell de logic.ts,
 * que puede o no avanzar currentPlayerIndex según el parámetro `advanceTurn`
 * que le pasamos — decidido aquí mismo con shouldConsumeTurn, igual que el
 * resto del catálogo. Si consume turno, el manejo replica exactamente lo que
 * advanceTurnAfterAbility haría (turnHistory/globalTurnIndex avanzan). Si no
 * consume (Shuffle activo, quedan usos Z), esos campos NO avanzan — el turno
 * sigue siendo del mismo jugador — y se resta 1 de noConsumeUsesRemaining.
 */
export function useMalversionFondos(
  game: GameState,
  abilities: AbilitiesState,
  playerId: number,
  targetCellIndex: number,
  disconnectedIds: Set<number> = new Set()
): { game: GameState; abilities: AbilitiesState } | null {
  if (!hasAbility(abilities, playerId, "malversion_fondos")) return null;
  if (!isValidCellTarget(game, playerId, targetCellIndex)) return null;

  const consumesTurn = shouldConsumeTurn(abilities, "malversion_fondos");
  const newGame = overwriteCell(game, targetCellIndex, playerId, disconnectedIds, consumesTurn);

  const newAbilities: AbilitiesState = consumesTurn
    ? {
        ...abilities,
        turnHistory: [...abilities.turnHistory, playerId],
        globalTurnIndex: abilities.globalTurnIndex + 1,
      }
    : {
        ...abilities,
        noConsumeUsesRemaining: abilities.noConsumeUsesRemaining - 1,
      };

  return { game: newGame, abilities: newAbilities };
}

// ---------- Postcognición: copia la habilidad activa de otro jugador ----------

/** Habilidades que no requieren ningún objetivo (se ejecutan directo sobre quien las usa). */
const NO_TARGET_ABILITIES: ReadonlySet<AbilityId> = new Set(["chicharron", "goyslop", "balanza", "reloj_roto"]);

/**
 * Postcognición: elige un jugador objetivo; copia UNA de sus habilidades
 * asignadas actualmente (la primera de su mano/lista, para que sea
 * determinista) y la ejecuta como si quien usa Postcognición la tuviera.
 *
 * Requiere que el objetivo tenga al menos una habilidad asignada (definido
 * así explícitamente: "No permitas usar Postcognición sobre alguien sin
 * habilidad activa"). Puede copiar cualquier habilidad del catálogo,
 * incluida otra Postcognición o Malversión de Fondos.
 *
 * `secondaryTargetPlayerId`/`secondaryTargetCellIndex` se usan SOLO si la
 * habilidad copiada a su vez necesita un objetivo propio (ej. si copias
 * Globo de Pintura, necesitas indicar a quién se lo tiras; si copias
 * Malversión, qué casilla). Para habilidades sin objetivo (Chicharrón,
 * Goyslop, Balanza, Reloj Roto) estos parámetros se ignoran.
 *
 * El consumo de turno lo decide la habilidad COPIADA (ej. si copias
 * Chicharrón, consume turno siempre; si copias Goyslop con Shuffle activo
 * y quedaba Z, no consume) — Postcognición en sí no tiene su propia regla
 * de consumo, hereda la de lo que copió.
 */
export function usePostcognicion(
  game: GameState,
  abilities: AbilitiesState,
  playerId: number,
  targetPlayerId: number,
  secondaryTargetPlayerId?: number,
  secondaryTargetCellIndex?: number,
  disconnectedIds: Set<number> = new Set()
): { game: GameState; abilities: AbilitiesState } | null {
  if (!hasAbility(abilities, playerId, "postcognicion")) return null;
  if (!isValidTarget(game, playerId, targetPlayerId, disconnectedIds)) return null;

  const targetHand = getAssignedAbilities(abilities, targetPlayerId);
  if (targetHand.length === 0) return null; // "No permitas usar Postcognición sobre alguien sin habilidad activa"

  const copiedAbility = targetHand[0];

  // Postcognición "presta" temporalmente la habilidad copiada a quien la usa,
  // ejecuta esa función de habilidad con playerId como actor, y luego el
  // jugador vuelve a tener solo Postcognición (no se queda con la copiada).
  // Se logra dándole la habilidad copiada de forma efímera en `assigned`
  // antes de delegar, sin que esto persista más allá de esta llamada.
  const lentAbilities: AbilitiesState = {
    ...abilities,
    assigned: { ...abilities.assigned, [playerId]: [copiedAbility] },
  };

  let result: { game: GameState; abilities: AbilitiesState } | null;
  switch (copiedAbility) {
    case "chicharron":
      result = useChicharron(game, lentAbilities, playerId, disconnectedIds);
      break;
    case "goyslop":
      result = useGoyslop(game, lentAbilities, playerId, disconnectedIds);
      break;
    case "balanza":
      result = useBalanza(game, lentAbilities, playerId, disconnectedIds);
      break;
    case "reloj_roto":
      result = useRelojRoto(game, lentAbilities, playerId, disconnectedIds);
      break;
    case "globo_pintura":
      if (secondaryTargetPlayerId === undefined) return null;
      result = useGloboPintura(game, lentAbilities, playerId, secondaryTargetPlayerId, disconnectedIds);
      break;
    case "malversion_fondos":
      if (secondaryTargetCellIndex === undefined) return null;
      result = useMalversionFondos(game, lentAbilities, playerId, secondaryTargetCellIndex, disconnectedIds);
      break;
    case "postcognicion":
      // Copiar Postcognición sobre sí misma sin un objetivo terciario no
      // tiene forma sensata de resolverse en una sola llamada — se trata
      // como "no se pudo copiar" en vez de intentar una recursión infinita
      // de copiar-copias. El resto del catálogo sí es copiable normalmente.
      return null;
    default:
      // papa_caliente, acelerador_particulas, brujula_mal_imantada: cada una
      // tiene su propia forma de parámetros que Postcognición no puede
      // adivinar con esta firma genérica — se rechazan por ahora.
      return null;
  }

  if (!result) return null;

  // Tras ejecutar la copia, el jugador vuelve a tener SOLO Postcognición
  // (no se queda con la habilidad prestada), preservando cualquier otro
  // cambio que la ejecución haya hecho en abilities (turnHistory, efectos, etc.).
  return {
    game: result.game,
    abilities: { ...result.abilities, assigned: { ...result.abilities.assigned, [playerId]: ["postcognicion"] } },
  };
}



