import { computeWinLines, getWinLines, normalizeBoardConfig, checkWinner, createInitialState, playMove, resetGame, createEmptyBoard, indexToCoord, coordToIndex, MAX_BOARD_SIZE, isBoardFull } from "../src/logic.js";
import { RoomManager } from "../src/rooms.js";
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };

// líneas: oráculo de la fórmula conocida ((n+2)^3 - n^3)/2 cuando la línea mide lo mismo que el cubo
for (const n of [2, 3, 4, 5, 6]) {
  const expected = ((n + 2) ** 3 - n ** 3) / 2;
  ok(computeWinLines(n, n).length === expected, `líneas ${n}x${n}x${n} con línea ${n}: ${expected}`);
}
// línea 2 en cubo 3: conteo independiente = pares de casillas vecinas (incluye diagonales)
{ const n = 3; let pairs = 0;
  for (let a = 0; a < n ** 3; a++) for (let b = a + 1; b < n ** 3; b++) {
    const A = indexToCoord(a, n), B = indexToCoord(b, n);
    if (Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z)) === 1) pairs++;
  }
  ok(computeWinLines(3, 2).length === pairs, `líneas de 2 en cubo 3: ${pairs} (conteo independiente por pares vecinos)`);
}
ok(getWinLines({ size: 3, lineLength: 3 }).length === 49, "por defecto siguen siendo 49 líneas");
ok(computeWinLines(4, 3).every((l) => l.length === 3) && computeWinLines(4, 2).every((l) => l.length === 2), "cada línea tiene exactamente lineLength casillas");
ok(getWinLines({ size: 5, lineLength: 4 }) === getWinLines({ size: 5, lineLength: 4 }), "las líneas se cachean");
ok(Array.from({ length: 64 }, (_, i) => i).every((i) => coordToIndex(indexToCoord(i, 4), 4) === i), "índice <-> coordenada ida y vuelta en cubo 4");

// validación
const nc = normalizeBoardConfig;
ok(JSON.stringify(nc()) === '{"size":3,"lineLength":3,"dimensions":3,"fractalLevel":0}' && JSON.stringify(nc(null)) === '{"size":3,"lineLength":3,"dimensions":3,"fractalLevel":0}' && JSON.stringify(nc({})) === '{"size":3,"lineLength":3,"dimensions":3,"fractalLevel":0}', "validación: por defecto 3 y 3");
ok(nc({ size: 1, lineLength: 1 }).size === 2 && nc({ size: 1, lineLength: 1 }).lineLength === 2, "validación: mínimo 2 y 2");
ok(nc({ size: 99 }).size === MAX_BOARD_SIZE && MAX_BOARD_SIZE === 6, "validación: máximo 6");
ok(nc({ size: 4, lineLength: 9 }).lineLength === 4, "validación: la línea no supera el cubo");
ok(nc({ size: 2 }).lineLength === 2, "validación: cubo 2 con línea por defecto 3 baja a 2");
ok(nc({ size: 4.9, lineLength: 3.2 }).size === 4 && nc({ size: 4.9, lineLength: 3.2 }).lineLength === 3, "validación: decimales se truncan");
ok(nc({ size: NaN as any, lineLength: "x" as any }).size === 3 && nc({ size: "5" as any }).size === 3, "validación: basura (NaN, texto) cae al valor por defecto");

// partidas: cubo 2, línea 2 (cualquier pareja contigua gana)
{ let g = createInitialState(undefined, undefined, undefined, { size: 2, lineLength: 2 });
  ok(g.board.length === 8 && g.boardConfig.size === 2, "cubo 2: 8 casillas");
  g = playMove(g, 0); g = playMove(g, 7); g = playMove(g, 1);
  ok(g.status.kind === "win" && (g.status as any).playerId === 0, "cubo 2, línea 2: dos contiguas ganan");
  const r = resetGame(g);
  ok(r.boardConfig.size === 2 && r.board.length === 8 && r.status.kind === "playing", "reiniciar conserva la configuración");
}
// cubo 4, línea 3: tres seguidas ganan, dos no
{ let g = createInitialState(undefined, undefined, undefined, { size: 4, lineLength: 3 });
  g = playMove(g, 0); g = playMove(g, 16); g = playMove(g, 1);
  ok(g.status.kind === "playing", "cubo 4, línea 3: dos seguidas aún no ganan");
  g = playMove(g, 17); g = playMove(g, 2);
  ok(g.status.kind === "win" && (g.status as any).line.length === 3, "cubo 4, línea 3: tres seguidas ganan (línea de 3)");
}
// cubo 4, línea 4: con 3 no basta
{ let g = createInitialState(undefined, undefined, undefined, { size: 4, lineLength: 4 });
  for (const [a, b] of [[0, 16], [1, 17], [2, 18]]) { g = playMove(g, a); g = playMove(g, b); }
  ok(g.status.kind === "playing", "cubo 4, línea 4: tres seguidas no ganan");
  g = playMove(g, 3);
  ok(g.status.kind === "win", "cubo 4, línea 4: cuatro seguidas ganan");
}
// diagonal espacial en cubo 5 línea 5
{ const n = 5; const diag = Array.from({ length: n }, (_, i) => i + i * n + i * n * n);
  const b = createEmptyBoard(n); diag.forEach((i) => (b[i] = 1));
  ok(checkWinner(b, { size: 5, lineLength: 5 })?.playerId === 1, "cubo 5: la diagonal espacial gana");
}
// última jugada
{ let g = createInitialState();
  ok(g.lastMoveIndex === null, "última jugada: null al empezar");
  g = playMove(g, 13);
  ok(g.lastMoveIndex === 13, "última jugada: la casilla recién puesta");
  g = playMove(g, 4);
  ok(g.lastMoveIndex === 4, "última jugada: se actualiza con cada jugada");
  ok(playMove(g, 4).lastMoveIndex === 4, "última jugada: una jugada inválida (casilla ocupada) no la cambia");
  ok(resetGame(g).lastMoveIndex === null, "última jugada: se borra al reiniciar");
}
// sala: la configuración viaja al estado y se valida en el servidor
{ const m = new RoomManager();
  const { room } = m.createRoom("A", "s0", { mode: "none" }, { startingLife: 3 }, {}, null, { size: 99, lineLength: 99 });
  ok(room.game.boardConfig.size === 6 && room.game.boardConfig.lineLength === 6 && room.game.board.length === 216, "sala: cliente pide 99 y el servidor lo limita a 6 (216 casillas)");
  const d = new RoomManager().createRoom("A", "s0").room;
  ok(d.game.boardConfig.size === 3 && d.game.board.length === 27, "sala sin configuración: 3x3x3 como siempre");
}
// rendimiento: cubo máximo con línea mínima
{ const t0 = Date.now(); const lines = computeWinLines(6, 2); const ms = Date.now() - t0;
  let pairs6 = 0;
  for (let a = 0; a < 216; a++) for (let b = a + 1; b < 216; b++) {
    const A = indexToCoord(a, 6), B = indexToCoord(b, 6);
    if (Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z)) === 1) pairs6++;
  }
  ok(lines.length === pairs6 && ms < 1500, `cubo 6, línea 2: ${lines.length} líneas (= ${pairs6} pares vecinos contados aparte) en ${ms} ms`);
  const t1 = Date.now(); const b = createEmptyBoard(6); for (let i = 0; i < 200; i++) checkWinner(b, { size: 6, lineLength: 2 }); 
  ok(Date.now() - t1 < 1500, `200 comprobaciones de victoria en cubo 6, línea 2: ${Date.now() - t1} ms`);
}
// ---------- 4D ----------
import { maxBoardSize, winLinesCacheSize, HOLE, isFractalCellPresent, fractalCellsPerLevel, fractalDimension, applyTurnTimeout, overwriteCell } from "../src/logic.js";
for (const n of [2, 3, 4, 5, 6]) {
  const expected = ((n + 2) ** 4 - n ** 4) / 2; // líneas de un hipercubo n^4 con línea de n
  ok(computeWinLines(n, n, 4).length === expected, `4D: ${n}x${n}x${n}x${n} con línea ${n}: ${expected} líneas`);
}
{ const n = 3; let pairs = 0; const N = n ** 4;
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
    const A = indexToCoord(a, n), B = indexToCoord(b, n);
    if (Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z), Math.abs(A.w - B.w)) === 1) pairs++;
  }
  ok(computeWinLines(3, 2, 4).length === pairs, `4D: líneas de 2 en hipercubo 3 = ${pairs} (conteo independiente por pares vecinos)`); }
ok(computeWinLines(3, 3, 3).length === 49 && getWinLines({ size: 3, lineLength: 3, dimensions: 3 }).length === 49, "3D: sigue habiendo 49 líneas");
ok(getWinLines({ size: 3, lineLength: 3, dimensions: 4 }).length === 272 && getWinLines({ size: 3, lineLength: 3, dimensions: 3 }).length === 49, "la caché distingue 3D y 4D con el mismo tamaño");
ok(Array.from({ length: 256 }, (_, i) => i).every((i) => coordToIndex(indexToCoord(i, 4), 4) === i), "4D: índice <-> coordenada ida y vuelta (256 casillas)");
ok(computeWinLines(3, 3, 4).some((l) => { const w = l.map((i) => indexToCoord(i, 3).w); return new Set(w).size === 3 && l.every((i) => indexToCoord(i, 3).x === indexToCoord(l[0], 3).x); }), "4D: existen líneas que cruzan rodajas de la cuarta dimensión");
ok(computeWinLines(3, 3, 3).every((l) => l.every((i) => indexToCoord(i, 3).w === 0)), "3D: ninguna línea sale de la rodaja w=0");
// validación de dimensiones
ok(nc({ dimensions: 4 }).dimensions === 4 && nc({ dimensions: 4 }).size === 3, "validación: 4D con tamaño por defecto 3");
ok(nc({ dimensions: 4, size: 9 }).size === 6 && maxBoardSize(4) === 6 && maxBoardSize(3) === 6, "validación: en 4D el tamaño máximo es 6 (como en 3D)");
ok(nc({ dimensions: 3, size: 9 }).size === 6, "validación: en 3D el máximo sigue siendo 6");
ok(nc({ dimensions: 2 as any }).dimensions === 3 && nc({ dimensions: 5 as any }).dimensions === 3 && nc({ dimensions: "4" as any }).dimensions === 3 && nc({ dimensions: 1 as any }).dimensions === 3, "validación: solo 3D y 4D (2D, 5D o basura vuelven a 3D)");
ok(nc({ dimensions: 4, size: 2, lineLength: 9 }).lineLength === 2, "validación: la línea no supera el tamaño en 4D");
// partidas en 4D
{ let g = createInitialState(undefined, undefined, undefined, { dimensions: 4, size: 2, lineLength: 2 });
  ok(g.board.length === 16 && g.boardConfig.dimensions === 4, "4D tamaño 2: 16 casillas");
  g = playMove(g, 0); g = playMove(g, 15);
  ok(g.board[0] === 0 && g.board[15] === 1 && g.lastMoveIndex === 15, "4D: las jugadas se colocan en su casilla");
  ok(resetGame(g).boardConfig.dimensions === 4 && resetGame(g).board.length === 16, "4D: reiniciar conserva las dimensiones"); }
{ // línea a lo largo de la cuarta dimensión: casillas con x,y,z iguales y w = 0,1,2 (índices 0, 27, 54 en tamaño 3)
  let g = createInitialState(undefined, undefined, undefined, { dimensions: 4, size: 3, lineLength: 3 });
  g = playMove(g, 0); g = playMove(g, 1); g = playMove(g, 27); g = playMove(g, 2); g = playMove(g, 54);
  ok(g.status.kind === "win" && (g.status as any).playerId === 0 && JSON.stringify((g.status as any).line.slice().sort((a: number, b: number) => a - b)) === "[0,27,54]", "4D: se gana con una línea que cruza las rodajas (casillas 0, 27 y 54)"); }
{ let g = createInitialState(undefined, undefined, undefined, { dimensions: 4, size: 3, lineLength: 3 });
  g = playMove(g, 0); g = playMove(g, 1); g = playMove(g, 27); g = playMove(g, 2);
  ok(g.status.kind === "playing", "4D: dos de tres en la cuarta dimensión todavía no ganan"); }
{ let g = createInitialState(undefined, undefined, undefined, { dimensions: 3, size: 3, lineLength: 3 });
  ok(g.board.length === 27, "3D por defecto: sigue siendo 27 casillas"); }
{ const m = new RoomManager(); const room = m.createRoom("A", "s0", { mode: "none" }, { startingLife: 3 }, {}, null, { dimensions: 4, size: 99, lineLength: 99 } as any).room;
  ok(room.game.boardConfig.dimensions === 4 && room.game.boardConfig.size === 6 && room.game.board.length === 1296, "sala: cliente pide 4D tamaño 99, el servidor lo deja en 4D tamaño 6 (1296 casillas)"); }
{ const t0 = Date.now(); const lines = computeWinLines(6, 2, 4); const ms = Date.now() - t0;
  let pairs = 0; for (let a = 0; a < 1296; a++) for (let b = a + 1; b < 1296; b++) { const A = indexToCoord(a, 6), B = indexToCoord(b, 6); if (Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z), Math.abs(A.w - B.w)) === 1) pairs++; }
  ok(lines.length === pairs && ms < 3000, `4D 6x6x6x6, línea 2: ${lines.length} líneas (= ${pairs} pares contados aparte) en ${ms} ms`);
  const t1 = Date.now(); const b = createEmptyBoard(6, 4); for (let i = 0; i < 100; i++) checkWinner(b, { size: 6, lineLength: 2, dimensions: 4 });
  ok(Date.now() - t1 < 4000, `100 comprobaciones de victoria en el peor caso (6x6x6x6, línea 2): ${Date.now() - t1} ms`); }
{ let g = createInitialState(undefined, undefined, undefined, { dimensions: 4, size: 6, lineLength: 6 });
  ok(g.board.length === 1296, "4D tamaño 6: 1296 casillas");
  // seis a lo largo de la cuarta dimensión: casillas con x,y,z iguales y w = 0..5 (índices 0, 216, 432, ... con tamaño 6)
  const mine = [0, 216, 432, 648, 864, 1080], other = [1, 2, 3, 4, 5];
  for (let k = 0; k < 5; k++) { g = playMove(g, mine[k]); g = playMove(g, other[k]); }
  ok(g.status.kind === "playing", "4D tamaño 6: cinco en la cuarta dimensión todavía no ganan");
  g = playMove(g, mine[5]);
  ok(g.status.kind === "win" && (g.status as any).line.length === 6 && (g.status as any).line.every((i: number) => mine.includes(i)), "4D tamaño 6: seis en la cuarta dimensión ganan"); }
{ // la caché no crece sin límite aunque se usen muchas configuraciones distintas
  for (const dims of [3, 4] as const) for (let size = 2; size <= 6; size++) for (let line = 2; line <= size; line++) getWinLines({ size, lineLength: line, dimensions: dims });
  ok(winLinesCacheSize() <= 8, `la caché de líneas se limita a 8 configuraciones (${winLinesCacheSize()})`);
  const a = getWinLines({ size: 3, lineLength: 3, dimensions: 3 }); ok(a.length === 49, "tras expulsar de la caché, la configuración vuelve a calcularse bien (49 líneas en 3D)"); }
// ---------- fractal (esponja de Menger) ----------
const fb = (level: number, dims: 3 | 4 = 3) => createEmptyBoard(3 ** level, dims, level);
const playable = (b: (number | null)[]) => b.filter((c) => c !== HOLE).length;
ok(playable(fb(1)) === 20 && playable(fb(2)) === 400, "fractal 3D: 20 casillas en el nivel 1 y 400 en el nivel 2 (la esponja de Menger clásica)");
// conteo independiente por combinatoria: k coordenadas en el medio, el resto en una de las 2 esquinas
{ const c3 = 2 ** 3 + 3 * 2 ** 2;                      // 3D: 0 medios = 8, 1 medio = 3*4 = 12
  const c4 = 2 ** 4 + 4 * 2 ** 3 + 6 * 2 ** 2;         // 4D: 0 medios = 16, 1 = 4*8 = 32, 2 = 6*4 = 24
  ok(c3 === 20 && playable(fb(1)) === c3 && c4 === 72 && playable(fb(1, 4)) === c4, "fractal: los conteos 20 (3D) y 72 (4D) coinciden con el cálculo combinatorio independiente"); }
ok(fractalCellsPerLevel(3) === 20 && fractalCellsPerLevel(4) === 72, "fractal: casillas por nivel");
ok(Math.abs(fractalDimension(3) - Math.log(20) / Math.log(3)) < 1e-12 && fractalDimension(3).toFixed(2) === "2.73" && fractalDimension(4).toFixed(2) === "3.89", "fractal: dimensión fractal 2,73 en 3D y 3,89 en 4D");
{ const b = fb(1); const idx = (x: number, y: number, z: number) => x + y * 3 + z * 9;
  ok(b[idx(1, 1, 1)] === HOLE && [[1, 1, 0], [1, 1, 2], [1, 0, 1], [1, 2, 1], [0, 1, 1], [2, 1, 1]].every(([x, y, z]) => b[idx(x, y, z)] === HOLE), "fractal 3D nivel 1: el centro y los 6 centros de cara son huecos");
  ok(b[idx(0, 0, 0)] === null && b[idx(2, 2, 2)] === null && b[idx(1, 0, 0)] === null && b[idx(0, 2, 1)] === null, "fractal 3D nivel 1: las esquinas y las aristas son casillas jugables"); }
{ const b = fb(2); const idx = (x: number, y: number, z: number) => x + y * 9 + z * 81;
  ok(b[idx(4, 4, 4)] === HOLE && b[idx(3, 3, 3)] === HOLE && b[idx(4, 3, 3)] === HOLE, "fractal 3D nivel 2: el bloque central entero (3..5) es hueco");
  ok(b[idx(0, 0, 3)] === null && b[idx(1, 1, 0)] === HOLE && b[idx(0, 0, 1)] === null && b[idx(1, 0, 3)] === null, "fractal 3D nivel 2: el hueco se repite dentro de cada sub-cubo");
  ok(b[idx(1, 1, 0)] === HOLE && b[idx(1, 1, 1)] === HOLE && b[idx(1, 0, 0)] === null, "fractal 3D nivel 2: huecos a escala pequeña dentro del primer sub-cubo"); }
// líneas del nivel 1 en 3D: con línea 3 solo valen las 12 aristas del cubo (cualquier otra pasaría por un hueco)
{ const idx = (x: number, y: number, z: number) => x + y * 3 + z * 9; const edges = new Set<string>();
  for (const axis of [0, 1, 2]) for (const a of [0, 2]) for (const b2 of [0, 2]) { const cells = [0, 1, 2].map((t) => { const p = [a, b2]; p.splice(axis, 0, t); return idx(p[0], p[1], p[2]); }); edges.add(cells.slice().sort((x, y) => x - y).join(",")); }
  const lines = getWinLines({ size: 3, lineLength: 3, dimensions: 3, fractalLevel: 1 });
  ok(edges.size === 12 && lines.length === 12 && lines.every((l) => edges.has(l.slice().sort((x, y) => x - y).join(","))), "fractal 3D nivel 1, línea 3: las líneas son exactamente las 12 aristas del cubo"); }
{ const n = 3, b = fb(1); let pairs = 0;
  for (let a = 0; a < 27; a++) for (let c = a + 1; c < 27; c++) { const A = indexToCoord(a, n), B = indexToCoord(c, n);
    if (b[a] !== HOLE && b[c] !== HOLE && Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z)) === 1) pairs++; }
  ok(getWinLines({ size: 3, lineLength: 2, dimensions: 3, fractalLevel: 1 }).length === pairs, `fractal 3D nivel 1, línea 2: ${pairs} líneas (= pares de casillas vecinas jugables contados aparte)`); }
{ const cfgs = [[1, 3, 3], [2, 3, 3], [1, 4, 3]] as const; let allOk = true;
  for (const [lvl, dims, size] of [[1, 3, 3], [2, 3, 9], [1, 4, 3]] as const) for (let k = 2; k <= size; k++) { const ls = getWinLines({ size, lineLength: k, dimensions: dims, fractalLevel: lvl });
    const bd = createEmptyBoard(size, dims, lvl); if (!ls.length || !ls.every((l) => l.length === k && l.every((i) => bd[i] !== HOLE))) allOk = false; }
  ok(allOk && cfgs.length === 3, "fractal: para toda longitud permitida hay líneas, todas con casillas jugables (nunca pasan por un hueco)"); }
// validación del fractal
ok(JSON.stringify(nc({ fractalLevel: 1 })) === '{"size":3,"lineLength":3,"dimensions":3,"fractalLevel":1}', "fractal: nivel 1 fija el tamaño en 3");
ok(nc({ fractalLevel: 2, size: 4 }).size === 9 && nc({ fractalLevel: 2 }).fractalLevel === 2, "fractal: nivel 2 fija el tamaño en 9 (ignora el tamaño pedido)");
ok(nc({ fractalLevel: 2, dimensions: 4 }).fractalLevel === 1 && nc({ fractalLevel: 2, dimensions: 4 }).size === 3, "fractal: en 4D el nivel 2 baja a 1 (5184 casillas serían demasiadas)");
ok(nc({ fractalLevel: 5 as any }).fractalLevel === 0 && nc({ fractalLevel: "1" as any }).fractalLevel === 0 && nc({ fractalLevel: -1 as any }).fractalLevel === 0, "fractal: niveles inválidos vuelven a 0 (sin fractal)");
ok(nc({ fractalLevel: 2, lineLength: 99 }).lineLength === 9 && nc({ fractalLevel: 1, lineLength: 99 }).lineLength === 3, "fractal: la línea no supera el tamaño");
ok(nc({}).fractalLevel === 0 && createEmptyBoard(3, 3, 0).length === 27 && playable(createEmptyBoard(3, 3, 0)) === 27, "sin fractal: tablero normal sin huecos");
// partidas con huecos
{ let g = createInitialState(undefined, undefined, undefined, { fractalLevel: 1 });
  ok(g.board.length === 27 && g.board.filter((c) => c === HOLE).length === 7, "fractal: el estado tiene 7 huecos en 27");
  const before = g; const after = playMove(g, 13);
  ok(after === before || (after.board[13] === HOLE && after.currentPlayerIndex === before.currentPlayerIndex), "fractal: jugar en un hueco no hace nada ni gasta el turno");
  g = playMove(g, 0); g = playMove(g, 2); g = playMove(g, 9); g = playMove(g, 6); g = playMove(g, 18);
  ok(g.status.kind === "win" && (g.status as any).playerId === 0 && JSON.stringify((g.status as any).line.slice().sort((a: number, b: number) => a - b)) === "[0,9,18]", "fractal: se gana con una arista del cubo (casillas 0, 9 y 18)"); }
{ let g = createInitialState(undefined, undefined, undefined, { fractalLevel: 1, lineLength: 3 });
  g = playMove(g, 0); g = playMove(g, 1); g = playMove(g, 4);  // 4 es el centro de una cara (x=1,y=1,z=0): hueco
  ok(g.board[4] === HOLE && g.currentPlayerIndex === 0, "fractal: una casilla de centro de cara es un hueco y no se puede ocupar"); }
{ const dummy = createInitialState(undefined, undefined, undefined, { fractalLevel: 1 });
  ok(overwriteCell(dummy, 13, 0) === dummy || overwriteCell(dummy, 13, 0).board[13] === HOLE, "fractal: la habilidad que cambia casillas no puede tocar un hueco"); }
{ // empate: el tablero está lleno cuando están ocupadas todas las casillas JUGABLES (los huecos no cuentan)
  const b = createEmptyBoard(3, 3, 1);
  for (let i = 0; i < b.length; i++) if (b[i] === null) b[i] = 0;
  ok(isBoardFull(b) === true, "fractal: con todas las casillas jugables ocupadas el tablero está lleno (empate posible)");
  const b2 = createEmptyBoard(3, 3, 1); for (let i = 0; i < b2.length; i++) if (b2[i] === null && i !== 0) b2[i] = 0;
  ok(isBoardFull(b2) === false, "fractal: con una casilla jugable libre no está lleno"); }
{ // jugada al azar al acabarse el tiempo: nunca elige un hueco
  let bad = 0;
  for (let trial = 0; trial < 300; trial++) {
    const g = createInitialState(undefined, { mode: "turn", secondsPerTurn: 5, onTimeout: "random_move" } as any, undefined, { fractalLevel: 1 });
    const after = applyTurnTimeout(g);
    const placed = after.board.map((c, i) => (c !== g.board[i] ? i : -1)).filter((i) => i >= 0);
    if (placed.length !== 1 || g.board[placed[0]] === HOLE) bad++;
  }
  ok(bad === 0, "fractal: 300 jugadas al azar por tiempo, ninguna cae en un hueco"); }
{ const m = new RoomManager();
  const r2 = m.createRoom("A", "s0", { mode: "none" }, { startingLife: 3 }, {}, null, { fractalLevel: 2, dimensions: 3, size: 3, lineLength: 3 } as any).room;
  ok(r2.game.board.length === 729 && r2.game.board.filter((c) => c === HOLE).length === 329 && r2.game.boardConfig.fractalLevel === 2, "sala: fractal nivel 2 en 3D son 729 casillas, 329 huecos y 400 jugables");
  const r4 = new RoomManager().createRoom("A", "s0", { mode: "none" }, { startingLife: 3 }, {}, null, { fractalLevel: 2, dimensions: 4 } as any).room;
  ok(r4.game.boardConfig.fractalLevel === 1 && r4.game.board.length === 81 && r4.game.board.filter((c) => c === HOLE).length === 9, "sala: fractal en 4D se queda en nivel 1 (81 casillas, 9 huecos, 72 jugables)"); }
{ const t0 = Date.now(); const l2 = getWinLines({ size: 9, lineLength: 2, dimensions: 3, fractalLevel: 2 }); const ms = Date.now() - t0;
  ok(l2.length > 0 && ms < 3000, `fractal 3D nivel 2, línea 2: ${l2.length} líneas en ${ms} ms`); }
console.log(fails === 0 ? "\nBOARD OK" : `\n${fails} FALLO(S)`);
process.exit(fails ? 1 : 0);
