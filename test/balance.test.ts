import { RoomManager } from "../src/rooms.js";
import { sanitizeRoomConfigs } from "../src/sanitize.js";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log((c ? "OK   " : "FAIL ") + m);
  if (!c) fails++;
};

// valores absurdos que podria mandar un cliente roto o malicioso
const s = sanitizeRoomConfigs({
  lifeConfig: { startingLife: 1e9 },
  timerConfig: { mode: "life", secondsPerTurn: 0, onTimeout: "x", damageOnTimeout: -5 },
  abilitiesConfig: {
    papa_caliente: { danoExplosion: 999, segundosParaJugar: -1, turnosParaPasar: "a", turnosParaRepasar: 99 },
    hackeo: {},
    chicharron: { curacion: 1e6 },
  },
  shuffleConfig: { handSize: 50, noConsumeUsesPerTurn: -3 },
});
ok(s.lifeConfig.startingLife === 30, "vida inicial acotada a 30");
ok(s.timerConfig.mode === "life" && s.timerConfig.secondsPerTurn === 5, "segundos por turno nunca por debajo de 5");
ok(s.timerConfig.mode === "life" && s.timerConfig.onTimeout === "skip_turn" && s.timerConfig.damageOnTimeout === 1, "accion de tiempo agotado y dano inválidos vuelven a valores seguros");
const pc = s.abilitiesConfig.papa_caliente;
ok(!!pc && pc.danoExplosion === 29, "la papa nunca mata de golpe a alguien con la vida llena");
ok(!!pc && pc.segundosParaJugar === 5 && pc.turnosParaPasar === 2 && pc.turnosParaRepasar === 10, "parametros de la papa acotados o con valor por defecto");
ok(!("hackeo" in s.abilitiesConfig), "las habilidades que no existen se descartan");
ok(s.abilitiesConfig.chicharron?.curacion === 10, "curacion del chicharron acotada");
ok(!!s.shuffleConfig && s.shuffleConfig.handSize === 2 && s.shuffleConfig.noConsumeUsesPerTurn === 0, "mano de shuffle acotada al numero de habilidades");

const vacio = sanitizeRoomConfigs({});
ok(vacio.timerConfig.mode === "none" && vacio.lifeConfig.startingLife === 3 && vacio.shuffleConfig === null && Object.keys(vacio.abilitiesConfig).length === 0, "sin configuracion: valores por defecto");

const una = sanitizeRoomConfigs({ lifeConfig: { startingLife: 1 }, abilitiesConfig: { goyslop: { curacion: 5, perdidaMaxima: 9 }, acelerador_particulas: { danoPorTardanza: 9 } } });
ok(una.abilitiesConfig.goyslop?.perdidaMaxima === 1 && una.abilitiesConfig.acelerador_particulas?.danoPorTardanza === 1, "con vida 1 ningun efecto hace mas de 1 de dano");

// la sala usa lo saneado
const rm = new RoomManager();
const { room } = rm.createRoom("Ana", "sock1", { mode: "none" }, { startingLife: 1e9 }, { chicharron: { curacion: 3 }, balanza: {} }, null, null);
ok(room.game.lifeConfig.startingLife === 30 && room.game.currentLife[0] === 30, "la sala creada usa la vida acotada");

// guardas anti-bloqueo: no se puede pasar turno gratis con estas habilidades
const r1 = rm.useChicharron(room.code, 0);
ok("error" in r1, "chicharron con la vida llena se rechaza (no sirve para pasar turno gratis)");
const r2 = rm.useBalanza(room.code, 0);
ok("error" in r2, "balanza con la vida igual para todos se rechaza");

console.log(fails ? `\n${fails} FALLO(S)` : "\nBALANCE OK");
process.exit(fails ? 1 : 0);
