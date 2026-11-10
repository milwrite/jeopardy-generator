import React, { useEffect, useState, useRef } from 'react';

import {
  createDifficultyAdjustments,
  defaultValues,
} from './jeopardyDefaults';
import { readGeneratedBoardStream } from './generationProgress';
import {
  getOpenRouterBoardResponseFormat,
  getOpenRouterModelOptions,
  normalizeOpenRouterModelId,
  OPENROUTER_MODELS, WORKERS_AI_MODEL, WORKERS_AI_MODELS, isHostedSuite, configuredModelId,
} from './openRouterModels';
import { logBadResponse, validateQuestionRule } from './questionValidation';
import type { AIProvider, BoardGenerationResult, BoardMetadata, Category } from './jeopardyTypes';
import { parseGeneratedBoard, waitForRetry } from './generatedBoard';
import { gameModel, generationBudget } from './gameModels';

const DEFAULT_SYSTEM_MESSAGE =
  'Write accurate, concise Jeopardy clues with one unambiguous answer each. Clues are declarative statements; answers are phrased as questions. Do not reveal the answer in its clue. Return only the requested JSON.';

interface AISettingsModalProps {
  signedIn: boolean;
  onClose: () => void;
  onGeneratedCategories: (result: BoardGenerationResult) => void;
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

const ensureBoardShape = (categories: Category[]) => {
  const normalized = categories;

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
  signedIn,
  onClose,
  onGeneratedCategories,
}: AISettingsModalProps) {
  // Included models use the current CUNY session at the Worker. Personal keys
  // go directly to OpenRouter and use that provider's full model identifiers.
  const [aiProvider, setAiProvider] = useState<AIProvider>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [modelId, setModelId] = useState(WORKERS_AI_MODEL);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelNotice, setModelNotice] = useState('');
  const useProxy = aiProvider === 'openrouter' && !apiKey.trim();
  useEffect(()=>{if(!useProxy&&apiKey)setModelId(id=>configuredModelId(id,isHostedSuite(),false));},[useProxy,apiKey]);
  useEffect(() => {
    if (!isHostedSuite() || !useProxy) return;
    const controller = new AbortController();
    setAvailableModels([]);
    fetch('/api/ai/models', { signal:controller.signal }).then(async response => {
      if (!response.ok) throw new Error('The model list could not be loaded. Reopen Config to retry.');
      const data = await response.json();
      const ids = (data.models || []).map((model:{id:string}) => model.id).filter((id:string) => gameModel(id));
      if (!ids.length) throw new Error('No shortlisted model is available right now. Reopen Config to retry.');
      setAvailableModels(ids);
      setModelId(previous => {
        const selected = configuredModelId(previous,true,true);
        const next = ids.includes(selected) ? selected : ids[0];
        try { localStorage.setItem('jeopardy_model_id',next); } catch {}
        return next;
      });
    }).catch(error => { if (!controller.signal.aborted) setModelNotice(error.message); });
    return () => controller.abort();
  }, [useProxy]);
  const selectModel = (id: string) => {
    setModelId(id);
    setModelNotice('');
    setTestResult(null);
    try { localStorage.setItem('jeopardy_model_id', id); } catch { /* Current session remains usable. */ }
  };
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
  const [testCooldown, setTestCooldown] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeGeneration = useRef<AbortController | null>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('select, input, button')?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activeGeneration.current) activeGeneration.current.abort(new Error('Generation cancelled. Your current board is unchanged.'));
        else onClose();
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary'))
        .filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    panel?.addEventListener('keydown', trapFocus);
    return () => { panel?.removeEventListener('keydown', trapFocus); previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    const form = panelRef.current?.querySelector<HTMLElement>('.generation-form');
    if (form) form.inert = isGenerating;
    if (isGenerating) panelRef.current?.querySelector<HTMLElement>('.gen-cancel')?.focus();
  }, [isGenerating]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => () => activeGeneration.current?.abort(new Error('Generation cancelled.')), []);
  useEffect(() => {
    if (!isGenerating) return;
    const started = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [isGenerating]);

  const buildGenerationMetadata = (resolvedModel?: string): BoardMetadata => {
    const topics = categoryTopics.map((topic) => topic.trim()).filter(Boolean);
    const requestedModel = aiProvider === 'openrouter' ? modelId.trim() : ollamaModel.trim();
    const model = resolvedModel?.trim() || requestedModel;

    return {
      schemaVersion: 1,
      source: 'generated',
      provider: gameModel(requestedModel)?.provider === 'workers-ai' ? 'workers-ai' : aiProvider,
      model,
      requestedModel,
      ...(resolvedModel ? { resolvedModel: resolvedModel.trim() } : {}),
      temperature,
      ...(topics.length > 0 ? { topics } : {}),
      generatedAt: new Date().toISOString(),
    };
  };

  const buildGenerationResult = (
    categories: Category[],
    resolvedModel?: string,
  ): BoardGenerationResult => ({
    categories,
    metadata: buildGenerationMetadata(resolvedModel),
  });

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

      const storedModelId = localStorage.getItem('jeopardy_model_id');
      const savedModelId = configuredModelId(storedModelId, isHostedSuite(), !savedKey);
      if (storedModelId && !gameModel(storedModelId)) setModelNotice('The previous model is outside this shortlist. DeepSeek V4.1 Flash is selected for new generations.');
      if (savedModelId) {
        const normalizedModelId = normalizeOpenRouterModelId(savedModelId);
        setModelId(normalizedModelId);
        if (normalizedModelId !== storedModelId) {
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
    if (isHostedSuite() && useProxy && !signedIn) {
      setTestResult({success:false, message:'Sign in with CUNY or enter your own API key.'});
      return;
    }

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
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error('The model did not respond within 30 seconds. Try another model.')), 30_000);

    try {
      const testPrompt = 'Respond with exactly: "API connection successful"';

      const response =
        aiProvider === 'openrouter'
          ? await fetch(useProxy ? '/api/ai/chat' : 'https://openrouter.ai/api/v1/chat/completions', {
              signal: controller.signal,
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
                model: modelId || WORKERS_AI_MODEL,
                messages: [{ role: 'user', content: testPrompt }],
                max_tokens: generationBudget(modelId, 50),
                temperature: 0.1,
                ...getOpenRouterModelOptions(modelId),
              }),
            })
          : await fetch(`${ollamaUrl}/api/chat`, {
              signal: controller.signal,
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
      clearTimeout(deadline);
      setIsTesting(false);
      startCooldown(setTestCooldown, 10);
    }
  };

  const generateQuestions = async () => {
    if (activeGeneration.current) return;
    setTestResult(null);
    if (isHostedSuite() && useProxy && !signedIn) {
      setTestResult({success:false, message:'Sign in with CUNY or enter your own API key.'});
      return;
    }

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
      setTestResult({ success: false, message: 'Please enter an Ollama model name such as llama3.2' });
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
    setGenerationStatus('Connecting to the model…');
    const controller = new AbortController();
    activeGeneration.current = controller;
    // One deadline covers fetching, streaming, and any transient retry.
    const deadline = setTimeout(() => controller.abort(new Error('The model did not finish within 90 seconds. Try another model in Config.')), 90_000);
    try {
      const useMockResponse = process.env.NEXT_PUBLIC_USE_MOCK_AI === 'true';

      if (useMockResponse) {
        const simulatedProgress = [
          [12, 'Connecting to the model…'],
          [34, 'Receiving categories…'],
          [58, 'Receiving clues…'],
          [82, 'Finishing the board…'],
          [98, 'Checking clue quality…'],
        ] as const;
        for (const [progress, status] of simulatedProgress) {
          setGenerationProgress(progress);
          setGenerationStatus(status);
          await new Promise((resolve) => setTimeout(resolve, 220));
        }
        onGeneratedCategories(buildGenerationResult(buildMockCategories()));
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
      const prompt = `Create exactly 6 distinct Jeopardy categories, each with exactly 5 concise clues increasing in difficulty.
${anyTopics ? `Use these topics in order:\n${topicList}` : 'Choose six varied topics.'}
${difficultyGuidance ? `Difficulty guidance:\n${difficultyGuidance}` : ''}
Return only JSON: {"categories":[{"title":"Category","questions":[{"text":"A specific factual statement","answer":"What is X?"}]}]}.
Include all 30 clues. The game assigns prices and Daily Doubles.`;

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
            model: modelId || WORKERS_AI_MODEL,
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: prompt },
            ],
            max_tokens: gameModel(modelId)?.id === 'minimax-m3' ? 8000 : 5000,
            temperature,
            stream: true,
            ...getOpenRouterModelOptions(modelId),
            response_format: getOpenRouterBoardResponseFormat(modelId),
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

      const maxRetries = 1;
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
            signal: controller.signal,
            mode: 'cors',
            credentials: useProxy ? 'same-origin' : 'omit',
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
              lastError = new Error('The model is busy. Wait a moment and try again.');
              if (retries >= maxRetries) throw lastError;
              setGenerationStatus('The model is busy. Retrying once…');
              await waitForRetry(2000, controller.signal);
              retries++;
              continue;
            }

            if (response.status === 401 || response.status === 403) {
              if(useProxy){const error=await response.json().catch(()=>({}));throw new Error(error.error?.message||'CUNY Login required.');}
              throw new Error(
                `Authentication failed: ${response.status} ${response.statusText}. Please check that your API key is valid, has not expired, and has the correct format.`
              );
            }

            if (response.status >= 500) {
              lastError = new Error(`The model service is unavailable (${response.status}). Try again or choose another model.`);
              if (retries >= maxRetries) throw lastError;
              setGenerationStatus('The model service is reconnecting. Retrying once…');
              await waitForRetry(1500, controller.signal);
              retries++;
              continue;
            }

            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
          }

          const generatedStream = await readGeneratedBoardStream(
            response,
            aiProvider,
            ({ completedQuestions, totalQuestions, percent, receiving }) => {
              setGenerationProgress(percent);
              setGenerationStatus(
                completedQuestions > 0
                  ? `Generated ${completedQuestions} of ${totalQuestions} clues…`
                  : receiving ? 'The model is writing the first clues…' : 'Connected. Waiting for the model…',
              );
            },
            { signal: controller.signal },
          );
          const jsonContent = generatedStream.content;

          const parsedData = parseGeneratedBoard(jsonContent);
          setGenerationProgress(94);
          setGenerationStatus('Checking board structure…');
          const savedAdjustmentsStr = localStorage.getItem('jeopardy_difficulty_adjustments');
          const savedAdjustments = savedAdjustmentsStr ? JSON.parse(savedAdjustmentsStr) : {};

          const parsedCategories = parsedData.categories;

          let formattedCategories: Category[] = parsedCategories.map((category: any) => {
            const similarCategory = Object.keys(savedAdjustments).find(
              (existingTitle) =>
                existingTitle.toLowerCase().includes(String(category.title || '').toLowerCase()) ||
                String(category.title || '').toLowerCase().includes(existingTitle.toLowerCase())
            );

            const difficultyAdjustments = similarCategory
              ? savedAdjustments[similarCategory]
              : createDifficultyAdjustments();

            const questions = category.questions;

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
                  text: question.text,
                  answer: question.answer,
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
          // so broken boards never reach the table.
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
          onGeneratedCategories(buildGenerationResult(formattedCategories, generatedStream.model));
          onClose();
          return;
        } catch (error) {
          lastError = error;
          if (controller.signal.aborted) throw controller.signal.reason;

          if (error instanceof TypeError) {
            retries++;
            if (retries <= maxRetries) {
              setGenerationProgress(0);
              setGenerationStatus(`Retrying generation after attempt ${retries}…`);
              await waitForRetry(1500, controller.signal);
              continue;
            }
          }

          throw error;
        }
      }

      throw lastError instanceof Error ? lastError : new Error('Question generation failed.');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Question generation failed.';
      setTestResult({ success: false, message: errorMessage.startsWith('Generation cancelled') ? errorMessage : `Generation failed: ${errorMessage}` });
    } finally {
      setIsGenerating(false);
      clearTimeout(deadline);
      activeGeneration.current = null;
    }
  };

  // Auto-detect the local model server + adapter, so users never touch endpoints.
  useEffect(() => {
    if(aiProvider!=='ollama')return;
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
  }, [aiProvider, ollamaUrl, ollamaModel]);

  return (
    <div className="ai-settings-modal" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} className="ai-settings-panel" role="dialog" aria-modal="true" aria-labelledby="generation-title">
        <div className="ai-settings-header">
          <div>
            <h2 id="generation-title" className="ai-settings-title">New board</h2>
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
              <div className="gen-progress-status" role="status">{generationStatus}</div>
              <p>{elapsedSeconds}s elapsed · up to 90s</p>
              <button type="button" className="ai-btn-test gen-cancel" onClick={() => activeGeneration.current?.abort(new Error('Generation cancelled. Your current board is unchanged.'))}>Cancel generation</button>
            </div>
          </div>
        )}

        <div className="generation-form">
        {aiProvider === 'openrouter' && <div className="ai-field-group">
          <label className="ai-field-label" htmlFor="generation-model">Model</label>
          <select id="generation-model" className="ai-input" value={modelId}
            disabled={isHostedSuite() && useProxy && !availableModels.length}
            onChange={event => selectModel(event.target.value)}>
            {(isHostedSuite() && useProxy ? WORKERS_AI_MODELS.filter(model => availableModels.includes(model.id)) : OPENROUTER_MODELS)
              .map(({id, label}) => <option key={id} value={id}>{label}{id === WORKERS_AI_MODEL || id === gameModel(WORKERS_AI_MODEL)?.upstream ? ' (recommended)' : ''}</option>)}
          </select>
          {modelId === 'minimax-m3' && <p className="model-choice-note">MiniMax usually takes longer to build a full board.</p>}
          {modelNotice && <p className="model-choice-note" role="status">{modelNotice}</p>}
        </div>}
        <fieldset className="ai-field-group category-topics">
          <legend className="ai-field-label">Category topics</legend>
          <p className="ai-optional">Choose up to six topics, or leave them blank for a surprise.</p>
          <div className="category-topics-grid">
            {categoryTopics.map((topic, index) => <label key={index}>
              <span className="topic-label">Topic {index + 1}</span>
              <input type="text" value={topic} onChange={event => setCategoryTopics(previous => previous.map((value, i) => i === index ? event.target.value : value))}
                className="ai-input" placeholder="Any topic" aria-label={`Category ${index + 1} topic`} />
            </label>)}
          </div>
        </fieldset>
        <details className="generation-options">
          <summary>More options</summary>
          <div className="ai-field-group">
            <label className="ai-field-label" htmlFor="generation-provider">Connection</label>
            <select id="generation-provider" className="ai-input" value={aiProvider} onChange={event => { setAiProvider(event.target.value as AIProvider); setTestResult(null); }}>
              <option value="openrouter">{isHostedSuite() && useProxy ? 'CUNY AI' : 'OpenRouter'}</option>
              <option value="ollama">Local model</option>
            </select>
          </div>
          {aiProvider === 'ollama' ? <>
            <p className="model-choice-note" role="status">{serverStatus === 'online' ? 'Local model connected.' : serverStatus === 'checking' ? 'Checking local model…' : 'Local model is offline.'}</p>
            <label className="ai-field-label" htmlFor="local-model">Model name</label>
            <input id="local-model" className="ai-input" value={ollamaModel} onChange={event => setOllamaModel(event.target.value)} />
            <label className="ai-field-label" htmlFor="local-server">Server URL</label>
            <input id="local-server" className="ai-input" value={ollamaUrl} onChange={event => setOllamaUrl(event.target.value)} />
          </> : <div className="ai-field-group">
            {useProxy && !showKeyInput && signedIn ? <button className="btn-ghost" onClick={() => setShowKeyInput(true)}>Use my API key</button> : <>
              <label className="ai-field-label" htmlFor="personal-api-key">OpenRouter API key</label>
              <input id="personal-api-key" type="password" value={apiKey} onChange={event => { setShowKeyInput(true); setApiKey(event.target.value); setTestResult(null); }} className="ai-input" placeholder="sk-or-…" />
              {(apiKey || showKeyInput) && <button className="btn-ghost" onClick={() => { setShowKeyInput(false); setApiKey(''); setTestResult(null); }}>Use CUNY access</button>}
            </>}
          </div>}
          <div className="ai-field-group">
            <label className="ai-field-label" htmlFor="generation-temperature">Clue style</label>
            <select id="generation-temperature" className="ai-input" value={temperature} onChange={event => setTemperature(Number(event.target.value))}>
              <option value={0}>Precise</option><option value={0.3}>Balanced</option><option value={0.5}>Standard</option><option value={0.7}>Creative</option><option value={1}>Wild</option>
            </select>
          </div>
          <button className="btn-ghost" onClick={testApiKey} disabled={isTesting || testCooldown > 0}>{isTesting ? 'Testing…' : 'Test connection'}</button>
        </details>
        {isHostedSuite() && useProxy && !signedIn && <p className="model-choice-note"><a href="/auth/start?next=/">CUNY Login</a> to generate a board, or use your API key in More options.</p>}

        {testResult && (
          <div role="status" className={`ai-test-result${testResult.success ? ' success' : ' error'}`}>

            {testResult.message}
          </div>
        )}

        <div className="ai-action-footer">
          <button className="ai-btn-generate" onClick={generateQuestions} disabled={isGenerating || (isHostedSuite() && useProxy && !availableModels.length)} type="button">
            {isGenerating ? 'Generating…' : 'Generate Board'}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
