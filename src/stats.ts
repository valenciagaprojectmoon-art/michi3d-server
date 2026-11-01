/**
 * Resultados de partida para la clasificación. Solo cuentan las cuentas (los invitados no tienen identidad),
 * y para que no se pueda inflar jugando contra invitados o contra uno mismo, una partida solo cuenta si
 * participaron AL MENOS DOS CUENTAS DISTINTAS.
 */

import type { GameStatus } from "./logic.js";

export type Outcome = "win" | "loss" | "draw";
export interface PlayerRef {
  id: number; // id del jugador dentro de la sala
  userId: string | null; // cuenta, o null si es invitado
}
export interface AccountResult {
  userId: string;
  outcome: Outcome;
}

/** Qué resultado le toca a cada cuenta cuando la partida termina. [] si la partida no cuenta. */
export function computeOutcomes(status: GameStatus, players: PlayerRef[]): AccountResult[] {
  if (status.kind === "playing" || status.kind === "ended_by_host") return []; // sin terminar, o cortada a mano: no cuenta
  const accounts = players.filter((p): p is { id: number; userId: string } => p.userId !== null);
  if (new Set(accounts.map((p) => p.userId)).size < 2) return [];
  return accounts.map((p) => ({
    userId: p.userId,
    outcome: status.kind === "draw" ? "draw" : p.id === status.playerId ? "win" : "loss",
  }));
}
