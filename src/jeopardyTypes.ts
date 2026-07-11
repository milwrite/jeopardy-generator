export interface Rating {
  rating: 'good' | 'bad';
  timestamp: string;
}

export interface Question {
  text: string;
  answer: string;
  value: number;
  revealed: boolean;
  answered: boolean;
  dailyDouble?: boolean;
  ruleViolation?: string | null;
  ratings?: Rating[];
}

export interface DifficultyAdjustments {
  [key: number]: number;
}

export interface Category {
  title: string;
  questions: Question[];
  difficultyAdjustments?: DifficultyAdjustments;
}

export interface Player {
  name: string;
  score: number;
  active: boolean;
}

export interface GameState {
  categories: Category[];
  players: Player[];
  currentPlayer: number;
  finalJeopardyActive: boolean;
}

export interface IncorrectPlayers {
  [key: number]: boolean;
}

export type AIProvider = 'openrouter' | 'ollama';

export type BoardSource = 'manual' | 'generated' | 'imported';

export interface BoardMetadata {
  schemaVersion: number;
  source: BoardSource;
  provider?: AIProvider;
  model?: string;
  requestedModel?: string;
  resolvedModel?: string;
  temperature?: number;
  topics?: string[];
  generatedAt?: string;
}

export interface BoardGenerationResult {
  categories: Category[];
  metadata: BoardMetadata;
}

export interface StoredBoardSummary {
  id: number;
  name: string;
  source: BoardSource;
  ai_provider: string | null;
  ai_model: string | null;
  metadata: BoardMetadata;
  schema_version: number;
  revision: number;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredBoard extends StoredBoardSummary {
  board_data: {
    gameState?: GameState;
    version?: string;
  };
}
