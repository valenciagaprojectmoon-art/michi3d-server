import { RoomManager } from "../src/rooms.js";
import { createInitialState } from "../src/logic.js";
import { createInitialAbilitiesState, usePostcognicion, pickCopiedAbility } from "../src/abilities.js";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log((c ? "OK   " : "FAIL ") + m);
  if (!c) fails++;
};

const cfg = { chicharron: { curacion: 3 } };
function nuevaSala() {
  const rm = new RoomManager();
  const { room } = rm.createRoom("Ana", "s1", { mode: "none" }, { startingLife: 10 }, cfg, null, null);
  return { rm, room, code: room.code };
}
function llena() {
  const t = nuevaSala();
  for (const [n, s] of [["Beto", "s2"], ["Caro", "s3"], ["Dani", "s4"]]) t.rm.joinRoom(t.code, n, s);
  return t;
}

// ---- expulsion ----
{
  const { rm, room, code } = llena();
  ok("error" in rm.joinRoom(code, "Eva", "s5"), "la sala de 4 esta llena");
  rm.setPresence(code, "s2", false);
  rm.setPresence(code, "s3", false);
  const t = Date.now();
  ok(rm.sweepAbsent(t + 30_000, 60_000, 90_000).length === 0, "antes del limite nadie se expulsa");
  const out = rm.sweepAbsent(t + 61_000, 60_000, 90_000);
  ok(out.length === 2 && out.every((o) => o.room.players[o.player.id].expelled === true), "los dos ocultos pasan de 60 s y se expulsan");
  ok(room.players[0].connected && !room.players[0].expelled, "quien sigue a la vista no se toca");
  const eva = rm.joinRoom(code, "Eva", "s5");
  ok(!("error" in eva) && eva.player.id === 1 && eva.player.name === "Eva" && !eva.reconnected, "un hueco expulsado se reutiliza al entrar alguien");
  ok(!("error" in eva) && eva.room.game.currentLife[1] === 10 && eva.room.game.players[1].name === "Eva" && !eva.room.game.players[1].eliminated, "quien ocupa el hueco empieza con vida y nombre nuevos");
  ok(!("error" in eva) && eva.room.abilities.assigned[1].includes("chicharron"), "y con sus habilidades");
}

// ---- nunca al unico presente ----
{
  const { rm, code } = nuevaSala();
  rm.setPresence(code, "s1", false);
  ok(rm.sweepAbsent(Date.now() + 10 * 60_000, 60_000, 90_000).length === 0, "quien esta solo en la sala no se expulsa");
}

// ---- anfitrion y turno ----
{
  const { rm, room, code } = llena();
  rm.setPresence(code, "s1", false); // Ana: anfitriona y con el turno
  const out = rm.sweepAbsent(Date.now() + 61_000, 60_000, 90_000);
  ok(out.length === 1 && room.players[0].expelled === true, "la anfitriona oculta se expulsa");
  ok(!room.players[0].isHost && room.players.filter((p) => p.isHost).length === 1 && room.players.find((p) => p.isHost)!.connected, "el cargo de anfitrion pasa a alguien conectado");
  const cur = room.game.players[room.game.currentPlayerIndex];
  ok(cur.id !== 0 && room.players[cur.id].connected, "el turno pasa a un jugador presente");
}

// ---- desconectados ----
{
  const { rm, room, code } = llena();
  rm.disconnectBySocketId("s3");
  ok(rm.sweepAbsent(Date.now() + 60_000, 60_000, 90_000).length === 0, "un desconectado reciente puede volver");
  const back = rm.joinRoom(code, "Caro", "s9");
  ok(!("error" in back) && back.reconnected && back.player.id === 2, "y vuelve a su sitio con el mismo nombre");
  rm.disconnectBySocketId("s9");
  const out = rm.sweepAbsent(Date.now() + 100_000, 60_000, 90_000);
  ok(out.length === 1 && room.players[2].expelled === true, "un desconectado de mas de 90 s se expulsa");
  const again = rm.joinRoom(code, "Caro", "s10");
  ok(!("error" in again) && !again.reconnected, "un expulsado no recupera su sitio por nombre: entra como nuevo");
}

// ---- hueco con fichas en el tablero no se reutiliza ----
{
  const { rm, room, code } = llena();
  room.game = { ...room.game, board: room.game.board.map((m, i) => (i === 0 ? 2 : m)) };
  rm.setPresence(code, "s3", false);
  rm.sweepAbsent(Date.now() + 61_000, 60_000, 90_000);
  ok("error" in rm.joinRoom(code, "Eva", "s5"), "si el expulsado dejo fichas, su hueco no se reutiliza");
}

// ---- Postcognicion ----
ok(pickCopiedAbility(["postcognicion", "chicharron"]) === "chicharron", "copia la primera que no sea Postcognicion");
ok(pickCopiedAbility(["postcognicion"]) === null, "si solo tiene Postcognicion no hay nada que copiar");
{
  const players = [
    { id: 0, name: "A", color: "#f00", eliminated: false },
    { id: 1, name: "B", color: "#00f", eliminated: false },
  ];
  const game0 = createInitialState(players, { mode: "none" }, { startingLife: 10 });
  const game = { ...game0, currentLife: { ...game0.currentLife, 0: 5 } };
  const ab0 = createInitialAbilitiesState({ postcognicion: {}, chicharron: { curacion: 3 } });
  const hand = ["postcognicion", "chicharron"] as const;
  const abilities = { ...ab0, assigned: { 0: [...hand], 1: [...hand] } };
  const res = usePostcognicion(game, abilities, 0, 1);
  ok(!!res, "Postcognicion funciona aunque la primera habilidad de la mano sea ella misma");
  ok(!!res && res.game.currentLife[0] === 8, "copia Chicharron y cura");
  ok(!!res && res.abilities.assigned[0].length === 2 && res.abilities.assigned[0].includes("chicharron"), "despues de usarla conserva el resto de su mano");
}

// ---- Postcognicion no se salta los bloqueos anti-parada ----
{
  const rm = new RoomManager();
  const { room } = rm.createRoom("Ana", "s1", { mode: "none" }, { startingLife: 10 }, { postcognicion: {}, chicharron: { curacion: 3 } }, null, null);
  rm.joinRoom(room.code, "Beto", "s2");
  const r = rm.usePostcognicion(room.code, 0, 1);
  ok("error" in r, "copiar Chicharron con la vida llena se rechaza tambien por Postcognicion");
}

console.log(fails ? `\n${fails} FALLO(S)` : "\nPRESENCE OK");
process.exit(fails ? 1 : 0);
