import type { Player } from './jeopardyTypes';

export interface FJClue { category: string; clue: string; answer: string }
export interface FinalRoundState {
  version: 2;
  phase: 'setup' | 'wager' | 'clue' | 'answers' | 'adjudicate' | 'results';
  baselinePlayers: Player[];
  wagers: number[];
  responses: string[];
  correct: (boolean | null)[];
  clue: FJClue | null;
  durationSeconds: number;
  remainingMs: number;
  deadline: number | null;
  finalPlayers: Player[];
  applied: boolean;
}

// Retain the game's classroom rule: players at zero or below can wager $1,000.
export const maxFinalWager = (player: Player) => Math.max(0, Math.floor(player.score)) || 1000;
export const clampFinalWager = (player: Player, value: number) => Number.isFinite(value)
  ? Math.min(maxFinalWager(player), Math.max(0, Math.round(value))) : 0;

export function createFinalRound(players: Player[]): FinalRoundState {
  return { version: 2, phase: 'setup', baselinePlayers: players.map(player => ({ ...player })),
    wagers: players.map(() => 0), responses: players.map(() => ''), correct: players.map(() => null),
    clue: null, durationSeconds: 30, remainingMs: 30_000, deadline: null, finalPlayers: [], applied: false };
}

export function restoreFinalRound(saved: unknown, players: Player[]): FinalRoundState {
  const fresh = createFinalRound(players);
  if (!saved || typeof saved !== 'object') return fresh;
  const old = saved as Partial<FinalRoundState> & { clueRevealed?: boolean; answerRevealed?: boolean };
  const clue = old.clue && ['category', 'clue', 'answer'].every(key => typeof (old.clue as any)[key] === 'string' && (old.clue as any)[key].trim()) ? old.clue : null;
  if (!clue) return fresh;
  const baseline = old.version === 2 && old.baselinePlayers?.length === players.length && old.baselinePlayers.every(p => Number.isFinite(p.score))
    ? old.baselinePlayers : players;
  const duration = [30, 60, 90].includes(old.durationSeconds || 0) ? old.durationSeconds! : 30;
  let phase = old.phase || 'wager';
  if (!['setup', 'wager', 'clue', 'answers', 'adjudicate', 'results'].includes(phase)) phase = 'wager';
  if (old.version !== 2 && phase === 'clue') phase = old.answerRevealed ? 'adjudicate' : old.clueRevealed ? 'answers' : 'wager';
  const finalPlayers = old.finalPlayers?.length === players.length && old.finalPlayers.every(p => Number.isFinite(p.score)) ? old.finalPlayers : [];
  if (phase === 'results' && !finalPlayers.length) phase = 'adjudicate';
  return { ...fresh, baselinePlayers: baseline.map(p => ({ ...p })), phase, clue, durationSeconds: duration,
    wagers: baseline.map((p, i) => clampFinalWager(p, old.wagers?.[i] || 0)),
    responses: baseline.map((_, i) => typeof old.responses?.[i] === 'string' ? old.responses[i].slice(0, 1000) : ''),
    // Legacy false was a default, not an explicit host decision.
    correct: baseline.map((_, i) => old.version === 2 && typeof old.correct?.[i] === 'boolean' ? old.correct[i] : null),
    remainingMs: Number.isFinite(old.remainingMs) ? Math.max(0, Math.min(duration * 1000, old.remainingMs!)) : duration * 1000,
    deadline: phase === 'clue' && Number.isFinite(old.deadline) ? old.deadline! : null,
    finalPlayers, applied: old.applied === true || (old.version !== 2 && phase === 'results' && finalPlayers.every((p, i) => p.score === players[i].score)) };
}

export function finalTimeRemaining(state: FinalRoundState, now: number): number {
  return Math.max(0, state.deadline === null ? state.remainingMs : state.deadline - now);
}

export function scoreFinalRound(state: FinalRoundState): FinalRoundState {
  if (state.phase === 'results' || state.applied) return state;
  if (state.phase !== 'adjudicate' || !state.baselinePlayers.length || state.correct.some(value => value === null)) {
    throw new Error('Mark every response correct or incorrect before scoring.');
  }
  return { ...state, phase: 'results', deadline: null, finalPlayers: state.baselinePlayers.map((player, i) => ({
    ...player, score: player.score + (state.correct[i] ? 1 : -1) * clampFinalWager(player, state.wagers[i]),
  })) };
}
