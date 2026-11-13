// Ten featured text models, checked against the live CAIL registry on 2026-11-12.
// Availability still requires an active entry with the same provider.
export const GAME_MODELS: ReadonlyArray<{id:string;label:string;group:string;provider:string;upstream:string;structuredOutput:boolean}> = [
  {
    "id": "deepseek-v4.1-flash-1017",
    "label": "DeepSeek V4.1 Flash",
    "group": "CAIL Featured",
    "provider": "workers-ai",
    "upstream": "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
    "structuredOutput": false
  },
  {
    "id": "kimi-k3",
    "label": "Kimi K3",
    "group": "CAIL Featured",
    "provider": "bedrock-runtime",
    "upstream": "kimi-k3",
    "structuredOutput": true
  },
  {
    "id": "kimi-k2.5",
    "label": "Kimi K2.5",
    "group": "CAIL Featured",
    "provider": "bedrock-mantle",
    "upstream": "kimi-k2.5",
    "structuredOutput": true
  },
  {
    "id": "deepseek-v4-pro-0813",
    "label": "DeepSeek V4 Pro",
    "group": "CAIL Featured",
    "provider": "workers-ai",
    "upstream": "@cf/deepseek-ai/deepseek-v4-pro-0813",
    "structuredOutput": false
  },
  {
    "id": "glm-5.3-flash",
    "label": "GLM 5.3 Flash",
    "group": "CAIL Featured",
    "provider": "workers-ai",
    "upstream": "@cf/zai-org/glm-5.3-flash",
    "structuredOutput": false
  },
  {
    "id": "gemma-4-26b-a4b-it",
    "label": "Gemma 4 \u00b7 26B",
    "group": "CAIL Featured",
    "provider": "workers-ai",
    "upstream": "@cf/google/gemma-4-26b-a4b-it",
    "structuredOutput": false
  },
  {
    "id": "minimax-m2.5",
    "label": "MiniMax M2.5",
    "group": "CAIL Featured",
    "provider": "bedrock-mantle",
    "upstream": "minimax-m2.5",
    "structuredOutput": true
  },
  {
    "id": "nemotron-super-3-120b",
    "label": "Nemotron 3 Super \u00b7 120B",
    "group": "CAIL Featured",
    "provider": "bedrock-mantle",
    "upstream": "nemotron-super-3-120b",
    "structuredOutput": true
  },
  {
    "id": "llama-3.3-70b-instruct-fp8-fast",
    "label": "Llama 3.3 · 70B",
    "group": "CAIL Featured",
    "provider": "workers-ai",
    "upstream": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "structuredOutput": false
  },
  {
    "id": "qwen3.8-27b",
    "label": "Qwen3.8 \u00b7 27B",
    "group": "CAIL Featured",
    "provider": "workers-ai",
    "upstream": "@cf/qwen/qwen3.8-27b",
    "structuredOutput": false
  }
];
export const DEFAULT_GAME_MODEL = 'deepseek-v4.1-flash-1017';
const ALIASES: Record<string,string> = {
  "gpt-oss-120b": "llama-3.3-70b-instruct-fp8-fast",
  "@cf/openai/gpt-oss-120b": "llama-3.3-70b-instruct-fp8-fast",
  "deepseek-v4-pro": "deepseek-v4-pro-0813",
  "deepseek/deepseek-v4-pro": "deepseek-v4-pro-0813",
  "deepseek/deepseek-v4-pro-0813": "deepseek-v4-pro-0813",
  "deepseek-v4-flash": "deepseek-v4.1-flash-1017",
  "deepseek-v4-flash-0731": "deepseek-v4.1-flash-1017",
  "@cf/deepseek-ai/deepseek-v4-flash-0731": "deepseek-v4.1-flash-1017",
  "deepseek/deepseek-v4-flash-0731": "deepseek-v4.1-flash-1017",
  "deepseek-v4.1-flash": "deepseek-v4.1-flash-1017",
  "kimi-k2.6": "kimi-k2.5",
  "@cf/moonshotai/kimi-k2.6": "kimi-k2.5",
  "moonshotai/kimi-k2.5": "kimi-k2.5",
  "moonshotai/kimi-k3": "kimi-k3",
  "minimax-m3": "minimax-m2.5",
  "minimax/minimax-m3": "minimax-m2.5",
  "minimax/minimax-m2.5": "minimax-m2.5",
  "glm-5.3": "glm-5.3-flash",
  "@cf/zai-org/glm-5.3": "glm-5.3-flash",
  "nemotron-3-120b-a12b": "nemotron-super-3-120b",
  "@cf/nvidia/nemotron-3-120b-a12b": "nemotron-super-3-120b"
};
export function gameModel(id: string) {
  const normalized = ALIASES[id] || id;
  return GAME_MODELS.find(model => model.id === normalized || model.upstream === normalized);
}
// AWS reasoning models and GLM need room for visible output even on short tasks.
export function generationBudget(id: string, requested: number) {
  const model = gameModel(id);
  if (model?.provider.startsWith('bedrock-') || model?.id === 'glm-5.3-flash') {
    return Math.max(requested >= 5000 ? 8000 : 2048, requested);
  }
  return requested;
}
