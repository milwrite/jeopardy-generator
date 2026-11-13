export interface BuzzerParticipant { id: string; name: string }
export interface BuzzerScore { id: string; roundId: string; clueKey: string; participantId: string; correct: boolean; delta: number }
export interface BuzzerRound {
  id: string; clueKey: string; value: number; state: 'locked' | 'open' | 'resolved';
  order: { id: string; participantId: string; position: number }[];
  judged: string[]; firstBuzzId: string | null;
  answerRevealed?: boolean;
}
export interface BuzzerRoom { code: string; version: number; participants: BuzzerParticipant[]; round: BuzzerRound | null; scores: BuzzerScore[] }
export interface BuzzerReply { room: BuzzerRoom; hostToken?: string; token?: string; participantId?: string }

export async function buzzerRequest(path: string, token?: string, data?: object): Promise<BuzzerReply> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/api/buzzer/${path}`, {
      method: data === undefined ? 'GET' : 'POST', cache: 'no-store', signal: controller.signal,
      headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.room && path !== 'status' && !path.endsWith('/close')) {
      throw new Error(result.error || 'The buzzer is unavailable on this host.');
    }
    return result;
  } finally { clearTimeout(timeout); }
}

export const readPreference = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export const writePreference = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Reconnect still works in this tab. */ } };
