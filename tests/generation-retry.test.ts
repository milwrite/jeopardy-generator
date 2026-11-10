import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Board generation is one large request. These pin the rule for asking again, in source.
const source = readFileSync(new URL('../src/AISettingsModal.tsx', import.meta.url), 'utf8');
const board = readFileSync(new URL('../src/JeopardyGame.tsx', import.meta.url), 'utf8');

test('only a 503 is asked again; a 502 or 504 may already have been paid for', () => {
  assert.match(source, /if \(response\.status === 504\) throw new Error\('The model took too long to answer/);
  assert.match(source, /if \(response\.status !== 503 \|\| retries >= maxRetries\) throw lastError;/);
  assert.doesNotMatch(source, /if \(response\.status >= 500\) \{\s*lastError = [^;]+;\s*if \(retries >= maxRetries\) throw lastError;/);
});

test('a dropped connection is asked again only before any response arrived', () => {
  assert.match(source, /let responded = false;/);
  assert.match(source, /credentials: useProxy \? 'same-origin' : 'omit',\s*\}\);\s*responded = true;/);
  assert.match(source, /if \(error instanceof TypeError && !responded\) \{/);
  assert.match(source, /const maxRetries = 1;/);
});

test('a save records the state that was sent, not the state after the request', () => {
  assert.equal((board.match(/const sent = gameStateSnapshot\(state\);/g) || []).length, 2);
  assert.equal((board.match(/activateStoredBoard\(board, state, sent\);/g) || []).length, 2);
  assert.match(board, /setActiveBoard\(\{ \.\.\.summary, savedSnapshot: sent \}\);/);
});

test('a board that cannot be reopened does not leave the loading screen up', () => {
  assert.match(board, /catch\(error=>\{try\{sessionStorage\.removeItem\('jeopardy-login-draft'\);\}catch\{\}if\(active\)\{setSaveStatus\(error\.message\);setHydrating\(false\);\}\}\)/);
});
