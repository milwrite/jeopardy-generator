const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAppServer } = require('../server');

function cookieFrom(response) {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'response should set a session cookie');
  return setCookie.split(';')[0];
}

test('Railway server registers users and keeps revision-safe owned boards', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jeopardy-server-api-'));
  const databasePath = path.join(directory, 'jeopardy.db');
  const server = createAppServer({
    publicDirectory: path.join(directory, 'public'),
    userApiOptions: { databasePath, bcryptRounds: 4 },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const request = (pathname, options = {}) => fetch(`${origin}${pathname}`, {
    ...options,
    headers: {
      Origin: origin,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  try {
    const registration = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'alice',
        email: 'alice@example.com',
        password: 'Testing123!',
      }),
    });
    assert.equal(registration.status, 201);
    const aliceCookie = cookieFrom(registration);
    assert.equal((await registration.json()).username, 'alice');

    const me = await request('/api/auth/me', { headers: { Cookie: aliceCookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).email, 'alice@example.com');

    const rejectedOrigin = await fetch(`${origin}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      body: JSON.stringify({}),
    });
    assert.equal(rejectedOrigin.status, 403);

    const create = await request('/api/boards', {
      method: 'POST',
      headers: { Cookie: aliceCookie },
      body: JSON.stringify({
        name: 'Generated Board',
        board_data: {
          version: '2.0',
          gameState: {
            categories: [{ title: 'Science', questions: [] }],
            players: [],
            currentPlayer: 0,
            finalJeopardyActive: false,
          },
        },
        source: 'generated',
        ai_provider: 'openrouter',
        ai_model: 'deepseek/deepseek-v4-flash',
        schema_version: 1,
        metadata: {
          schemaVersion: 1,
          source: 'generated',
          provider: 'openrouter',
          model: 'deepseek/deepseek-v4-flash',
          generatedAt: '2026-07-11T12:00:00.000Z',
        },
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json();
    assert.equal(created.revision, 1);
    assert.equal(created.ai_model, 'deepseek/deepseek-v4-flash');

    const update = await request(`/api/boards/${created.id}`, {
      method: 'PUT',
      headers: { Cookie: aliceCookie },
      body: JSON.stringify({ expected_revision: 1, name: 'Updated Board' }),
    });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).revision, 2);

    const stale = await request(`/api/boards/${created.id}`, {
      method: 'PUT',
      headers: { Cookie: aliceCookie },
      body: JSON.stringify({ expected_revision: 1, name: 'Stale Board' }),
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).current.revision, 2);

    const credentialMetadata = await request('/api/boards', {
      method: 'POST',
      headers: { Cookie: aliceCookie },
      body: JSON.stringify({
        name: 'Unsafe Board',
        board_data: { gameState: { categories: [] } },
        metadata: { api_key: 'must-not-be-stored' },
      }),
    });
    assert.equal(credentialMetadata.status, 400);

    const bobRegistration = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'bob',
        email: 'bob@example.com',
        password: 'Testing456!',
      }),
    });
    assert.equal(bobRegistration.status, 201);
    const bobCookie = cookieFrom(bobRegistration);
    const otherUsersBoard = await request(`/api/boards/${created.id}`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(otherUsersBoard.status, 404);

    const logout = await request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: aliceCookie },
    });
    assert.equal(logout.status, 200);
    const signedOut = await request('/api/auth/me', { headers: { Cookie: aliceCookie } });
    assert.equal(signedOut.status, 401);
    assert.ok(fs.existsSync(databasePath));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
