// CAIL Featured snapshot checked against the live registry on 2026-09-11.
// Source: CUNY-AI-Lab/CUNY-AI-Lab-website/src/data/featured-models.json (2026-09-10).
// MiniMax M3 is requested explicitly; Gemma 26B A4B is the compact addition.
export const GAME_MODELS = [
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', group: 'CAIL Featured', provider: 'openrouter', upstream: 'deepseek/deepseek-v4.1-flash' },
  { id: 'qwen3.8-27b', label: 'Qwen3.8 · 27B', group: 'CAIL Featured', provider: 'workers-ai', upstream: '@cf/qwen/qwen3.8-27b' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 · 31B', group: 'CAIL Featured', provider: 'openrouter', upstream: 'google/gemma-4-31b-it' },
  { id: 'mistral-small-2603', label: 'Mistral Small 4', group: 'CAIL Featured', provider: 'openrouter', upstream: 'mistralai/mistral-small-2603' },
  { id: 'minimax-m3', label: 'MiniMax M3', group: 'Also available', provider: 'openrouter', upstream: 'minimax/minimax-m3' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 · 26B, 4B active', group: 'Compact model', provider: 'workers-ai', upstream: '@cf/google/gemma-4-26b-a4b-it' },
] as const;
export const DEFAULT_GAME_MODEL = 'deepseek-v4.1-flash';
export function gameModel(id: string) {
  return GAME_MODELS.find(model => model.id === id || model.upstream === id);
}
export function generationBudget(id: string, requested: number) {
  return gameModel(id)?.id === 'minimax-m3' ? Math.max(2048, requested) : requested;
}
