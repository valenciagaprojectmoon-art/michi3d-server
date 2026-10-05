import { RoomManager } from "../src/rooms.js";
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const cfg = {
  brujula_mal_imantada: { maxTurnosAtras: 3 },
  papa_caliente: { turnosParaPasar: 1, segundosParaJugar: 10, danoExplosion: 2, turnosParaRepasar: 0 },
  reloj_roto: {},
};
function setup(timer: any = { mode: "none" }) {
  const m = new RoomManager();
  const { room } = m.createRoom("A", "s0", timer, { startingLife: 5 }, cfg as any, null);
  m.joinRoom(room.code, "B", "s1");
  m.joinRoom(room.code, "C", "s2");
  return { m, code: room.code };
}
const cur = (m: RoomManager, c: string) => m.getRoom(c)!.game.players[m.getRoom(c)!.game.currentPlayerIndex].id;

// T1: turnHistory se llena con jugadas normales
{ const { m, code } = setup();
  m.playMove(code, 0, 0); m.playMove(code, 1, 1);
  ok(JSON.stringify(m.getRoom(code)!.abilities.turnHistory) === "[0,1]", "T1 turnHistory con jugadas normales = [0,1]");
  const bad = m.playMove(code, 2, 0); // celda ocupada
  ok(JSON.stringify(m.getRoom(code)!.abilities.turnHistory) === "[0,1]", "T1b jugada inválida no se registra");
}
// T2: Brújula retrocede sin tocar tablero
{ const { m, code } = setup();
  m.playMove(code, 0, 0); m.playMove(code, 1, 1); m.playMove(code, 2, 2); // turno de 0
  const board = JSON.stringify(m.getRoom(code)!.game.board);
  const r: any = m.useBrujula(code, 0, 2); // tramo [1,2] -> destino 1
  ok(!("error" in r), "T2 Brújula(2) permitida");
  ok(cur(m, code) === 1, "T2 turno retrocede al jugador 1");
  ok(JSON.stringify(m.getRoom(code)!.game.board) === board, "T2 tablero intacto");
  ok(JSON.stringify(m.getRoom(code)!.abilities.turnHistory) === "[0,1,2,0]", "T2 el uso de Brújula queda en historial");
}
// T3: bloqueos
{ const { m, code } = setup();
  ok("error" in (m.useBrujula(code, 0, 1) as any), "T3a historial vacío bloquea");
  m.playMove(code, 0, 0); m.playMove(code, 1, 1); m.playMove(code, 2, 2);
  ok("error" in (m.useBrujula(code, 0, 4) as any), "T3b stepsBack > maxTurnosAtras bloquea");
  ok("error" in (m.useBrujula(code, 0, 0) as any), "T3c stepsBack 0 bloquea");
  ok("error" in (m.useBrujula(code, 0, 1.5) as any), "T3d no entero bloquea");
}
// T4: Reloj Roto en destino bloquea
{ const { m, code } = setup();
  m.playMove(code, 0, 0);
  m.useRelojRoto(code, 1);            // 1 protegido, turno -> 2
  m.playMove(code, 2, 2);             // turno -> 0
  ok("error" in (m.useBrujula(code, 0, 2) as any), "T4 destino con Reloj Roto bloquea");
}
// T5: Papa Caliente
{ const { m, code } = setup();
  ok("error" in (m.usePassPapaCaliente(code, 0, 1) as any), "T5a no se puede pasar sin tenerla");
  const a: any = m.useActivatePapaCaliente(code, 0);
  ok(!("error" in a) && m.getRoom(code)!.abilities.papaCaliente.holderId === 0, "T5b activar la toma, turno consumido");
  ok(cur(m, code) === 1, "T5b turno pasa al 1");
  ok("error" in (m.useActivatePapaCaliente(code, 1) as any), "T5c no se activa si ya hay dueño");
  m.playMove(code, 1, 1); m.playMove(code, 2, 2);        // vuelve a 0: turno 1 del dueño
  m.playMove(code, 0, 3);                                 // termina turno 1 sin pasar: turnsHeld=1
  ok(m.getRoom(code)!.abilities.papaCaliente.turnsHeld === 1, "T5d turnsHeld=1 tras un turno sin pasar");
  ok(m.getRoom(code)!.game.currentLife[0] === 5, "T5d aún sin daño (1 no es > 1)");
  m.playMove(code, 1, 4); m.playMove(code, 2, 5);
  m.playMove(code, 0, 6);                                 // 2 > 1 -> explota
  ok(m.getRoom(code)!.game.currentLife[0] === 3, "T5e explota: -2 de vida");
  ok(m.getRoom(code)!.abilities.papaCaliente.holderId === null, "T5e papa liberada");
}
// T6: pasar la papa y límite de repase
{ const { m, code } = setup();
  m.useActivatePapaCaliente(code, 0);                     // dueño 0, turno -> 1
  m.playMove(code, 1, 1); m.playMove(code, 2, 2);         // turno 0
  const p: any = m.usePassPapaCaliente(code, 0, 2);
  ok(!("error" in p) && m.getRoom(code)!.abilities.papaCaliente.holderId === 2, "T6a pasar a 2");
  ok(m.getRoom(code)!.abilities.papaCaliente.passedOnce === true, "T6a marcada como ya pasada");
  m.playMove(code, 1, 3);                                  // turno 2
  m.playMove(code, 2, 4);                                  // termina turno de 2 sin pasar: 1 > repasar(0) -> explota
  ok(m.getRoom(code)!.game.currentLife[2] === 3, "T6b dueño por pase explota con turnosParaRepasar=0");
}
// T7: Papa Caliente con Shuffle: el dueño puede pasarla aunque no la tenga en la mano
{ const m = new RoomManager();
  const { room } = m.createRoom("A", "s0", { mode: "none" }, { startingLife: 5 }, cfg as any, { handSize: 1, noConsumeUsesPerTurn: 1 });
  m.joinRoom(room.code, "B", "s1"); m.joinRoom(room.code, "C", "s2");
  const code = room.code;
  const R = () => m.getRoom(code)!;
  R().abilities.assigned[0] = ["papa_caliente"];
  m.useActivatePapaCaliente(code, 0);
  m.playMove(code, 1, 1); m.playMove(code, 2, 2);          // vuelve a 0 (mano resorteada)
  R().abilities.assigned[0] = ["reloj_roto"];                // forzamos mano SIN papa
  const p: any = m.usePassPapaCaliente(code, 0, 1);
  ok(!("error" in p) && R().abilities.papaCaliente.holderId === 1, "T7 dueño pasa la papa sin tenerla en la mano");
}
// T8: Acelerador
{ const m = new RoomManager();
  const c2 = { ...cfg, acelerador_particulas: { turnoDeAparicion: 3, segundosPorDano: 5, danoPorTardanza: 2, jugadoresParaActivar: 2 } };
  const { room } = m.createRoom("A", "s0", { mode: "none" }, { startingLife: 10 }, c2 as any, null);
  m.joinRoom(room.code, "B", "s1"); m.joinRoom(room.code, "C", "s2");
  const code = room.code; const R = () => m.getRoom(code)!;
  ok("error" in (m.useAcelerador(code, 0) as any), "T8a no aparece antes del turno de aparición");
  m.playMove(code, 0, 0); m.playMove(code, 1, 1); m.playMove(code, 2, 2);   // globalTurnIndex = 3, turno de 0
  const v1: any = m.useAcelerador(code, 0);
  ok(!("error" in v1) && R().abilities.acelerador.activatedByPlayerIds.length === 1 && !R().abilities.acelerador.effectLive, "T8b primer voto, aún no vivo");
  ok(cur(m, code) === 1, "T8b votar consume turno");
  const v1b: any = m.useAcelerador(code, 1);                                   // jugador 1 vota -> vivo
  ok(!("error" in v1b) && R().abilities.acelerador.effectLive, "T8c segundo voto distinto activa el efecto");
  // jugador 0 no puede votar de nuevo (y ya está vivo)
  m.playMove(code, 2, 3);                                                      // turno de 0 otra vez
  ok("error" in (m.useAcelerador(code, 0) as any), "T8d no se vota dos veces / ya vivo");
  // daño por tardanza: simulamos que el turno de 0 duró 12 s -> 2 ticks de 5s -> 4 daño
  R().game = { ...R().game, turnStartedAt: Date.now() - 12000 };
  m.playMove(code, 0, 4);
  ok(R().game.currentLife[0] === 6, "T8e 12s con tick de 5s y 2 de daño = -4 (10 -> 6)");
  // jugada rápida: sin daño
  m.playMove(code, 1, 5);
  ok(R().game.currentLife[1] === 10, "T8f jugada rápida sin daño");
}
// T9: Acelerador en vivo, sin doble cobro
{ const m = new RoomManager();
  const c2 = { acelerador_particulas: { turnoDeAparicion: 0, segundosPorDano: 5, danoPorTardanza: 2, jugadoresParaActivar: 1 } };
  const { room } = m.createRoom("A", "s0", { mode: "none" }, { startingLife: 10 }, c2 as any, null);
  m.joinRoom(room.code, "B", "s1");
  const code = room.code; const R = () => m.getRoom(code)!;
  m.useAcelerador(code, 0);                                  // 1 voto basta -> vivo; turno de 1
  ok(R().abilities.acelerador.effectLive, "T9a efecto vivo");
  const t0 = R().game.turnStartedAt;
  ok(m.tickLiveEffects(t0 + 4000).length === 0, "T9b a los 4s no hay daño");
  ok(m.tickLiveEffects(t0 + 5500).length === 1 && R().game.currentLife[1] === 8, "T9c a los 5.5s: -2 en vivo");
  ok(m.tickLiveEffects(t0 + 6000).length === 0 && R().game.currentLife[1] === 8, "T9d el mismo tick no se cobra dos veces");
  m.tickLiveEffects(t0 + 10500);                               // 2 ticks acumulados -> -4 total
  ok(R().game.currentLife[1] === 6, "T9e a los 10.5s: -4 en total");
  R().game = { ...R().game, turnStartedAt: t0 }; // mismo turno
  const realNow = Date.now();
  // al cerrar el turno no se vuelven a cobrar ticks ya pagados
  R().game = { ...R().game, turnStartedAt: realNow - 10500 };
  R().abilities = { ...R().abilities, aceleradorTick: { stamp: realNow - 10500, applied: 2 } };
  m.playMove(code, 1, 0);
  ok(R().game.currentLife[1] === 6, "T9f al cerrar el turno no se cobra lo ya cobrado");
}
// T10: Papa Caliente: ventana de segundosParaJugar
{ const m = new RoomManager();
  const c2 = { papa_caliente: { turnosParaPasar: 5, segundosParaJugar: 10, danoExplosion: 3, turnosParaRepasar: 5 } };
  const { room } = m.createRoom("A", "s0", { mode: "none" }, { startingLife: 10 }, c2 as any, null);
  m.joinRoom(room.code, "B", "s1");
  const code = room.code; const R = () => m.getRoom(code)!;
  m.useActivatePapaCaliente(code, 0);                        // turno de 1
  m.playMove(code, 1, 0);                                    // turno de 0
  m.usePassPapaCaliente(code, 0, 1);                         // 1 recibe: awaitingPlay, turno de 1
  ok(R().abilities.papaCaliente.awaitingPlay === true, "T10a recién pasada: awaitingPlay");
  const t0 = R().game.turnStartedAt;
  ok(m.tickLiveEffects(t0 + 9000).length === 0, "T10b a los 9s todavía no explota");
  ok(m.tickLiveEffects(t0 + 11000).length === 1 && R().game.currentLife[1] === 7, "T10c a los 11s explota: -3");
  ok(R().abilities.papaCaliente.holderId === null, "T10c papa liberada");
  // jugar a tiempo cierra la ventana
  const m2 = new RoomManager();
  const r2 = m2.createRoom("A", "s0", { mode: "none" }, { startingLife: 10 }, c2 as any, null).room;
  m2.joinRoom(r2.code, "B", "s1");
  m2.useActivatePapaCaliente(r2.code, 0); m2.playMove(r2.code, 1, 0); m2.usePassPapaCaliente(r2.code, 0, 1);
  m2.playMove(r2.code, 1, 1);
  ok(m2.getRoom(r2.code)!.abilities.papaCaliente.awaitingPlay === false && m2.getRoom(r2.code)!.game.currentLife[1] === 10, "T10d jugar a tiempo cierra la ventana sin daño");
}
// T11: Postcognición copia Brújula
{ const m = new RoomManager();
  const c2 = { brujula_mal_imantada: { maxTurnosAtras: 3 }, postcognicion: {} };
  const { room } = m.createRoom("A", "s0", { mode: "none" }, { startingLife: 10 }, c2 as any, null);
  m.joinRoom(room.code, "B", "s1"); m.joinRoom(room.code, "C", "s2");
  const code = room.code; const R = () => m.getRoom(code)!;
  m.playMove(code, 0, 0); m.playMove(code, 1, 1); m.playMove(code, 2, 2);   // turno de 0
  R().abilities.assigned[0] = ["postcognicion"]; R().abilities.assigned[1] = ["brujula_mal_imantada"];
  const r: any = m.usePostcognicion(code, 0, 1, undefined, undefined, 2);
  ok(!("error" in r) && cur(m, code) === 1, "T11 Postcognición->Brújula(2) retrocede al jugador 1");
  R().abilities.assigned[1] = ["postcognicion"]; R().abilities.assigned[2] = ["brujula_mal_imantada"];
  ok("error" in (m.usePostcognicion(code, 1, 2) as any), "T11b sin número de turnos se rechaza");
}
console.log(fails === 0 ? "\nTODAS LAS PRUEBAS PASARON" : `\n${fails} FALLO(S)`);
process.exit(fails ? 1 : 0);
