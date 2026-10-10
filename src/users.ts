/**
 * Cuentas de jugador (inicio de sesión con Discord o Google) y su estado: pendiente, aprobada o baneada.
 * Solo se guarda el identificador estable que da el proveedor y el nombre que muestra. Nunca el correo.
 * Con DATABASE_URL se guardan en Postgres; sin ella, en memoria (se pierden al reiniciar, solo para desarrollo).
 */

import { randomUUID } from "node:crypto";
import pg from "pg";

export type Provider = "discord" | "google";
export type UserStatus = "pending" | "approved" | "banned";

export interface User {
  id: string; // id interno nuestro (no el del proveedor)
  provider: Provider;
  providerUserId: string; // id estable del proveedor: Discord `id`, Google `sub`
  displayName: string;
  status: UserStatus;
  banReason: string | null;
  createdAt: number;
  lastLoginAt: number;
}

export interface UserStore {
  readonly kind: "postgres" | "memory";
  init(): Promise<void>;
  /** Entra o se registra. Las cuentas nuevas empiezan con `newStatus`; las que ya existen conservan su estado. */
  upsertLogin(provider: Provider, providerUserId: string, displayName: string, newStatus: UserStatus): Promise<User>;
  get(id: string): Promise<User | null>;
  list(status: UserStatus | null, limit: number): Promise<User[]>;
  setStatus(id: string, status: UserStatus, reason?: string | null): Promise<User | null>;
  close(): Promise<void>;
}

function cleanName(name: string): string {
  const trimmed = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  return trimmed || "jugador";
}

// ---------- Postgres ----------

class PostgresUserStore implements UserStore {
  readonly kind = "postgres" as const;
  private pool: pg.Pool;

  constructor(connectionString: string, poolOverride?: pg.Pool) {
    if (poolOverride) {
      this.pool = poolOverride; // solo para pruebas (Postgres embebido)
      return;
    }
    const useSsl = process.env.PGSSLMODE !== "disable" && !/localhost|127\.0\.0\.1/.test(connectionString);
    this.pool = new pg.Pool({ connectionString, ssl: useSsl ? { rejectUnauthorized: false } : undefined, max: 3 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        ban_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_user_id)
      );
      CREATE INDEX IF NOT EXISTS users_status_idx ON users (status, created_at);
    `);
  }

  private static map(r: Record<string, unknown>): User {
    return {
      id: String(r.id),
      provider: r.provider as Provider,
      providerUserId: String(r.provider_user_id),
      displayName: String(r.display_name),
      status: r.status as UserStatus,
      banReason: (r.ban_reason as string | null) ?? null,
      createdAt: Math.round(Number(r.created_ms)),
      lastLoginAt: Math.round(Number(r.last_login_ms)),
    };
  }

  private static readonly COLS = `id, provider, provider_user_id, display_name, status, ban_reason,
    (EXTRACT(EPOCH FROM created_at)*1000)::float8 AS created_ms, (EXTRACT(EPOCH FROM last_login_at)*1000)::float8 AS last_login_ms`;

  async upsertLogin(provider: Provider, providerUserId: string, displayName: string, newStatus: UserStatus): Promise<User> {
    const res = await this.pool.query(
      `INSERT INTO users (id, provider, provider_user_id, display_name, status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (provider, provider_user_id) DO UPDATE SET display_name = EXCLUDED.display_name, last_login_at = now()
       RETURNING ${PostgresUserStore.COLS}`,
      [randomUUID(), provider, providerUserId, cleanName(displayName), newStatus]
    );
    return PostgresUserStore.map(res.rows[0]);
  }

  async get(id: string): Promise<User | null> {
    const res = await this.pool.query(`SELECT ${PostgresUserStore.COLS} FROM users WHERE id = $1`, [id]);
    return res.rows[0] ? PostgresUserStore.map(res.rows[0]) : null;
  }

  async list(status: UserStatus | null, limit: number): Promise<User[]> {
    const res = status
      ? await this.pool.query(`SELECT ${PostgresUserStore.COLS} FROM users WHERE status = $1 ORDER BY created_at DESC LIMIT $2`, [status, limit])
      : await this.pool.query(`SELECT ${PostgresUserStore.COLS} FROM users ORDER BY created_at DESC LIMIT $1`, [limit]);
    return res.rows.map(PostgresUserStore.map);
  }

  async setStatus(id: string, status: UserStatus, reason: string | null = null): Promise<User | null> {
    const res = await this.pool.query(
      `UPDATE users SET status = $2, ban_reason = $3 WHERE id = $1 RETURNING ${PostgresUserStore.COLS}`,
      [id, status, status === "banned" ? reason : null]
    );
    return res.rows[0] ? PostgresUserStore.map(res.rows[0]) : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ---------- Memoria ----------

class MemoryUserStore implements UserStore {
  readonly kind = "memory" as const;
  private users = new Map<string, User>();

  async init(): Promise<void> {}

  async upsertLogin(provider: Provider, providerUserId: string, displayName: string, newStatus: UserStatus): Promise<User> {
    const now = Date.now();
    for (const u of this.users.values()) {
      if (u.provider === provider && u.providerUserId === providerUserId) {
        u.displayName = cleanName(displayName);
        u.lastLoginAt = now;
        return { ...u };
      }
    }
    const user: User = { id: randomUUID(), provider, providerUserId, displayName: cleanName(displayName), status: newStatus, banReason: null, createdAt: now, lastLoginAt: now };
    this.users.set(user.id, user);
    return { ...user };
  }

  async get(id: string): Promise<User | null> {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async list(status: UserStatus | null, limit: number): Promise<User[]> {
    return [...this.users.values()]
      .filter((u) => !status || u.status === status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((u) => ({ ...u }));
  }

  async setStatus(id: string, status: UserStatus, reason: string | null = null): Promise<User | null> {
    const u = this.users.get(id);
    if (!u) return null;
    u.status = status;
    u.banReason = status === "banned" ? reason : null;
    return { ...u };
  }

  async close(): Promise<void> {}
}

export function createUserStore(databaseUrl: string | undefined, poolOverride?: pg.Pool): UserStore {
  if (poolOverride) return new PostgresUserStore("", poolOverride);
  return databaseUrl ? new PostgresUserStore(databaseUrl) : new MemoryUserStore();
}

export function createMemoryUserStore(): UserStore {
  return new MemoryUserStore();
}
