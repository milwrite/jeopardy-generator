import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinalRound, restoreFinalRound, scoreFinalRound, finalTimeRemaining, clampFinalWager, maxFinalWager } from '../src/finalRound';
const players = [{ name:'Ada', score:2000, active:true }, { name:'Sam', score:1000, active:false }];
const clue = { category:'Archives', clue:'This archive opened in 1986.', answer:'What is the Lantern Archive?' };
test('the round starts with preparation and requires explicit judgments', () => {
  const state = createFinalRound(players); assert.equal(state.phase,'setup'); assert.deepEqual(state.correct,[null,null]);
  assert.throws(() => scoreFinalRound(state), /Mark every/);
  assert.throws(() => scoreFinalRound({ ...state, phase:'adjudicate', correct:[true,null] }), /Mark every/);
});
test('wagers are finite, integral and bounded, preserving the classroom rule', () => {
  assert.equal(clampFinalWager(players[0],4000),2000); assert.equal(clampFinalWager(players[0],-2),0);
  assert.equal(clampFinalWager(players[0],NaN),0); assert.equal(clampFinalWager(players[0],Infinity),0);
  assert.equal(clampFinalWager(players[0],20.8),21);
  assert.equal(maxFinalWager({ ...players[0],score:-400 }),1000);
  assert.equal(maxFinalWager({ ...players[0],score:0 }),1000);
});
test('scores use the locked baseline and cannot be added twice, including after reload', () => {
  const state = { ...createFinalRound(players), phase:'adjudicate' as const, clue, wagers:[1000,1000], correct:[false,true] };
  const result = scoreFinalRound(state); assert.deepEqual(result.finalPlayers.map(p=>p.score),[1000,2000]);
  assert.equal(scoreFinalRound(result),result);
  const resumed = restoreFinalRound({ ...result,applied:true },result.finalPlayers);
  assert.equal(resumed.applied,true); assert.deepEqual(scoreFinalRound(resumed).finalPlayers,result.finalPlayers);
  assert.deepEqual(players.map(p=>p.score),[2000,1000]);
});
test('ties and negative final scores retain every player', () => {
  const tied=scoreFinalRound({ ...createFinalRound(players),phase:'adjudicate',wagers:[0,1000],correct:[true,true] });
  assert.deepEqual(tied.finalPlayers.map(p=>p.score),[2000,2000]);
  const negative=scoreFinalRound({ ...createFinalRound([{...players[0],score:-200}]),phase:'adjudicate',wagers:[1000],correct:[false] });
  assert.equal(negative.finalPlayers[0].score,-1200);
});
test('timer survives reload, paused time stays fixed, and expired time is zero', () => {
  const saved={ ...createFinalRound(players),clue,phase:'clue' as const,deadline:35_000 };
  assert.equal(finalTimeRemaining(restoreFinalRound(saved,players),20_000),15_000);
  assert.equal(finalTimeRemaining(saved,40_000),0);
  assert.equal(finalTimeRemaining({...saved,deadline:null,remainingMs:12_000},90_000),12_000);
});
test('legacy or incomplete rounds recover without exposing answers or grading defaults', () => {
  assert.equal(restoreFinalRound({ phase:'clue',clue:null },players).phase,'setup');
  const legacy=restoreFinalRound({ phase:'clue',clue,clueRevealed:false,wagers:[500,200],correct:[false,false] },players);
  assert.equal(legacy.phase,'wager'); assert.deepEqual(legacy.correct,[null,null]);
  assert.equal(restoreFinalRound({phase:'clue',clue,clueRevealed:true},players).phase,'answers');
});
