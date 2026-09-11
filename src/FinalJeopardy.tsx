import { useState, useEffect, useRef } from 'react';
import {configuredModelId,isHostedSuite,getOpenRouterModelOptions} from './openRouterModels';
import { parseFinalClue } from './generatedBoard';
import type { Player } from './jeopardyTypes';

export interface FJClue {
  category: string;
  clue: string;
  answer: string;
}

// Generate one Final Jeopardy clue using whichever model the game is configured
// for (local vLLM via the shim, or OpenRouter).
async function generateFinalClue(controller: AbortController): Promise<FJClue> {
  const deadline = setTimeout(() => controller.abort(new Error('The model did not respond within 45 seconds. Try another model in Config.')), 45_000);
  try {
  const g = (k: string, d = '') =>
    (typeof window !== 'undefined' ? localStorage.getItem(k) || d : d);
  const prompt =
    'Generate ONE challenging Final Jeopardy! clue on an interesting topic. ' +
    'Return ONLY JSON (no markdown, no commentary): ' +
    '{"category":"CATEGORY NAME","clue":"a difficult declarative statement","answer":"What is X?"}. ' +
    'The clue must be a statement, never a question, and must not contain the answer words.';

  let content = '';
  const useProxy = g('jeopardy_ai_provider', 'openrouter') === 'openrouter' && !g('jeopardy_api_key');
  const model = configuredModelId(g('jeopardy_model_id'), isHostedSuite(), useProxy);
  if (g('jeopardy_ai_provider', 'openrouter') === 'openrouter') {
    const r = await fetch(useProxy ? '/api/ai/chat' : 'https://openrouter.ai/api/v1/chat/completions', {
      signal: controller.signal,
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
        model,
        max_tokens: 600,
        ...getOpenRouterModelOptions(model),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'Model request failed');
    content = d.choices?.[0]?.message?.content || '';
  } else {
    const r = await fetch(`${g('jeopardy_ollama_url', 'http://localhost:11435')}/api/chat`, {
      signal: controller.signal,
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
    if (!r.ok) throw new Error(d.error?.message || d.error || 'Model request failed');
    content = d.message?.content || d.response || '';
  }

  return parseFinalClue(content);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

export interface FinalRoundState {phase:'wager'|'clue'|'adjudicate'|'results';wagers:number[];clue:FJClue|null;clueRevealed:boolean;answerRevealed:boolean;correct:boolean[];finalPlayers:Player[]}
interface Props {
  saved?:FinalRoundState;
  onStateChange:(state:FinalRoundState)=>void;
  players: Player[];
  onComplete: (players: Player[]) => void;
  onCancel: () => void;
}

export default function FinalJeopardy({ players, onComplete, onCancel, saved, onStateChange }: Props) {
  const [phase, setPhase] = useState<'wager' | 'clue' | 'adjudicate' | 'results'>(saved?.phase==='clue'&&!saved.clue?'wager':saved?.phase||'wager');
  const [wagers, setWagers] = useState<number[]>(saved?.wagers||players.map(() => 0));
  const [clue, setClue] = useState<FJClue | null>(saved?.clue||null);
  const [loading, setLoading] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const activeGeneration = useRef<AbortController | null>(null);
  useEffect(() => () => activeGeneration.current?.abort(new Error('Generation cancelled.')), []);
  const [clueRevealed, setClueRevealed] = useState(saved?.clueRevealed||false);
  const [answerRevealed, setAnswerRevealed] = useState(saved?.answerRevealed||false);
  const [correct, setCorrect] = useState<boolean[]>(saved?.correct||players.map(() => false));
  const [finalPlayers, setFinalPlayers] = useState<Player[]>(saved?.finalPlayers||players);

  useEffect(()=>{onStateChange({phase,wagers,clue,clueRevealed,answerRevealed,correct,finalPlayers});},[phase,wagers,clue,clueRevealed,answerRevealed,correct,finalPlayers,onStateChange]);

  const maxWager = (i: number) => Math.max(players[i].score, 0) || 1000;

  const setWager = (i: number, raw: number) => {
    const clamped = Math.max(0, Math.min(Math.round(raw || 0), maxWager(i)));
    setWagers((prev) => prev.map((w, j) => (j === i ? clamped : w)));
  };

  const beginClue = async () => {
    if (activeGeneration.current) return;
    const controller = new AbortController();
    activeGeneration.current = controller;
    setGenerationError('');
    setPhase('clue');
    setLoading(true);
    try {
      setClue(await generateFinalClue(controller));
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Generation failed. Try again.');
      setPhase('wager');
    } finally {
      activeGeneration.current = null;
      setLoading(false);
    }
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
      {generationError && <p role="alert">{generationError} Your wagers are retained.</p>}

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
            <><p className="fj-loading" role="status">Generating the Final Jeopardy clue…</p>
            <button className="btn-danger" onClick={() => activeGeneration.current?.abort(new Error('Generation cancelled.'))}>Cancel generation</button></>
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
