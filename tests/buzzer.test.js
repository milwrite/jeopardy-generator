const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppServer } = require('../server');
const { createBuzzerApi } = require('../server/buzzer');

async function harness(t, options = {}) {
  const server = createAppServer({ userApi: { handle: () => false }, buzzerApi: createBuzzerApi(options) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, token, data, extraHeaders = {}) => {
    const response = await fetch(`${base}/api/buzzer/${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, ...(await response.json()) };
  };
}

test('remote room orders simultaneous buzzes, reconnects identities and scores each response once', async t => {
  const request = await harness(t);
  const created = await request('rooms', null, {});
  assert.equal(created.status, 201);
  const path = `rooms/${created.room.code}`;
  const host = created.hostToken;
  const alice = await request(`${path}/join`, null, { name: 'Test Alice' });
  const bob = await request(`${path}/join`, null, { name: 'Test Bob' });
  assert.notEqual(alice.participantId, bob.participantId);
  assert.equal((await request(`${path}/join`, null, { name: 'test alice' })).status, 409);
  const rejoined = await request(`${path}/join`, alice.token, { name: 'different ignored name' });
  assert.equal(rejoined.participantId, alice.participantId);
  assert.equal(rejoined.room.participants.length, 2);
  assert.equal(rejoined.room.participants[0].name, 'Test Alice');
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, 'é'.repeat(64))).status, 401);
  assert.equal((await request(`${path}/prepare`, alice.token, { clueKey: '0:0', value: 200 })).status, 403);
  let room = (await request(`${path}/prepare`, host, { clueKey: '0:0', value: 200 })).room;
  const roundId = room.round.id;
  assert.equal((await request(`${path}/buzz`, alice.token, { roundId })).status, 409);
  await request(`${path}/open`, host, { roundId });
  const buzzes = await Promise.all([alice, bob].map(player => request(`${path}/buzz`, player.token, { roundId })));
  assert.ok(buzzes.every(result => result.status === 200));
  room = (await request(path, host)).room;
  assert.deepEqual(room.round.order.map(buzz => buzz.position), [1, 2]);
  assert.equal(new Set(room.round.order.map(buzz => buzz.participantId)).size, 2);
  const firstBuzzId = room.round.firstBuzzId;
  await request(`${path}/lock`, host, { roundId });
  const retried = await request(`${path}/buzz`, alice.token, { roundId });
  assert.equal(retried.room.round.order.length, 2);
  assert.equal(retried.room.round.firstBuzzId, firstBuzzId);
  const first = room.round.order[0].participantId;
  const second = room.round.order[1].participantId;
  assert.equal((await request(`${path}/score`, bob.token, { roundId, participantId: first, correct: true })).status, 403);
  assert.equal((await request(`${path}/score`, host, { roundId, participantId: second, correct: true })).status, 409);
  const wrong = await request(`${path}/score`, host, { roundId, participantId: first, correct: false });
  assert.equal(wrong.room.scores[0].delta, -200);
  const correctResults = await Promise.all([1, 2].map(() => request(`${path}/score`, host, { roundId, participantId: second, correct: true })));
  assert.ok(correctResults.every(result => result.room.scores.length === 2));
  assert.equal(correctResults[0].room.round.state, 'resolved');
  assert.equal(correctResults[0].room.scores[1].delta, 200);
  assert.equal((await request(`${path}/open`, host, { roundId })).status, 409);
  assert.equal((await request(`${path}/score`, host, { roundId, participantId: second, correct: false })).status, 409);
  const next = await request(`${path}/prepare`, host, { clueKey: '0:1', value: 400 });
  assert.deepEqual(next.room.round.order, []);
  assert.equal(next.room.round.firstBuzzId, null);
  assert.equal(next.room.round.state, 'locked');
  assert.deepEqual(next.room.participants, room.participants);
  assert.equal((await request(`${path}/buzz`, bob.token, { roundId })).status, 409);
  assert.equal((await request(`${path}/score`, host, { roundId, participantId: first, correct: false })).status, 409);
  const nextId = next.room.round.id;
  await request(`${path}/lock`, host, { roundId: nextId, answerRevealed: true });
  assert.equal((await request(`${path}/open`, host, { roundId: nextId })).status, 409);
  const playerView = await request(path, alice.token);
  assert.equal(playerView.room.participants.length, 2);
  assert.equal(JSON.stringify(playerView).includes(host), false);
  assert.equal(JSON.stringify(playerView).includes(bob.token), false);
  assert.equal((await request(`${path}/close`, host, {})).status, 200);
  assert.equal((await request(path, alice.token)).status, 404);
});

test('rooms reject cross-site access, bounded names/capacity and expired capabilities', async t => {
  let time = 0;
  const request = await harness(t, { now: () => time, maxRooms: 1, ttl: 100 });
  assert.equal((await request('rooms', null, {}, { Origin: 'https://unrelated.example' })).status, 403);
  const created = await request('rooms', null, {});
  assert.equal((await request('rooms', null, {})).status, 503);
  const path = `rooms/${created.room.code}`;
  assert.equal((await request(`${path}/join`, null, { name: 'x'.repeat(33) })).status, 400);
  assert.equal((await request(`${path}/join`, null, { name: '' })).status, 400);
  assert.equal((await request(`${path}/prepare`, created.hostToken, { clueKey: 'arbitrary', value: 200 })).status, 400);
  time = 101;
  assert.equal((await request(path, created.hostToken)).status, 404);
  assert.equal((await request('rooms', null, {})).status, 201);
});
