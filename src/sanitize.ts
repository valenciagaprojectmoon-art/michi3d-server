// Limites de seguridad para lo que el creador de una sala manda desde el cliente.
// El cliente es de confianza solo a medias: un valor absurdo (vida de mil millones, tiempo 0, danos
// negativos, habilidades que no existen) podria arruinar la partida a todos. Aqui se recorta todo
// a rangos jugables y se aplica un criterio de equilibrio: ningun efecto suelto mata de golpe a
// alguien con la vida llena (el dano maximo por efecto es la vida inicial menos 1).

import type { TimerConfig, LifeConfig } from "./logic.js";
import type { AbilitiesConfig, ShuffleConfig } from "./abilities.js";

export const LIMITS = {
  startingLife: [1, 30],
  secondsPerTurn: [5, 300],
  shuffleHand: [1, 5],
  noConsumeUses: [0, 3],
} as const;

function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export interface RoomConfigs {
  timerConfig: TimerConfig;
  lifeConfig: LifeConfig;
  abilitiesConfig: AbilitiesConfig;
  shuffleConfig: ShuffleConfig | null;
}

export function sanitizeRoomConfigs(raw: {
  timerConfig?: unknown;
  lifeConfig?: unknown;
  abilitiesConfig?: unknown;
  shuffleConfig?: unknown;
}): RoomConfigs {
  const startingLife = int(obj(raw.lifeConfig).startingLife, LIMITS.startingLife[0], LIMITS.startingLife[1], 3);
  const cap = Math.max(1, startingLife - 1); // dano maximo por efecto

  const t = obj(raw.timerConfig);
  let timerConfig: TimerConfig = { mode: "none" };
  if (t.mode === "turn" || t.mode === "life") {
    const secondsPerTurn = int(t.secondsPerTurn, LIMITS.secondsPerTurn[0], LIMITS.secondsPerTurn[1], 20);
    const onTimeout = t.onTimeout === "random_move" ? "random_move" : "skip_turn";
    timerConfig =
      t.mode === "turn"
        ? { mode: "turn", secondsPerTurn, onTimeout }
        : { mode: "life", secondsPerTurn, onTimeout, damageOnTimeout: int(t.damageOnTimeout, 1, cap, 1) };
  }

  const a = obj(raw.abilitiesConfig);
  const abilitiesConfig: AbilitiesConfig = {};
  if ("chicharron" in a) abilitiesConfig.chicharron = { curacion: int(obj(a.chicharron).curacion, 1, 10, 3) };
  if ("goyslop" in a) {
    const p = obj(a.goyslop);
    abilitiesConfig.goyslop = { curacion: int(p.curacion, 1, 10, 4), perdidaMaxima: int(p.perdidaMaxima, 1, cap, Math.min(2, cap)) };
  }
  if ("globo_pintura" in a) abilitiesConfig.globo_pintura = { divergencia: int(obj(a.globo_pintura).divergencia, 1, 20, 5) };
  if ("brujula_mal_imantada" in a) abilitiesConfig.brujula_mal_imantada = { maxTurnosAtras: int(obj(a.brujula_mal_imantada).maxTurnosAtras, 1, 5, 2) };
  if ("papa_caliente" in a) {
    const p = obj(a.papa_caliente);
    abilitiesConfig.papa_caliente = {
      turnosParaPasar: int(p.turnosParaPasar, 1, 10, 2),
      segundosParaJugar: int(p.segundosParaJugar, 5, 120, 30),
      danoExplosion: int(p.danoExplosion, 1, cap, Math.min(3, cap)),
      turnosParaRepasar: int(p.turnosParaRepasar, 0, 10, 1),
    };
  }
  if ("acelerador_particulas" in a) {
    const p = obj(a.acelerador_particulas);
    abilitiesConfig.acelerador_particulas = {
      turnoDeAparicion: int(p.turnoDeAparicion, 0, 100, 20),
      segundosPorDano: int(p.segundosPorDano, 3, 60, 10),
      danoPorTardanza: int(p.danoPorTardanza, 1, cap, 1),
      jugadoresParaActivar: int(p.jugadoresParaActivar, 1, 4, 2),
    };
  }
  if ("postcognicion" in a) abilitiesConfig.postcognicion = {};
  if ("balanza" in a) abilitiesConfig.balanza = {};
  if ("reloj_roto" in a) abilitiesConfig.reloj_roto = {};
  if ("malversion_fondos" in a) abilitiesConfig.malversion_fondos = {};

  let shuffleConfig: ShuffleConfig | null = null;
  if (raw.shuffleConfig && typeof raw.shuffleConfig === "object") {
    const s = obj(raw.shuffleConfig);
    const pool = Math.max(1, Object.keys(abilitiesConfig).length);
    shuffleConfig = {
      handSize: int(s.handSize, LIMITS.shuffleHand[0], Math.min(LIMITS.shuffleHand[1], pool), 2),
      noConsumeUsesPerTurn: int(s.noConsumeUsesPerTurn, LIMITS.noConsumeUses[0], LIMITS.noConsumeUses[1], 1),
    };
  }

  return { timerConfig, lifeConfig: { startingLife }, abilitiesConfig, shuffleConfig };
}
