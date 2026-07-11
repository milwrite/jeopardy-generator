const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const SESSION_COOKIE = 'jeopardy_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_AUTH_BODY_BYTES = 16 * 1024;
const MAX_BOARD_BODY_BYTES = 1024 * 1024;
const MAX_BOARD_DATA_BYTES = 900 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const BOARD_SOURCES = new Set(['manual', 'generated', 'imported']);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function defaultDatabasePath() {
  const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (volumePath) return path.join(volumePath, 'jeopardy.db');
  if (fs.existsSync('/data')) return '/data/jeopardy.db';
  return path.join(process.cwd(), 'data', 'jeopardy.db');
}

function addColumn(db, table, columns, name, definition) {
  if (columns.has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  columns.add(name);
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      email TEXT UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
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
      board_data TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      ai_provider TEXT,
      ai_model TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      schema_version INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1,
      last_opened_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_rate_limits (
      rate_key TEXT PRIMARY KEY,
      window_started_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL
    );
  `);

  const userColumns = new Set(db.pragma('table_info(users)').map(({ name }) => name));
  addColumn(db, 'users', userColumns, 'email', 'TEXT COLLATE NOCASE');
  addColumn(db, 'users', userColumns, 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'users', userColumns, 'updated_at', "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'");
  addColumn(db, 'users', userColumns, 'last_login_at', 'TEXT');

  const boardColumns = new Set(db.pragma('table_info(boards)').map(({ name }) => name));
  addColumn(db, 'boards', boardColumns, 'source', "TEXT NOT NULL DEFAULT 'manual'");
  addColumn(db, 'boards', boardColumns, 'ai_provider', 'TEXT');
  addColumn(db, 'boards', boardColumns, 'ai_model', 'TEXT');
  addColumn(db, 'boards', boardColumns, 'metadata_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, 'boards', boardColumns, 'schema_version', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'boards', boardColumns, 'revision', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'boards', boardColumns, 'last_opened_at', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_boards_user_updated
      ON boards(user_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window
      ON auth_rate_limits(window_started_at);
  `);
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res, methods) {
  json(res, 405, { error: 'Method not allowed' }, { Allow: methods.join(', ') });
}

function requestOrigin(req) {
  const protocol = (req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http'))
    .split(',')[0]
    .trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  return host ? `${protocol}://${host}` : null;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const expected = requestOrigin(req);
  return Boolean(expected && origin === expected);
}

function apiCorsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !sameOrigin(req)) return {};
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

function isMutation(method) {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

async function readJson(req, maximumBytes) {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ApiError(413, 'Request body is too large');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximumBytes) throw new ApiError(413, 'Request body is too large');
    chunks.push(chunk);
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiError(400, 'A JSON object is required');
    }
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Malformed JSON');
  }
}

function requiredString(value, field, minimum, maximum) {
  if (typeof value !== 'string') throw new ApiError(400, `${field} is required`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ApiError(400, `${field} must be ${minimum}-${maximum} characters`);
  }
  return normalized;
}

function nullableString(value, field, maximum) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new ApiError(400, `${field} must be 1-${maximum} characters`);
  }
  return normalized;
}

function validateUsername(value) {
  const username = requiredString(value, 'username', 2, 32);
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    throw new ApiError(400, 'Username may only contain letters, numbers, _ and -');
  }
  return username;
}

function validateEmail(value) {
  const email = requiredString(value, 'email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'Invalid email address');
  }
  return email;
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 72) {
    throw new ApiError(400, 'Password must be 8-72 characters');
  }
  if (!/[A-Z]/.test(value)) {
    throw new ApiError(400, 'Password must contain at least one uppercase letter');
  }
  if (!/[0-9]/.test(value)) {
    throw new ApiError(400, 'Password must contain at least one number');
  }
  return value;
}

function safeJsonObject(value, field, maximumBytes) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, `${field} must be a JSON object`);
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > maximumBytes) {
    throw new ApiError(413, `${field} is too large`);
  }
  return serialized;
}

function serializeBoardData(value) {
  const serialized = safeJsonObject(value, 'board_data', MAX_BOARD_DATA_BYTES);
  const gameState = value.gameState;
  if (!gameState || typeof gameState !== 'object' || Array.isArray(gameState)) {
    throw new ApiError(400, 'board_data must include gameState');
  }
  if (!Array.isArray(gameState.categories)) {
    throw new ApiError(400, 'board_data gameState must include categories');
  }
  return serialized;
}

function containsCredential(value) {
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
  return Object.entries(value).some(
    ([key, child]) => credentialKeys.has(key.toLowerCase()) || containsCredential(child),
  );
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeBoard(row, includeData) {
  const storedMetadata = parseJson(row.metadata_json);
  const metadata = storedMetadata && typeof storedMetadata === 'object' && !Array.isArray(storedMetadata)
    ? storedMetadata
    : {};
  const result = {
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
  if (includeData) result.board_data = parseJson(row.board_data, null);
  return result;
}

function parseCookies(req) {
  const cookies = {};
  for (const entry of (req.headers.cookie || '').split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    cookies[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
  }
  return cookies;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sessionCookie(req, token, maximumAge) {
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = forwardedProtocol === 'https' || req.socket.encrypted || process.env.NODE_ENV === 'production';
  return [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maximumAge}`,
    'SameSite=Lax',
    'Priority=High',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function createUserApi(options = {}) {
  const databasePath = options.databasePath || process.env.JEOPARDY_DB_PATH || defaultDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  const bcryptRounds = options.bcryptRounds || 12;
  const now = options.now || (() => new Date());
  const dummyPasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), bcryptRounds);

  const boardSelect = `
    SELECT id, user_id, name, board_data, source, ai_provider, ai_model,
           metadata_json, schema_version, revision, last_opened_at,
           created_at, updated_at
    FROM boards`;

  function rateLimit(req, action, maximum, windowMs) {
    const address = String(
      req.headers['cf-connecting-ip'] ||
      String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'local',
    ).slice(0, 80);
    const rateKey = `${action}:${address}`;
    const timestamp = now().getTime();
    const existing = db
      .prepare('SELECT window_started_at, attempts FROM auth_rate_limits WHERE rate_key = ?')
      .get(rateKey);
    if (!existing || timestamp - existing.window_started_at >= windowMs) {
      db.prepare(
        `INSERT INTO auth_rate_limits (rate_key, window_started_at, attempts)
         VALUES (?, ?, 1)
         ON CONFLICT(rate_key) DO UPDATE SET
           window_started_at = excluded.window_started_at, attempts = 1`,
      ).run(rateKey, timestamp);
      return;
    }
    if (existing.attempts >= maximum) {
      throw new ApiError(429, 'Too many attempts. Please try again later.');
    }
    db.prepare('UPDATE auth_rate_limits SET attempts = attempts + 1 WHERE rate_key = ?').run(rateKey);
  }

  function currentUser(req) {
    const rawToken = parseCookies(req)[SESSION_COOKIE];
    if (!rawToken) return null;
    return db.prepare(
      `SELECT u.id, u.username, u.email, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`,
    ).get(tokenHash(rawToken), now().toISOString()) || null;
  }

  function requireUser(req) {
    const user = currentUser(req);
    if (!user) throw new ApiError(401, 'Not authenticated');
    return user;
  }

  function createSession(userId) {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_SECONDS * 1000);
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(tokenHash(rawToken), userId, createdAt.toISOString(), expiresAt.toISOString());
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(createdAt.toISOString());
    db.prepare(
      `DELETE FROM sessions
       WHERE user_id = ? AND rowid NOT IN (
         SELECT rowid FROM sessions WHERE user_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 20
       )`,
    ).run(userId, userId);
    return rawToken;
  }

  async function register(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    rateLimit(req, 'register', 5, 60 * 60 * 1000);
    const body = await readJson(req, MAX_AUTH_BODY_BYTES);
    const username = validateUsername(body.username);
    const email = validateEmail(body.email);
    const password = validatePassword(body.password);
    if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
      throw new ApiError(409, 'Username already taken');
    }
    if (db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
      throw new ApiError(409, 'Email already registered');
    }

    const timestamp = now().toISOString();
    const passwordHash = await bcrypt.hash(password, bcryptRounds);
    let userId;
    let session;
    try {
      userId = db.transaction(() => {
        const result = db.prepare(
          `INSERT INTO users
             (username, email, password_hash, is_admin, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?)`,
        ).run(username, email, passwordHash, timestamp, timestamp);
        const insertedUserId = Number(result.lastInsertRowid);
        session = createSession(insertedUserId);
        return insertedUserId;
      })();
    } catch (error) {
      if (/unique constraint/i.test(error.message)) {
        throw new ApiError(409, 'Username or email already registered');
      }
      throw error;
    }

    if (!session) throw new Error('Session creation failed');
    json(res, 201, { userId, username, email, isAdmin: false }, {
      ...apiCorsHeaders(req),
      'Set-Cookie': sessionCookie(req, session, SESSION_TTL_SECONDS),
    });
  }

  async function login(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    rateLimit(req, 'login', 20, 10 * 60 * 1000);
    const body = await readJson(req, MAX_AUTH_BODY_BYTES);
    const loginValue = requiredString(body.login, 'login', 2, 254);
    if (typeof body.password !== 'string' || body.password.length > 72) {
      throw new ApiError(400, 'Password is required');
    }
    const user = db.prepare(
      `SELECT id, username, email, password_hash, is_admin
       FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1`,
    ).get(loginValue, loginValue.toLowerCase());
    const passwordMatches = await bcrypt.compare(
      body.password,
      user?.password_hash || dummyPasswordHash,
    );
    if (!user || !passwordMatches) {
      throw new ApiError(401, 'Invalid credentials');
    }

    const timestamp = now().toISOString();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(timestamp);
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, timestamp, user.id);
    const session = createSession(user.id);
    json(res, 200, {
      userId: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.is_admin === 1,
    }, {
      ...apiCorsHeaders(req),
      'Set-Cookie': sessionCookie(req, session, SESSION_TTL_SECONDS),
    });
  }

  function logout(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const rawToken = parseCookies(req)[SESSION_COOKIE];
    if (rawToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(rawToken));
    json(res, 200, { ok: true }, {
      ...apiCorsHeaders(req),
      'Set-Cookie': sessionCookie(req, '', 0),
    });
  }

  function me(req, res) {
    const user = requireUser(req);
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      return json(res, 200, { ok: true }, {
        ...apiCorsHeaders(req),
        'Set-Cookie': sessionCookie(req, '', 0),
      });
    }
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET', 'DELETE']);
    json(res, 200, {
      userId: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.is_admin === 1,
    }, apiCorsHeaders(req));
  }

  function boardInput(body, existing = null) {
    const name = body.name === undefined && existing
      ? existing.name
      : requiredString(body.name, 'name', 1, 120);
    const source = body.source === undefined
      ? existing?.source || 'manual'
      : requiredString(body.source, 'source', 1, 16);
    if (!BOARD_SOURCES.has(source)) throw new ApiError(400, 'Invalid board source');
    const aiProvider = body.ai_provider === undefined && existing
      ? existing.ai_provider
      : nullableString(body.ai_provider, 'ai_provider', 64);
    const aiModel = body.ai_model === undefined && existing
      ? existing.ai_model
      : nullableString(body.ai_model, 'ai_model', 200);
    if (source === 'generated' && (!aiProvider || !aiModel)) {
      throw new ApiError(400, 'Generated boards require ai_provider and ai_model');
    }
    if (body.metadata !== undefined && containsCredential(body.metadata)) {
      throw new ApiError(400, 'metadata must not contain credentials');
    }
    const metadataJson = body.metadata === undefined
      ? existing?.metadata_json || '{}'
      : safeJsonObject(body.metadata, 'metadata', MAX_METADATA_BYTES);
    const boardData = body.board_data === undefined && existing
      ? existing.board_data
      : serializeBoardData(body.board_data);
    const schemaVersion = body.schema_version === undefined
      ? existing?.schema_version || 1
      : Number(body.schema_version);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1000) {
      throw new ApiError(400, 'schema_version must be an integer from 1 to 1000');
    }
    return { name, source, aiProvider, aiModel, metadataJson, boardData, schemaVersion };
  }

  async function boards(req, res) {
    const user = requireUser(req);
    if (req.method === 'GET') {
      const rows = db.prepare(
        `${boardSelect} WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 200`,
      ).all(user.id);
      return json(res, 200, rows.map((row) => serializeBoard(row, false)), apiCorsHeaders(req));
    }
    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);
    const body = await readJson(req, MAX_BOARD_BODY_BYTES);
    const input = boardInput(body);
    const timestamp = now().toISOString();
    const result = db.prepare(
      `INSERT INTO boards
         (user_id, name, board_data, source, ai_provider, ai_model, metadata_json,
          schema_version, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      user.id,
      input.name,
      input.boardData,
      input.source,
      input.aiProvider,
      input.aiModel,
      input.metadataJson,
      input.schemaVersion,
      timestamp,
      timestamp,
    );
    const row = db.prepare(`${boardSelect} WHERE id = ? AND user_id = ?`).get(
      Number(result.lastInsertRowid),
      user.id,
    );
    json(res, 201, serializeBoard(row, true), apiCorsHeaders(req));
  }

  async function board(req, res, id) {
    const user = requireUser(req);
    const existing = db.prepare(`${boardSelect} WHERE id = ? AND user_id = ?`).get(id, user.id);
    if (!existing) throw new ApiError(404, 'Board not found');

    if (req.method === 'GET') {
      const openedAt = now().toISOString();
      db.prepare('UPDATE boards SET last_opened_at = ? WHERE id = ? AND user_id = ?')
        .run(openedAt, id, user.id);
      return json(
        res,
        200,
        serializeBoard({ ...existing, last_opened_at: openedAt }, true),
        apiCorsHeaders(req),
      );
    }
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM boards WHERE id = ? AND user_id = ?').run(id, user.id);
      return json(res, 200, { ok: true }, apiCorsHeaders(req));
    }
    if (req.method !== 'PUT' && req.method !== 'PATCH') {
      return methodNotAllowed(res, ['GET', 'PUT', 'PATCH', 'DELETE']);
    }

    const body = await readJson(req, MAX_BOARD_BODY_BYTES);
    const expectedRevision = Number(body.expected_revision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new ApiError(400, 'expected_revision is required');
    }
    if (expectedRevision !== existing.revision) {
      return json(res, 409, {
        error: 'This board changed in another session. Reload it before saving again.',
        current: serializeBoard(existing, false),
      }, apiCorsHeaders(req));
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
    const input = boardInput(body, existing);
    const timestamp = now().toISOString();
    const update = db.prepare(
      `UPDATE boards SET
         name = ?, board_data = ?, source = ?, ai_provider = ?, ai_model = ?,
         metadata_json = ?, schema_version = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND revision = ?`,
    ).run(
      input.name,
      input.boardData,
      input.source,
      input.aiProvider,
      input.aiModel,
      input.metadataJson,
      input.schemaVersion,
      timestamp,
      id,
      user.id,
      expectedRevision,
    );
    if (update.changes !== 1) {
      const latest = db.prepare(`${boardSelect} WHERE id = ? AND user_id = ?`).get(id, user.id);
      if (!latest) throw new ApiError(404, 'Board not found');
      return json(res, 409, {
        error: 'This board changed in another session. Reload it before saving again.',
        current: serializeBoard(latest, false),
      }, apiCorsHeaders(req));
    }
    const updated = db.prepare(`${boardSelect} WHERE id = ? AND user_id = ?`).get(id, user.id);
    json(res, 200, serializeBoard(updated, true), apiCorsHeaders(req));
  }

  async function handle(req, res, pathname) {
    const boardMatch = /^\/api\/boards\/([1-9][0-9]*)\/?$/.exec(pathname);
    const isApiPath = pathname.startsWith('/api/auth/') ||
      pathname === '/api/boards' ||
      pathname === '/api/boards/' ||
      Boolean(boardMatch);
    if (!isApiPath) return false;

    if (req.method === 'OPTIONS') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request rejected' });
      res.writeHead(204, apiCorsHeaders(req));
      res.end();
      return true;
    }
    if (isMutation(req.method) && !sameOrigin(req)) {
      json(res, 403, { error: 'Cross-origin request rejected' });
      return true;
    }

    try {
      if (pathname === '/api/auth/register') await register(req, res);
      else if (pathname === '/api/auth/login') await login(req, res);
      else if (pathname === '/api/auth/logout') logout(req, res);
      else if (pathname === '/api/auth/me') me(req, res);
      else if (pathname === '/api/boards' || pathname === '/api/boards/') await boards(req, res);
      else if (boardMatch) await board(req, res, Number(boardMatch[1]));
      else json(res, 404, { error: 'API route not found' });
    } catch (error) {
      if (error instanceof ApiError) {
        json(res, error.status, { error: error.message }, apiCorsHeaders(req));
      } else {
        console.error('User API request failed:', error);
        json(res, 500, { error: 'Internal server error' }, apiCorsHeaders(req));
      }
    }
    return true;
  }

  return {
    close: () => db.close(),
    databasePath,
    handle,
  };
}

module.exports = {
  createUserApi,
  defaultDatabasePath,
};
