const SESSION_COOKIE = 'jeopardy_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const PBKDF2_ITERATIONS = 210_000;
const MAX_AUTH_BODY_BYTES = 16 * 1024;
const MAX_BOARD_BODY_BYTES = 1024 * 1024;
const MAX_BOARD_DATA_BYTES = 900 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

type SqlValue = string | number | null | ArrayBuffer;

interface SqlCursor<T> extends Iterable<T> {
  toArray(): T[];
  rowsWritten: number;
}

interface SqlStorage {
  exec<T = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): SqlCursor<T>;
}

interface DurableObjectStorageLike {
  sql: SqlStorage;
  transactionSync<T>(callback: () => T): T;
}

interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}

interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  is_admin: number;
}

interface SessionUserRow {
  id: number;
  username: string;
  email: string;
  is_admin: number;
}

interface RateLimitRow {
  window_started_at: number;
  attempts: number;
}

interface BoardRow {
  id: number;
  user_id: number;
  name: string;
  board_data: string;
  source: string;
  ai_provider: string | null;
  ai_model: string | null;
  metadata_json: string;
  schema_version: number;
  revision: number;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
}

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function methodNotAllowed(methods: string[]): Response {
  return jsonResponse(
    { error: 'Method not allowed' },
    405,
    { Allow: methods.join(', ') },
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: copyBuffer(salt), iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationText, saltText, hashText] = encoded.split('$');
  const iterations = Number(iterationText);
  if (
    algorithm !== 'pbkdf2_sha256' ||
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    !saltText ||
    !hashText
  ) {
    return false;
  }

  try {
    const expected = base64UrlToBytes(hashText);
    const actual = await derivePasswordHash(password, base64UrlToBytes(saltText), iterations);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

function cookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiError(413, 'Request body is too large');
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError(413, 'Request body is too large');
  }

  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiError(400, 'A JSON object is required');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Malformed JSON');
  }
}

function requiredString(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== 'string') throw new ApiError(400, `${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) {
    throw new ApiError(400, `${field} must be ${minimum}-${maximum} characters`);
  }
  return trimmed;
}

function nullableString(value: unknown, field: string, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) {
    throw new ApiError(400, `${field} must be 1-${maximum} characters`);
  }
  return trimmed;
}

function validateUsername(value: unknown): string {
  const username = requiredString(value, 'username', 2, 32);
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    throw new ApiError(400, 'Username may only contain letters, numbers, _ and -');
  }
  return username;
}

function validateEmail(value: unknown): string {
  const email = requiredString(value, 'email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'Invalid email address');
  }
  return email;
}

function validatePassword(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'password is required');
  if (value.length < 8 || value.length > 128) {
    throw new ApiError(400, 'Password must be 8-128 characters');
  }
  if (!/[A-Z]/.test(value)) {
    throw new ApiError(400, 'Password must contain at least one uppercase letter');
  }
  if (!/[0-9]/.test(value)) {
    throw new ApiError(400, 'Password must contain at least one number');
  }
  return value;
}

function safeJsonObject(value: unknown, field: string, maxBytes: number): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, `${field} must be a JSON object`);
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw new ApiError(413, `${field} is too large`);
  }
  return serialized;
}

function serializeBoardData(value: unknown): string {
  const serialized = safeJsonObject(value, 'board_data', MAX_BOARD_DATA_BYTES);
  const gameState = (value as { gameState?: unknown }).gameState;
  if (!gameState || typeof gameState !== 'object' || Array.isArray(gameState)) {
    throw new ApiError(400, 'board_data must include gameState');
  }
  if (!Array.isArray((gameState as { categories?: unknown }).categories)) {
    throw new ApiError(400, 'board_data gameState must include categories');
  }
  return serialized;
}

function containsCredential(value: unknown): boolean {
  const sensitiveKeys = new Set([
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
    ([key, child]) => sensitiveKeys.has(key.toLowerCase()) || containsCredential(child),
  );
}

function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function serializeBoard(row: BoardRow, includeData: boolean): Record<string, unknown> {
  const storedMetadata = parseStoredJson(row.metadata_json);
  const metadata = storedMetadata && typeof storedMetadata === 'object' && !Array.isArray(storedMetadata)
    ? storedMetadata as Record<string, unknown>
    : {};
  const board: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    source: row.source,
    ai_provider: row.ai_provider,
    ai_model: row.ai_model,
    metadata: {
      ...metadata,
      schemaVersion: row.schema_version,
      source: row.source,
      ...(row.ai_provider ? { provider: row.ai_provider } : {}),
      ...(row.ai_model ? { model: row.ai_model } : {}),
    },
    schema_version: row.schema_version,
    revision: row.revision,
    last_opened_at: row.last_opened_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includeData) board.board_data = parseStoredJson(row.board_data);
  return board;
}

function parseBoardId(pathname: string): number | null {
  const match = /^\/api\/boards\/([1-9][0-9]*)\/?$/.exec(pathname);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

export class UserStore {
  private readonly storage: DurableObjectStorageLike;
  private readonly sql: SqlStorage;

  constructor(state: DurableObjectStateLike, _env: unknown) {
    this.storage = state.storage;
    this.sql = state.storage.sql;
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.sql.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        board_data TEXT NOT NULL CHECK (json_valid(board_data)),
        source TEXT NOT NULL DEFAULT 'manual'
          CHECK (source IN ('manual', 'generated', 'imported')),
        ai_provider TEXT,
        ai_model TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        last_opened_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_rate_limits (
        rate_key TEXT PRIMARY KEY,
        window_started_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_boards_user_updated
        ON boards(user_id, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window
        ON auth_rate_limits(window_started_at);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const boardId = parseBoardId(url.pathname);

      if (url.pathname === '/api/auth/register') return await this.register(request);
      if (url.pathname === '/api/auth/login') return await this.login(request);
      if (url.pathname === '/api/auth/logout') return await this.logout(request);
      if (url.pathname === '/api/auth/me') return await this.me(request);
      if (url.pathname === '/api/boards' || url.pathname === '/api/boards/') {
        return await this.boards(request);
      }
      if (boardId !== null) return await this.board(request, boardId);
      return jsonResponse({ error: 'API route not found' }, 404);
    } catch (error) {
      if (error instanceof ApiError) return jsonResponse({ error: error.message }, error.status);
      console.error('UserStore request failed', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  }

  private async createSession(): Promise<{ raw: string; hash: string; expiresAt: string }> {
    const raw = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await sha256Hex(raw);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
    return { raw, hash, expiresAt };
  }

  private async currentUser(request: Request): Promise<SessionUserRow | null> {
    const rawToken = cookieValue(request, SESSION_COOKIE);
    if (!rawToken) return null;
    const tokenHash = await sha256Hex(rawToken);
    const rows = this.sql.exec<SessionUserRow>(
      `SELECT u.id, u.username, u.email, u.is_admin
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?
       LIMIT 1`,
      tokenHash,
      nowIso(),
    ).toArray();
    return rows[0] || null;
  }

  private async requireUser(request: Request): Promise<SessionUserRow> {
    const user = await this.currentUser(request);
    if (!user) throw new ApiError(401, 'Not authenticated');
    return user;
  }

  private enforceAuthRateLimit(
    request: Request,
    action: 'login' | 'register',
    maximum: number,
    windowMs: number,
  ): void {
    const address = (
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
      'local'
    ).slice(0, 80);
    const rateKey = `${action}:${address}`;
    const timestamp = Date.now();
    const existing = this.sql.exec<RateLimitRow>(
      `SELECT window_started_at, attempts
       FROM auth_rate_limits WHERE rate_key = ? LIMIT 1`,
      rateKey,
    ).toArray()[0];

    if (!existing || timestamp - existing.window_started_at >= windowMs) {
      this.sql.exec(
        `INSERT INTO auth_rate_limits (rate_key, window_started_at, attempts)
         VALUES (?, ?, 1)
         ON CONFLICT(rate_key) DO UPDATE SET window_started_at = excluded.window_started_at,
           attempts = 1`,
        rateKey,
        timestamp,
      );
      return;
    }

    if (existing.attempts >= maximum) {
      throw new ApiError(429, 'Too many attempts. Please try again later.');
    }

    this.sql.exec(
      'UPDATE auth_rate_limits SET attempts = attempts + 1 WHERE rate_key = ?',
      rateKey,
    );
  }

  private async register(request: Request): Promise<Response> {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    this.enforceAuthRateLimit(request, 'register', 5, REGISTER_WINDOW_MS);
    const body = await readJsonObject(request, MAX_AUTH_BODY_BYTES);
    const username = validateUsername(body.username);
    const email = validateEmail(body.email);
    const password = validatePassword(body.password);

    const usernameMatch = this.sql.exec<{ id: number }>(
      'SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1',
      username,
    ).toArray()[0];
    if (usernameMatch) throw new ApiError(409, 'Username already taken');

    const emailMatch = this.sql.exec<{ id: number }>(
      'SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1',
      email,
    ).toArray()[0];
    if (emailMatch) throw new ApiError(409, 'Email already registered');

    const passwordHash = await hashPassword(password);
    const session = await this.createSession();
    const timestamp = nowIso();

    let userId = 0;
    try {
      this.storage.transactionSync(() => {
        const inserted = this.sql.exec<{ id: number }>(
          `INSERT INTO users
             (username, email, password_hash, is_admin, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?)
           RETURNING id`,
          username,
          email,
          passwordHash,
          timestamp,
          timestamp,
        ).toArray()[0];
        if (!inserted) throw new Error('User insert returned no id');
        userId = inserted.id;
        this.sql.exec(
          `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
           VALUES (?, ?, ?, ?)`,
          session.hash,
          userId,
          timestamp,
          session.expiresAt,
        );
      });
    } catch (error) {
      if (error instanceof Error && /unique constraint/i.test(error.message)) {
        throw new ApiError(409, 'Username or email already registered');
      }
      throw error;
    }

    return jsonResponse(
      { userId, username, email, isAdmin: false },
      201,
      { 'Set-Cookie': sessionCookie(session.raw) },
    );
  }

  private async login(request: Request): Promise<Response> {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    this.enforceAuthRateLimit(request, 'login', 20, LOGIN_WINDOW_MS);
    const body = await readJsonObject(request, MAX_AUTH_BODY_BYTES);
    const login = requiredString(body.login, 'login', 2, 254);
    if (typeof body.password !== 'string' || body.password.length > 128) {
      throw new ApiError(400, 'Password is required');
    }

    const user = this.sql.exec<UserRow>(
      `SELECT id, username, email, password_hash, is_admin
       FROM users
       WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
       LIMIT 1`,
      login,
      login.toLowerCase(),
    ).toArray()[0];

    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      throw new ApiError(401, 'Invalid credentials');
    }

    const session = await this.createSession();
    const timestamp = nowIso();
    this.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', timestamp);
      this.sql.exec(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
        session.hash,
        user.id,
        timestamp,
        session.expiresAt,
      );
      this.sql.exec(
        'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?',
        timestamp,
        timestamp,
        user.id,
      );
    });

    return jsonResponse(
      {
        userId: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.is_admin === 1,
      },
      200,
      { 'Set-Cookie': sessionCookie(session.raw) },
    );
  }

  private async logout(request: Request): Promise<Response> {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const rawToken = cookieValue(request, SESSION_COOKIE);
    if (rawToken) {
      this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', await sha256Hex(rawToken));
    }
    return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearedSessionCookie() });
  }

  private async me(request: Request): Promise<Response> {
    const user = await this.requireUser(request);
    if (request.method === 'DELETE') {
      this.sql.exec('DELETE FROM users WHERE id = ?', user.id);
      return jsonResponse(
        { ok: true },
        200,
        { 'Set-Cookie': clearedSessionCookie() },
      );
    }
    if (request.method !== 'GET') return methodNotAllowed(['GET', 'DELETE']);
    return jsonResponse({
      userId: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.is_admin === 1,
    });
  }

  private async boards(request: Request): Promise<Response> {
    const user = await this.requireUser(request);

    if (request.method === 'GET') {
      const rows = this.sql.exec<BoardRow>(
        `SELECT id, user_id, name, board_data, source, ai_provider, ai_model,
                metadata_json, schema_version, revision, last_opened_at,
                created_at, updated_at
         FROM boards
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 200`,
        user.id,
      ).toArray();
      return jsonResponse(rows.map((row) => serializeBoard(row, false)));
    }

    if (request.method !== 'POST') return methodNotAllowed(['GET', 'POST']);
    const body = await readJsonObject(request, MAX_BOARD_BODY_BYTES);
    const name = requiredString(body.name, 'name', 1, 120);
    const source = body.source === undefined
      ? 'manual'
      : requiredString(body.source, 'source', 1, 16);
    if (!['manual', 'generated', 'imported'].includes(source)) {
      throw new ApiError(400, 'Invalid board source');
    }

    const aiProvider = nullableString(body.ai_provider, 'ai_provider', 64);
    const aiModel = nullableString(body.ai_model, 'ai_model', 200);
    if (source === 'generated' && (!aiProvider || !aiModel)) {
      throw new ApiError(400, 'Generated boards require ai_provider and ai_model');
    }

    if (containsCredential(body.metadata)) {
      throw new ApiError(400, 'metadata must not contain credentials');
    }
    const metadataJson = body.metadata === undefined
      ? '{}'
      : safeJsonObject(body.metadata, 'metadata', MAX_METADATA_BYTES);
    const boardData = serializeBoardData(body.board_data);
    const schemaVersion = body.schema_version === undefined ? 1 : Number(body.schema_version);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1000) {
      throw new ApiError(400, 'schema_version must be an integer from 1 to 1000');
    }

    const timestamp = nowIso();
    const row = this.sql.exec<BoardRow>(
      `INSERT INTO boards
         (user_id, name, board_data, source, ai_provider, ai_model, metadata_json,
          schema_version, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       RETURNING id, user_id, name, board_data, source, ai_provider, ai_model,
                 metadata_json, schema_version, revision, last_opened_at,
                 created_at, updated_at`,
      user.id,
      name,
      boardData,
      source,
      aiProvider,
      aiModel,
      metadataJson,
      schemaVersion,
      timestamp,
      timestamp,
    ).toArray()[0];
    if (!row) throw new Error('Board insert returned no row');
    return jsonResponse(serializeBoard(row, true), 201);
  }

  private async board(request: Request, id: number): Promise<Response> {
    const user = await this.requireUser(request);
    const existing = this.sql.exec<BoardRow>(
      `SELECT id, user_id, name, board_data, source, ai_provider, ai_model,
              metadata_json, schema_version, revision, last_opened_at,
              created_at, updated_at
       FROM boards
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      id,
      user.id,
    ).toArray()[0];
    if (!existing) throw new ApiError(404, 'Board not found');

    if (request.method === 'GET') {
      const openedAt = nowIso();
      this.sql.exec(
        'UPDATE boards SET last_opened_at = ? WHERE id = ? AND user_id = ?',
        openedAt,
        id,
        user.id,
      );
      return jsonResponse(serializeBoard({ ...existing, last_opened_at: openedAt }, true));
    }

    if (request.method === 'DELETE') {
      this.sql.exec('DELETE FROM boards WHERE id = ? AND user_id = ?', id, user.id);
      return jsonResponse({ ok: true });
    }

    if (request.method !== 'PUT' && request.method !== 'PATCH') {
      return methodNotAllowed(['GET', 'PUT', 'PATCH', 'DELETE']);
    }

    const body = await readJsonObject(request, MAX_BOARD_BODY_BYTES);
    const expectedRevision = Number(body.expected_revision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new ApiError(400, 'expected_revision is required');
    }
    if (expectedRevision !== existing.revision) {
      return jsonResponse(
        {
          error: 'This board changed in another session. Reload it before saving again.',
          current: serializeBoard(existing, false),
        },
        409,
      );
    }

    const hasUpdate = [
      'name',
      'board_data',
      'source',
      'ai_provider',
      'ai_model',
      'metadata',
      'schema_version',
    ].some((field) => Object.prototype.hasOwnProperty.call(body, field));
    if (!hasUpdate) throw new ApiError(400, 'No board changes supplied');

    const name = body.name === undefined
      ? existing.name
      : requiredString(body.name, 'name', 1, 120);
    const source = body.source === undefined
      ? existing.source
      : requiredString(body.source, 'source', 1, 16);
    if (!['manual', 'generated', 'imported'].includes(source)) {
      throw new ApiError(400, 'Invalid board source');
    }

    const aiProvider = body.ai_provider === undefined
      ? existing.ai_provider
      : nullableString(body.ai_provider, 'ai_provider', 64);
    const aiModel = body.ai_model === undefined
      ? existing.ai_model
      : nullableString(body.ai_model, 'ai_model', 200);
    if (source === 'generated' && (!aiProvider || !aiModel)) {
      throw new ApiError(400, 'Generated boards require ai_provider and ai_model');
    }

    if (body.metadata !== undefined && containsCredential(body.metadata)) {
      throw new ApiError(400, 'metadata must not contain credentials');
    }
    const metadataJson = body.metadata === undefined
      ? existing.metadata_json
      : safeJsonObject(body.metadata, 'metadata', MAX_METADATA_BYTES);
    const boardData = body.board_data === undefined
      ? existing.board_data
      : serializeBoardData(body.board_data);
    const schemaVersion = body.schema_version === undefined
      ? existing.schema_version
      : Number(body.schema_version);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1000) {
      throw new ApiError(400, 'schema_version must be an integer from 1 to 1000');
    }

    const timestamp = nowIso();
    const updated = this.sql.exec<BoardRow>(
      `UPDATE boards
       SET name = ?, board_data = ?, source = ?, ai_provider = ?, ai_model = ?,
           metadata_json = ?, schema_version = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND revision = ?
       RETURNING id, user_id, name, board_data, source, ai_provider, ai_model,
                 metadata_json, schema_version, revision, last_opened_at,
                 created_at, updated_at`,
      name,
      boardData,
      source,
      aiProvider,
      aiModel,
      metadataJson,
      schemaVersion,
      timestamp,
      id,
      user.id,
      expectedRevision,
    ).toArray()[0];

    if (!updated) {
      const latest = this.sql.exec<BoardRow>(
        `SELECT id, user_id, name, board_data, source, ai_provider, ai_model,
                metadata_json, schema_version, revision, last_opened_at,
                created_at, updated_at
         FROM boards WHERE id = ? AND user_id = ? LIMIT 1`,
        id,
        user.id,
      ).toArray()[0];
      if (!latest) throw new ApiError(404, 'Board not found');
      return jsonResponse(
        {
          error: 'This board changed in another session. Reload it before saving again.',
          current: serializeBoard(latest, false),
        },
        409,
      );
    }

    return jsonResponse(serializeBoard(updated, true));
  }
}
