export const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6';
// Exact active catalog IDs checked against CAIL Gateway on 2026-09-08.
// These are picker suggestions, not an authorization allowlist or fallbacks.
export const WORKERS_AI_MODELS = [
  { id: WORKERS_AI_MODEL, label: 'Kimi K2.6 · Default' },
  { id: '@cf/deepseek-ai/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash' },
  { id: '@cf/deepseek-ai/deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro' },
  { id: '@cf/zai-org/glm-5.2', label: 'GLM 5.2' },
  { id: '@cf/zai-org/glm-5.3', label: 'GLM 5.3' },
  { id: '@cf/qwen/qwen3.8-27b', label: 'Qwen 3.8 27B' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B' },
  { id: '@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
  { id: '@cf/openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
  { id: '@cf/nvidia/nemotron-3-120b-a12b', label: 'Nemotron 3 120B' },
  { id: '@cf/google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
  { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1' },
];
export const isHostedSuite = () => typeof window !== 'undefined' && window.location.hostname.endsWith('.ailab-452.workers.dev');

export function configuredModelId(saved: string | null, hosted: boolean, useProxy: boolean): string {
  return saved?.trim() ? normalizeOpenRouterModelId(saved.trim())
    : hosted && useProxy ? WORKERS_AI_MODEL : 'google/gemini-3.1-flash-lite';
}

export const OPENROUTER_MODELS = [
  { id: 'deepseek/deepseek-v4-flash', label: 'deepseek-v4-flash' },
  { id: 'google/gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
  { id: 'z-ai/glm-5.2', label: 'glm-5.2' },
] as const;

const LEGACY_MODEL_IDS: Record<string, string> = {
  'z-ai/glm-5.2-flash': 'z-ai/glm-5.2',
};

const MODELS_WITH_OPTIONAL_REASONING = new Set([
  'deepseek/deepseek-v4-flash',
  'z-ai/glm-5.2',
]);

export function normalizeOpenRouterModelId(modelId: string): string {
  return LEGACY_MODEL_IDS[modelId] || modelId;
}

export function getOpenRouterModelOptions(modelId: string) {
  if(modelId.startsWith('@cf/'))return {chat_template_kwargs:{enable_thinking:false}};
  return MODELS_WITH_OPTIONAL_REASONING.has(normalizeOpenRouterModelId(modelId))
    ? { reasoning: { effort: 'none' as const } }
    : {};
}

export function getOpenRouterBoardResponseFormat(modelId: string) {
  return (modelId.startsWith('@cf/') || normalizeOpenRouterModelId(modelId) === 'google/gemini-3.1-flash-lite')
    ? { type: 'json_object' as const }
    : JEOPARDY_BOARD_RESPONSE_FORMAT;
}

export const JEOPARDY_BOARD_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'jeopardy_board',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          minItems: 6,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              questions: {
                type: 'array',
                minItems: 5,
                maxItems: 5,
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    answer: { type: 'string' },
                    value: { type: 'integer', enum: [200, 400, 600, 800, 1000] },
                    dailyDouble: { type: 'boolean' },
                  },
                  required: ['text', 'answer', 'value', 'dailyDouble'],
                  additionalProperties: false,
                },
              },
            },
            required: ['title', 'questions'],
            additionalProperties: false,
          },
        },
      },
      required: ['categories'],
      additionalProperties: false,
    },
  },
} as const;
