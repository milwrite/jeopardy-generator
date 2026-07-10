import React, { useEffect, useState } from 'react';

import {
  createDefaultQuestion,
  createDifficultyAdjustments,
  defaultCategories,
  defaultValues,
} from './jeopardyDefaults';
import { readGeneratedBoardStream } from './generationProgress';
import {
  getOpenRouterModelOptions,
  JEOPARDY_BOARD_RESPONSE_FORMAT,
  normalizeOpenRouterModelId,
  OPENROUTER_MODELS,
} from './openRouterModels';
import { logBadResponse, validateQuestionRule } from './questionValidation';
import type { AIProvider, Category } from './jeopardyTypes';

const DEFAULT_SYSTEM_MESSAGE =
  'Create a Jeopardy! game board. Return ONLY valid JSON — no markdown, no code fences, no commentary — in EXACTLY this shape:\n' +
  '{"categories":[{"title":"Category Title","questions":[{"value":200,"text":"the clue shown to players","answer":"What is X?"}]}]}\n\n' +
  'Rules:\n' +
  '- Each category has exactly 5 questions with values 200, 400, 600, 800, 1000.\n' +
  '- "text" is the clue (a declarative statement). "answer" is the response phrased as a question ("What is..."/"Who is...").\n' +
  '- Clues are specific with ONE unambiguous answer. NEVER include the answer words in the clue text.\n' +
  '- Clever category titles; gradual difficulty; factually accurate; do not repeat concepts.\n' +
  'Output the single JSON object and nothing else.';

interface AISettingsModalProps {
  onClose: () => void;
  onGeneratedCategories: (categories: Category[]) => void;
}

// A quick, fun standalone clue from OpenRouter (gemini) to entertain the player
// while the local model grinds out the full board. Best-effort; silently no-ops.
async function fetchFillerClue(useProxy: boolean, apiKey: string): Promise<string> {
  const body = JSON.stringify({
    model: 'google/gemini-3.1-flash-lite',
    messages: [{
      role: 'user',
      content: 'Write ONE clever Jeopardy! clue as a single declarative statement on a random interesting topic. Then on a new line put "A: " followed by the response phrased as a question. No preamble, under 40 words total.',
    }],
    max_tokens: 120,
    temperature: 0.9,
  });

  const r = await fetch(
    useProxy ? '/api/ai/chat' : 'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(useProxy
          ? {}
          : { Authorization: `Bearer ${apiKey}`, 'HTTP-Referer': window.location.href, 'X-Title': 'Jeopardy Game' }),
      },
      body,
    },
  );
  if (!r.ok) throw new Error('filler unavailable');
  const d = await r.json();
  return (d.choices?.[0]?.message?.content || '').trim();
}

const buildMockCategories = (): Category[] => {
  const mockData = {
    categories: [
      {
        title: 'World History',
        questions: [
          { text: 'This emperor built a famous wall in northern China to keep out invaders', answer: 'Who is Qin Shi Huang?', value: 200 },
          { text: "This 'Great' ruler modernized Russia in the early 18th century", answer: 'Who is Peter the Great?', value: 400 },
          { text: 'In 1453, this city fell to Ottoman forces led by Mehmed II', answer: 'What is Constantinople?', value: 600 },
          { text: "This Mongol leader's empire stretched from the Pacific Ocean to Eastern Europe", answer: 'Who is Genghis Khan?', value: 800 },
          { text: 'The 1648 Treaty of Westphalia ended this European conflict', answer: 'What is the Thirty Years\' War?', value: 1000 },
        ],
      },
      {
        title: 'Science',
        questions: [
          { text: 'The chemical formula H2O represents this common substance', answer: 'What is water?', value: 200 },
          { text: 'This element with symbol Fe is the most common on Earth by mass', answer: 'What is iron?', value: 400 },
          { text: 'This scientist published the theory of general relativity in 1915', answer: 'Who is Albert Einstein?', value: 600 },
          { text: 'This subatomic particle carries a positive charge', answer: 'What is a proton?', value: 800 },
          { text: 'CRISPR-Cas9 is a technology used to edit this molecule', answer: 'What is DNA?', value: 1000 },
        ],
      },
      {
        title: 'Pop Culture',
        questions: [
          { text: 'This 1997 film featured Leonardo DiCaprio and Kate Winslet on a doomed ocean liner', answer: 'What is Titanic?', value: 200 },
          { text: "This Swedish group's hits include 'Dancing Queen' and 'Mamma Mia'", answer: 'Who is ABBA?', value: 400 },
          { text: "This streaming service produced 'Stranger Things' and 'The Crown'", answer: 'What is Netflix?', value: 600 },
          { text: 'This superhero film franchise has grossed over $25 billion worldwide', answer: 'What is the Marvel Cinematic Universe?', value: 800 },
          { text: "This British band's concept album 'The Dark Side of the Moon' stayed on charts for 15 years", answer: 'Who is Pink Floyd?', value: 1000 },
        ],
      },
      {
        title: 'Literature',
        questions: [
          { text: 'This Shakespeare play features the character Juliet Capulet', answer: 'What is Romeo and Juliet?', value: 200 },
          { text: "This author wrote 'Pride and Prejudice' and 'Emma'", answer: 'Who is Jane Austen?', value: 400 },
          { text: "This dystopian novel by George Orwell introduced the concept of 'Big Brother'", answer: 'What is 1984?', value: 600 },
          { text: "This Colombian author wrote 'One Hundred Years of Solitude'", answer: 'Who is Gabriel Garcia Marquez?', value: 800 },
          { text: 'This James Joyce novel follows Leopold Bloom through a single day in Dublin', answer: 'What is Ulysses?', value: 1000 },
        ],
      },
      {
        title: 'Sports',
        questions: [
          { text: 'This sport uses a shuttlecock', answer: 'What is badminton?', value: 200 },
          { text: 'Wayne Gretzky is considered the greatest player in the history of this sport', answer: 'What is hockey?', value: 400 },
          { text: 'This golfer has won 15 major championships', answer: 'Who is Tiger Woods?', value: 600 },
          { text: 'In tennis, this term refers to a tied score of 40-40', answer: 'What is deuce?', value: 800 },
          { text: "This swimming stroke is performed on one's back", answer: 'What is backstroke?', value: 1000 },
        ],
      },
      {
        title: 'Geography',
        questions: [
          { text: 'This is the largest ocean on Earth', answer: 'What is the Pacific Ocean?', value: 200 },
          { text: 'This African country is home to the Pyramids of Giza', answer: 'What is Egypt?', value: 400 },
          { text: 'The Amazon River flows through this rainforest', answer: 'What is the Amazon Rainforest?', value: 600 },
          { text: 'This mountain range separates Europe from Asia', answer: 'What are the Ural Mountains?', value: 800 },
          { text: 'This capital city sits at the mouth of the Chao Phraya River', answer: 'What is Bangkok?', value: 1000 },
        ],
      },
    ],
  };

  return mockData.categories.map((category) => ({
    title: category.title,
    questions: category.questions.map((question) => ({
      text: question.text,
      answer: question.answer,
      value: question.value,
      revealed: false,
      answered: false,
      dailyDouble: false,
      ruleViolation: null,
      ratings: [],
    })),
    difficultyAdjustments: createDifficultyAdjustments(),
  }));
};

const buildFallbackCategories = (): Category[] =>
  defaultCategories.map((title) => ({
    title: `${title} (AI Error)`,
    questions: defaultValues.map((value, index) => ({
      text: `JSON parse error occurred. This is a fallback question ${index + 1} for ${value} points.`,
      answer: 'What is a JSON parsing error?',
      value,
      revealed: false,
      answered: false,
      dailyDouble: false,
      ruleViolation: null,
      ratings: [],
    })),
    difficultyAdjustments: createDifficultyAdjustments(),
  }));

const extractJsonCandidate = (jsonContent: string) => {
  const codeBlockMatch = jsonContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1];
  }

  const jsonRegex = /(\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}))*\})/g;
  const balancedMatches = jsonContent.match(jsonRegex);
  if (balancedMatches && balancedMatches.length > 0) {
    return balancedMatches.sort((a, b) => b.length - a.length)[0];
  }

  const braceMatches = jsonContent.match(/\{[\s\S]*?\}/g);
  if (braceMatches && braceMatches.length > 0) {
    return braceMatches.sort((a, b) => b.length - a.length)[0];
  }

  return jsonContent.match(/\{[\s\S]*\}/)?.[0] || null;
};

const sanitizeJsonCandidate = (candidate: string) => {
  let sanitizedJson = candidate.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');

  sanitizedJson = sanitizedJson.replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
    match
      .replace(/\\(?!["\\/bfnrt])/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f')
  );

  sanitizedJson = sanitizedJson
    .replace(/,\s*}/g, '}')
    .replace(/,\s*\]/g, ']')
    .replace(/"\s+"/g, '" "')
    .replace(/"\{/g, '{')
    .replace(/\}"/g, '}')
    .replace(/"\[/g, '[')
    .replace(/\]"/g, ']');

  const jsonLines = sanitizedJson.split('\n');
  if (jsonLines.length >= 13) {
    jsonLines[12] = jsonLines[12].replace(/(".*?)([\u0000-\u001F])(.+?")/g, '$1\\$2$3');
    sanitizedJson = jsonLines.join('\n');
  }

  return sanitizedJson.replace(/"(?:[^"\\]|\\["\\bfnrt])*"/g, (match) =>
    match.replace(/\\([^"\\bfnrt/])/g, '\\\\$1')
  );
};

const parseJsonCandidate = (candidate: string) => {
  const sanitizedJson = sanitizeJsonCandidate(candidate);

  try {
    return JSON.parse(sanitizedJson);
  } catch {
    try {
      const aggressiveJson = sanitizedJson
        .replace(/\\(?!["\\/bfnrt])/g, '\\\\')
        .replace(/[\n\r\t\f]/g, ' ')
        .replace(/"\s+"/g, '" "')
        .replace(/([^\\])"/g, '$1\\"')
        .replace(/\\\\"/g, '\\"')
        .replace(/\\"/g, '\\"');

      return JSON.parse(aggressiveJson);
    } catch {
      try {
        const categoryMatch = sanitizedJson.match(/"categories"\s*:\s*(\[[\s\S]*?\])/);
        if (!categoryMatch) {
          throw new Error('Missing categories array');
        }
        return JSON.parse(`{"categories":${categoryMatch[1]}}`);
      } catch {
        const fixedJson = sanitizedJson
          .replace(/("[^"]*)(")([^"]*")/g, '$1\\"$3')
          .replace(/([\[\{,]\s*)([^,\{\[\]\"\d-])/g, '$1"$2')
          .replace(/([^\s\]\}"])(\s*[\]\},])/g, '$1"$2');

        return JSON.parse(fixedJson);
      }
    }
  }
};

const ensureBoardShape = (categories: Category[]) => {
  let normalized = categories;

  if (normalized.length < 6) {
    const placeholders = defaultCategories.slice(0, 6 - normalized.length).map((title) => ({
      title: `${title} (Generated)`,
      questions: defaultValues.map(createDefaultQuestion),
      difficultyAdjustments: createDifficultyAdjustments(),
    }));
    normalized = [...normalized, ...placeholders];
  } else if (normalized.length > 6) {
    normalized = normalized.slice(0, 6);
  }

  const positions: Array<{ categoryIndex: number; questionIndex: number }> = [];
  let dailyDoubleCount = 0;

  normalized.forEach((category, categoryIndex) => {
    category.questions.forEach((question, questionIndex) => {
      positions.push({ categoryIndex, questionIndex });
      if (question.dailyDouble) {
        dailyDoubleCount++;
      }
    });
  });

  if (dailyDoubleCount > 2) {
    const dailyDoublePositions = positions.filter(
      ({ categoryIndex, questionIndex }) => normalized[categoryIndex].questions[questionIndex].dailyDouble
    );

    dailyDoublePositions.sort(() => Math.random() - 0.5);
    dailyDoublePositions.slice(0, dailyDoublePositions.length - 2).forEach(({ categoryIndex, questionIndex }) => {
      normalized[categoryIndex].questions[questionIndex].dailyDouble = false;
    });
  } else if (dailyDoubleCount < 2) {
    positions
      .sort(() => Math.random() - 0.5)
      .filter(({ categoryIndex, questionIndex }) => !normalized[categoryIndex].questions[questionIndex].dailyDouble)
      .slice(0, 2 - dailyDoubleCount)
      .forEach(({ categoryIndex, questionIndex }) => {
        normalized[categoryIndex].questions[questionIndex].dailyDouble = true;
      });
  }

  return normalized;
};

export default function AISettingsModal({
  onClose,
  onGeneratedCategories,
}: AISettingsModalProps) {
  // OpenRouter ("External") is the default provider. When no personal API key is
  // stored, calls route through a same-origin worker proxy that adds a runtime
  // secret, so the key stays out of the static bundle and users don't have to
  // paste one in. Power users can still save their own key in localStorage to
  // hit OpenRouter directly.
  const [aiProvider, setAiProvider] = useState<AIProvider>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [modelId, setModelId] = useState('google/gemini-3.1-flash-lite');
  const useProxy = aiProvider === 'openrouter' && !apiKey.trim();
  const [ollamaModel, setOllamaModel] = useState('jeopardylm');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11435');
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [temperature, setTemperature] = useState(0.3);
  // Fixed system prompt — not user-editable (keeps output schema reliable).
  const [systemMessage] = useState(DEFAULT_SYSTEM_MESSAGE);
  const [categoryTopics, setCategoryTopics] = useState<string[]>(['', '', '', '', '', '']);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState('Waiting for generated clues…');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testCooldown, setTestCooldown] = useState(0);
  const [generateCooldown, setGenerateCooldown] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const savedKey = localStorage.getItem('jeopardy_api_key');
      if (savedKey) {
        setApiKey(savedKey);
      }

      const savedProvider = localStorage.getItem('jeopardy_ai_provider');
      if (savedProvider === 'openrouter' || savedProvider === 'ollama') {
        setAiProvider(savedProvider);
      }

      const savedModelId = localStorage.getItem('jeopardy_model_id');
      if (savedModelId) {
        const normalizedModelId = normalizeOpenRouterModelId(savedModelId);
        setModelId(normalizedModelId);
        if (normalizedModelId !== savedModelId) {
          localStorage.setItem('jeopardy_model_id', normalizedModelId);
        }
      }

      const savedOllamaModel = localStorage.getItem('jeopardy_ollama_model');
      if (savedOllamaModel) {
        setOllamaModel(savedOllamaModel);
      }

      const savedOllamaUrl = localStorage.getItem('jeopardy_ollama_url');
      if (savedOllamaUrl) {
        setOllamaUrl(savedOllamaUrl);
      }

      const savedTemperature = localStorage.getItem('jeopardy_temperature');
      if (savedTemperature) {
        setTemperature(parseFloat(savedTemperature));
      }
    } catch {
      // Ignore malformed saved settings.
    }
  }, []);

  const startCooldown = (setter: React.Dispatch<React.SetStateAction<number>>, seconds: number) => {
    setter(seconds);
    const interval = setInterval(() => {
      setter((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const testApiKey = async () => {
    setTestResult(null);

    if (aiProvider === 'openrouter') {
      if (useProxy) {
        // No key required when routing through the worker proxy.
      } else if (!apiKey.trim()) {
        setTestResult({ success: false, message: 'Please enter an API key' });
        return;
      }

      if (!modelId.trim()) {
        setTestResult({ success: false, message: 'Please enter a Model ID' });
        return;
      }
    } else if (!ollamaModel.trim()) {
      setTestResult({ success: false, message: 'Please enter an Ollama model name' });
      return;
    }

    setIsTesting(true);

    try {
      const testPrompt = 'Respond with exactly: "API connection successful"';

      const response =
        aiProvider === 'openrouter'
          ? await fetch(useProxy ? '/api/ai/chat' : 'https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(useProxy
                  ? {}
                  : {
                      Authorization: `Bearer ${apiKey}`,
                      'HTTP-Referer': window.location.href,
                      'X-Title': 'Jeopardy Game - API Test',
                    }),
              },
              body: JSON.stringify({
                model: modelId || 'gpt-oss-120b',
                messages: [{ role: 'user', content: testPrompt }],
                max_tokens: 50,
                temperature: 0.1,
                ...getOpenRouterModelOptions(modelId),
              }),
            })
          : await fetch(`${ollamaUrl}/api/chat`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: ollamaModel,
                messages: [{ role: 'user', content: testPrompt }],
                stream: false,
                options: {
                  temperature: 0.1,
                  num_predict: 50,
                },
              }),
            });

      if (!response.ok) {
        let errorMessage = `Error ${response.status}: `;

        if (aiProvider === 'openrouter') {
          if (response.status === 400) {
            try {
              const errorJson = JSON.parse(await response.text());
              errorMessage += errorJson.error?.message || 'Bad request. Please check your API key and model ID format';
            } catch {
              errorMessage += 'Bad request. Please check your API key and model ID format';
            }
          } else if (response.status === 401) {
            errorMessage += 'Invalid API key';
          } else if (response.status === 404) {
            errorMessage += 'Model not found. Please check your Model ID';
          } else if (response.status === 429) {
            errorMessage += 'Rate limit exceeded. Please wait and try again';
          } else if (response.status === 402) {
            errorMessage += 'Insufficient credits on your OpenRouter account';
          } else {
            try {
              const errorJson = JSON.parse(await response.text());
              errorMessage += errorJson.error?.message || response.statusText;
            } catch {
              errorMessage += response.statusText;
            }
          }
        } else if (response.status === 404) {
          errorMessage += `Model "${ollamaModel}" not found. Pull it with: ollama pull ${ollamaModel}`;
        } else if (response.status === 0 || !response.status) {
          errorMessage = 'Cannot connect to Ollama. Make sure Ollama is running with: ollama serve';
        } else {
          try {
            const errorJson = JSON.parse(await response.text());
            errorMessage += errorJson.error || response.statusText;
          } catch {
            errorMessage += response.statusText;
          }
        }

        setTestResult({ success: false, message: errorMessage });
        return;
      }

      const data = await response.json();

      if (aiProvider === 'openrouter') {
        setTestResult(
          data.choices?.[0]?.message?.content
            ? { success: true, message: `Connection successful. Model "${modelId}" is working.` }
            : { success: false, message: 'Unexpected response format from API' }
        );
      } else {
        setTestResult(
          data.message?.content || (data.response && typeof data.response === 'string')
            ? { success: true, message: `Ollama connection successful. Model "${ollamaModel}" is working.` }
            : {
                success: false,
                message: 'Unexpected response format from Ollama. Make sure Ollama is running and the model is installed.',
              }
        );
      }
    } catch (error) {
      let errorMessage = 'Connection failed: ';
      if (aiProvider === 'ollama' && error instanceof TypeError && error.message.includes('fetch')) {
        errorMessage =
          'Cannot connect to Ollama. Please ensure:\n1. Ollama is installed and running (ollama serve)\n2. The URL is correct (default: http://localhost:11434)\n3. No firewall is blocking the connection';
      } else {
        errorMessage += error instanceof Error ? error.message : 'Unknown error';
      }

      setTestResult({ success: false, message: errorMessage });
    } finally {
      setIsTesting(false);
      startCooldown(setTestCooldown, 10);
    }
  };

  const generateQuestions = async () => {
    setTestResult(null);

    if (aiProvider === 'openrouter') {
      if (useProxy) {
        // Worker proxy provides the key; no user key required.
      } else if (!apiKey.trim()) {
        setTestResult({ success: false, message: 'Please enter an OpenRouter API key' });
        return;
      }
      if (!modelId.trim()) {
        setTestResult({
          success: false,
          message: 'Please enter a Model ID such as openai/gpt-4.1-mini or google/gemini-2.0-flash-001',
        });
        return;
      }
    } else if (!ollamaModel.trim()) {
      setTestResult({ success: false, message: 'Please enter an Ollama model name such as llama2 or mistral' });
      return;
    }

    localStorage.setItem('jeopardy_api_key', apiKey);
    localStorage.setItem('jeopardy_ai_provider', aiProvider);
    localStorage.setItem('jeopardy_model_id', modelId);
    localStorage.setItem('jeopardy_ollama_model', ollamaModel);
    localStorage.setItem('jeopardy_ollama_url', ollamaUrl);
    localStorage.setItem('jeopardy_system_message', systemMessage);
    localStorage.setItem('jeopardy_temperature', temperature.toString());

    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationStatus('Waiting for generated clues…');

    try {
      const useMockResponse = false;

      if (useMockResponse) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        onGeneratedCategories(buildMockCategories());
        onClose();
        return;
      }

      let difficultyGuidance = '';
      try {
        const savedAdjustmentsStr = localStorage.getItem('jeopardy_difficulty_adjustments');
        const ratingsStr = localStorage.getItem('jeopardy_question_difficulty_ratings');
        const ratingsData = ratingsStr ? JSON.parse(ratingsStr) : [];

        if (savedAdjustmentsStr) {
          const savedAdjustments = JSON.parse(savedAdjustmentsStr);

          Object.keys(savedAdjustments).forEach((categoryTitle) => {
            const adjustments = savedAdjustments[categoryTitle];
            const hasAdjustments = Object.values(adjustments).some((adjustment) => adjustment !== 0);

            if (!hasAdjustments) {
              return;
            }

            difficultyGuidance += `For category similar to "${categoryTitle}", adjust difficulty as follows:\n`;

            const categoryRatings = ratingsData.filter((rating: any) =>
              rating.category.toLowerCase() === categoryTitle.toLowerCase() ||
              rating.category.toLowerCase().includes(categoryTitle.toLowerCase()) ||
              categoryTitle.toLowerCase().includes(rating.category.toLowerCase())
            );

            Object.keys(adjustments).forEach((valueStr) => {
              const value = parseInt(valueStr, 10);
              const adjustment = adjustments[value];

              if (adjustment > 0) {
                difficultyGuidance += `- For $${value} questions: Make them ${adjustment > 1 ? 'significantly' : 'somewhat'} HARDER with more specific details and specialized knowledge\n`;

                categoryRatings
                  .filter((rating: any) => rating.value === value && rating.rating === 'good')
                  .slice(0, 2)
                  .forEach((example: any) => {
                    difficultyGuidance += `  * "${example.clue}" -> "${example.answer}"\n`;
                  });
              } else if (adjustment < 0) {
                difficultyGuidance += `- For $${value} questions: Make them ${adjustment < -1 ? 'significantly' : 'somewhat'} EASIER with more common knowledge and simpler concepts\n`;

                categoryRatings
                  .filter((rating: any) => rating.value === value && rating.rating === 'bad')
                  .slice(0, 2)
                  .forEach((example: any) => {
                    difficultyGuidance += `  * "${example.clue}" -> "${example.answer}"\n`;
                  });
              }
            });

            difficultyGuidance += '\n';
          });
        }
      } catch (error) {
        console.error('Error loading difficulty adjustments for AI prompt:', error);
      }

      const topicList = categoryTopics
        .map((t, i) => `${i + 1}. ${t.trim() || '(your choice — invent a clever category)'}`)
        .join('\n');
      const anyTopics = categoryTopics.some((t) => t.trim());
      const prompt = `Create a Jeopardy! game board with EXACTLY 6 categories.
${anyTopics ? `Use these topics, one category each, kept in this order:\n${topicList}` : 'Invent 6 clever, distinct categories.'}

For each category write EXACTLY 5 clues with values 200, 400, 600, 800, 1000, increasing in difficulty.
- "text" is the clue shown to contestants: a statement or fact, NEVER a question.
- "answer" is the response phrased as a question ("What is..."/"Who is...").
- Never include the answer words in the clue text.
- Mark EXACTLY 2 clues total across the whole board with "dailyDouble": true.
${difficultyGuidance ? `\nDIFFICULTY ADJUSTMENT GUIDANCE based on player performance:\n${difficultyGuidance}\n` : ''}
Return ONLY JSON (no markdown, no commentary) in EXACTLY this shape:
{"categories":[{"title":"Category Name","questions":[{"text":"clue text","answer":"What is X?","value":200,"dailyDouble":false}]}]}

Requirements: EXACTLY 6 categories; each with EXACTLY 5 questions; EXACTLY 2 dailyDouble:true total.`;

      const apiEndpoints = {
        openrouter: useProxy ? '/api/ai/chat' : 'https://openrouter.ai/api/v1/chat/completions',
        ollama: `${ollamaUrl}/api/chat`,
      };

      const apiConfigs = {
        openrouter: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(useProxy
              ? {}
              : {
                  Authorization: `Bearer ${apiKey}`,
                  'HTTP-Referer': window.location.href,
                  'X-Title': 'Jeopardy Game',
                }),
          },
          body: JSON.stringify({
            model: modelId || 'gpt-oss-120b',
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: prompt },
            ],
            max_tokens: 8000,
            temperature,
            stream: true,
            ...getOpenRouterModelOptions(modelId),
            response_format: JEOPARDY_BOARD_RESPONSE_FORMAT,
            provider: { require_parameters: true },
          }),
        },
        ollama: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: ollamaModel,
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: prompt },
            ],
            stream: true,
            options: {
              temperature,
              num_predict: 4000,
            },
          }),
        },
      } as const;

      const maxRetries = 4;
      let retries = 0;
      let lastError: unknown = null;

      while (retries <= maxRetries) {
        try {
          if (retries > 0) {
            setGenerationProgress(0);
            setGenerationStatus(`Starting generation attempt ${retries + 1}…`);
          }

          const response = await fetch(apiEndpoints[aiProvider], {
            ...(apiConfigs[aiProvider] as RequestInit),
            mode: 'cors',
            credentials: 'omit',
          });

          if (!response.ok) {
            if (response.status === 400) {
              const responseText = await response.text();
              let parsedError = '';
              try {
                const errorJson = JSON.parse(responseText);
                parsedError = errorJson.error?.message || errorJson.message || '';
              } catch {
                parsedError = responseText;
              }
              throw new Error(
                `Bad request (400): ${parsedError || 'Please check your API key and model ID format. For OpenRouter, use format like "openai/gpt-4o-mini" or "anthropic/claude-3-haiku"'}`
              );
            }

            if (response.status === 429) {
              await new Promise((resolve) => setTimeout(resolve, 2000 * (retries + 1)));
              retries++;
              continue;
            }

            if (response.status === 401 || response.status === 403) {
              throw new Error(
                `Authentication failed: ${response.status} ${response.statusText}. Please check that your API key is valid, has not expired, and has the correct format.`
              );
            }

            if (response.status >= 500) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
              retries++;
              continue;
            }

            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
          }

          const jsonContent = await readGeneratedBoardStream(
            response,
            aiProvider,
            ({ completedQuestions, totalQuestions, percent }) => {
              setGenerationProgress(percent);
              setGenerationStatus(
                completedQuestions > 0
                  ? `Generated ${completedQuestions} of ${totalQuestions} clues…`
                  : 'Waiting for generated clues…',
              );
            },
          );

          const candidate = extractJsonCandidate(jsonContent);
          const parsedData = candidate ? parseJsonCandidate(candidate) : { categories: buildFallbackCategories() };
          setGenerationProgress(94);
          setGenerationStatus('Checking board structure…');
          const savedAdjustmentsStr = localStorage.getItem('jeopardy_difficulty_adjustments');
          const savedAdjustments = savedAdjustmentsStr ? JSON.parse(savedAdjustmentsStr) : {};

          const parsedCategories = Array.isArray(parsedData?.categories)
            ? parsedData.categories
            : buildFallbackCategories();

          let formattedCategories: Category[] = parsedCategories.map((category: any) => {
            const similarCategory = Object.keys(savedAdjustments).find(
              (existingTitle) =>
                existingTitle.toLowerCase().includes(String(category.title || '').toLowerCase()) ||
                String(category.title || '').toLowerCase().includes(existingTitle.toLowerCase())
            );

            const difficultyAdjustments = similarCategory
              ? savedAdjustments[similarCategory]
              : createDifficultyAdjustments();

            const questions = Array.isArray(category.questions) ? category.questions : defaultValues.map(createDefaultQuestion);

            return {
              title: category.title || 'Generated Category',
              questions: questions.map((question: any) => {
                const validation = validateQuestionRule(
                  String(category.title || 'Generated Category'),
                  String(question.text || ''),
                  String(question.answer || '')
                );

                if (!validation.valid) {
                  logBadResponse(
                    String(category.title || 'Generated Category'),
                    String(question.text || ''),
                    String(question.answer || ''),
                    validation.reason || 'Unknown rule violation'
                  );
                }

                return {
                  text: String(question.text || 'Generated clue unavailable'),
                  answer: String(question.answer || 'What is unavailable?'),
                  value: Number(question.value) || 200,
                  revealed: false,
                  answered: false,
                  dailyDouble: question.dailyDouble === true,
                  ruleViolation: validation.valid ? null : validation.reason,
                  ratings: [],
                };
              }),
              difficultyAdjustments,
            };
          });

          formattedCategories = ensureBoardShape(formattedCategories);
          setGenerationProgress(98);
          setGenerationStatus('Checking clue quality…');

          // Guardrail: reject a board whose responses aren't proper Jeopardy
          // questions, whose clues leak the answer, or whose categories repeat —
          // and retry, so broken boards never reach the table.
          const totalQ = formattedCategories.reduce((n, c) => n + c.questions.length, 0);
          const violations = formattedCategories.reduce(
            (n, c) => n + c.questions.filter((q) => q.ruleViolation).length,
            0,
          );
          const titles = formattedCategories.map((c) => c.title.trim().toLowerCase());
          const hasDuplicateCategories = new Set(titles).size !== titles.length;
          if (hasDuplicateCategories || (totalQ > 0 && violations > totalQ * 0.4)) {
            throw new Error(
              `Board quality check failed: ${violations}/${totalQ} clues malformed` +
                `${hasDuplicateCategories ? ', duplicate categories' : ''}.`,
            );
          }

          setGenerationProgress(100);
          setGenerationStatus('Board ready');
          onGeneratedCategories(formattedCategories);
          onClose();
          return;
        } catch (error) {
          lastError = error;

          if (
            error instanceof TypeError ||
            (error instanceof Error &&
              (error.message.includes('Rate limit exceeded') ||
                error.message.includes('experiencing issues') ||
                error.message.includes('Board quality check failed')))
          ) {
            retries++;
            if (retries <= maxRetries) {
              setGenerationProgress(0);
              setGenerationStatus(`Retrying generation after attempt ${retries}…`);
              await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, retries)));
              continue;
            }
          }

          throw error;
        }
      }

      throw lastError instanceof Error ? lastError : new Error('Question generation failed.');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Question generation failed.';
      setTestResult({ success: false, message: `Generation failed: ${errorMessage}` });
    } finally {
      setIsGenerating(false);
      startCooldown(setGenerateCooldown, 45);
    }
  };

  // Auto-detect the local model server + adapter, so users never touch endpoints.
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const r = await fetch(`${ollamaUrl}/api/tags`, { cache: 'no-store' });
        const data = await r.json();
        const ok = Array.isArray(data?.models)
          && data.models.some((m: { name?: string; model?: string }) => (m.name || m.model) === ollamaModel);
        if (active) setServerStatus(ok ? 'online' : 'offline');
      } catch {
        if (active) setServerStatus('offline');
      }
    };
    check();
    const id = setInterval(check, 5000);
    return () => { active = false; clearInterval(id); };
  }, [ollamaUrl, ollamaModel]);

  const statusStyle = {
    padding: '10px 14px', borderRadius: 8, marginBottom: 18, fontSize: 18,
    display: 'flex', alignItems: 'center', gap: 8,
    background: serverStatus === 'online' ? 'rgba(34,197,94,0.12)'
      : serverStatus === 'offline' ? 'rgba(239,68,68,0.12)' : 'rgba(148,163,184,0.12)',
    border: `1px solid ${serverStatus === 'online' ? 'rgba(34,197,94,0.55)'
      : serverStatus === 'offline' ? 'rgba(239,68,68,0.55)' : 'rgba(148,163,184,0.4)'}`,
    color: serverStatus === 'online' ? '#15803d'
      : serverStatus === 'offline' ? '#b91c1c' : '#64748b',
  } as const;

  return (
    <div className="ai-settings-modal" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ai-settings-panel">
        <div className="ai-settings-header">
          <div>
            <h2 className="ai-settings-title">Config</h2>
          </div>
          <button className="ai-settings-close" onClick={onClose} aria-label="Close">
            &#x2715;
          </button>
        </div>

        {isGenerating && (
          <div className="gen-overlay">
            <div className="gen-overlay-inner">
              <h3 className="gen-title">Generating your board…</h3>
              <div
                className="gen-progress-track"
                role="progressbar"
                aria-label="Board generation progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={generationProgress}
                aria-valuetext={generationStatus}
              >
                <div className="gen-progress-fill" style={{ width: `${generationProgress}%` }} />
              </div>
              <div className="gen-progress-pct">{generationProgress}%</div>
              <div className="gen-progress-status">{generationStatus}</div>
            </div>
          </div>
        )}

        <div className="provider-tabs" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`provider-tab${aiProvider === 'ollama' ? ' active' : ''}`}
            onClick={() => { setAiProvider('ollama'); setTestResult(null); }}
          >
            Local
          </button>
          <button
            type="button"
            className={`provider-tab${aiProvider === 'openrouter' ? ' active' : ''}`}
            onClick={() => { setAiProvider('openrouter'); setTestResult(null); }}
          >
            External
          </button>
        </div>

        {aiProvider === 'ollama' ? (
          <div style={statusStyle}>
            {serverStatus === 'online' ? (
              <span>&#x2713; Connected — <strong>{ollamaModel}</strong> ready on your local model server.</span>
            ) : serverStatus === 'checking' ? (
              <span>Checking model server…</span>
            ) : (
              <span>&#x2717; Model server offline. Start the local model, then this connects automatically.</span>
            )}
          </div>
        ) : (
          <div className="ai-provider-panel">
            <div className="ai-field-group">
              <label className="ai-field-label">API Key</label>
              {useProxy ? (
                <div className="ai-key-configured">
                  <span>&#x2713; External AI enabled by default</span>
                  <button
                    type="button"
                    className="ai-key-change"
                    onClick={() => { setShowKeyInput(true); setTestResult(null); }}
                  >
                    use my key
                  </button>
                </div>
              ) : apiKey && !showKeyInput ? (
                <div className="ai-key-configured">
                  <span>&#x2713; API key configured</span>
                  <button type="button" className="ai-key-change" onClick={() => setShowKeyInput(true)}>change</button>
                </div>
              ) : (
                <>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => { setApiKey(event.target.value); setTestResult(null); }}
                    placeholder="sk-or-..."
                    className="ai-input"
                  />
                  {apiKey && (
                    <button
                      type="button"
                      className="ai-key-change"
                      onClick={() => { setShowKeyInput(false); setApiKey(''); setTestResult(null); }}
                      style={{ marginTop: 6 }}
                    >
                      use default proxy instead
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="ai-field-group">
              <label className="ai-field-label">Model</label>
              <div className="model-chip-grid">
                {OPENROUTER_MODELS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={`model-chip${modelId === id ? ' selected' : ''}`}
                    onClick={() => { setModelId(id); setTestResult(null); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {false && (aiProvider === 'openrouter' ? (
          <div className="ai-provider-panel">
            <div className="ai-field-group">
              <label className="ai-field-label">API Key</label>
              <div className="ai-input-row">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => { setApiKey(event.target.value); setTestResult(null); }}
                  placeholder="sk-or-..."
                  className="ai-input"
                />
                <button
                  className="ai-eye-toggle"
                  onClick={() => setShowApiKey((visible) => !visible)}
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  type="button"
                >
                  {showApiKey ? '&#x1F648;' : '&#x1F441;'}
                </button>
              </div>
              {apiKey && <span className="ai-field-saved">&#x2713; Key saved in session</span>}
            </div>

            <div className="ai-field-group">
              <label className="ai-field-label">Model</label>
              <input
                type="text"
                value={modelId}
                onChange={(event) => { setModelId(event.target.value); setTestResult(null); }}
                placeholder="provider/model-id"
                className="ai-input"
              />
              <div className="model-chip-section">
                <div className="model-chip-group-label">Gemini 3</div>
                <div className="model-chip-grid">
                  {[
                    'google/gemini-3.1-flash-lite-preview',
                  ].map((model) => (
                    <button
                      key={model}
                      className={`model-chip${modelId === model ? ' selected' : ''}`}
                      onClick={() => { setModelId(model); setTestResult(null); }}
                    >
                      {model.split('/')[1]}
                    </button>
                  ))}
                </div>
                <div className="model-chip-group-label">Gemma 4</div>
                <div className="model-chip-grid">
                  {[
                    'google/gemma-4-31b-it',
                  ].map((model) => (
                    <button
                      key={model}
                      className={`model-chip${modelId === model ? ' selected' : ''}`}
                      onClick={() => { setModelId(model); setTestResult(null); }}
                    >
                      {model.split('/')[1]}
                    </button>
                  ))}
                </div>
                <div className="model-chip-group-label">MiniMax, Kimi &amp; GLM</div>
                <div className="model-chip-grid">
                  {[
                    'minimax/minimax-m2.7',
                    'moonshotai/kimi-k2.5',
                    'z-ai/glm-5-turbo',
                  ].map((model) => (
                    <button
                      key={model}
                      className={`model-chip${modelId === model ? ' selected' : ''}`}
                      onClick={() => { setModelId(model); setTestResult(null); }}
                    >
                      {model.split('/')[1]}
                    </button>
                  ))}
                </div>
                <div className="model-chip-group-label">DeepSeek</div>
                <div className="model-chip-grid">
                  {[
                    'deepseek/deepseek-v3.2',
                    'deepseek/deepseek-r1-0528',
                  ].map((model) => (
                    <button
                      key={model}
                      className={`model-chip${modelId === model ? ' selected' : ''}`}
                      onClick={() => { setModelId(model); setTestResult(null); }}
                    >
                      {model.split('/')[1]}
                    </button>
                  ))}
                </div>
                <div className="model-chip-group-label">Qwen 3.5</div>
                <div className="model-chip-grid">
                  {[
                    'qwen/qwen3.5-397b-a17b',
                    'qwen/qwen3.5-122b-a10b',
                    'qwen/qwen3.5-35b-a3b',
                  ].map((model) => (
                    <button
                      key={model}
                      className={`model-chip${modelId === model ? ' selected' : ''}`}
                      onClick={() => { setModelId(model); setTestResult(null); }}
                    >
                      {model.split('/')[1]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="ai-provider-panel">
            <div className="ai-field-group">
              <label className="ai-field-label">Server URL</label>
              <input
                type="text"
                value={ollamaUrl}
                onChange={(event) => { setOllamaUrl(event.target.value); setTestResult(null); }}
                placeholder="http://localhost:11434"
                className="ai-input"
              />
            </div>
            <div className="ai-field-group">
              <label className="ai-field-label">Model Name</label>
              <input
                type="text"
                value={ollamaModel}
                onChange={(event) => { setOllamaModel(event.target.value); setTestResult(null); }}
                placeholder="llama2, mistral, gemma, mixtral"
                className="ai-input"
              />
            </div>
            <div className="ai-ollama-note">
              Start server: <code>ollama serve</code> &nbsp;|&nbsp; Pull model: <code>ollama pull llama2</code>
            </div>
          </div>
        ))}

        <div className="ai-field-group">
          <label className="ai-field-label">Temperature</label>
          <div className="temp-segmented">
            {([
              [0.0, 'Precise'],
              [0.3, 'Balanced'],
              [0.5, 'Standard'],
              [0.7, 'Creative'],
              [1.0, 'Wild'],
            ] as [number, string][]).map(([value, label]) => (
              <button
                key={value}
                className={`temp-seg-btn${temperature === value ? ' active' : ''}`}
                onClick={() => setTemperature(value)}
                type="button"
              >
                <span className="temp-seg-val">{value.toFixed(1)}</span>
                <span className="temp-seg-label">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ai-field-group">
          <label className="ai-field-label">Category topics — one per column</label>
          <div className="category-topics-grid">
            {categoryTopics.map((topic, i) => (
              <input
                key={i}
                type="text"
                value={topic}
                onChange={(event) =>
                  setCategoryTopics((prev) => prev.map((t, j) => (j === i ? event.target.value : t)))
                }
                placeholder={`Category ${i + 1}`}
                className="ai-input"
                aria-label={`Category ${i + 1} topic`}
              />
            ))}
          </div>
          <span className="ai-optional">Leave any field blank to let the model pick that category.</span>
        </div>

        {testResult && (
          <div className={`ai-test-result${testResult.success ? ' success' : ' error'}`}>
            <span className="ai-test-icon">{testResult.success ? '&#x2713;' : '&#x2717;'}</span>
            {testResult.message}
          </div>
        )}

        <div className="ai-action-footer">
          <button className="ai-btn-generate" onClick={generateQuestions} disabled={isGenerating || generateCooldown > 0} type="button">
            {isGenerating ? 'Generating…' : generateCooldown > 0 ? `Wait ${generateCooldown}s` : 'Generate Board'}
          </button>
        </div>
      </div>
    </div>
  );
}
