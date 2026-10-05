/**
 * Registro persistente del chat de sala (moderación + protocolo general).
 *
 * - Con DATABASE_URL definida (Postgres, p. ej. el de Render) los mensajes sobreviven
 *   a reinicios. Sin ella se usa un almacén EN MEMORIA que se pierde al reiniciar:
 *   sirve para desarrollo, no para producción (el servidor avisa al arrancar).
 * - Retención: los mensajes se borran pasados CHAT_RETENTION_DAYS (30 por defecto).
 *   Cuando alguien REPORTA un mensaje, todo el chat de esa sala queda "retenido"
 *   (held) y se conserva REPORT_RETENTION_DAYS (180 por defecto) para moderación.
 * - Se guarda lo mínimo: sala, id y nombre elegido del jugador, texto, hora y la
 *   versión de los términos aceptados. No hay cuentas, correos ni IPs.
 *
 * IMPORTANTE: los plazos de aquí deben coincidir con los de la Política de
 * Privacidad (michi3d/public/privacidad.html). Si cambias uno, cambia el otro.
 */

import pg from "pg";

export interface ChatLogEntry {
  roomId: string; // `${código}:${createdAt}` — único aunque un código de sala se reutilice
  roomCode: string;
  playerId: number;
  playerName: string;
  text: string;
  sentAt: number; // ms
  termsVersion: string;
}

export interface ChatReportEntry {
  roomId: string;
  roomCode: string;
  reporterId: number;
  reporterName: string;
  reportedPlayerId: number;
  reportedPlayerName: string;
  messageSentAt: number; // ms
  messageText: string;
  reason: string;
}

export interface StoredMessage extends ChatLogEntry {
  id: number;
  held: boolean;
}

export interface StoredReport extends ChatReportEntry {
  id: number;
  createdAt: number;
}

export interface RoomSummary {
  roomId: string;
  roomCode: string;
  messages: number;
  firstAt: number;
  lastAt: number;
  held: boolean;
}

export interface ChatLogStore {
  readonly kind: "postgres" | "memory";
  init(): Promise<void>;
  append(entry: ChatLogEntry): Promise<void>;
  /** Guarda el reporte y retiene todo el chat de la sala. Devuelve cuántos mensajes quedaron retenidos. */
  report(report: ChatReportEntry): Promise<{ held: number }>;
  purge(retentionMs: number, reportRetentionMs: number, now?: number): Promise<{ messages: number; reports: number }>;
  listRooms(limit: number): Promise<RoomSummary[]>;
  listRoom(roomId: string, limit: number): Promise<StoredMessage[]>;
  listReports(limit: number): Promise<StoredReport[]>;
  deleteRoom(roomId: string): Promise<{ messages: number; reports: number }>;
  close(): Promise<void>;
}

// ---------- Postgres ----------

class PostgresChatLogStore implements ChatLogStore {
  readonly kind = "postgres" as const;
  private pool: pg.Pool;

  constructor(connectionString: string) {
    // Render exige TLS en sus Postgres externos; en la red interna no hace falta.
    // PGSSLMODE=disable permite desactivarlo (desarrollo local).
    const useSsl = process.env.PGSSLMODE !== "disable" && !/localhost|127\.0\.0\.1/.test(connectionString);
    this.pool = new pg.Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGSERIAL PRIMARY KEY,
        room_id TEXT NOT NULL,
        room_code TEXT NOT NULL,
        player_id INT NOT NULL,
        player_name TEXT NOT NULL,
        text TEXT NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL,
        terms_version TEXT NOT NULL,
        held BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE INDEX IF NOT EXISTS chat_messages_room_idx ON chat_messages (room_id, sent_at);
      CREATE INDEX IF NOT EXISTS chat_messages_sent_idx ON chat_messages (sent_at);
      CREATE TABLE IF NOT EXISTS chat_reports (
        id BIGSERIAL PRIMARY KEY,
        room_id TEXT NOT NULL,
        room_code TEXT NOT NULL,
        reporter_id INT NOT NULL,
        reporter_name TEXT NOT NULL,
        reported_player_id INT NOT NULL,
        reported_player_name TEXT NOT NULL,
        message_sent_at TIMESTAMPTZ NOT NULL,
        message_text TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS chat_reports_created_idx ON chat_reports (created_at);
    `);
  }

  async append(e: ChatLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO chat_messages (room_id, room_code, player_id, player_name, text, sent_at, terms_version)
       VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),$7)`,
      [e.roomId, e.roomCode, e.playerId, e.playerName, e.text, e.sentAt, e.termsVersion]
    );
  }

  async report(r: ChatReportEntry): Promise<{ held: number }> {
    await this.pool.query(
      `INSERT INTO chat_reports (room_id, room_code, reporter_id, reporter_name, reported_player_id, reported_player_name, message_sent_at, message_text, reason)
       VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),$8,$9)`,
      [r.roomId, r.roomCode, r.reporterId, r.reporterName, r.reportedPlayerId, r.reportedPlayerName, r.messageSentAt, r.messageText, r.reason]
    );
    const res = await this.pool.query(`UPDATE chat_messages SET held = TRUE WHERE room_id = $1`, [r.roomId]);
    return { held: res.rowCount ?? 0 };
  }

  async purge(retentionMs: number, reportRetentionMs: number, now = Date.now()) {
    const msgCutoff = new Date(now - retentionMs);
    const heldCutoff = new Date(now - reportRetentionMs);
    const m1 = await this.pool.query(`DELETE FROM chat_messages WHERE held = FALSE AND sent_at < $1`, [msgCutoff]);
    const m2 = await this.pool.query(`DELETE FROM chat_messages WHERE held = TRUE AND sent_at < $1`, [heldCutoff]);
    const r = await this.pool.query(`DELETE FROM chat_reports WHERE created_at < $1`, [heldCutoff]);
    return { messages: (m1.rowCount ?? 0) + (m2.rowCount ?? 0), reports: r.rowCount ?? 0 };
  }

  async listRooms(limit: number): Promise<RoomSummary[]> {
    const res = await this.pool.query(
      `SELECT room_id, MIN(room_code) AS room_code, COUNT(*)::int AS messages,
              (EXTRACT(EPOCH FROM MIN(sent_at))*1000)::float8 AS first_at,
              (EXTRACT(EPOCH FROM MAX(sent_at))*1000)::float8 AS last_at,
              BOOL_OR(held) AS held
       FROM chat_messages GROUP BY room_id ORDER BY MAX(sent_at) DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map((r) => ({
      roomId: r.room_id,
      roomCode: r.room_code,
      messages: r.messages,
      firstAt: Math.round(r.first_at),
      lastAt: Math.round(r.last_at),
      held: r.held,
    }));
  }

  async listRoom(roomId: string, limit: number): Promise<StoredMessage[]> {
    const res = await this.pool.query(
      `SELECT id, room_id, room_code, player_id, player_name, text, terms_version, held,
              (EXTRACT(EPOCH FROM sent_at)*1000)::float8 AS sent_at
       FROM chat_messages WHERE room_id = $1 ORDER BY sent_at ASC, id ASC LIMIT $2`,
      [roomId, limit]
    );
    return res.rows.map((r) => ({
      id: Number(r.id),
      roomId: r.room_id,
      roomCode: r.room_code,
      playerId: r.player_id,
      playerName: r.player_name,
      text: r.text,
      sentAt: Math.round(r.sent_at),
      termsVersion: r.terms_version,
      held: r.held,
    }));
  }

  async listReports(limit: number): Promise<StoredReport[]> {
    const res = await this.pool.query(
      `SELECT id, room_id, room_code, reporter_id, reporter_name, reported_player_id, reported_player_name, message_text, reason,
              (EXTRACT(EPOCH FROM message_sent_at)*1000)::float8 AS message_sent_at,
              (EXTRACT(EPOCH FROM created_at)*1000)::float8 AS created_at
       FROM chat_reports ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map((r) => ({
      id: Number(r.id),
      roomId: r.room_id,
      roomCode: r.room_code,
      reporterId: r.reporter_id,
      reporterName: r.reporter_name,
      reportedPlayerId: r.reported_player_id,
      reportedPlayerName: r.reported_player_name,
      messageSentAt: Math.round(r.message_sent_at),
      messageText: r.message_text,
      reason: r.reason,
      createdAt: Math.round(r.created_at),
    }));
  }

  async deleteRoom(roomId: string) {
    const m = await this.pool.query(`DELETE FROM chat_messages WHERE room_id = $1`, [roomId]);
    const r = await this.pool.query(`DELETE FROM chat_reports WHERE room_id = $1`, [roomId]);
    return { messages: m.rowCount ?? 0, reports: r.rowCount ?? 0 };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ---------- Memoria (respaldo de desarrollo) ----------

class MemoryChatLogStore implements ChatLogStore {
  readonly kind = "memory" as const;
  private messages: StoredMessage[] = [];
  private reports: StoredReport[] = [];
  private nextId = 1;

  async init(): Promise<void> {}

  async append(e: ChatLogEntry): Promise<void> {
    this.messages.push({ ...e, id: this.nextId++, held: false });
  }

  async report(r: ChatReportEntry): Promise<{ held: number }> {
    this.reports.push({ ...r, id: this.nextId++, createdAt: Date.now() });
    let held = 0;
    for (const m of this.messages) {
      if (m.roomId === r.roomId) {
        m.held = true;
        held++;
      }
    }
    return { held };
  }

  async purge(retentionMs: number, reportRetentionMs: number, now = Date.now()) {
    const before = this.messages.length;
    this.messages = this.messages.filter((m) =>
      m.held ? m.sentAt >= now - reportRetentionMs : m.sentAt >= now - retentionMs
    );
    const reportsBefore = this.reports.length;
    this.reports = this.reports.filter((r) => r.createdAt >= now - reportRetentionMs);
    return { messages: before - this.messages.length, reports: reportsBefore - this.reports.length };
  }

  async listRooms(limit: number): Promise<RoomSummary[]> {
    const map = new Map<string, RoomSummary>();
    for (const m of this.messages) {
      const cur = map.get(m.roomId);
      if (!cur) {
        map.set(m.roomId, { roomId: m.roomId, roomCode: m.roomCode, messages: 1, firstAt: m.sentAt, lastAt: m.sentAt, held: m.held });
      } else {
        cur.messages++;
        cur.firstAt = Math.min(cur.firstAt, m.sentAt);
        cur.lastAt = Math.max(cur.lastAt, m.sentAt);
        cur.held = cur.held || m.held;
      }
    }
    return [...map.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, limit);
  }

  async listRoom(roomId: string, limit: number): Promise<StoredMessage[]> {
    return this.messages
      .filter((m) => m.roomId === roomId)
      .sort((a, b) => a.sentAt - b.sentAt || a.id - b.id)
      .slice(0, limit);
  }

  async listReports(limit: number): Promise<StoredReport[]> {
    return [...this.reports].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  async deleteRoom(roomId: string) {
    const mBefore = this.messages.length;
    const rBefore = this.reports.length;
    this.messages = this.messages.filter((m) => m.roomId !== roomId);
    this.reports = this.reports.filter((r) => r.roomId !== roomId);
    return { messages: mBefore - this.messages.length, reports: rBefore - this.reports.length };
  }

  async close(): Promise<void> {}
}

export function createChatLogStore(databaseUrl: string | undefined): ChatLogStore {
  return databaseUrl ? new PostgresChatLogStore(databaseUrl) : new MemoryChatLogStore();
}

export const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Plazos de retención (días). Deben coincidir con privacidad.html. */
export function retentionConfig() {
  return {
    chatDays: daysFromEnv("CHAT_RETENTION_DAYS", 30),
    reportDays: daysFromEnv("REPORT_RETENTION_DAYS", 180),
  };
}
