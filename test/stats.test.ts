import { computeOutcomes } from "../src/stats.js";
import { createMemoryUserStore } from "../src/users.js";
let fails = 0; const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const P = (id: number, userId: string | null) => ({ id, userId });
const win = (playerId: number) => ({ kind: "win", playerId, line: [0, 1, 2] }) as any;
const out = (r: ReturnType<typeof computeOutcomes>) => JSON.stringify(r.map((x) => `${x.userId}:${x.outcome}`).sort());

// ---- quién gana y quién pierde ----
ok(out(computeOutcomes(win(0), [P(0, "A"), P(1, "B")])) === '["A:win","B:loss"]', "victoria: gana uno, pierde el otro");
ok(out(computeOutcomes(win(2), [P(0, "A"), P(1, "B"), P(2, "C")])) === '["A:loss","B:loss","C:win"]', "tres jugadores: uno gana y los otros dos pierden");
ok(out(computeOutcomes({ kind: "draw" } as any, [P(0, "A"), P(1, "B")])) === '["A:draw","B:draw"]', "empate: los dos empatan");
ok(out(computeOutcomes({ kind: "win_by_elimination", playerId: 1 } as any, [P(0, "A"), P(1, "B")])) === '["A:loss","B:win"]', "ganar por eliminación (los demás se quedaron sin vida) cuenta como victoria");
ok(computeOutcomes({ kind: "playing" } as any, [P(0, "A"), P(1, "B")]).length === 0, "partida en curso: no cuenta");
ok(computeOutcomes({ kind: "ended_by_host" } as any, [P(0, "A"), P(1, "B")]).length === 0, "partida cortada a mano por el creador: no cuenta");
// ---- anti granja ----
ok(computeOutcomes(win(0), [P(0, "A"), P(1, null)]).length === 0, "una cuenta contra un invitado: no cuenta (no se puede inflar jugando contra invitados)");
ok(computeOutcomes(win(0), [P(0, "A"), P(1, "A")]).length === 0, "la misma cuenta dos veces: no cuenta");
ok(computeOutcomes(win(0), [P(0, null), P(1, null)]).length === 0, "dos invitados: no cuenta");
ok(out(computeOutcomes(win(0), [P(0, "A"), P(1, "B"), P(2, null)])) === '["A:win","B:loss"]', "dos cuentas y un invitado: cuenta para las cuentas, el invitado no figura");
ok(out(computeOutcomes(win(2), [P(0, "A"), P(1, "B"), P(2, null)])) === '["A:loss","B:loss"]', "si gana el invitado, las dos cuentas pierden");

// ---- almacén en memoria: rachas, orden, filtros ----
const store = createMemoryUserStore();
const mk = async (n: string, status: "approved" | "pending" | "banned" = "approved") => { const u = await store.upsertLogin("discord", n, n, "pending"); await store.setStatus(u.id, status); return u.id; };
const a = await mk("ana"), b = await mk("beto"), c = await mk("carol"), d = await mk("dani", "pending"), e = await mk("eva", "banned");
for (const [x, y] of [["win", "loss"], ["win", "loss"], ["loss", "win"], ["win", "loss"]] as const) await store.recordGame([{ userId: a, outcome: x }, { userId: b, outcome: y }]);
let lb = await store.leaderboard(10);
ok(lb[0].name === "ana" && lb[0].wins === 3 && lb[0].losses === 1 && lb[0].games === 4 && lb[0].bestStreak === 2, "ranking: ana 3 victorias, 1 derrota, mejor racha 2 (gana, gana, pierde, gana)");
ok(lb[1].name === "beto" && lb[1].wins === 1 && lb[1].bestStreak === 1, "ranking: beto 1 victoria y mejor racha 1");
await store.recordGame([{ userId: c, outcome: "draw" }, { userId: a, outcome: "draw" }]);
lb = await store.leaderboard(10);
ok(lb.find((r) => r.name === "carol")?.draws === 1 && lb.find((r) => r.name === "ana")?.bestStreak === 2 && lb.find((r) => r.name === "ana")?.games === 5, "un empate suma partida, corta la racha y conserva la mejor");
{ const s2 = createMemoryUserStore(); const m = async (n: string) => (await s2.upsertLogin("discord", n, n, "approved")).id;
  const x = await m("x"), y = await m("y"), z = await m("z");
  await s2.recordGame([{ userId: x, outcome: "win" }, { userId: y, outcome: "win" }, { userId: z, outcome: "win" }]);
  await s2.recordGame([{ userId: x, outcome: "loss" }]);
  await s2.recordGame([{ userId: x, outcome: "win" }, { userId: y, outcome: "win" }, { userId: z, outcome: "win" }]);
  // x: 2 victorias de 3 partidas; y y z: 2 de 2. Mismas victorias: gana el mejor porcentaje; y y z empatan en todo, así que por nombre.
  const byWins = (await s2.leaderboard(10)).map((q) => `${q.name}:${q.wins}/${q.games}`).join(",");
  ok(byWins === "y:2/2,z:2/2,x:2/3", `orden: a igualdad de victorias gana el mejor porcentaje y luego el nombre (${byWins})`); }
await store.recordGame([{ userId: d, outcome: "win" }, { userId: e, outcome: "win" }]);
lb = await store.leaderboard(10);
ok(!lb.some((r) => r.name === "dani" || r.name === "eva"), "las cuentas pendientes y las baneadas no salen en la clasificación");
await store.setStatus(a, "banned", "x");
ok(!(await store.leaderboard(10)).some((r) => r.name === "ana"), "al banear una cuenta desaparece de la clasificación");
await store.setStatus(a, "approved");
ok((await store.leaderboard(10)).some((r) => r.name === "ana"), "al desbanearla vuelve con sus resultados");
ok((await store.leaderboard(1)).length === 1, "el límite se respeta");
ok((await store.resetStats(a)) === true && !(await store.leaderboard(10)).some((r) => r.name === "ana") && (await store.resetStats(a)) === false, "reiniciar estadísticas borra la cuenta de la clasificación (y avisa si no había nada)");
console.log(fails === 0 ? "\nSTATS OK" : `\n${fails} FALLO(S)`); process.exit(fails ? 1 : 0);
