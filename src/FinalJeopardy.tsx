import { useState } from 'react';
import type { Player } from './jeopardyTypes';

interface FJClue {
  category: string;
  clue: string;
  answer: string;
}

// Generate one Final Jeopardy clue using whichever model the game is configured
// for (local vLLM via the shim, or OpenRouter). Best-effort JSON extraction.
async function generateFinalClue(): Promise<FJClue> {
  const g = (k: string, d = '') =>
    (typeof window !== 'undefined' ? localStorage.getItem(k) || d : d);
  const prompt =
    'Generate ONE challenging Final Jeopardy! clue on an interesting topic. ' +
    'Return ONLY JSON (no markdown, no commentary): ' +
    '{"category":"CATEGORY NAME","clue":"a difficult declarative statement","answer":"What is X?"}. ' +
    'The clue must be a statement, never a question, and must not contain the answer words.';

  let content = '';
  const useProxy = g('jeopardy_ai_provider', 'openrouter') === 'openrouter' && !g('jeopardy_api_key');
  if (g('jeopardy_ai_provider', 'openrouter') === 'openrouter') {
    const r = await fetch(useProxy ? '/api/ai/chat' : 'https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(useProxy
          ? {}
          : {
              Authorization: `Bearer ${g('jeopardy_api_key')}`,
              'HTTP-Referer': window.location.href,
              'X-Title': 'Jeopardy Game',
            }),
      },
      body: JSON.stringify({
        model: g('jeopardy_model_id', 'google/gemini-3.1-flash-lite'),
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.6,
      }),
    });
    const d = await r.json();
    content = d.choices?.[0]?.message?.content || '';
  } else {
    const r = await fetch(`${g('jeopardy_ollama_url', 'http://localhost:11435')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: g('jeopardy_ollama_model', 'jeopardylm'),
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.6, num_predict: 300 },
      }),
    });
    const d = await r.json();
    content = d.message?.content || d.response || '';
  }

  const match = content.match(/\{[\s\S]*\}/);
  let obj: Partial<FJClue> = {};
  try {
    obj = match ? JSON.parse(match[0]) : {};
  } catch {
    obj = {};
  }
  return {
    category: obj.category || 'Final Jeopardy',
    clue: obj.clue || content.trim() || 'No clue generated.',
    answer: obj.answer || '',
  };
}

interface Props {
  players: Player[];
  onComplete: (players: Player[]) => void;
  onCancel: () => void;
}

export default function FinalJeopardy({ players, onComplete, onCancel }: Props) {
  const [phase, setPhase] = useState<'wager' | 'clue' | 'adjudicate' | 'results'>('wager');
  const [wagers, setWagers] = useState<number[]>(players.map(() => 0));
  const [clue, setClue] = useState<FJClue | null>(null);
  const [loading, setLoading] = useState(false);
  const [clueRevealed, setClueRevealed] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [correct, setCorrect] = useState<boolean[]>(players.map(() => false));
  const [finalPlayers, setFinalPlayers] = useState<Player[]>(players);

  const maxWager = (i: number) => Math.max(players[i].score, 0) || 1000;

  const setWager = (i: number, raw: number) => {
    const clamped = Math.max(0, Math.min(Math.round(raw || 0), maxWager(i)));
    setWagers((prev) => prev.map((w, j) => (j === i ? clamped : w)));
  };

  const beginClue = async () => {
    setPhase('clue');
    setLoading(true);
    try {
      setClue(await generateFinalClue());
    } catch {
      setClue({ category: 'Final Jeopardy', clue: 'Could not reach the model — check the connection and try again.', answer: '' });
    }
    setLoading(false);
  };

  const toResults = () => {
    const updated = players.map((p, i) => ({
      ...p,
      score: p.score + (correct[i] ? wagers[i] : -wagers[i]),
    }));
    setFinalPlayers(updated);
    setPhase('results');
  };

  const ranked = [...finalPlayers]
    .map((p, i) => ({ ...p, idx: i }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="final-jeopardy">
      <h2>Final Jeopardy</h2>

      {phase === 'wager' && (
        <div className="fj-section">
          <p className="fj-sub">Each player wagers up to their score (or $1000 if broke).</p>
          {players.map((p, i) => (
            <div className="fj-row" key={i}>
              <span className="fj-name">{p.name} <em>(${p.score})</em></span>
              <input
                type="number"
                min={0}
                max={maxWager(i)}
                value={wagers[i]}
                onChange={(e) => setWager(i, Number(e.target.value))}
                className="fj-wager-input"
              />
              <span className="fj-max">/ ${maxWager(i)}</span>
            </div>
          ))}
          <div className="fj-actions">
            <button className="btn-primary" onClick={beginClue}>Lock wagers &amp; reveal category</button>
            <button className="btn-danger" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}

      {phase === 'clue' && (
        <div className="fj-section">
          {loading ? (
            <p className="fj-loading">Generating the Final Jeopardy clue…</p>
          ) : clue ? (
            <>
              <div className="fj-category">{clue.category}</div>
              {clueRevealed ? (
                <div className="fj-clue">{clue.clue}</div>
              ) : (
                <button className="btn-primary" onClick={() => setClueRevealed(true)}>Reveal clue</button>
              )}
              {clueRevealed && (answerRevealed ? (
                <div className="fj-answer">Correct response: <strong>{clue.answer || '—'}</strong></div>
              ) : (
                <button className="btn-primary" onClick={() => setAnswerRevealed(true)}>Reveal answer</button>
              ))}
              {answerRevealed && (
                <div className="fj-actions">
                  <button className="btn-primary" onClick={() => setPhase('adjudicate')}>Score players</button>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {phase === 'adjudicate' && (
        <div className="fj-section">
          <p className="fj-sub">Mark each player right or wrong. Right adds their wager; wrong subtracts it.</p>
          {players.map((p, i) => (
            <div className="fj-row" key={i}>
              <span className="fj-name">{p.name} <em>(wager ${wagers[i]})</em></span>
              <div className="fj-judge">
                <button
                  className={`fj-judge-btn${correct[i] ? ' on-correct' : ''}`}
                  onClick={() => setCorrect((prev) => prev.map((c, j) => (j === i ? true : c)))}
                >Correct</button>
                <button
                  className={`fj-judge-btn${!correct[i] ? ' on-wrong' : ''}`}
                  onClick={() => setCorrect((prev) => prev.map((c, j) => (j === i ? false : c)))}
                >Wrong</button>
              </div>
            </div>
          ))}
          <div className="fj-actions">
            <button className="btn-primary" onClick={toResults}>Reveal results</button>
          </div>
        </div>
      )}

      {phase === 'results' && (
        <div className="fj-section">
          <ol className="fj-results">
            {ranked.map((p, rank) => (
              <li key={p.idx} className={rank === 0 ? 'fj-winner' : ''}>
                <span className="fj-name">{rank === 0 ? '👑 ' : ''}{p.name}</span>
                <span className="fj-score">${p.score}</span>
              </li>
            ))}
          </ol>
          <div className="fj-actions">
            <button className="btn-primary" onClick={() => onComplete(finalPlayers)}>Back to board</button>
          </div>
        </div>
      )}
    </div>
  );
}
