/**
 * Lógica pura del juego "Michi 3D" (Tres en raya en cubo 3x3x3).
 * Sin dependencias de UI ni de motor 3D: solo estructuras de datos y funciones.
 */

// ---------- Tipos base ----------

/** Coordenada dentro del cubo, cada eje en [0, 2]. */
export interface Coord {
  x: number;
  y: number;
  z: number;
}

/** Marca de un jugador. null = casilla vacía. */
export type Mark = number | null; // índice de jugador (0, 1, 2...) o null

/** Definición de un jugador. */
export interface Player {
  id: number;
  name: string;
  color: string; // color hex para su marca
  eliminated: boolean; // true si llegó a 0 vidas en modo Vida (nunca vuelve a jugar en esta partida)
}

/** Tablero: 27 casillas indexadas linealmente. */
export type Board = Mark[];

/** Una línea ganadora es una lista de 3 índices lineales del tablero. */
export type WinLine = number[];

export const SIZE = 3;
export const CELL_COUNT = SIZE * SIZE * SIZE; // 27

// ---------- Conversión de coordenadas ----------

/** Convierte coordenada 3D a índice lineal 0..26. */
export function coordToIndex(c: Coord): number {
  return c.x + c.y * SIZE + c.z * SIZE * SIZE;
}

/** Convierte índice lineal a coordenada 3D. */
export function indexToCoord(i: number): Coord {
  const x = i % SIZE;
  const y = Math.floor(i / SIZE) % SIZE;
  const z = Math.floor(i / (SIZE * SIZE));
  return { x, y, z };
}

// ---------- Precálculo de líneas ganadoras ----------

/**
 * Genera todas las líneas rectas válidas de 3 casillas dentro del cubo 3x3x3.
 *
 * Definición formal: una línea válida es una secuencia de 3 puntos
 * {(x0,y0,z0), (x0+dx,y0+dy,z0+dz), (x0+2dx,y0+2dy,z0+2dz)}
 * donde cada componente de (dx,dy,dz) ∈ {-1, 0, 1}, el vector dirección
 * no es (0,0,0), y los 3 puntos caen dentro de [0,2] en cada eje.
 *
 * Esto cubre, por construcción:
 * - Líneas rectas en cada una de las 3 capas por eje (filas, columnas, diagonales de capa)
 * - Líneas rectas "verticales" que atraviesan las 3 capas
 * - Las 4 diagonales espaciales del cubo completo
 * - Diagonales de las "capas diagonales" (planos internos)
 *
 * Se generan combinaciones con dirección canonicalizada (evitando duplicar
 * la misma línea en sentido inverso) usando un Set de líneas normalizadas.
 */
export function computeWinLines(): WinLine[] {
  const directions: Coord[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        directions.push({ x: dx, y: dy, z: dz });
      }
    }
  }

  const seen = new Set<string>();
  const lines: WinLine[] = [];

  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < SIZE; z++) {
        for (const d of directions) {
          const p0: Coord = { x, y, z };
          const p1: Coord = { x: x + d.x, y: y + d.y, z: z + d.z };
          const p2: Coord = { x: x + 2 * d.x, y: y + 2 * d.y, z: z + 2 * d.z };

          if (!inBounds(p1) || !inBounds(p2)) continue;

          const idxs = [coordToIndex(p0), coordToIndex(p1), coordToIndex(p2)];
          const key = [...idxs].sort((a, b) => a - b).join("-");

          if (!seen.has(key)) {
            seen.add(key);
            lines.push(idxs);
          }
        }
      }
    }
  }

  return lines;
}

function inBounds(c: Coord): boolean {
  return c.x >= 0 && c.x < SIZE && c.y >= 0 && c.y < SIZE && c.z >= 0 && c.z < SIZE;
}

/** Líneas ganadoras precalculadas una sola vez al cargar el módulo. */
export const WIN_LINES: WinLine[] = computeWinLines();

// ---------- Estado y reglas del juego ----------

export type GameStatus =
  | { kind: "playing" }
  | { kind: "win"; playerId: number; line: WinLine }
  | { kind: "win_by_elimination"; playerId: number } // ganó porque todos los demás quedaron eliminados
  | { kind: "draw" }
  | { kind: "ended_by_host" }; // el creador de la sala terminó la partida manualmente

/** Qué pasa cuando se acaba el tiempo de un turno. */
export type TimeoutAction = "skip_turn" | "random_move";

/**
 * Configuración de tiempo de la partida, fijada por el creador al armar la sala.
 * "life" ya no trae su propio contador de vidas — resta directamente del sistema
 * de vida global (LifeConfig/currentLife/maxLife abajo), que existe siempre.
 */
export type TimerConfig =
  | { mode: "none" } // sin límite de tiempo, como el juego original
  | { mode: "turn"; secondsPerTurn: number; onTimeout: TimeoutAction }
  | { mode: "life"; secondsPerTurn: number; onTimeout: TimeoutAction; damageOnTimeout: number };

/**
 * Configuración de vida de la partida. A diferencia del timer, esto SIEMPRE está
 * presente — toda partida tiene vida configurada por el creador, independiente
 * de si hay límite de tiempo o no. Habilidades como Chicharrón, Goyslop o Balanza
 * operan sobre este sistema, no sobre el timer.
 */
export interface LifeConfig {
  startingLife: number; // vida (y vida máxima) con la que arranca cada jugador
}

export interface GameState {
  board: Board;
  players: Player[];
  currentPlayerIndex: number;
  status: GameStatus;
  timerConfig: TimerConfig;
  lifeConfig: LifeConfig;
  currentLife: Record<number, number>; // vida actual por playerId
  maxLife: Record<number, number>; // vida máxima por playerId (Goyslop puede reducirla)
  turnStartedAt: number; // timestamp (ms) de cuándo empezó el turno actual, para calcular tiempo restante
}

export function createEmptyBoard(): Board {
  return new Array(CELL_COUNT).fill(null);
}

export const DEFAULT_PLAYERS: Player[] = [
  { id: 0, name: "Jugador 1", color: "#ff5c5c", eliminated: false },
  { id: 1, name: "Jugador 2", color: "#5c9dff", eliminated: false },
];

export const DEFAULT_LIFE_CONFIG: LifeConfig = { startingLife: 3 };

export function createInitialState(
  players: Player[] = DEFAULT_PLAYERS,
  timerConfig: TimerConfig = { mode: "none" },
  lifeConfig: LifeConfig = DEFAULT_LIFE_CONFIG
): GameState {
  const currentLife: Record<number, number> = {};
  const maxLife: Record<number, number> = {};
  for (const p of players) {
    currentLife[p.id] = lifeConfig.startingLife;
    maxLife[p.id] = lifeConfig.startingLife;
  }
  return {
    board: createEmptyBoard(),
    players,
    currentPlayerIndex: 0,
    status: { kind: "playing" },
    timerConfig,
    lifeConfig,
    currentLife,
    maxLife,
    turnStartedAt: Date.now(),
  };
}

/**
 * Revisa el tablero completo contra todas las líneas precalculadas.
 * Devuelve la primera línea ganadora encontrada (y el jugador dueño de ella),
 * o null si nadie ha ganado todavía.
 *
 * Es función pura y reutilizable: no muta el tablero, solo lo lee.
 */
export function checkWinner(board: Board): { playerId: number; line: WinLine } | null {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const markA = board[a];
    if (markA === null) continue;
    if (markA === board[b] && markA === board[c]) {
      return { playerId: markA, line };
    }
  }
  return null;
}

/** El tablero está lleno si no queda ninguna casilla vacía. */
export function isBoardFull(board: Board): boolean {
  return board.every((cell) => cell !== null);
}

/**
 * Calcula el índice (en `players`) del siguiente jugador que debería jugar,
 * empezando a buscar después de `fromIndex` y saltándose jugadores eliminados.
 * `excludeIds` permite además saltarse temporalmente jugadores desconectados
 * (ver rooms.ts, que sí conoce el estado de conexión).
 *
 * Devuelve null si no queda ningún jugador elegible (caso borde: todos eliminados
 * o todos desconectados a la vez, que no debería ocurrir en la práctica pero
 * se maneja explícitamente para no dividir por cero ni entrar en loop infinito).
 */
export function nextEligiblePlayerIndex(
  players: Player[],
  fromIndex: number,
  excludeIds: Set<number> = new Set()
): number | null {
  for (let step = 1; step <= players.length; step++) {
    const candidateIndex = (fromIndex + step) % players.length;
    const candidate = players[candidateIndex];
    if (!candidate.eliminated && !excludeIds.has(candidate.id)) {
      return candidateIndex;
    }
  }
  return null;
}

/**
 * Si tras una eliminación solo queda un jugador no eliminado, ese jugador
 * gana automáticamente (no tiene sentido seguir jugando solo contra el tablero).
 * Devuelve su id, o null si quedan 2+ jugadores activos (la partida sigue).
 */
export function checkWinByElimination(players: Player[]): number | null {
  const active = players.filter((p) => !p.eliminated);
  if (active.length === 1 && players.length > 1) {
    return active[0].id;
  }
  return null;
}

/**
 * Cambia el dueño de una casilla YA OCUPADA a `newOwnerId` (usado por la
 * habilidad Malversión de Fondos). A diferencia de playMove, no valida que la
 * casilla esté vacía — al contrario, se usa exactamente cuando SÍ está ocupada.
 * El llamador (rooms.ts / abilities.ts) es responsable de validar que la
 * casilla objetivo pertenezca a otro jugador, no a quien usa la habilidad.
 *
 * Revisa victoria/empate con las mismas reglas que playMove: si el cambio de
 * dueño completa una línea, se declara ganador; si el tablero queda lleno sin
 * ganador, empate.
 *
 * `advanceTurn` (default true, para no romper el uso existente) controla si
 * el turno avanza al siguiente jugador tras el cambio. Se pasa `false` cuando
 * el llamador (típicamente useMalversionFondos con el sistema de Shuffle
 * activo) decide que este uso no debe consumir el turno — en ese caso el
 * cambio de casilla y la revisión de victoria/empate ocurren igual, pero
 * currentPlayerIndex se queda como estaba.
 */
export function overwriteCell(
  state: GameState,
  index: number,
  newOwnerId: number,
  disconnectedIds: Set<number> = new Set(),
  advanceTurn: boolean = true
): GameState {
  if (state.status.kind !== "playing") return state;
  if (index < 0 || index >= CELL_COUNT) return state;
  if (state.board[index] === null) return state; // esta función es solo para casillas YA ocupadas

  const board = [...state.board];
  board[index] = newOwnerId;

  const win = checkWinner(board);
  let status: GameStatus;
  if (win) {
    status = { kind: "win", playerId: win.playerId, line: win.line };
  } else if (isBoardFull(board)) {
    status = { kind: "draw" };
  } else {
    status = { kind: "playing" };
  }

  let nextIndex = state.currentPlayerIndex;
  if (advanceTurn && status.kind === "playing") {
    const next = nextEligiblePlayerIndex(state.players, state.currentPlayerIndex, disconnectedIds);
    if (next !== null) nextIndex = next;
  }

  return {
    ...state,
    board,
    status,
    currentPlayerIndex: nextIndex,
    turnStartedAt: advanceTurn ? Date.now() : state.turnStartedAt,
  };
}

/**
 * Aplica daño a un jugador: resta de currentLife, sin bajar de 0. Si currentLife
 * llega a 0, marca al jugador como eliminated (mismo mecanismo que el modo Vida
 * del timer) y evalúa victoria por eliminación. `amount` negativo o cero no hace nada.
 */
export function applyDamage(state: GameState, playerId: number, amount: number): GameState {
  if (amount <= 0) return state;
  const current = state.currentLife[playerId] ?? 0;
  const newLife = Math.max(0, current - amount);
  const currentLife = { ...state.currentLife, [playerId]: newLife };

  let players = state.players;
  let status = state.status;
  if (newLife <= 0) {
    players = state.players.map((p) => (p.id === playerId ? { ...p, eliminated: true } : p));
    const winnerByElimination = checkWinByElimination(players);
    if (winnerByElimination !== null) {
      status = { kind: "win_by_elimination", playerId: winnerByElimination };
    }
  }

  return { ...state, currentLife, players, status };
}

/**
 * Cura a un jugador: suma a currentLife, sin superar su maxLife actual.
 * `amount` negativo o cero no hace nada. No revive a un jugador ya eliminado
 * (curar no deshace una eliminación ya ocurrida — es una decisión de diseño
 * conservadora: la eliminación es un evento de la partida, no solo un número).
 */
export function applyHeal(state: GameState, playerId: number, amount: number): GameState {
  if (amount <= 0) return state;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return state;
  const current = state.currentLife[playerId] ?? 0;
  const max = state.maxLife[playerId] ?? 0;
  const newLife = Math.min(max, current + amount);
  return { ...state, currentLife: { ...state.currentLife, [playerId]: newLife } };
}

/**
 * Reduce la vida MÁXIMA de un jugador (Goyslop). Si currentLife queda por encima
 * del nuevo máximo, se recorta también (no puedes tener más vida actual que máxima).
 * Ese recorte puede ser letal por sí mismo si el nuevo máximo llega a 0 o menos.
 */
export function reduceMaxLife(state: GameState, playerId: number, amount: number): GameState {
  if (amount <= 0) return state;
  const currentMax = state.maxLife[playerId] ?? 0;
  const newMax = Math.max(0, currentMax - amount);
  const maxLife = { ...state.maxLife, [playerId]: newMax };

  const currentLifeValue = state.currentLife[playerId] ?? 0;
  if (currentLifeValue > newMax) {
    // El recorte de vida máxima empuja hacia abajo también la vida actual;
    // reutilizamos applyDamage para no duplicar la lógica de eliminación/victoria.
    const clampedState = { ...state, maxLife };
    return applyDamage(clampedState, playerId, currentLifeValue - newMax);
  }

  return { ...state, maxLife };
}

/**
 * Balanza: promedia la vida actual de todos los jugadores NO eliminados (ceil),
 * y todos quedan con ese mismo valor (nunca por encima de su propio máximo
 * individual). Los jugadores eliminados no participan del promedio ni lo reciben.
 * Si el promedio resultante es 0, cualquiera que quede en 0 se marca eliminado,
 * igual que con cualquier otro daño.
 */
export function applyBalance(state: GameState): GameState {
  const activePlayers = state.players.filter((p) => !p.eliminated);
  if (activePlayers.length === 0) return state;

  const total = activePlayers.reduce((sum, p) => sum + (state.currentLife[p.id] ?? 0), 0);
  const averaged = Math.ceil(total / activePlayers.length);

  // Primero fijamos a todos el mismo valor (clamped a su propio máximo individual).
  let currentLife = { ...state.currentLife };
  for (const p of activePlayers) {
    const max = state.maxLife[p.id] ?? 0;
    currentLife[p.id] = Math.min(averaged, max);
  }
  let nextState: GameState = { ...state, currentLife };

  // Luego, cualquiera que haya quedado en 0 se procesa como una eliminación normal
  // (reutilizando applyDamage con amount=0 no serviría porque ya está en 0 y esa función
  // ignora amount<=0; en su lugar marcamos eliminados directamente aquí, es más claro
  // que forzar el paso por applyDamage con un valor artificial).
  let players = nextState.players;
  let status = nextState.status;
  for (const p of activePlayers) {
    if (currentLife[p.id] <= 0) {
      players = players.map((pl) => (pl.id === p.id ? { ...pl, eliminated: true } : pl));
    }
  }
  if (players !== nextState.players) {
    const winnerByElimination = checkWinByElimination(players);
    if (winnerByElimination !== null) {
      status = { kind: "win_by_elimination", playerId: winnerByElimination };
    }
  }

  return { ...nextState, players, status };
}

/**
 * Aplica una jugada: coloca la marca del jugador actual en `index` si es válida.
 * Devuelve un nuevo GameState (inmutable) sin mutar el original.
 * Si la jugada no es válida (fuera de juego, casilla ocupada, partida terminada),
 * devuelve el mismo estado sin cambios.
 */
export function playMove(state: GameState, index: number, disconnectedIds: Set<number> = new Set()): GameState {
  if (state.status.kind !== "playing") return state;
  if (index < 0 || index >= CELL_COUNT) return state;
  if (state.board[index] !== null) return state;

  const board = [...state.board];
  board[index] = state.players[state.currentPlayerIndex].id;

  const win = checkWinner(board);
  let status: GameStatus;
  if (win) {
    status = { kind: "win", playerId: win.playerId, line: win.line };
  } else if (isBoardFull(board)) {
    status = { kind: "draw" };
  } else {
    status = { kind: "playing" };
  }

  let nextIndex = state.currentPlayerIndex;
  if (status.kind === "playing") {
    const next = nextEligiblePlayerIndex(state.players, state.currentPlayerIndex, disconnectedIds);
    // Si no queda nadie elegible (todos desconectados a la vez), nos quedamos donde estábamos;
    // el servidor reintentará cuando alguien vuelva a conectarse.
    if (next !== null) nextIndex = next;
  }

  return {
    ...state,
    board,
    status,
    currentPlayerIndex: nextIndex,
    turnStartedAt: Date.now(),
  };
}

/**
 * Reinicia la partida: tablero vacío, nadie eliminado, vida restaurada al valor
 * inicial configurado, mismos timerConfig/lifeConfig que ya tenía la sala.
 */
export function resetGame(state: GameState): GameState {
  const revivedPlayers = state.players.map((p) => ({ ...p, eliminated: false }));
  return createInitialState(revivedPlayers, state.timerConfig, state.lifeConfig);
}

/**
 * Aplica el efecto de que se acabó el tiempo de un turno, según timerConfig.onTimeout:
 * - "skip_turn": simplemente pasa al siguiente jugador elegible, sin colocar marca.
 * - "random_move": elige una casilla vacía al azar y juega ahí como si el jugador la hubiera elegido.
 * En modo "life", además aplica `damageOnTimeout` de daño al jugador cuyo turno expiró
 * (vía applyDamage, que ya maneja eliminación y victoria por eliminación).
 *
 * No hace nada (devuelve el mismo estado) si timerConfig.mode === "none" o si la
 * partida ya no está en curso — el servidor es responsable de no llamar a esto
 * fuera de esos casos, pero se protege igual por robustez.
 */
export function applyTurnTimeout(state: GameState, disconnectedIds: Set<number> = new Set()): GameState {
  if (state.timerConfig.mode === "none") return state;
  if (state.status.kind !== "playing") return state;

  const timedOutPlayer = state.players[state.currentPlayerIndex];
  let nextState = state;

  // Aplicar daño si el modo es "life", ANTES de mover el turno (para que si esto
  // dispara victoria por eliminación, la partida ya quede en ese estado y no
  // sigamos avanzando el turno de una partida que técnicamente ya terminó).
  if (state.timerConfig.mode === "life") {
    nextState = applyDamage(state, timedOutPlayer.id, state.timerConfig.damageOnTimeout);
    if (nextState.status.kind !== "playing") {
      return nextState; // victoria por eliminación ya resuelta dentro de applyDamage
    }
  }

  // Efecto sobre el tablero/turno: según la variante elegida por el creador.
  if (state.timerConfig.onTimeout === "random_move") {
    const emptyIndices = nextState.board
      .map((cell, i) => (cell === null ? i : -1))
      .filter((i) => i !== -1);
    if (emptyIndices.length > 0) {
      const randomIndex = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
      // playMove ya se encarga de avanzar currentPlayerIndex correctamente.
      return playMove(nextState, randomIndex, disconnectedIds);
    }
    // Sin casillas vacías (tablero lleno): cae al caso skip_turn de abajo.
  }

  // skip_turn (o random_move sin casillas disponibles): avanza el turno sin tocar el tablero.
  const next = nextEligiblePlayerIndex(nextState.players, nextState.currentPlayerIndex, disconnectedIds);
  return {
    ...nextState,
    currentPlayerIndex: next !== null ? next : nextState.currentPlayerIndex,
    turnStartedAt: Date.now(),
  };
}
