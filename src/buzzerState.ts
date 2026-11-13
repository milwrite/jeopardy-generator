import type { GameState } from './jeopardyTypes';
import type { BuzzerRoom } from './buzzerClient';

// Stable participant IDs, not array positions or display names, own score changes.
// Receipts travel with the board so a reconnect cannot apply an event twice.
export function applyBuzzerSnapshot(state: GameState, room: BuzzerRoom): GameState {
  if (state.buzzerRoomCode !== room.code) return state;
  let changed = false;
  const replaceDefaults = room.participants.length > 0 && state.players.every((player, i) => player.name === `Player ${i + 1}` && player.score === 0 && !player.remoteParticipantId);
  const players = replaceDefaults ? [] : state.players.map(player => ({ ...player }));
  for (const participant of room.participants) {
    if (!players.some(player => player.remoteParticipantId === participant.id)) {
      players.push({ name: participant.name, score: 0, active: true, remoteParticipantId: participant.id });
      changed = true;
    }
  }
  const applied = new Set(state.buzzerAppliedEvents || []);
  let categories = state.categories;
  let currentPlayer = state.currentPlayer;
  for (const event of room.scores) {
    const receipt = `${room.code}:${event.id}`;
    if (applied.has(receipt)) continue;
    const playerIndex = players.findIndex(player => player.remoteParticipantId === event.participantId);
    const [ci, qi] = event.clueKey.split(':').map(Number);
    const question = categories[ci]?.questions[qi];
    if (playerIndex < 0 || !question || question.dailyDouble || Math.abs(event.delta) !== question.value) continue;
    players[playerIndex].score += event.delta;
    applied.add(receipt);
    changed = true;
    if (event.correct) {
      currentPlayer = playerIndex;
      categories = categories.map((category, index) => index !== ci ? category : {
        ...category, questions: category.questions.map((clue, index) => index !== qi ? clue : { ...clue, answered: true, revealed: true }),
      });
    }
  }
  return changed ? { ...state, players, currentPlayer, categories, buzzerAppliedEvents: Array.from(applied) } : state;
}

export function attachBuzzerRoom(state: GameState, code: string): GameState {
  return { ...state, buzzerRoomCode: code, buzzerAppliedEvents: [] };
}
