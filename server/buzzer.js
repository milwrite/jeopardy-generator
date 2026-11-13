const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');

// Ephemeral rooms in the existing Node service. No board text or answers are stored here.
// A single service replica is required; a restart ends rooms without touching saved boards.
function createBuzzerApi({ now = Date.now, maxRooms = 128, ttl = 8 * 60 * 60 * 1000 } = {}) {
  const rooms = new Map();
  const secret = () => randomBytes(32).toString('hex');
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' &&
    /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const send = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const sweep = () => { for (const [code, room] of rooms) if (now() - room.touched > ttl) rooms.delete(code); };
  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) fail(413, 'Request too large');
      chunks.push(chunk);
    }
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'A JSON object is required');
      return data;
    } catch (error) { fail(error.status || 400, 'Invalid JSON request'); }
  }
  function snapshot(room) {
    return {
      code: room.code,
      version: room.version,
      participants: room.participants.map(({ id, name }) => ({ id, name })),
      round: room.round,
      scores: room.scores,
      expiresAfterHours: ttl / 3600000,
    };
  }
  async function handle(req, res, pathname) {
    if (!pathname.startsWith('/api/buzzer/')) return false;
    try {
      // Never enable cross-origin credential or capability use.
      if (req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { fail(403, 'Invalid origin'); }
        if (origin.host !== req.headers.host) fail(403, 'Use the buzzer on this site');
      }
      sweep();
      if (pathname === '/api/buzzer/status' && req.method === 'GET') {
        send(res, 200, { available: true, protocol: 1, storage: 'ephemeral', release: process.env.RAILWAY_GIT_COMMIT_SHA || null });
        return true;
      }
      if (pathname === '/api/buzzer/rooms' && req.method === 'POST') {
        await body(req);
        if (rooms.size >= maxRooms) fail(503, 'All buzzer rooms are busy; try again later');
        let code;
        do { code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(code));
        const room = { code, version: 0, hostToken: secret(), participants: [], round: null, scores: [], touched: now() };
        rooms.set(code, room);
        send(res, 201, { hostToken: room.hostToken, room: snapshot(room) });
        return true;
      }
      const match = /^\/api\/buzzer\/rooms\/([A-F0-9]{6})(?:\/(join|prepare|open|lock|buzz|score|close))?$/.exec(pathname);
      if (!match) fail(404, 'Buzzer endpoint not found');
      const room = rooms.get(match[1]);
      if (!room) fail(404, 'This room has ended. Ask the host for a new code.');
      const action = match[2];
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const host = same(token, room.hostToken);
      const participant = room.participants.find(p => same(token, p.token));
      if (!action && req.method === 'GET') {
        if (!host && !participant) fail(401, 'Join the room first');
        room.touched = now();
        send(res, 200, { room: snapshot(room) });
        return true;
      }
      if (req.method !== 'POST') fail(405, 'Method not allowed');
      const data = await body(req);
      if (action === 'join') {
        if (participant) {
          send(res, 200, { participantId: participant.id, token: participant.token, room: snapshot(room) });
          return true;
        }
        const name = typeof data.name === 'string' ? data.name.trim().replace(/\s+/g, ' ') : '';
        if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) fail(400, 'Use a display name of 1–32 characters');
        if (room.participants.some(p => p.name.toLowerCase() === name.toLowerCase())) fail(409, 'That name is already in use. Reconnect in your original browser or choose a different name.');
        if (room.participants.length >= 64) fail(409, 'This room is full');
        const joined = { id: randomUUID(), token: secret(), name };
        room.participants.push(joined);
        room.version++;
        room.touched = now();
        send(res, 201, { participantId: joined.id, token: joined.token, room: snapshot(room) });
        return true;
      }
      if (!host && action !== 'buzz') fail(403, 'Host control required');
      if (action === 'close') {
        rooms.delete(room.code);
        send(res, 200, { closed: true });
        return true;
      }
      if (action === 'prepare') {
        if (!/^\d{1,2}:\d{1,2}$/.test(data.clueKey) || !Number.isInteger(data.value) || data.value < 1 || data.value > 100000) fail(400, 'Invalid clue');
        if (room.round?.clueKey !== data.clueKey) {
          if (room.scores.some(score => score.clueKey === data.clueKey && score.correct)) fail(409, 'This clue has already been scored');
          if (room.scores.length >= 512) fail(409, 'Start a new room for another game');
          room.round = { id: randomUUID(), clueKey: data.clueKey, value: data.value, state: 'locked', order: [], judged: [], firstBuzzId: null };
        }
      } else {
        const round = room.round;
        if (!round || data.roundId !== round.id) fail(409, 'This clue changed. Wait for the current clue.');
        if (action === 'buzz') {
          if (!participant) fail(401, 'Join the room first');
          // A retry returns the same result, even after the host has locked the room.
          if (!round.order.some(b => b.participantId === participant.id)) {
            if (round.state !== 'open') fail(409, 'Buzzers are locked');
            const buzz = { id: randomUUID(), participantId: participant.id, position: round.order.length + 1 };
            round.order.push(buzz);
            if (!round.firstBuzzId) round.firstBuzzId = buzz.id;
          }
        } else if (action === 'score') {
          const existing = room.scores.find(s => s.roundId === round.id && s.participantId === data.participantId);
          if (existing) {
            if (existing.correct !== data.correct) fail(409, 'That response has already been judged');
          } else {
            if (typeof data.correct !== 'boolean' || round.state === 'resolved') fail(409, 'This clue is closed');
            const next = round.order.find(b => !round.judged.includes(b.participantId));
            if (!next || next.participantId !== data.participantId) fail(409, 'Judge the next player in buzz order');
            const event = { id: randomUUID(), roundId: round.id, clueKey: round.clueKey,
              participantId: next.participantId, correct: data.correct, delta: data.correct ? round.value : -round.value };
            room.scores.push(event);
            round.judged.push(next.participantId);
            round.state = data.correct ? 'resolved' : 'locked';
          }
        } else if (action === 'open' || action === 'lock') {
          if (round.state === 'resolved') fail(409, 'This clue is closed');
          if (action === 'open' && round.answerRevealed) fail(409, 'The response has been revealed. Move to the next clue.');
          if (action === 'lock' && data.answerRevealed === true) round.answerRevealed = true;
          round.state = action === 'open' ? 'open' : 'locked';
        } else fail(404, 'Buzzer action not found');
      }
      room.touched = now();
      room.version++;
      send(res, 200, { room: snapshot(room) });
    } catch (error) { send(res, error.status || 500, { error: error.status ? error.message : 'Buzzer request failed' }); }
    return true;
  }
  return { handle };
}

module.exports = { createBuzzerApi };
