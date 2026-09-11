export const validateQuestionRule = (
  categoryTitle: string,
  questionText: string,
  answerText: string
): { valid: boolean; reason?: string } => {
  const normalizeText = (text: string) =>
    text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, '');

  const normalizedCategory = normalizeText(categoryTitle);
  const normalizedQuestion = normalizeText(questionText);
  const normalizedAnswer = normalizeText(answerText);

  // Shared grammar is not an answer leak. Judge the named subject rather than
  // the "What is the..." response scaffold or ordinary connecting words.
  const commonWords = new Set(['a','an','the','is','are','was','were','be','been','being','what','who','where','when','which','this','that','these','those','it','its','has','have','had','of','in','on','at','to','for','from','by','with','and','or','as']);

  const categoryWords = normalizedCategory.split(/\s+/).filter((word) => word.length > 2);
  const questionWords = normalizedQuestion.split(/\s+/).filter((word) => word.length > 2);
  const answerWords = normalizedAnswer.split(/\s+/);
  const allClueWords = [...categoryWords, ...questionWords].filter(word => !commonWords.has(word));

  const overlappingWords = allClueWords.filter((word) =>
    answerWords.some((answerWord) => answerWord === word)
  );

  if (overlappingWords.length > 0) {
    return {
      valid: false,
      reason: `Answer contains words from the clue or category: ${overlappingWords.join(', ')}`,
    };
  }

  const vaguePhrases = [
    'known for',
    'famous for',
    'renowned for',
    'recognized for',
    'celebrated for',
    'this country',
    'this nation',
    'this place',
    'this region',
    'this area',
    'this city',
    'this culture',
    'this tradition',
    'unique blend',
    'rich history',
    'diverse landscape',
  ];

  const hasVaguePhrases = vaguePhrases.some((phrase) =>
    normalizedQuestion.includes(normalizeText(phrase))
  );

  // "This city, on the Thames, is the capital of the United Kingdom" is a
  // specific clue. Generic phrasing is only an error when it lacks details.
  let distinguishingText = normalizedQuestion;
  for (const phrase of vaguePhrases) distinguishingText = distinguishingText.replaceAll(normalizeText(phrase), ' ');
  const details = distinguishingText.split(/\s+/).filter(word => word.length > 2 && !commonWords.has(word));
  if (hasVaguePhrases && details.length < 2) {
    return {
      valid: false,
      reason:
        'Question may be too vague and could accept multiple answers. Consider adding more specific, distinguishing details.',
    };
  }

  // The clue ("text") must be a statement; the response ("answer") must be a
  // Jeopardy question that NAMES the subject, e.g. "What is Mesopotamia?".
  const isResponseForm = /^\s*(what|who|where|when|which)\s+(is|are|was|were)\b/i.test(answerText.trim());
  if (!isResponseForm) {
    return {
      valid: false,
      reason: 'Response must be phrased as a Jeopardy question ("What is…", "Who is…").',
    };
  }
  if (/\?\s*$/.test(questionText.trim())) {
    return {
      valid: false,
      reason: 'The clue must be a statement, not a question.',
    };
  }

  return { valid: true };
};

export const logBadResponse = (
  categoryTitle: string,
  questionText: string,
  answerText: string,
  reason: string
) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const existingLogs = JSON.parse(localStorage.getItem('jeopardy_format_issues') || '[]');
    existingLogs.push({
      category: categoryTitle,
      clue: questionText,
      answer: answerText,
      issue: reason,
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem('jeopardy_format_issues', JSON.stringify(existingLogs));
  } catch {
    // Ignore analytics failures.
  }
};
