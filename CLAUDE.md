# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JeopardyLM is a Next.js-based interactive Jeopardy game with AI-powered question generation. The application supports both cloud-based (OpenRouter) and local (Ollama) AI models for generating game content.

## Development Commands

```bash
npm run dev        # Start development server on port 3000 (or 3001 if occupied)
npm run build      # Create production build
npm run start      # Start production server
npm run lint       # Run ESLint
npx tsc --noEmit   # Type check without emitting files
```

## Architecture & Key Components

### Main Application Structure
- **src/JeopardyGame.tsx**: Core game component containing all game logic, state management, and UI
  - Manages game state including categories, questions, players, scores
  - Handles AI integration for both OpenRouter and Ollama
  - Implements Daily Double, Final Jeopardy, and multiplayer features
  - Contains modal components for settings, editing, and player management

- **pages/_app.tsx**: Next.js app wrapper with ErrorBoundary
- **pages/index.tsx**: Entry point that dynamically imports JeopardyGame to prevent SSR issues
- **styles/globals.css**: All styling using Tailwind CSS with custom Jeopardy theme variables

### AI Integration Architecture

The app supports two AI providers with different configurations:

**OpenRouter (Cloud)**:
- Endpoint: `https://openrouter.ai/api/v1/chat/completions`
- Requires: API key and Model ID
- Headers: Authorization, HTTP-Referer, X-Title

**Ollama (Local)**:
- Endpoint: `http://localhost:11434/api/chat` (configurable)
- Requires: Model name only
- Response format: `data.message.content` or `data.response`

### State Management Pattern

Uses React hooks for state management with localStorage persistence:
- Game state (categories, questions, players, scores)
- AI settings (provider, keys, models, temperature)
- Theme preferences
- Difficulty adjustments based on player performance

### Question Generation Flow

1. User configures AI settings (provider, model, temperature)
2. System validates provider-specific requirements
3. Sends formatted prompt with game structure requirements
4. Parses JSON response with multiple fallback strategies
5. Validates questions against word exclusion rules
6. Applies difficulty adjustments based on historical performance

### Key Technical Decisions

- **Client-side only rendering** for components with audio/localStorage to avoid hydration issues
- **Robust JSON extraction** with multiple parsing strategies for AI responses
- **Provider-agnostic design** allowing easy addition of new AI providers
- **Automatic difficulty adjustment** based on player performance ratings
- **Test connection feature** before generating full game boards

## AI Provider Configuration

When adding new AI providers, implement:
1. Add provider to `aiProvider` state type
2. Create API endpoint in `apiEndpoints` object
3. Add configuration in `apiConfigs` object
4. Update response parsing in switch statement
5. Add provider-specific UI fields in settings modal
6. Handle provider-specific error cases

## Common Issues & Solutions

**Ollama Connection Issues**:
- Check if Ollama is running: `ollama serve`
- Verify model is pulled: `ollama pull [model]`
- Default URL: `http://localhost:11434`

**CORS/Network Errors**:
- OpenRouter requires proper headers (HTTP-Referer, X-Title)
- Ollama must allow CORS from localhost origins

**JSON Parsing Failures**:
- AI responses are sanitized through multiple stages
- Fallback to partial extraction if full parse fails
- Mock data used as last resort

## Testing AI Connections

The "Test API Connection" feature makes minimal API calls to verify:
- API key validity (OpenRouter)
- Model availability
- Network connectivity
- Response format compatibility