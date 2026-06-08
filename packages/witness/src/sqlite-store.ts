import Database from "better-sqlite3";
import type { Receipt } from "@witnessed/core";
import type { ReceiptStore } from "./store";
import {
  computeRetainUntil,
  type ListFilter,
  type PurgeResult,
  type RecordMeta,
  type RetentionPolicy,
  type RetentionStore,
} from "./retention";

/**
 * Durable, append-only receipt store backed by SQLite, with record-keeping support:
 * per-record retention windows, legal hold, listing, and audited purge.
 * The PRIMARY KEY on `id` enforces append-only: re-inserting an id throws.
 */
export class SqliteStore implements RetentionStore, ReceiptStore {
  private readonly db: Database.Database;

  /**
   * @param path  a file path for durability, or ":memory:" for an ephemeral DB.
   * @param policy optional retention policy; without it records are kept indefinitely.
   */
  constructor(
    path: string,
    private readonly policy?: RetentionPolicy,
  ) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS receipts (
         id TEXT PRIMARY KEY,
         json TEXT NOT NULL,
         witnessed_at TEXT NOT NULL,
         retain_until TEXT,
         legal_hold INTEGER NOT NULL DEFAULT 0,
         legal_hold_reason TEXT
       )`,
    );
    // Migrate older DBs that predate the record-keeping columns.
    this.ensureColumn("retain_until", "TEXT");
    this.ensureColumn("legal_hold", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("legal_hold_reason", "TEXT");
  }

  private ensureColumn(name: string, decl: string): void {
    const cols = this.db.prepare("PRAGMA table_info(receipts)").all() as { name: string }[];
    if (!cols.some((c) => c.name === name)) {
      this.db.exec(`ALTER TABLE receipts ADD COLUMN ${name} ${decl}`);
    }
  }

  async put(receipt: Receipt): Promise<void> {
    const retainUntil = computeRetainUntil(receipt.witness.witnessed_at, this.policy);
    try {
      this.db
        .prepare(
          "INSERT INTO receipts (id, json, witnessed_at, retain_until) VALUES (?, ?, ?, ?)",
        )
        .run(receipt.id, JSON.stringify(receipt), receipt.witness.witnessed_at, retainUntil);
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
        throw new Error(`append-only store: id already exists (${receipt.id})`);
      }
      throw err;
    }
  }

  async get(id: string): Promise<Receipt | null> {
    const row = this.db.prepare("SELECT json FROM receipts WHERE id = ?").get(id) as
      | { json: string }
      | undefined;
    return row ? (JSON.parse(row.json) as Receipt) : null;
  }

  async getMeta(id: string): Promise<RecordMeta | null> {
    const row = this.db
      .prepare(
        "SELECT id, witnessed_at, retain_until, legal_hold, legal_hold_reason FROM receipts WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          witnessed_at: string;
          retain_until: string | null;
          legal_hold: number;
          legal_hold_reason: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      witnessed_at: row.witnessed_at,
      retain_until: row.retain_until,
      legal_hold: row.legal_hold === 1,
      legal_hold_reason: row.legal_hold_reason,
    };
  }

  async placeLegalHold(id: string, reason: string): Promise<boolean> {
    const info = this.db
      .prepare("UPDATE receipts SET legal_hold = 1, legal_hold_reason = ? WHERE id = ?")
      .run(reason, id);
    return info.changes > 0;
  }

  async releaseLegalHold(id: string): Promise<boolean> {
    const info = this.db
      .prepare("UPDATE receipts SET legal_hold = 0, legal_hold_reason = NULL WHERE id = ?")
      .run(id);
    return info.changes > 0;
  }

  async list(filter?: ListFilter): Promise<Receipt[]> {
    let sql = "SELECT json FROM receipts WHERE 1 = 1";
    const params: string[] = [];
    if (filter?.from) {
      sql += " AND witnessed_at >= ?";
      params.push(filter.from);
    }
    if (filter?.to) {
      sql += " AND witnessed_at <= ?";
      params.push(filter.to);
    }
    if (filter?.agentKeyId) {
      sql += " AND json_extract(json, '$.agent.key_id') = ?";
      params.push(filter.agentKeyId);
    }
    sql += " ORDER BY witnessed_at ASC, id ASC";
    const rows = this.db.prepare(sql).all(...params) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as Receipt);
  }

  async purgeExpired(nowIso: string): Promise<PurgeResult> {
    const expired = "retain_until IS NOT NULL AND retain_until <= ?";
    const purged = (
      this.db.prepare(`SELECT id FROM receipts WHERE ${expired} AND legal_hold = 0`).all(nowIso) as {
        id: string;
      }[]
    ).map((r) => r.id);
    const retainedUnderHold = (
      this.db.prepare(`SELECT id FROM receipts WHERE ${expired} AND legal_hold = 1`).all(nowIso) as {
        id: string;
      }[]
    ).map((r) => r.id);
    this.db.prepare(`DELETE FROM receipts WHERE ${expired} AND legal_hold = 0`).run(nowIso);
    return { purged, retainedUnderHold };
  }

  close(): void {
    this.db.close();
  }
}
