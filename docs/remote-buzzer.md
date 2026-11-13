# Remote buzzer

On the Node-hosted game, open **Game → Remote buzzers → Start buzzer room**. Share the player join link. Players enter a display name; no account or email is required. On static-only hosts the setup explains that remote buzzing is unavailable.

The host dock stays in the bottom-right corner while reading clues. Click it to expand upward. Its expanded state and mute preference persist between clues and reloads. The collapsed dock announces the current state and first buzz visually and through an ARIA live region.

Open buzzers after reading the clue. Each player can buzz once per clue. The server assigns positions in request-arrival order; network latency affects that order, and there is no claim of measuring simultaneous physical button presses. Lock buzzers to stop new arrivals. Judge the next queued player: incorrect deducts the clue value and advances the queue; correct adds the value and closes the clue. The next clue resets the order while retaining names and identity. Revealing the response permanently locks that clue's buzzers. Daily Doubles and Final Jeopardy keep their existing host scoring flows.

A short original four-note Web Audio cue plays on the first new accepted buzz. No broadcast audio, sample, external asset, or audio download is used. A mute control is available in the dock. Duplicate requests, historical state on reconnect, and unmuting do not replay old events.

Player credentials stay in their browser; opening another tab can reconnect the most recent player. Use **Join as a different player** when sharing a browser. The original tab retains its own identity. Host controls use a separate unguessable token stored only in the host browser, never in a join link or board export. Score receipts and participant IDs are stored in the game state to make score synchronization idempotent.

This implementation uses the existing Node server, with no new dependencies or infrastructure. Rooms are ephemeral, expire after eight hours without activity, and end when the server restarts. Use one service replica. Saved boards retain names, scores, and applied score receipts independently of rooms. Wait for the existing **Saved** indicator before reloading a saved board. End the room before changing player names, editing clues, or resetting the game. If a room has become unavailable, the host can detach it and continue with the normal local controls.

Validation: `npm test`, `npm run check`, and `npm run build`. The synthetic tests cover concurrent requests, host authorization, stale rounds, lock/reveal behavior, duplicate scores, player-ID mapping, reconnect identity, room expiry, and sound deduplication. No model calls are needed.
