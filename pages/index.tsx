import JeopardyGame from '../src/JeopardyGame';

export default function Home() {
  return (
    <main className="suite-game-page flex min-h-screen flex-col items-center justify-between bg-black">
      <JeopardyGame />
    </main>
  );
}
