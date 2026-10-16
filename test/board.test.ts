import { computeWinLines, getWinLines, normalizeBoardConfig, checkWinner, createInitialState, playMove, resetGame, createEmptyBoard, indexToCoord, coordToIndex, MAX_BOARD_SIZE } from "../src/logic.js";
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
ok(JSON.stringify(nc()) === '{"size":3,"lineLength":3,"dimensions":3}' && JSON.stringify(nc(null)) === '{"size":3,"lineLength":3,"dimensions":3}' && JSON.stringify(nc({})) === '{"size":3,"lineLength":3,"dimensions":3}', "validación: por defecto 3 y 3");
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
import { maxBoardSize, winLinesCacheSize } from "../src/logic.js";
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
console.log(fails === 0 ? "\nBOARD OK" : `\n${fails} FALLO(S)`);
process.exit(fails ? 1 : 0);
