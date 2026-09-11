/** Reject incomplete output before it can replace or autosave a playable board. */
export function parseGeneratedBoard(content: string): { categories: Array<{ title: string; questions: Array<{ text: string; answer: string; value: number; dailyDouble?: boolean }> }> } {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data: any;
  try { data = JSON.parse(trimmed); }
  catch { throw new Error('The model returned incomplete or invalid board JSON. Try again or choose another model.'); }
  if (!Array.isArray(data?.categories) || data.categories.length !== 6) {
    throw new Error('The model must return all six categories. Your current board is unchanged.');
  }
  for (const category of data.categories) {
    if (typeof category?.title !== 'string' || !category.title.trim() || !Array.isArray(category.questions) || category.questions.length !== 5) {
      throw new Error('The model returned an incomplete category. Your current board is unchanged.');
    }
    for (const question of category.questions) {
      if (typeof question?.text !== 'string' || !question.text.trim() || typeof question?.answer !== 'string' || !question.answer.trim()) {
        throw new Error('The model returned a clue without an answer. Your current board is unchanged.');
      }
    }
    // Prices are board mechanics, not content the model needs to regenerate.
    category.questions.forEach((question: any, index: number) => { question.value = (index + 1) * 200; });
  }
  return data;
}

export function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function parseFinalClue(content: string): { category: string; clue: string; answer: string } {
  let data: any;
  try { data = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('The model returned an incomplete Final Jeopardy clue. Try again.'); }
  if (!['category', 'clue', 'answer'].every(key => typeof data?.[key] === 'string' && data[key].trim())) {
    throw new Error('The Final Jeopardy clue is missing its category, clue, or answer. Try again.');
  }
  return { category: data.category, clue: data.clue, answer: data.answer };
}
