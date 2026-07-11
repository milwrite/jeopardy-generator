export const REQUIRED_CATEGORY_COUNT = 6;
export const QUESTIONS_PER_CATEGORY = 5;
export const REQUIRED_QUESTION_COUNT = REQUIRED_CATEGORY_COUNT * QUESTIONS_PER_CATEGORY;
export const STREAM_PROGRESS_LIMIT = 90;

export type StreamProvider = 'openrouter' | 'ollama';

export interface GenerationProgress {
  completedQuestions: number;
  totalQuestions: number;
  percent: number;
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
): Promise<GeneratedBoardStream> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('The generation response did not include a readable body.');
  }

  const decoder = new TextDecoder();
  let content = '';
  let buffer = '';
  let rawResponse = '';
  let resolvedModel: string | undefined;
  let lastCompletedQuestions = -1;

  const reportProgress = () => {
    const completedQuestions = countCompletedQuestions(content);
    if (completedQuestions === lastCompletedQuestions) return;

    lastCompletedQuestions = completedQuestions;
    onProgress({
      completedQuestions,
      totalQuestions: REQUIRED_QUESTION_COUNT,
      percent: Math.round(
        (completedQuestions / REQUIRED_QUESTION_COUNT) * STREAM_PROGRESS_LIMIT,
      ),
    });
  };

  const processLine = (line: string) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith(':')) return;

    const payload = trimmedLine.startsWith('data:')
      ? trimmedLine.slice(5).trim()
      : trimmedLine;
    if (!payload || payload === '[DONE]') return;

    try {
      const chunk = JSON.parse(payload);
      if (chunk?.error) {
        throw new Error(chunk.error.message || chunk.error || 'Generation stream failed.');
      }

      if (typeof chunk?.model === 'string' && chunk.model.trim()) {
        resolvedModel = chunk.model.trim();
      }

      const nextContent = contentFromChunk(chunk, provider);
      if (nextContent) {
        content += nextContent;
        reportProgress();
      }
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    const decoded = decoder.decode(value, { stream: true });
    rawResponse += decoded;
    buffer += decoded;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.forEach(processLine);
  }

  const finalDecoded = decoder.decode();
  rawResponse += finalDecoded;
  buffer += finalDecoded;
  if (buffer.trim()) processLine(buffer);

  if (!content && rawResponse.trim()) {
    try {
      const completeResponse = JSON.parse(rawResponse);
      content = contentFromChunk(completeResponse, provider);
      reportProgress();
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }

  if (!content) {
    throw new Error('The generation response did not contain board content.');
  }

  return { content, ...(resolvedModel ? { model: resolvedModel } : {}) };
}
