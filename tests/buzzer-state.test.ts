import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBuzzerRoom, applyBuzzerSnapshot } from '../src/buzzerState';
import { createCueGate, playBuzzerCue } from '../src/buzzerSound';
import type { BuzzerRoom } from '../src/buzzerClient';
import type { GameState } from '../src/jeopardyTypes';

const state: GameState = { categories: [{ title: 'Synthetic', questions: [
  { text: 'Synthetic clue', answer: 'Synthetic response', value: 200, revealed: true, answered: false },
]}], players: [{ name: 'Player 1', score: 0, active: true }], currentPlayer: 0, finalJeopardyActive: false };
const room: BuzzerRoom = { code: 'ABC123', version: 1, participants: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], round: null,
  scores: [{ id: 'one', roundId: 'r', clueKey: '0:0', participantId: 'b', correct: false, delta: -200 },
    { id: 'two', roundId: 'r', clueKey: '0:0', participantId: 'a', correct: true, delta: 200 }] };

test('score receipts survive serialization and follow player IDs after reordering', () => {
  let result = applyBuzzerSnapshot(attachBuzzerRoom(state, room.code), { ...room, scores: [] });
  assert.deepEqual(result.players.map(p => p.name), ['Alice', 'Bob']);
  result = { ...result, players: [...result.players].reverse() };
  result = applyBuzzerSnapshot(result, room);
  assert.deepEqual(result.players.map(p => p.score), [-200, 200]);
  assert.equal(result.players[result.currentPlayer].name, 'Alice');
  assert.equal(result.categories[0].questions[0].answered, true);
  const restored = JSON.parse(JSON.stringify(result));
  assert.equal(applyBuzzerSnapshot(restored, room), restored);
  assert.equal(state.players[0].score, 0);
  assert.equal(state.categories[0].questions[0].answered, false);
});
test('unrelated room, unknown participant, invalid clue and wrong value cannot change scores', () => {
  assert.equal(applyBuzzerSnapshot(state, room), state);
  const attached = attachBuzzerRoom(state, room.code);
  const bad = { ...room, scores: [
    { ...room.scores[0], participantId: 'missing' },
    { ...room.scores[0], clueKey: '9:9' },
    { ...room.scores[0], delta: -400 },
  ] };
  const result = applyBuzzerSnapshot(attached, bad);
  assert.deepEqual(result.players.map(p => p.score), [0, 0]);
  assert.equal(result.buzzerAppliedEvents?.length, 0);
});
test('existing names and scores are preserved when players join', () => {
  const existing = { ...state, players: [{ name: 'Local team', score: 600, active: true }] };
  const result = applyBuzzerSnapshot(attachBuzzerRoom(existing, room.code), { ...room, scores: [] });
  assert.equal(result.players[0].name, 'Local team');
  assert.equal(result.players[0].score, 600);
});
test('sound gate emits once per new first buzz, never for retries, reconnects or muted history', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
  let cue = createCueGate(storage, room.code);
  assert.equal(cue(null, false), false);
  assert.equal(cue('first', false), true);
  assert.equal(cue('first', false), false);
  cue = createCueGate(storage, room.code);
  assert.equal(cue('first', false), false);
  assert.equal(cue(null, false), false);
  assert.equal(cue('second', true), false);
  assert.equal(cue('second', false), false);
  assert.equal(cue('third', false), true);
  const differentBrowser = createCueGate(storage, 'SECOND');
  assert.equal(differentBrowser('existing', false), false);
});
test('original cue schedules a short four-note synthesis without fetching audio', () => {
  const frequencies: number[] = [], ends: number[] = [];
  const fake = { state: 'running', currentTime: 0, destination: {},
    createOscillator: () => ({ type: '', frequency: { set value(value: number) { frequencies.push(value); } }, connect() {}, start() {}, stop(time: number) { ends.push(time); }, disconnect() {} }),
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
  };
  playBuzzerCue(fake as unknown as AudioContext);
  assert.equal(frequencies.length, 4);
  assert.ok(Math.max(...ends) < 0.4);
});
