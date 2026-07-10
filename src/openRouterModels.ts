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
  return MODELS_WITH_OPTIONAL_REASONING.has(normalizeOpenRouterModelId(modelId))
    ? { reasoning: { effort: 'none' as const } }
    : {};
}

export function getOpenRouterBoardResponseFormat(modelId: string) {
  return normalizeOpenRouterModelId(modelId) === 'google/gemini-3.1-flash-lite'
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
