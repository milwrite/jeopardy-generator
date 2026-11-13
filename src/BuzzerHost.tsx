import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from './jeopardyTypes';
import { BuzzerRoom, buzzerRequest, readPreference, writePreference } from './buzzerClient';
import { applyBuzzerSnapshot, attachBuzzerRoom } from './buzzerState';
import { createCueGate, playBuzzerCue } from './buzzerSound';

type Selection = { categoryIndex: number; questionIndex: number } | null;
type Setter = React.Dispatch<React.SetStateAction<GameState>>;

export function useBuzzerHost(state: GameState, setState: Setter, selected: Selection) {
  const [room, setRoom] = useState<BuzzerRoom | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const credentials = useRef<Record<string, string>>({});
  const gate = useRef<ReturnType<typeof createCueGate> | null>(null);
  const liveRoom = useRef<BuzzerRoom | null>(null);
  const code = state.buzzerRoomCode;
  const codeRef = useRef(code);
  codeRef.current = code;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const clueKey = selected ? `${selected.categoryIndex}:${selected.questionIndex}` : null;
  const question = selected ? state.categories[selected.categoryIndex]?.questions[selected.questionIndex] : undefined;
  const value = question?.value;
  const dailyDouble = Boolean(question?.dailyDouble);

  useEffect(() => {
    setMuted(readPreference('jeopardy.buzzer.muted') === 'true');
    buzzerRequest('status').then(() => setAvailable(true)).catch(() => setAvailable(false));
    return () => { void audio.current?.close(); };
  }, []);

  const accept = useCallback((next: BuzzerRoom) => {
    if (next.code !== codeRef.current) return;
    if (liveRoom.current?.code === next.code && liveRoom.current.version > next.version) return;
    liveRoom.current = next;
    setRoom(next);
    setConnected(true);
    setState(current => applyBuzzerSnapshot(current, next));
    if (gate.current?.(next.round?.firstBuzzId, mutedRef.current) && audio.current) playBuzzerCue(audio.current);
  }, [setState]);

  useEffect(() => {
    setRoom(null);
    liveRoom.current = null;
    setConnected(false);
    if (!code) return;
    gate.current = createCueGate({ getItem: readPreference, setItem: writePreference }, code);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const token = credentials.current[code] || readPreference(`jeopardy.buzzer.host.${code}`);
        if (!token) throw new Error('Host controls belong to the browser that created this room.');
        const result = await buzzerRequest(`rooms/${code}`, token);
        if (!stopped) accept(result.room);
      } catch (err) {
        if (!stopped) { setConnected(false); setError((err as Error).message); }
      } finally { if (!stopped) timer = setTimeout(poll, 400); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [code, accept]);

  const command = useCallback(async (action: string, data: object = {}) => {
    if (!code) return;
    const token = credentials.current[code] || readPreference(`jeopardy.buzzer.host.${code}`);
    if (!token) { setError('Use the browser that created this room.'); return; }
    setPending(true); setError('');
    try {
      const result = await buzzerRequest(`rooms/${code}/${action}`, token, data);
      if (result.room) accept(result.room);
      return true;
    } catch (err) { setError((err as Error).message); return false; }
    finally { setPending(false); }
  }, [code, accept]);

  // A new clue starts locked and clears its buzz order; participant identities remain.
  useEffect(() => {
    if (!code) return;
    if (clueKey && value && !dailyDouble) {
      void command('prepare', { clueKey, value });
    } else {
      const round = liveRoom.current?.round;
      if (round && round.state !== 'resolved') void command('lock', { roundId: round.id });
    }
  }, [code, clueKey, value, dailyDouble, command]);

  const armAudio = () => {
    if (!audio.current && typeof AudioContext !== 'undefined') audio.current = new AudioContext();
    if (audio.current?.state === 'suspended') void audio.current.resume().catch(() => {});
  };
  const start = async () => {
    setPending(true); setError(''); armAudio();
    try {
      const result = await buzzerRequest('rooms', undefined, {});
      credentials.current[result.room.code] = result.hostToken!;
      writePreference(`jeopardy.buzzer.host.${result.room.code}`, result.hostToken!);
      setState(current => attachBuzzerRoom(current, result.room.code));
    } catch (err) { setError((err as Error).message); }
    finally { setPending(false); }
  };
  const end = async () => {
    // Only this ephemeral room is ended. Scores and board content remain local/saved.
    if (await command('close')) {
      setState(current => ({ ...current, buzzerRoomCode: undefined }));
      setRoom(null); setConnected(false);
    }
  };
  const disconnect = () => { setState(current => ({ ...current, buzzerRoomCode: undefined })); setRoom(null); setError(''); };
  const toggleMute = () => { armAudio(); setMuted(!muted); writePreference('jeopardy.buzzer.muted', String(!muted)); };
  const ready = connected && room?.round?.clueKey === clueKey && !dailyDouble;
  const round = room?.round;
  const next = round?.order.find(buzz => !round.judged.includes(buzz.participantId));
  const nextPlayer = room?.participants.find(player => player.id === next?.participantId);
  const open = () => { armAudio(); return command('open', { roundId: round?.id }); };
  const lock = (answerRevealed = false) => command('lock', { roundId: round?.id, answerRevealed });
  const score = (correct: boolean) => command('score', { roundId: round?.id, participantId: next?.participantId, correct });
  return { code, room, error, pending, connected, muted, available, showSetup, setShowSetup,
    start, end, disconnect, toggleMute, ready, round, nextPlayer, open, lock, score, dailyDouble };
}

type Host = ReturnType<typeof useBuzzerHost>;
export function BuzzerSetup({ host }: { host: Host }) {
  if (!host.showSetup) return null;
  const joinUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/buzz/?room=${host.code}`;
  return <section className="buzzer-setup" aria-label="Remote buzzer setup">
    <div className="buzzer-heading"><h2>Remote buzzers</h2><button onClick={() => host.setShowSetup(false)} className="btn-ghost">Close setup</button></div>
    {!host.code ? <>
      <p>Players join with a display name on their own phone or computer. Share the board in your call.</p>
      <p>Empty default player slots are replaced by joined players. Existing names and scores stay.</p>
      <button className="btn-primary" disabled={host.pending || host.available !== true} onClick={host.start}>Start buzzer room</button>
      {host.available === false && <p role="status">Remote buzzing is unavailable on this host.</p>}
    </> : <>
      <p>Room <strong className="buzzer-code">{host.code}</strong></p>
      <label htmlFor="buzzer-join-link">Player join link</label><input id="buzzer-join-link" readOnly value={joinUrl} onFocus={e => e.currentTarget.select()} />
      <p>Share this link with players. Your host controls stay in this browser.</p>
      <p role="status">{host.connected ? `${host.room?.participants.length || 0} players joined` : 'Connecting…'}</p>
      <ul>{host.room?.participants.map(player => <li key={player.id}>{player.name}</li>)}</ul>
      <p>Names persist between clues and browser reconnects. Rooms end after a server restart or 8 hours without activity.</p>
      <button className="btn-ghost" onClick={host.end} disabled={host.pending}>End buzzer room</button>
      {!host.connected && <button className="btn-ghost" onClick={host.disconnect}>Detach unavailable room</button>}
    </>}
    {host.error && <p role="alert">{host.error}</p>}
  </section>;
}

export function BuzzerClueControls({ host, onFinish }: { host: Host; onFinish: () => void }) {
  if (!host.code) return null;
  if (host.dailyDouble) return <p className="buzzer-status">Buzzers are locked for this Daily Double.</p>;
  const resolved = host.round?.state === 'resolved';
  const first = host.room?.participants.find(player => player.id === host.round?.order[0]?.participantId);
  return <section className="buzzer-clue" aria-label="Host buzzer controls">
    <div className="buzzer-heading"><h3>Room {host.code}</h3><button className="btn-ghost" aria-pressed={host.muted} onClick={host.toggleMute}>{host.muted ? 'Unmute buzzer sound' : 'Mute buzzer sound'}</button></div>
    <p className="buzzer-status" role="status" aria-live="polite">
      {!host.ready ? 'Connecting to this clue…' : resolved ? 'Clue scored — buzzers locked' : host.round?.state === 'open' ? 'Buzzers open' : 'Buzzers locked'}
      {first && <> · First buzz: <strong>{first.name}</strong></>}
    </p>
    <div className="button-row">
      <button className="btn-primary" disabled={!host.ready || host.pending || resolved || host.round?.answerRevealed || !host.room?.participants.length || host.round?.state === 'open'} onClick={host.open}>Open buzzers</button>
      <button className="btn-ghost" disabled={!host.ready || host.pending || host.round?.state !== 'open'} onClick={() => host.lock()}>Lock buzzers</button>
    </div>
    <ol aria-label="Buzz order">{host.round?.order.map(buzz => <li key={buzz.id}>
      {host.room?.participants.find(player => player.id === buzz.participantId)?.name}
      {host.round?.judged.includes(buzz.participantId) ? ' — judged' : ''}
    </li>)}</ol>
    {host.nextPlayer && !resolved && <div className="buzzer-judge">
      <p>Responding: <strong>{host.nextPlayer.name}</strong></p>
      <button className="correct-button" disabled={!host.ready || host.pending} onClick={() => host.score(true)}>Correct: {host.nextPlayer.name} +${host.round?.value}</button>
      <button className="incorrect-button" disabled={!host.ready || host.pending} onClick={() => host.score(false)}>Incorrect: {host.nextPlayer.name} −${host.round?.value}</button>
    </div>}
    <p className="buzzer-help">Order follows arrival at the server. After an incorrect response, judge the next queued player or reopen buzzers.</p>
    {resolved && <button className="btn-primary" onClick={onFinish}>Return to board</button>}
    {host.error && <p role="alert">{host.error}</p>}
    {!host.connected && <button className="btn-ghost" onClick={host.disconnect}>Leave unavailable buzzer room</button>}
  </section>;
}

export function BuzzerDock({ host, clueOpen, onFinish }: { host: Host; clueOpen: boolean; onFinish: () => void }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(readPreference('jeopardy.buzzer.expanded') === 'true'); }, []);
  if (!host.code) return null;
  const first = host.room?.participants.find(player => player.id === host.round?.order[0]?.participantId);
  const status = !host.connected ? 'Reconnecting' : !clueOpen ? 'Waiting for a clue' : host.dailyDouble ? 'Daily Double · locked' :
    !host.ready ? 'Preparing clue' : host.round?.state === 'resolved' ? 'Scored · locked' : host.round?.state === 'open' ? 'Open' : 'Locked';
  const toggle = () => { writePreference('jeopardy.buzzer.expanded', String(!expanded)); setExpanded(!expanded); };
  return <aside className={`buzzer-dock${expanded ? ' buzzer-dock-expanded' : ''}`} aria-label="Buzzer dock">
    {expanded && <div id="buzzer-dock-panel" className="buzzer-dock-panel">
      {clueOpen ? <BuzzerClueControls host={host} onFinish={onFinish} /> : <div className="buzzer-dock-lobby">
        <h2>Room {host.code}</h2><p>{host.room?.participants.length || 0} players joined</p>
        <ul>{host.room?.participants.map(player => <li key={player.id}>{player.name}</li>)}</ul>
        <button className="btn-ghost" onClick={() => host.setShowSetup(true)}>Room &amp; join link</button>
        {host.error && <p role="alert">{host.error}</p>}
      </div>}
    </div>}
    <button className="buzzer-dock-toggle" aria-expanded={expanded} aria-controls="buzzer-dock-panel" onClick={toggle}>
      <span className="buzzer-dock-title">Buzzers <span aria-hidden="true">{expanded ? '⌄' : '⌃'}</span></span>
      <span className="buzzer-dock-live" role="status" aria-live="polite">{status}{clueOpen && first ? ` · First: ${first.name}` : ''}</span>
      {clueOpen && host.nextPlayer && host.nextPlayer.id !== first?.id && <span className="buzzer-dock-next">Next: {host.nextPlayer.name}</span>}
    </button>
  </aside>;
}
