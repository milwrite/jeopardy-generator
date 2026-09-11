import { DEFAULT_GAME_MODEL, GAME_MODELS, gameModel } from './gameModels';
export const WORKERS_AI_MODEL = DEFAULT_GAME_MODEL;
export const WORKERS_AI_MODELS = GAME_MODELS;
export const isHostedSuite = () => typeof window !== 'undefined' && window.location.hostname.endsWith('.ailab-452.workers.dev');

export function configuredModelId(saved: string | null, hosted: boolean, useProxy: boolean): string {
  const choice = gameModel(saved?.trim() || '');
  if (hosted && useProxy) return choice?.id || DEFAULT_GAME_MODEL;
  return choice?.provider === 'openrouter' ? choice.upstream : 'deepseek/deepseek-v4.1-flash';
}

export const OPENROUTER_MODELS = GAME_MODELS.filter(m => m.provider === 'openrouter').map(m => ({id:m.upstream, label:m.label}));

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
  const choice = gameModel(modelId);
  if(choice?.provider === 'workers-ai' || modelId.startsWith('@cf/'))return {chat_template_kwargs:{enable_thinking:false}};
  if(choice?.provider === 'openrouter')return {reasoning:{enabled:false}};
  return MODELS_WITH_OPTIONAL_REASONING.has(normalizeOpenRouterModelId(modelId))
    ? { reasoning: { effort: 'none' as const } }
    : {};
}

export function getOpenRouterBoardResponseFormat(modelId: string) {
  return (Boolean(gameModel(modelId)) || modelId.startsWith('@cf/') || normalizeOpenRouterModelId(modelId) === 'google/gemini-3.1-flash-lite')
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
