// CAIL Featured snapshot checked against the live registry on 2026-09-12.
// Source: CUNY-AI-Lab/CUNY-AI-Lab-website/src/data/featured-models.json (2026-09-10).
// GLM 5.3 Flash is active in the CAIL registry; use it instead of regular GLM 5.3.
// Requested additions accompany Featured text models, excluding Mistral.
export const GAME_MODELS = [
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', group: 'CAIL Featured', provider: 'openrouter', upstream: 'deepseek/deepseek-v4.1-flash' },
  { id: 'kimi-k2.6', label: 'Kimi K2.6', group: 'Also available', provider: 'workers-ai', upstream: '@cf/moonshotai/kimi-k2.6' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', group: 'Also available', provider: 'openrouter', upstream: 'deepseek/deepseek-v4-pro' },
  { id: 'glm-5.3-flash', label: 'GLM 5.3 Flash', group: 'CAIL Featured', provider: 'openrouter', upstream: 'z-ai/glm-5.3-flash' },
  { id: 'kimi-k3', label: 'Kimi K3', group: 'CAIL Featured', provider: 'openrouter', upstream: 'moonshotai/kimi-k3' },
  { id: 'gpt-oss-120b', label: 'GPT OSS 120B', group: 'CAIL Featured', provider: 'workers-ai', upstream: '@cf/openai/gpt-oss-120b' },
  { id: 'qwen3.8-27b', label: 'Qwen3.8 · 27B', group: 'CAIL Featured', provider: 'workers-ai', upstream: '@cf/qwen/qwen3.8-27b' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 · 31B', group: 'CAIL Featured', provider: 'openrouter', upstream: 'google/gemma-4-31b-it' },
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
