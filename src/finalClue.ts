import { configuredModelId, isHostedSuite, getOpenRouterModelOptions, getFinalClueResponseFormat } from './openRouterModels';
import { generationBudget } from './gameModels';
import { parseFinalClue } from './generatedBoard';
import { referenceContext, type ReferenceMaterial } from './referenceMaterials';
import type { Category } from './jeopardyTypes';
import type { FJClue } from './finalRound';

export function buildFinalPrompt(categories: Category[], materials: ReferenceMaterial[] = []): string {
  return 'Generate ONE challenging Final Jeopardy clue related to this board. Do not repeat a clue already used. ' +
    'Return ONLY JSON: {"category":"CATEGORY NAME","clue":"a difficult declarative statement","answer":"What is X?"}. ' +
    'The clue must have one unambiguous answer, must be a statement, never a question, and must not contain the answer words. ' +
    'The following JSON describes the existing board, as context only: ' +
    JSON.stringify(categories.map(category => ({ title: category.title, clues: category.questions.map(question => question.text) }))) +
    referenceContext(materials);
}

export async function generateFinalClue(controller: AbortController, categories: Category[] = [], materials: ReferenceMaterial[] = []): Promise<FJClue> {
  const deadline = setTimeout(() => controller.abort(new Error('The model did not respond within 90 seconds. Try another model in Config.')), 90_000);
  try {
  const g = (k: string, d = '') =>
    (typeof window !== 'undefined' ? localStorage.getItem(k) || d : d);
  const prompt = buildFinalPrompt(categories, materials);

  let content = '';
  const useProxy = g('jeopardy_ai_provider', 'openrouter') === 'openrouter' && !g('jeopardy_api_key');
  const model = configuredModelId(g('jeopardy_model_id'), isHostedSuite(), useProxy);
  if (isHostedSuite() && useProxy) {
    localStorage.setItem('jeopardy_model_id', model);
  }
  if (g('jeopardy_ai_provider', 'openrouter') === 'openrouter') {
    const r = await fetch(useProxy ? '/api/ai/chat' : 'https://openrouter.ai/api/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(useProxy
          ? {}
          : {
              Authorization: `Bearer ${g('jeopardy_api_key')}`,
              'HTTP-Referer': window.location.href,
              'X-Title': 'Jeopardy Game',
            }),
      },
      body: JSON.stringify({
        model,
        max_tokens: generationBudget(model,1500),
        ...getOpenRouterModelOptions(model),
        response_format: getFinalClueResponseFormat(model),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'Model request failed');
    if (d.choices?.[0]?.finish_reason === 'length') throw new Error('The model ran out of space before completing the final clue. Try again or select another model.');
    content = d.choices?.[0]?.message?.content || '';
  } else {
    const r = await fetch(`${g('jeopardy_ollama_url', 'http://localhost:11435')}/api/chat`, {
      signal: controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: g('jeopardy_ollama_model', 'jeopardylm'),
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.6, num_predict: 1500 },
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || d.error || 'Model request failed');
    content = d.message?.content || d.response || '';
  }

  return parseFinalClue(content);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

