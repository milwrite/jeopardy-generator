// Workers AI shortlist checked against Cloudflare and the live CAIL registry on 2026-09-12.
// GLM 5.3 is the available CAIL Workers AI route; Flash is not linked there yet.
// Only Kimi K3 and MiniMax M3 use OpenRouter.
export const GAME_MODELS = [
  { id: 'deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash', group: 'CAIL Featured', provider: 'workers-ai', upstream: '@cf/deepseek-ai/deepseek-v4-flash-0731' },
  { id: 'deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro', group: 'CAIL Featured', provider: 'workers-ai', upstream: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
  { id: 'kimi-k2.6', label: 'Kimi K2.6', group: 'Also available', provider: 'workers-ai', upstream: '@cf/moonshotai/kimi-k2.6' },
  { id: 'glm-5.3', label: 'GLM 5.3', group: 'Workers AI', provider: 'workers-ai', upstream: '@cf/zai-org/glm-5.3' },
  { id: 'nemotron-3-120b-a12b', label: 'Nemotron 3 · 120B', group: 'Workers AI', provider: 'workers-ai', upstream: '@cf/nvidia/nemotron-3-120b-a12b' },
  { id: 'kimi-k3', label: 'Kimi K3', group: 'CAIL Featured', provider: 'openrouter', upstream: 'moonshotai/kimi-k3' },
  { id: 'gpt-oss-120b', label: 'GPT OSS 120B', group: 'CAIL Featured', provider: 'workers-ai', upstream: '@cf/openai/gpt-oss-120b' },
  { id: 'minimax-m3', label: 'MiniMax M3', group: 'Also available', provider: 'openrouter', upstream: 'minimax/minimax-m3' },
] as const;
export const DEFAULT_GAME_MODEL = 'deepseek-v4-flash-0731';
export function gameModel(id: string) {
  const aliases: Record<string, string> = {
    'deepseek-v4-pro': 'deepseek-v4-pro-0813',
    'deepseek/deepseek-v4-pro': 'deepseek-v4-pro-0813',
    'deepseek/deepseek-v4-pro-0813': 'deepseek-v4-pro-0813',
    'deepseek-v4-flash': 'deepseek-v4-flash-0731',
    'deepseek/deepseek-v4-flash-0731': 'deepseek-v4-flash-0731',
  };
  const normalized = aliases[id] || id;
  return GAME_MODELS.find(model => model.id === normalized || model.upstream === normalized);
}
export function generationBudget(id: string, requested: number) {
  return gameModel(id)?.id === 'minimax-m3' ? Math.max(2048, requested) : requested;
}
