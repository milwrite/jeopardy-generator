import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  BoardConflictError,
  createBoard,
  getBoard,
  listBoards,
  updateBoard,
} from '../lib/boards';
import { initializeSchema } from '../lib/db';

function databaseFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'jeopardy-board-storage-'));
  const db = new Database(path.join(directory, 'test.db'));
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  const timestamp = new Date().toISOString();
  const user = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run('alice', 'alice@example.com', 'test-only', timestamp, timestamp);
  const otherUser = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run('bob', 'bob@example.com', 'test-only', timestamp, timestamp);

  return {
    db,
    directory,
    userId: Number(user.lastInsertRowid),
    otherUserId: Number(otherUser.lastInsertRowid),
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function gameState(categoryTitle: string) {
  return {
    categories: [{ title: categoryTitle, questions: [] }],
    players: [{ name: 'Player 1', score: 0, active: true }],
    currentPlayer: 0,
    finalJeopardyActive: false,
  };
}

test('migrates the legacy board table without losing existing rows', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jeopardy-board-migration-'));
  const db = new Database(path.join(directory, 'legacy.db'));
  try {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        board_data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users (username, password_hash, created_at)
        VALUES ('legacy', 'hash', '2025-01-01T00:00:00.000Z');
      INSERT INTO boards (user_id, name, board_data, created_at, updated_at)
        VALUES (1, 'Legacy Board', '{"gameState":{"categories":[]}}',
                '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
    `);

    initializeSchema(db);

    const columns = new Set(
      (db.pragma('table_info(boards)') as { name: string }[]).map(({ name }) => name),
    );
    assert.ok(columns.has('ai_model'));
    assert.ok(columns.has('metadata_json'));
    assert.ok(columns.has('revision'));
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM boards').get() as { count: number }).count, 1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stores generated-board metadata and updates content with revisions', () => {
  const fixture = databaseFixture();
  try {
    const created = createBoard(fixture.db, fixture.userId, {
      name: 'Space and History',
      board_data: { gameState: gameState('Space'), version: '2.0' },
      source: 'generated',
      ai_provider: 'openrouter',
      ai_model: 'deepseek/deepseek-v4',
      schema_version: 1,
      metadata: {
        schemaVersion: 1,
        source: 'generated',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4',
        temperature: 0.7,
        topics: ['Space', 'History'],
        generatedAt: '2026-07-11T12:00:00.000Z',
      },
    });

    assert.equal(created.revision, 1);
    assert.equal(created.ai_model, 'deepseek/deepseek-v4');
    assert.equal(created.metadata.source, 'generated');
    assert.deepEqual(created.metadata.topics, ['Space', 'History']);
    assert.equal(listBoards(fixture.db, fixture.userId)[0].id, created.id);
    assert.equal(listBoards(fixture.db, fixture.otherUserId).length, 0);
    assert.equal(getBoard(fixture.db, fixture.otherUserId, created.id), null);

    const updated = updateBoard(fixture.db, fixture.userId, created.id, {
      expected_revision: 1,
      board_data: { gameState: gameState('Updated Space'), version: '2.0' },
    });
    assert.ok(updated);
    assert.equal(updated.revision, 2);
    assert.equal(
      (updated.board_data as { gameState: { categories: { title: string }[] } }).gameState.categories[0].title,
      'Updated Space',
    );

    assert.throws(
      () => updateBoard(fixture.db, fixture.userId, created.id, {
        expected_revision: 1,
        name: 'Stale overwrite',
      }),
      BoardConflictError,
    );
    assert.equal(getBoard(fixture.db, fixture.userId, created.id)?.name, 'Space and History');
  } finally {
    fixture.close();
  }
});

test('records last_opened_at without changing a board revision', () => {
  const fixture = databaseFixture();
  try {
    const created = createBoard(fixture.db, fixture.userId, {
      name: 'Manual Board',
      board_data: { gameState: gameState('General Knowledge'), version: '2.0' },
    });
    const opened = getBoard(fixture.db, fixture.userId, created.id, true);
    assert.ok(opened?.last_opened_at);
    assert.equal(opened?.revision, 1);
  } finally {
    fixture.close();
  }
});
