import { RoomManager } from "../src/rooms.js";
import {
  normalizeBoardConfig, getWinLines, fractalCellsPerLevel, fractalDimension, indexToCoord, coordToIndex,
  createInitialState, playMove, HOLE, isFractalCellPresent,
} from "../src/logic.js";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log((c ? "OK   " : "FAIL ") + m);
  if (!c) fails++;
};

// ---- el 3D y el 4D no cambian ----
ok(getWinLines({ size: 3, lineLength: 3, dimensions: 3, fractalLevel: 0 }).length === 49, "3D 3x3x3: 49 lineas");
ok(getWinLines({ size: 3, lineLength: 3, dimensions: 4, fractalLevel: 0 }).length === 272, "4D 3x3x3x3: 272 lineas");

// ---- reglas propias del 5D ----
const n5 = normalizeBoardConfig({ dimensions: 5, size: 2, lineLength: 2, fractalLevel: 0 });
ok(n5.dimensions === 5 && n5.size === 3 && n5.lineLength === 3, "5D: tamano minimo 3 y linea minima 3");
ok(normalizeBoardConfig({ dimensions: 5, size: 99, lineLength: 99 }).size === 4, "5D: tamano maximo 4 (1024 casillas)");
ok(normalizeBoardConfig({ dimensions: 5, fractalLevel: 2 }).fractalLevel === 1, "5D: el fractal de nivel 2 baja a 1");
const nf = normalizeBoardConfig({ dimensions: 5, fractalLevel: 1, lineLength: 2 });
ok(nf.size === 3 && nf.lineLength === 3, "5D fractal: tablero de 3 por lado y linea de 3");
ok(normalizeBoardConfig({ dimensions: 7 as never }).dimensions === 3, "dimensiones inventadas vuelven a 3D");

// ---- coordenadas ----
let rt = true;
for (const size of [3, 4]) for (let i = 0; i < size ** 5; i++) if (coordToIndex(indexToCoord(i, size), size) !== i) rt = false;
ok(rt, "indice y coordenada de 5 ejes se convierten de ida y vuelta (3^5 y 4^5)");
const c = indexToCoord(3 ** 5 - 1, 3);
ok(c.x === 2 && c.y === 2 && c.z === 2 && c.w === 2 && c.v === 2, "la ultima casilla de 3^5 es (2,2,2,2,2)");

// ---- lineas ----
const l5 = getWinLines({ size: 3, lineLength: 3, dimensions: 5, fractalLevel: 0 });
ok(l5.length === 1441, `5D 3^5 con linea de 3: 1441 lineas (hay ${l5.length})`);
ok(l5.every((l) => new Set(l).size === 3), "ninguna linea repite casillas");
const l45 = getWinLines({ size: 4, lineLength: 3, dimensions: 5, fractalLevel: 0 });
ok(l45.length > 10000, `5D 4^5 con linea de 3: muchas lineas (${l45.length})`);

// ---- fractal 5D ----
ok(fractalCellsPerLevel(5) === 232, "esponja 5D: 232 de 243 casillas");
ok(Math.abs(fractalDimension(5) - 4.96) < 0.01, "dimension fractal de 5D: 4,96");
const lf = getWinLines({ size: 3, lineLength: 3, dimensions: 5, fractalLevel: 1 });
ok(lf.length > 0 && lf.length < 1441, `con huecos hay menos lineas (${lf.length})`);
ok(lf.every((l) => l.every((i) => isFractalCellPresent(indexToCoord(i, 3), 1, 5))), "ninguna linea pasa por un hueco");
ok(!isFractalCellPresent({ x: 1, y: 1, z: 1, w: 1, v: 1 }, 1, 5), "el centro exacto del 5D es un hueco");

// ---- jugar y ganar con una linea que cruza cubos ----
{
  const cfg = normalizeBoardConfig({ dimensions: 5, size: 3, lineLength: 3, fractalLevel: 0 });
  const players = [
    { id: 0, name: "A", color: "#f00", eliminated: false },
    { id: 1, name: "B", color: "#00f", eliminated: false },
  ];
  let g = createInitialState(players, { mode: "none" }, { startingLife: 10 }, cfg);
  ok(g.board.length === 243, "el tablero 5D tiene 243 casillas");
  // una linea que cambia de cubo (w y v distintos en cada paso)
  const line = l5.find((l) => new Set(l.map((i) => `${indexToCoord(i, 3).w}-${indexToCoord(i, 3).v}`)).size === 3)!;
  const others = g.board.map((_, i) => i).filter((i) => !line.includes(i));
  // el rival juega casillas que no forman nada con nada: se eligen lejos entre si
  const rival = [others[0], others[100]];
  g = playMove(g, line[0]);
  g = playMove(g, rival[0]);
  g = playMove(g, line[1]);
  g = playMove(g, rival[1]);
  g = playMove(g, line[2]);
  ok(g.status.kind === "win" && g.status.playerId === 0, "gana quien completa una linea que cruza cubos distintos del 5D");
}

// ---- servidor ----
{
  const rm = new RoomManager();
  const { room } = rm.createRoom("Ana", "s1", { mode: "none" }, { startingLife: 10 }, {}, null, { dimensions: 5, size: 3, lineLength: 3, fractalLevel: 1 });
  const holes = room.game.board.filter((m) => m === HOLE).length;
  ok(room.game.boardConfig.dimensions === 5 && room.game.board.length === 243 && holes === 11, "el servidor crea una sala 5D con 232 casillas jugables y 11 huecos");
  const r2 = new RoomManager().createRoom("Ana", "s1", { mode: "none" }, { startingLife: 10 }, {}, null, { dimensions: 5, size: 9 as never, lineLength: 1 });
  ok(r2.room.game.boardConfig.size === 4 && r2.room.game.boardConfig.lineLength === 3, "el servidor recorta una sala 5D con valores absurdos");
}

console.log(fails ? `\n${fails} FALLO(S)` : "\nBOARD5D OK");
process.exit(fails ? 1 : 0);
