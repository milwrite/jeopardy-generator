import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { BuzzerRoom, buzzerRequest, readPreference, writePreference } from '../src/buzzerClient';

type Identity = { code: string; participantId: string; token: string };
const key = (code: string) => `jeopardy.buzzer.player.${code}`;
function remember(identity: Identity) {
  const text = JSON.stringify(identity);
  writePreference(key(identity.code), text);
  try { sessionStorage.setItem(key(identity.code), text); } catch { /* Local preference is enough for a normal reconnect. */ }
}
function restore(code: string): Identity | null {
  try {
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(key(code)); } catch { /* Fall back to this browser's most recent player. */ }
    const identity = JSON.parse(saved || readPreference(key(code)) || 'null');
    return identity?.code === code && typeof identity.token === 'string' && typeof identity.participantId === 'string' ? identity : null;
  } catch { return null; }
}

export default function BuzzPage() {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [room, setRoom] = useState<BuzzerRoom | null>(null);
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef<BuzzerRoom | null>(null);
  const accept = (next: BuzzerRoom) => {
    if (latest.current?.code === next.code && latest.current.version > next.version) return;
    latest.current = next; setRoom(next); setConnected(true);
  };
  useEffect(() => {
    const query = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';
    if (/^[A-F0-9]{6}$/.test(query)) { setCode(query); setIdentity(restore(query)); }
  }, []);
  useEffect(() => {
    if (!identity) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await buzzerRequest(`rooms/${identity.code}`, identity.token);
        if (!stopped) { accept(result.room); setError(''); }
      } catch (err) { if (!stopped) { setConnected(false); setError((err as Error).message); } }
      finally { if (!stopped) timer = setTimeout(poll, 400); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [identity]);
  const join = async (event: React.FormEvent) => {
    event.preventDefault(); setPending(true); setError('');
    try {
      const result = await buzzerRequest(`rooms/${code}/join`, undefined, { name });
      const next = { code, participantId: result.participantId!, token: result.token! };
      remember(next); setIdentity(next); accept(result.room);
      history.replaceState(null, '', `/buzz/?room=${code}`);
    } catch (err) { setError((err as Error).message); }
    finally { setPending(false); }
  };
  const buzz = async () => {
    if (!identity || !room?.round) return;
    setPending(true); setError('');
    try { accept((await buzzerRequest(`rooms/${identity.code}/buzz`, identity.token, { roundId: room.round.id })).room); }
    catch (err) { setError((err as Error).message); }
    finally { setPending(false); }
  };
  const self = room?.participants.find(player => player.id === identity?.participantId);
  const round = room?.round;
  const mine = round?.order.find(b => b.participantId === identity?.participantId);
  const first = room?.participants.find(player => player.id === round?.order[0]?.participantId);
  const ready = connected && round?.state === 'open' && !mine && !pending;
  const switchPlayer = () => { setIdentity(null); setRoom(null); latest.current = null; setConnected(false); setError(''); };
  return <main className="buzzer-page">
    <Head><title>Jeopardy! Buzzer</title><meta name="referrer" content="no-referrer" /></Head>
    <div className="buzzer-player-card">
      <h1>Jeopardy! Buzzer</h1>
      {!identity ? <form onSubmit={join}>
        <label htmlFor="room-code">Room code</label>
        <input id="room-code" value={code} maxLength={6} pattern="[A-Fa-f0-9]{6}" autoComplete="off" required onChange={e => setCode(e.target.value.trim().toUpperCase())} />
        <label htmlFor="display-name">Display name</label>
        <input id="display-name" value={name} maxLength={32} autoComplete="nickname" required onChange={e => setName(e.target.value)} />
        <button className="btn-primary" type="submit" disabled={pending || !/^[A-F0-9]{6}$/.test(code) || !name.trim()}>Join room</button>
      </form> : <>
        <p>Room <strong>{identity.code}</strong></p>
        <h2>{self?.name || 'Reconnecting…'}</h2>
        <p className="buzzer-status" role="status" aria-live="polite">
          {!connected ? 'Reconnecting…' : mine ? `You buzzed ${mine.position === 1 ? 'first' : `#${mine.position}`}.` : round?.state === 'open' ? 'Open' : 'Locked'}
        </p>
        <button className={`buzz-button ${ready ? 'buzz-ready' : ''}`} disabled={!ready} onClick={buzz}>{mine ? `BUZZED #${mine.position}` : 'BUZZ!'}</button>
        {first && <p className="buzzer-first">First buzz: <strong>{first.name}</strong></p>}
        <ol aria-label="Buzz order">{round?.order.map(b => <li key={b.id}>{room?.participants.find(p => p.id === b.participantId)?.name}</li>)}</ol>
        <button className="btn-ghost" onClick={switchPlayer}>Switch player</button>
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
  </main>;
}
