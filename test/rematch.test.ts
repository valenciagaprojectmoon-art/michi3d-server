import { RoomManager } from "../src/rooms.js";
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
function play() {
  const m = new RoomManager();
  const { room } = m.createRoom("A", "s0", { mode: "none" }, { startingLife: 3 }, {}, null, { size: 2, lineLength: 2 });
  m.joinRoom(room.code, "B", "s1");
  return { m, code: room.code, R: () => m.getRoom(room.code)! };
}
{ const { m, code, R } = play();
  const early: any = m.voteRematch(code, 0);
  ok("error" in early, "revancha: no se puede pedir con la partida en curso");
  m.playMove(code, 0, 0); m.playMove(code, 1, 7); m.playMove(code, 0, 1); // gana el jugador 0 (cubo 2, línea 2)
  ok(R().game.status.kind === "win", "la partida terminó");
  const v1: any = m.voteRematch(code, 0);
  ok(!("error" in v1) && v1.restarted === false && R().rematchVotes.length === 1 && R().game.status.kind === "win", "un voto solo: todavía no reinicia");
  const dup: any = m.voteRematch(code, 0);
  ok(R().rematchVotes.length === 1 && dup.restarted === false, "votar dos veces no cuenta doble");
  const v2: any = m.voteRematch(code, 1);
  ok(v2.restarted === true && R().game.status.kind === "playing" && R().game.board.every((c) => c === null), "con todos los votos se reinicia la partida");
  ok(R().rematchVotes.length === 0, "los votos se vacían tras reiniciar");
  ok(R().game.boardConfig.size === 2 && R().game.board.length === 8, "la revancha conserva la configuración del cubo");
}
// un jugador desconectado no bloquea la revancha
{ const { m, code, R } = play();
  m.playMove(code, 0, 0); m.playMove(code, 1, 7); m.playMove(code, 0, 1);
  R().players[1].connected = false;
  const v: any = m.voteRematch(code, 0);
  ok(v.restarted === true, "si el otro jugador está desconectado, basta con el voto de quien sigue");
}
console.log(fails === 0 ? "\nREMATCH OK" : `\n${fails} FALLO(S)`); process.exit(fails ? 1 : 0);
