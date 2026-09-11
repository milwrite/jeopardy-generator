export const REQUIRED_CATEGORY_COUNT = 6;
export const QUESTIONS_PER_CATEGORY = 5;
export const REQUIRED_QUESTION_COUNT = REQUIRED_CATEGORY_COUNT * QUESTIONS_PER_CATEGORY;
export const STREAM_PROGRESS_LIMIT = 90;

export type StreamProvider = 'openrouter' | 'ollama';

export interface GenerationProgress {
  completedQuestions: number;
  totalQuestions: number;
  percent: number;
  receiving: boolean;
}

export interface GeneratedBoardStream {
  content: string;
  model?: string;
}

export function countCompletedQuestions(content: string): number {
  let bracketDepth = 0;
  let braceDepth = 0;
  let questionsArrayStart = -1;
  let questionsArrayDepth: number | null = null;
  let questionObjectDepth: number | null = null;
  let completedQuestions = 0;

  for (let index = 0; index < content.length; index++) {
    const character = content[index];

    if (character === '"') {
      const stringStart = index;
      let escaped = false;
      index++;

      while (index < content.length) {
        const stringCharacter = content[index];
        if (escaped) {
          escaped = false;
        } else if (stringCharacter === '\\') {
          escaped = true;
        } else if (stringCharacter === '"') {
          break;
        }
        index++;
      }

      if (index >= content.length) {
        break;
      }

      if (content.slice(stringStart, index + 1) === '"questions"') {
        let cursor = index + 1;
        while (/\s/.test(content[cursor] || '')) cursor++;
        if (content[cursor] === ':') {
          cursor++;
          while (/\s/.test(content[cursor] || '')) cursor++;
          if (content[cursor] === '[') {
            questionsArrayStart = cursor;
          }
        }
      }
      continue;
    }

    if (character === '[') {
      bracketDepth++;
      if (index === questionsArrayStart) {
        questionsArrayDepth = bracketDepth;
        questionsArrayStart = -1;
      }
      continue;
    }

    if (character === ']') {
      if (questionsArrayDepth === bracketDepth) {
        questionsArrayDepth = null;
        questionObjectDepth = null;
      }
      bracketDepth--;
      continue;
    }

    if (character === '{') {
      braceDepth++;
      if (
        questionsArrayDepth !== null &&
        bracketDepth === questionsArrayDepth &&
        questionObjectDepth === null
      ) {
        questionObjectDepth = braceDepth;
      }
      continue;
    }

    if (character === '}') {
      if (questionObjectDepth === braceDepth) {
        completedQuestions++;
        questionObjectDepth = null;
      }
      braceDepth--;
    }
  }

  return Math.min(completedQuestions, REQUIRED_QUESTION_COUNT);
}

function contentFromChunk(chunk: any, provider: StreamProvider): string {
  const content = provider === 'openrouter'
    ? chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content
    : chunk?.message?.content ?? chunk?.response;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
  }

  return '';
}

export async function readGeneratedBoardStream(
  response: Response,
  provider: StreamProvider,
  onProgress: (progress: GenerationProgress) => void,
  options: { signal?: AbortSignal; idleTimeoutMs?: number } = {},
): Promise<GeneratedBoardStream> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The generation response did not include a readable body.');
  const decoder = new TextDecoder();
  let content = '';
  let buffer = '';
  let rawResponse = '';
  let resolvedModel: string | undefined;
  let complete = false;
  let received = false;
  let lastProgress = '';
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let failure: unknown;
  const cancel = (reason: unknown) => {
    failure = reason;
    void reader.cancel(reason).catch(() => {});
  };
  const abort = () => cancel(options.signal?.reason || new Error('Generation cancelled.'));
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => cancel(new Error('The model stopped responding. Try again or choose another model.')), options.idleTimeoutMs ?? 45_000);
  };
  const reportProgress = () => {
    const completedQuestions = countCompletedQuestions(content);
    const key = `${completedQuestions}:${received}`;
    if (key === lastProgress) return;
    lastProgress = key;
    onProgress({ completedQuestions, totalQuestions: REQUIRED_QUESTION_COUNT,
      percent: Math.round(completedQuestions / REQUIRED_QUESTION_COUNT * STREAM_PROGRESS_LIMIT),
      receiving: received });
  };
  const processChunk = (chunk: any) => {
    if (chunk?.error) throw new Error(chunk.error.message || String(chunk.error));
    if (typeof chunk?.model === 'string' && chunk.model.trim()) resolvedModel = chunk.model.trim();
    const nextContent = contentFromChunk(chunk, provider);
    content += nextContent;
    received ||= Boolean(nextContent || chunk?.choices?.[0]?.delta?.reasoning || chunk?.choices?.[0]?.delta?.reasoning_content || chunk?.message?.thinking);
    reportProgress();
    const finish = chunk?.choices?.[0]?.finish_reason;
    if (finish === 'length' || (provider === 'ollama' && chunk?.done_reason === 'length')) {
      throw new Error('The model reached its output limit before finishing. Try another model.');
    }
    if (finish && finish !== 'stop') throw new Error(`The model could not finish the board (${finish}). Try another model.`);
    if (finish === 'stop' || chunk?.done === true) complete = true;
  };
  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return;
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (payload === '[DONE]') { complete = true; return; }
    let chunk;
    try { chunk = JSON.parse(payload); } catch { return; }
    processChunk(chunk);
  };
  try {
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    resetIdle();
    while (!complete && !failure) {
      const { done, value } = await reader.read();
      if (failure) throw failure;
      if (done) break;
      resetIdle();
      const decoded = decoder.decode(value, { stream: true });
      rawResponse += decoded;
      buffer += decoded;
      if (rawResponse.length > 2_000_000) throw new Error('The model response was too large. Try again.');
      let newline;
      while (!complete && (newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        processLine(line);
      }
    }
    if (failure) throw failure;
    if (!complete) {
      const tail = decoder.decode();
      rawResponse += tail;
      buffer += tail;
      if (buffer.trim()) processLine(buffer);
    }
    if (!content && rawResponse.trim()) {
      let chunk;
      try { chunk = JSON.parse(rawResponse); } catch { /* SSE was processed above. */ }
      if (chunk) processChunk(chunk);
    }
    if (!content.trim()) throw new Error('The generation response did not contain board content.');
    return { content, ...(resolvedModel ? { model: resolvedModel } : {}) };
  } finally {
    clearTimeout(idleTimer);
    options.signal?.removeEventListener('abort', abort);
    // Provider completion ends the operation even when its HTTP stream stays open.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
