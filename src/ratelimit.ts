/**
 * Limitación de peticiones (anti-bombardeo) para el servidor WebSocket + HTTP.
 *
 * Capas, de fuera hacia dentro:
 *  1. Tamaño máximo de mensaje (maxPayload del WebSocketServer, ver server.ts).
 *  2. Por IP: conexiones simultáneas, ritmo de conexiones nuevas, y baneo temporal.
 *  3. Por conexión: ritmo general de mensajes (cubre también JSON basura) y, si
 *     alguien insiste a pesar de los avisos, cierre + baneo temporal de la IP.
 *  4. Por acción: chat, reportes, creación de salas y búsqueda de salas
 *     inexistentes (anti fuerza bruta de códigos de 4 letras).
 *  5. HTTP: ritmo general y bloqueo de intentos fallidos contra /admin.
 *
 * Es un limitador de "cubo de fichas" (token bucket): permite ráfagas cortas
 * (jugar normal nunca se acerca) pero frena el sostenido.
 *
 * PRIVACIDAD: las IPs viven SOLO en memoria, el tiempo justo para limitar, y se
 * descartan al barrer. No se escriben en la base de datos ni en logs de partidas.
 *
 * Todos los valores se pueden ajustar con variables de entorno (ver loadLimits).
 */

import type http from "node:http";

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now: number
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  private refill(now: number) {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.last = now;
  }

  /** Intenta gastar fichas. true = permitido. */
  tryTake(now: number, cost = 1): boolean {
    this.refill(now);
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  /** ¿Habría fichas disponibles? No gasta. */
  canTake(now: number, cost = 1): boolean {
    this.refill(now);
    return this.tokens >= cost;
  }
}

/** Un cubo por clave (IP o similar), con limpieza de claves inactivas. */
export class KeyedLimiter {
  private buckets = new Map<string, { bucket: TokenBucket; lastSeen: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number
  ) {}

  private get(key: string, now: number): { bucket: TokenBucket; lastSeen: number } {
    let entry = this.buckets.get(key);
    if (!entry) {
      entry = { bucket: new TokenBucket(this.capacity, this.refillPerSec, now), lastSeen: now };
      this.buckets.set(key, entry);
    }
    entry.lastSeen = now;
    return entry;
  }

  tryTake(key: string, now: number, cost = 1): boolean {
    return this.get(key, now).bucket.tryTake(now, cost);
  }

  canTake(key: string, now: number, cost = 1): boolean {
    return this.get(key, now).bucket.canTake(now, cost);
  }

  /** Borra claves sin actividad reciente (evita que el mapa crezca sin límite). */
  sweep(now: number, idleMs: number): number {
    let removed = 0;
    for (const [key, entry] of this.buckets) {
      if (now - entry.lastSeen > idleMs) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }
}

export type ConnectionVerdict = "ok" | "limited" | "abusive";

/**
 * Limitador de UNA conexión WebSocket. "limited": se descarta el mensaje (y se
 * avisa de vez en cuando). "abusive": demasiados descartes seguidos → cerrar y banear.
 */
export class ConnectionLimiter {
  private general: TokenBucket;
  private strikes = 0;
  private windowStart: number;

  constructor(
    capacity: number,
    refillPerSec: number,
    private readonly maxStrikes: number,
    private readonly strikeWindowMs: number,
    now: number
  ) {
    this.general = new TokenBucket(capacity, refillPerSec, now);
    this.windowStart = now;
  }

  check(now: number): ConnectionVerdict {
    if (this.general.tryTake(now)) return "ok";
    if (now - this.windowStart > this.strikeWindowMs) {
      this.windowStart = now;
      this.strikes = 0;
    }
    this.strikes++;
    return this.strikes >= this.maxStrikes ? "abusive" : "limited";
  }
}

export type IpVerdict = "ok" | "banned" | "too_many_connections" | "too_fast";

/** Control por IP: baneos temporales, conexiones simultáneas y ritmo de conexiones nuevas. */
export class IpGuard {
  private open = new Map<string, number>();
  private bans = new Map<string, number>(); // ip -> timestamp (ms) hasta el que dura el baneo
  private connRate: KeyedLimiter;

  constructor(
    private readonly maxConcurrent: number,
    connBurst: number,
    connRefillPerSec: number
  ) {
    this.connRate = new KeyedLimiter(connBurst, connRefillPerSec);
  }

  /** Evalúa un intento de conexión. Si es "ok", se cuenta como conexión nueva (llamar luego a onClose). */
  admit(ip: string, now: number): IpVerdict {
    const until = this.bans.get(ip);
    if (until !== undefined) {
      if (until > now) return "banned";
      this.bans.delete(ip);
    }
    if ((this.open.get(ip) ?? 0) >= this.maxConcurrent) return "too_many_connections";
    if (!this.connRate.tryTake(ip, now)) return "too_fast";
    this.open.set(ip, (this.open.get(ip) ?? 0) + 1);
    return "ok";
  }

  onClose(ip: string): void {
    const n = (this.open.get(ip) ?? 0) - 1;
    if (n <= 0) this.open.delete(ip);
    else this.open.set(ip, n);
  }

  ban(ip: string, now: number, durationMs: number): void {
    this.bans.set(ip, now + durationMs);
  }

  isBanned(ip: string, now: number): boolean {
    const until = this.bans.get(ip);
    return until !== undefined && until > now;
  }

  sweep(now: number): void {
    for (const [ip, until] of this.bans) if (until <= now) this.bans.delete(ip);
    this.connRate.sweep(now, 10 * 60 * 1000);
  }
}

/**
 * IP del cliente. Detrás de un proxy (Render) la IP real viene en X-Forwarded-For;
 * cada proxy AÑADE la suya al final, así que lo único fiable es contar desde la
 * derecha: `trustedHops` = nº de proxies de confianza (por defecto 1). Lo que el
 * cliente escriba a la izquierda se ignora, por lo que no puede falsificar su IP.
 * Sin cabecera (ej. pruebas locales) se usa la IP del socket.
 */
export function clientIp(req: http.IncomingMessage, trustedHops: number): string {
  const header = req.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (raw && trustedHops > 0) {
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const idx = Math.max(0, parts.length - trustedHops);
      return parts[idx];
    }
  }
  return req.socket.remoteAddress ?? "desconocida";
}

export interface Limits {
  maxPayloadBytes: number;
  maxConnectionsPerIp: number;
  connBurst: number; // conexiones nuevas en ráfaga por IP
  connRefillPerSec: number;
  msgBurst: number; // mensajes en ráfaga por conexión
  msgRefillPerSec: number; // ritmo sostenido (400/min por defecto); msgBurst permite ráfagas cortas por encima
  maxStrikes: number; // mensajes descartados seguidos que disparan cierre+baneo
  strikeWindowMs: number;
  banMs: number;
  chatBurst: number; // por conexión
  chatRefillPerSec: number;
  reportBurst: number; // por IP
  reportRefillPerSec: number;
  createRoomBurst: number; // por IP
  createRoomRefillPerSec: number;
  failedJoinBurst: number; // por IP: búsquedas de salas inexistentes
  failedJoinRefillPerSec: number;
  httpBurst: number; // por IP
  httpRefillPerSec: number;
  adminFailBurst: number; // por IP: claves de admin incorrectas
  adminFailRefillPerSec: number;
  maxRooms: number;
  trustedProxyHops: number;
}

function num(name: string, fallback: number, min = 0): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && process.env[name] !== undefined && process.env[name] !== "" ? n : fallback;
}

/**
 * Valores por defecto pensados para que una clase entera detrás de la MISMA IP
 * (colegio, red doméstica compartida) pueda jugar sin molestarse, y un bot no.
 * Se pueden ajustar con variables de entorno RL_*.
 */
export function loadLimits(): Limits {
  return {
    maxPayloadBytes: num("RL_MAX_PAYLOAD_BYTES", 16 * 1024, 1024),
    maxConnectionsPerIp: num("RL_MAX_CONN_PER_IP", 40, 1),
    connBurst: num("RL_CONN_BURST", 40, 1),
    connRefillPerSec: num("RL_CONN_REFILL_PER_SEC", 1, 0.01),
    msgBurst: num("RL_MSG_BURST", 30, 1),
    msgRefillPerSec: num("RL_MSG_REFILL_PER_SEC", 400 / 60, 0.1), // 400 peticiones por minuto sostenidas por conexión
    maxStrikes: num("RL_MAX_STRIKES", 40, 1),
    strikeWindowMs: num("RL_STRIKE_WINDOW_MS", 10_000, 1000),
    banMs: num("RL_BAN_MS", 2 * 60 * 1000, 1000),
    chatBurst: num("RL_CHAT_BURST", 5, 1),
    chatRefillPerSec: num("RL_CHAT_REFILL_PER_SEC", 0.5, 0.01),
    reportBurst: num("RL_REPORT_BURST", 10, 1),
    reportRefillPerSec: num("RL_REPORT_REFILL_PER_SEC", 1 / 30, 0.001),
    createRoomBurst: num("RL_CREATE_ROOM_BURST", 10, 1),
    createRoomRefillPerSec: num("RL_CREATE_ROOM_REFILL_PER_SEC", 1 / 30, 0.001),
    failedJoinBurst: num("RL_FAILED_JOIN_BURST", 10, 1),
    failedJoinRefillPerSec: num("RL_FAILED_JOIN_REFILL_PER_SEC", 1 / 6, 0.001),
    httpBurst: num("RL_HTTP_BURST", 60, 1),
    httpRefillPerSec: num("RL_HTTP_REFILL_PER_SEC", 1, 0.01),
    adminFailBurst: num("RL_ADMIN_FAIL_BURST", 5, 1),
    adminFailRefillPerSec: num("RL_ADMIN_FAIL_REFILL_PER_SEC", 1 / 12, 0.001),
    maxRooms: num("RL_MAX_ROOMS", 2000, 1),
    trustedProxyHops: num("TRUST_PROXY_HOPS", 1, 0),
  };
}
