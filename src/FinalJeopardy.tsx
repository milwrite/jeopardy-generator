import { useEffect, useRef, useState } from 'react';
import { generateFinalClue } from './finalClue';
import { clampFinalWager, finalTimeRemaining, maxFinalWager, restoreFinalRound, scoreFinalRound, type FJClue, type FinalRoundState } from './finalRound';
import type { Category, Player } from './jeopardyTypes';
import type { ReferenceMaterial } from './referenceMaterials';
export type { FJClue, FinalRoundState } from './finalRound';

interface Props {
  saved?: FinalRoundState;
  onStateChange: (state: FinalRoundState) => void;
  players: Player[];
  categories: Category[];
  referenceMaterials?: ReferenceMaterial[];
  onComplete: (state: FinalRoundState) => void;
  onCancel: () => void;
}

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function FinalJeopardy({ players, categories, referenceMaterials, onComplete, onCancel, saved, onStateChange }: Props) {
  const [round, setRound] = useState(() => restoreFinalRound(saved, players));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  const [manual, setManual] = useState<FJClue>({ category: '', clue: '', answer: '' });
  const activeGeneration = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => activeGeneration.current?.abort(new Error('Generation cancelled.')), []);
  useEffect(() => { onStateChange(round); }, [round, onStateChange]);
  useEffect(() => { heading.current?.focus(); }, [round.phase]);
  useEffect(() => {
    if (round.phase !== 'clue' || round.deadline === null) return;
    const tick = () => {
      const time = Date.now(); setNow(time);
      if (time >= round.deadline!) setRound(previous => previous.phase === 'clue'
        ? { ...previous, phase: 'answers', remainingMs: 0, deadline: null } : previous);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [round.phase, round.deadline]);

  const prepare = async () => {
    if (activeGeneration.current) return;
    const controller = new AbortController(); activeGeneration.current = controller;
    setLoading(true); setError('');
    try {
      const clue = await generateFinalClue(controller, categories, referenceMaterials);
      if (!controller.signal.aborted) setRound(previous => ({ ...previous, clue, phase: 'wager' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Clue generation failed. Try again or enter your own clue.');
    } finally { activeGeneration.current = null; setLoading(false); }
  };

  const start = () => {
    const time = Date.now(); setNow(time);
    setRound(previous => ({ ...previous, phase: 'clue', remainingMs: previous.durationSeconds * 1000, deadline: time + previous.durationSeconds * 1000 }));
  };
  const seconds = Math.ceil(finalTimeRemaining(round, now) / 1000);
  const rank = round.finalPlayers.map((player, index) => ({ ...player, index })).sort((a, b) => b.score - a.score);
  const winners = rank.filter(player => player.score === rank[0]?.score);
  const allGraded = round.correct.length > 0 && round.correct.every(value => value !== null);

  return <section className="final-jeopardy" aria-labelledby="final-title">
    <h2 id="final-title" ref={heading} tabIndex={-1}>Final Jeopardy</h2>
    <p className="fj-sub">{({ setup: 'Prepare the round', wager: 'Set wagers', clue: 'Time to answer', answers: 'Collect responses', adjudicate: 'Review responses', results: 'Final scores' })[round.phase]}</p>
    {error && <p role="alert" className="reference-error">{error}</p>}
    <div className="fj-section">
      {round.phase === 'setup' && <>
        <p className="fj-sub">Prepare one final clue with your selected model. Players see the category before they wager.</p>
        {referenceMaterials?.length ? <p className="fj-sub">Using {referenceMaterials.length} reference {referenceMaterials.length === 1 ? 'file' : 'files'} from this board.</p> : null}
        {loading ? <><p role="status">Generating the final clue…</p><button className="btn-danger" onClick={() => activeGeneration.current?.abort(new Error('Generation cancelled.'))}>Cancel generation</button></>
          : <button className="btn-primary" onClick={prepare}>Generate final clue</button>}
        <details className="fj-manual">
          <summary>Enter a host-prepared clue</summary>
          <p className="fj-sub">Prepare this before sharing the screen with players.</p>
          <label>Category<input className="ai-input" value={manual.category} maxLength={120} onChange={event => setManual({ ...manual, category: event.target.value })} /></label>
          <label>Clue<textarea className="ai-input" value={manual.clue} maxLength={2000} onChange={event => setManual({ ...manual, clue: event.target.value })} /></label>
          <label>Correct response<input className="ai-input" value={manual.answer} maxLength={500} onChange={event => setManual({ ...manual, answer: event.target.value })} /></label>
          <button className="btn-primary" disabled={loading || !Object.values(manual).every(value => value.trim())} onClick={() => { setError(''); setRound({ ...round, clue: { category: manual.category.trim(), clue: manual.clue.trim(), answer: manual.answer.trim() }, phase: 'wager' }); }}>Use this clue</button>
        </details>
      </>}

      {round.clue && round.phase !== 'setup' && <div className="fj-category">{round.clue.category}</div>}
      {round.phase === 'wager' && <>
        <p className="fj-sub">Wager up to your current score. Classroom rule: players at zero or below may wager up to $1,000. The host records wagers before revealing the clue.</p>
        {round.baselinePlayers.map((player, i) => <div className="fj-row" key={i}>
          <label className="fj-name" htmlFor={`final-wager-${i}`}>{player.name} <em>({money(player.score)})</em></label>
          <input id={`final-wager-${i}`} className="fj-wager-input" type="number" min={0} max={maxFinalWager(player)} step={1} value={round.wagers[i]}
            onChange={event => setRound({ ...round, wagers: round.wagers.map((wager, j) => i === j ? clampFinalWager(player, Number(event.target.value)) : wager) })} />
          <span className="fj-max">/ {money(maxFinalWager(player))}</span>
        </div>)}
        <label className="fj-duration">Answer time <select value={round.durationSeconds} onChange={event => setRound({ ...round, durationSeconds: Number(event.target.value) })}>
          <option value={30}>30 seconds</option><option value={60}>60 seconds</option><option value={90}>90 seconds</option>
        </select></label>
        <div className="fj-actions"><button className="btn-primary" disabled={!round.baselinePlayers.length} onClick={start}>Lock wagers &amp; reveal clue</button></div>
      </>}

      {round.clue && ['clue', 'answers', 'adjudicate', 'results'].includes(round.phase) && <div className="fj-clue">{round.clue.clue}</div>}
      {round.phase === 'clue' && <>
        <p className="fj-sub">Write your response privately. The host collects answers when time expires.</p>
        <div className="fj-timer" role="timer" aria-label={`${seconds} seconds remaining`}>{seconds}<small> seconds{round.deadline === null ? ' · paused' : ''}</small></div>
        <div className="fj-actions">
          <button className="btn-primary" onClick={() => { const time = Date.now(); setNow(time); setRound(previous => previous.deadline === null
            ? { ...previous, deadline: time + previous.remainingMs }
            : { ...previous, remainingMs: finalTimeRemaining(previous, time), deadline: null }); }}>{round.deadline === null ? 'Resume timer' : 'Pause timer'}</button>
          <button className="btn-ghost" onClick={() => setRound({ ...round, phase: 'answers', deadline: null, remainingMs: 0 })}>End answer time</button>
        </div>
      </>}

      {round.phase === 'answers' && <>
        <p role="status" className="fj-sub">Time is up. Record each response before revealing the correct answer, or leave these blank if players answered on paper.</p>
        {round.baselinePlayers.map((player, i) => <label className="fj-response-entry" key={i}>{player.name}&apos;s response
          <textarea className="ai-input" maxLength={1000} value={round.responses[i]} placeholder="What is…?" onChange={event => setRound({ ...round, responses: round.responses.map((response, j) => i === j ? event.target.value : response) })} />
        </label>)}
        <button className="btn-primary" onClick={() => setRound({ ...round, phase: 'adjudicate' })}>Lock responses &amp; reveal answer</button>
      </>}

      {round.clue && ['adjudicate', 'results'].includes(round.phase) && <div className="fj-answer">Correct response: <strong>{round.clue.answer}</strong></div>}
      {round.phase === 'adjudicate' && <>
        <p className="fj-sub">The host judges each response. A correct response adds the wager; an incorrect or missing response subtracts it.</p>
        {round.baselinePlayers.map((player, i) => <div className="fj-review" key={i}>
          <p><strong>{player.name}</strong> · wager {money(round.wagers[i])}</p>
          <p className="fj-written-response">{round.responses[i] || 'No typed response — review the player’s paper answer.'}</p>
          <div className="fj-judge" role="group" aria-label={`Grade ${player.name}`}>
            {[true, false].map(correct => <button key={String(correct)} aria-pressed={round.correct[i] === correct}
              className={`fj-judge-btn${round.correct[i] === correct ? correct ? ' on-correct' : ' on-wrong' : ''}`}
              onClick={() => setRound({ ...round, correct: round.correct.map((value, j) => i === j ? correct : value) })}>{correct ? 'Correct' : 'Incorrect'}</button>)}
          </div>
        </div>)}
        {!allGraded && <p className="fj-sub">Mark every response to reveal the results.</p>}
        <button className="btn-primary" disabled={!allGraded} onClick={() => setRound(scoreFinalRound(round))}>Reveal final scores</button>
      </>}

      {round.phase === 'results' && <>
        <p className="fj-winner-message" role="status">{winners.map(player => player.name).join(' & ')} {winners.length > 1 ? 'tie for first place!' : 'wins!'}</p>
        <ol className="fj-results">{rank.map(player => <li key={player.index} className={player.score === rank[0]?.score ? 'fj-winner' : ''}>
          <span className="fj-name">{player.name}<small>{money(round.baselinePlayers[player.index].score)} {round.correct[player.index] ? '+' : '−'} {money(round.wagers[player.index])}</small></span>
          <span className="fj-score">{money(player.score)}</span>
        </li>)}</ol>
        <div className="fj-actions"><button className="btn-primary" onClick={() => onComplete({ ...round, applied: true })}>Back to board</button></div>
      </>}
      {round.phase !== 'results' && <div className="fj-actions"><button className="btn-ghost" disabled={loading} onClick={onCancel}>Save round &amp; return to board</button></div>}
    </div>
  </section>;
}
