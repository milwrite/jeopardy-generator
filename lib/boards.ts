import type Database from 'better-sqlite3';
import type { BoardMetadata, BoardSource } from '../src/jeopardyTypes';

const BOARD_NAME_LIMIT = 120;
const BOARD_DATA_LIMIT = 1_500_000;
const METADATA_LIMIT = 32_000;
const MODEL_NAME_LIMIT = 200;
const PROVIDER_NAME_LIMIT = 64;
const BOARD_SOURCES = new Set<BoardSource>(['manual', 'generated', 'imported']);

interface BoardRow {
  id: number;
  user_id: number;
  name: string;
  board_data: string;
  source: BoardSource;
  ai_provider: string | null;
  ai_model: string | null;
  metadata_json: string;
  schema_version: number;
  revision: number;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardSummary {
  id: number;
  name: string;
  source: BoardSource;
  ai_provider: string | null;
  ai_model: string | null;
  metadata: BoardMetadata;
  schema_version: number;
  revision: number;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardRecord extends BoardSummary {
  board_data: unknown;
}

export interface CreateBoardInput {
  name?: unknown;
  board_data?: unknown;
  source?: unknown;
  ai_provider?: unknown;
  ai_model?: unknown;
  metadata?: unknown;
  schema_version?: unknown;
}

export interface UpdateBoardInput extends Partial<CreateBoardInput> {
  expected_revision?: unknown;
}

export class BoardInputError extends Error {
  readonly status = 400;
}

export class BoardConflictError extends Error {
  readonly status = 409;

  constructor(readonly current: BoardSummary) {
    super('This board changed in another session. Reload it before saving again.');
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function boardMetadata(row: BoardRow): BoardMetadata {
  const parsed = parseJson<Partial<BoardMetadata>>(row.metadata_json, {});
  return {
    ...parsed,
    schemaVersion: row.schema_version,
    source: row.source,
    ...(row.ai_provider ? { provider: row.ai_provider as BoardMetadata['provider'] } : {}),
    ...(row.ai_model ? { model: row.ai_model } : {}),
  };
}

function toSummary(row: BoardRow): BoardSummary {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    ai_provider: row.ai_provider,
    ai_model: row.ai_model,
    metadata: boardMetadata(row),
    schema_version: row.schema_version,
    revision: row.revision,
    last_opened_at: row.last_opened_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toRecord(row: BoardRow): BoardRecord {
  return { ...toSummary(row), board_data: parseJson<unknown>(row.board_data, null) };
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new BoardInputError('Board name is required.');
  const name = value.trim();
  if (!name) throw new BoardInputError('Board name is required.');
  if (name.length > BOARD_NAME_LIMIT) {
    throw new BoardInputError(`Board name must be ${BOARD_NAME_LIMIT} characters or fewer.`);
  }
  return name;
}

function normalizeSource(value: unknown): BoardSource {
  if (value === undefined) return 'manual';
  if (typeof value !== 'string' || !BOARD_SOURCES.has(value as BoardSource)) {
    throw new BoardInputError('Board source must be manual, generated, or imported.');
  }
  return value as BoardSource;
}

function normalizeOptionalString(value: unknown, label: string, limit: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BoardInputError(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > limit) {
    throw new BoardInputError(`${label} must be ${limit} characters or fewer.`);
  }
  return normalized || null;
}

function normalizeSchemaVersion(value: unknown): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 1000) {
    throw new BoardInputError('Board schema version must be a positive integer.');
  }
  return Number(value);
}

function serializeBoardData(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BoardInputError('Board data must be an object.');
  }

  const gameState = (value as { gameState?: unknown }).gameState;
  if (!gameState || typeof gameState !== 'object') {
    throw new BoardInputError('Board data must include gameState.');
  }
  if (!Array.isArray((gameState as { categories?: unknown }).categories)) {
    throw new BoardInputError('Board gameState must include categories.');
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new BoardInputError('Board data must be valid JSON.');
  }
  if (serialized.length > BOARD_DATA_LIMIT) {
    throw new BoardInputError('Board data is too large to save.');
  }
  return serialized;
}

function serializeMetadata(value: unknown, fallback: BoardMetadata): string {
  if (value === undefined) return JSON.stringify(fallback);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BoardInputError('Board metadata must be an object.');
  }
  if (containsCredential(value)) {
    throw new BoardInputError('Board metadata must not contain credentials.');
  }
  const metadata = JSON.stringify(value);
  if (metadata.length > METADATA_LIMIT) {
    throw new BoardInputError('Board metadata is too large to save.');
  }
  return metadata;
}

function containsCredential(value: unknown): boolean {
  const credentialKeys = new Set([
    'api_key',
    'apikey',
    'authorization',
    'password',
    'secret',
    'access_token',
    'refresh_token',
  ]);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsCredential);
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => credentialKeys.has(key.toLowerCase()) || containsCredential(child),
  );
}

function getOwnedRow(db: Database.Database, userId: number, id: number): BoardRow | undefined {
  return db
    .prepare('SELECT * FROM boards WHERE id = ? AND user_id = ?')
    .get(id, userId) as BoardRow | undefined;
}

export function listBoards(db: Database.Database, userId: number): BoardSummary[] {
  const rows = db
    .prepare(
      `SELECT * FROM boards
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC`,
    )
    .all(userId) as BoardRow[];
  return rows.map(toSummary);
}

export function getBoard(
  db: Database.Database,
  userId: number,
  id: number,
  markOpened = false,
): BoardRecord | null {
  let row = getOwnedRow(db, userId, id);
  if (!row) return null;

  if (markOpened) {
    const openedAt = new Date().toISOString();
    db.prepare('UPDATE boards SET last_opened_at = ? WHERE id = ? AND user_id = ?').run(
      openedAt,
      id,
      userId,
    );
    row = { ...row, last_opened_at: openedAt };
  }
  return toRecord(row);
}

export function createBoard(
  db: Database.Database,
  userId: number,
  input: CreateBoardInput,
): BoardRecord {
  const name = normalizeName(input.name);
  const boardData = serializeBoardData(input.board_data);
  const source = normalizeSource(input.source);
  const provider = normalizeOptionalString(input.ai_provider, 'AI provider', PROVIDER_NAME_LIMIT);
  const model = normalizeOptionalString(input.ai_model, 'AI model', MODEL_NAME_LIMIT);
  if (source === 'generated' && (!provider || !model)) {
    throw new BoardInputError('Generated boards require an AI provider and model.');
  }
  const schemaVersion = normalizeSchemaVersion(input.schema_version);
  const fallbackMetadata: BoardMetadata = {
    schemaVersion,
    source,
    ...(provider ? { provider: provider as BoardMetadata['provider'] } : {}),
    ...(model ? { model } : {}),
  };
  const metadata = serializeMetadata(input.metadata, fallbackMetadata);
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO boards (
        user_id, name, board_data, source, ai_provider, ai_model, metadata_json,
        schema_version, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      userId,
      name,
      boardData,
      source,
      provider,
      model,
      metadata,
      schemaVersion,
      now,
      now,
    );

  const created = getOwnedRow(db, userId, Number(result.lastInsertRowid));
  if (!created) throw new Error('Saved board could not be read back.');
  return toRecord(created);
}

export function updateBoard(
  db: Database.Database,
  userId: number,
  id: number,
  input: UpdateBoardInput,
): BoardRecord | null {
  const currentRow = getOwnedRow(db, userId, id);
  if (!currentRow) return null;

  if (!Number.isSafeInteger(input.expected_revision) || Number(input.expected_revision) < 1) {
    throw new BoardInputError('expected_revision is required for board updates.');
  }
  const expectedRevision = Number(input.expected_revision);
  if (currentRow.revision !== expectedRevision) {
    throw new BoardConflictError(toSummary(currentRow));
  }

  const name = input.name === undefined ? currentRow.name : normalizeName(input.name);
  const boardData =
    input.board_data === undefined ? currentRow.board_data : serializeBoardData(input.board_data);
  const source = input.source === undefined ? currentRow.source : normalizeSource(input.source);
  const provider =
    input.ai_provider === undefined
      ? currentRow.ai_provider
      : normalizeOptionalString(input.ai_provider, 'AI provider', PROVIDER_NAME_LIMIT);
  const model =
    input.ai_model === undefined
      ? currentRow.ai_model
      : normalizeOptionalString(input.ai_model, 'AI model', MODEL_NAME_LIMIT);
  if (source === 'generated' && (!provider || !model)) {
    throw new BoardInputError('Generated boards require an AI provider and model.');
  }
  const schemaVersion =
    input.schema_version === undefined
      ? currentRow.schema_version
      : normalizeSchemaVersion(input.schema_version);
  const fallbackMetadata: BoardMetadata = {
    ...boardMetadata(currentRow),
    schemaVersion,
    source,
    ...(provider ? { provider: provider as BoardMetadata['provider'] } : {}),
    ...(model ? { model } : {}),
  };
  const metadata =
    input.metadata === undefined
      ? currentRow.metadata_json
      : serializeMetadata(input.metadata, fallbackMetadata);
  const updatedAt = new Date().toISOString();

  const updateResult = db
    .prepare(
      `UPDATE boards SET
        name = ?, board_data = ?, source = ?, ai_provider = ?, ai_model = ?,
        metadata_json = ?, schema_version = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND revision = ?`,
    )
    .run(
      name,
      boardData,
      source,
      provider,
      model,
      metadata,
      schemaVersion,
      updatedAt,
      id,
      userId,
      expectedRevision,
    );

  if (updateResult.changes !== 1) {
    const latest = getOwnedRow(db, userId, id);
    if (!latest) return null;
    throw new BoardConflictError(toSummary(latest));
  }

  const updated = getOwnedRow(db, userId, id);
  if (!updated) throw new Error('Updated board could not be read back.');
  return toRecord(updated);
}

export function deleteBoard(db: Database.Database, userId: number, id: number): boolean {
  return db.prepare('DELETE FROM boards WHERE id = ? AND user_id = ?').run(id, userId).changes === 1;
}
