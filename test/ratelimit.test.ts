import { TokenBucket, KeyedLimiter, ConnectionLimiter, IpGuard, clientIp, loadLimits } from "../src/ratelimit.js";
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };

// TokenBucket
{ const b = new TokenBucket(3, 1, 0);
  ok(b.tryTake(0) && b.tryTake(0) && b.tryTake(0), "bucket: ráfaga de 3 permitida");
  ok(!b.tryTake(0), "bucket: la 4ª inmediata se bloquea");
  ok(!b.tryTake(500), "bucket: a los 0.5 s todavía no hay ficha");
  ok(b.tryTake(1000), "bucket: a 1 s se recupera 1 ficha");
  ok(!b.tryTake(1000), "bucket: y solo una");
  const c = new TokenBucket(2, 1, 0); c.tryTake(0); c.tryTake(0);
  ok(!c.canTake(0) && c.canTake(2000) && c.canTake(2000), "bucket: canTake no consume");
  const d = new TokenBucket(2, 1, 0); d.tryTake(0);
  ok(d.tryTake(1_000_000) && d.tryTake(1_000_000) && !d.tryTake(1_000_000), "bucket: nunca supera su capacidad");
}
// KeyedLimiter
{ const k = new KeyedLimiter(1, 0.1);
  ok(k.tryTake("a", 0) && !k.tryTake("a", 0) && k.tryTake("b", 0), "keyed: claves independientes");
  ok(k.sweep(10 * 60_000, 60_000) === 2 && k.size === 0, "keyed: sweep elimina claves inactivas");
}
// ConnectionLimiter
{ const c = new ConnectionLimiter(5, 1, 3, 10_000, 0);
  let v = ""; for (let i = 0; i < 5; i++) v = c.check(0);
  ok(v === "ok", "conexión: 5 mensajes en ráfaga pasan");
  ok(c.check(0) === "limited" && c.check(0) === "limited", "conexión: excesos se descartan (limited)");
  ok(c.check(0) === "abusive", "conexión: 3 descartes seguidos -> abusive");
  const c2 = new ConnectionLimiter(1, 1, 3, 10_000, 0);
  c2.check(0); c2.check(0); c2.check(0);
  ok(c2.check(20_000) === "ok" && c2.check(20_000) === "limited", "conexión: tras esperar vuelve a funcionar y las faltas caducan");
}
// IpGuard
{ const g = new IpGuard(2, 100, 100);
  ok(g.admit("1.1.1.1", 0) === "ok" && g.admit("1.1.1.1", 0) === "ok", "ip: 2 conexiones simultáneas ok");
  ok(g.admit("1.1.1.1", 0) === "too_many_connections", "ip: la 3ª simultánea se rechaza");
  g.onClose("1.1.1.1");
  ok(g.admit("1.1.1.1", 0) === "ok", "ip: al cerrar una se libera cupo");
  ok(g.admit("2.2.2.2", 0) === "ok", "ip: otras IP no se ven afectadas");
  g.ban("3.3.3.3", 0, 1000);
  ok(g.admit("3.3.3.3", 500) === "banned" && g.isBanned("3.3.3.3", 500), "ip: baneada rechazada");
  ok(g.admit("3.3.3.3", 1500) === "ok", "ip: el baneo expira solo");
  const r = new IpGuard(100, 2, 0.1);
  r.admit("4.4.4.4", 0); r.admit("4.4.4.4", 0);
  ok(r.admit("4.4.4.4", 0) === "too_fast", "ip: ritmo de conexiones nuevas limitado");
}
// clientIp
{ const req = (xff: string | undefined, remote = "9.9.9.9"): any => ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: remote } });
  ok(clientIp(req(undefined), 1) === "9.9.9.9", "clientIp: sin cabecera usa la IP del socket");
  ok(clientIp(req("5.5.5.5"), 1) === "5.5.5.5", "clientIp: una IP");
  ok(clientIp(req("6.6.6.6, 5.5.5.5"), 1) === "5.5.5.5", "clientIp: con 1 proxy se toma la de más a la derecha (la que añadió el proxy)");
  ok(clientIp(req("1.2.3.4, 6.6.6.6, 5.5.5.5"), 1) === "5.5.5.5", "clientIp: lo que falsifique el cliente a la izquierda se ignora");
  ok(clientIp(req("6.6.6.6, 5.5.5.5"), 2) === "6.6.6.6", "clientIp: con 2 proxies de confianza se retrocede uno");
  ok(clientIp(req("5.5.5.5"), 0) === "9.9.9.9", "clientIp: con 0 proxies de confianza se ignora la cabecera");
}
// loadLimits
{ const l = loadLimits();
  ok(l.msgBurst === 30 && l.maxPayloadBytes === 16384, "loadLimits: valores por defecto");
  process.env.RL_MSG_BURST = "7"; process.env.RL_MAX_ROOMS = "abc";
  const l2 = loadLimits();
  ok(l2.msgBurst === 7 && l2.maxRooms === 2000, "loadLimits: respeta env válido e ignora valores inválidos");
}
// 400 peticiones/min por conexión (valores por defecto reales)
{ delete process.env.RL_MSG_BURST; delete process.env.RL_MAX_ROOMS;
  const L = loadLimits();
  ok(Math.abs(L.msgRefillPerSec * 60 - 400) < 0.01, "400/min: el ritmo sostenido por defecto es 400 por minuto");
  const sim = (perSec: number, seconds: number) => {
    const c = new ConnectionLimiter(L.msgBurst, L.msgRefillPerSec, 1e9, L.strikeWindowMs, 0);
    let blocked = 0;
    for (let i = 0; i < perSec * seconds; i++) if (c.check((i / perSec) * 1000) !== "ok") blocked++;
    return blocked;
  };
  ok(sim(6, 120) === 0, "400/min: un ritmo de 6 mensajes/s (360/min) durante 2 min no bloquea nada");
  ok(sim(10, 60) > 100, "400/min: 10 mensajes/s (600/min) sí se frena");
  ok(sim(100, 5) >= 100 * 5 - 30 - 40, "400/min: una ráfaga de 100/s queda casi toda bloqueada");
}
console.log(fails === 0 ? "\nRATELIMIT OK" : `\n${fails} FALLO(S)`);
process.exit(fails ? 1 : 0);
