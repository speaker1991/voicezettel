# VoiceZettel 🎙️

**AI голосовой помощник с Zettelkasten для Obsidian**

Говори — помощник запоминает, создаёт структурированные заметки и отвечает голосом. Все данные хранятся у вас.

[![CI](https://github.com/speaker1991/voicezettel/actions/workflows/ci.yml/badge.svg)](https://github.com/speaker1991/voicezettel/actions/workflows/ci.yml)

## Архитектура

```
📱 Браузер (React)
    ├── 🎙 Микрофон → STT (Local Whisper / Browser / Yandex)
    ├── 💬 Чат → /api/chat → LLM (DeepSeek / OpenAI / Gemini)
    ├── 🔊 TTS → EdgeTTS / Yandex SpeechKit
    └── 🗂 Заметки → Obsidian Local REST API
         ↕
    Next.js 16 (App Router)
    ├── providers/   → LLM провайдеры (OpenAI, DeepSeek, Gemini)
    ├── chatContext   → память + vault + ChromaDB RAG
    ├── chatTools     → function calling (save_memory, create_zettel)
    ├── sseStream     → SSE streaming + DSML обработка
    └── memoryStore   → embeddings + cosine similarity
```

## Стек

| Категория | Технологии |
|-----------|-----------|
| **Frontend** | Next.js 16, React 19, Zustand, Tailwind CSS 4, Framer Motion |
| **3D** | Three.js (ParticleOrb), react-ai-orb |
| **Auth** | NextAuth v5 (Google OAuth) |
| **LLM** | DeepSeek, OpenAI (GPT-4o-mini), Google Gemini 2.0 Flash |
| **TTS** | EdgeTTS, Yandex SpeechKit |
| **STT** | faster-whisper (Local Core), Browser Speech API |
| **Память** | JSON store + OpenAI embeddings + cosine similarity |
| **Заметки** | Obsidian Local REST API, прямая запись в vault |

## Быстрый старт

```bash
git clone https://github.com/speaker1991/voicezettel.git
cd voicezettel/temp-next
npm install
cp .env.example .env.local
# Заполни .env.local ключами
npm run dev
```

Открой `http://localhost:3000`

## Env-переменные

| Переменная | Обязательная | Описание |
|------------|:---:|----------|
| `OPENAI_API_KEY` | ✅ | OpenAI API ключ (embeddings + GPT-4o-mini) |
| `DEEPSEEK_API_KEY` | — | DeepSeek API ключ (основной LLM, работает из РФ) |
| `GOOGLE_GEMINI_API_KEY` | — | Google Gemini API ключ (fallback LLM) |
| `AUTH_SECRET` | ✅ | Секрет для NextAuth (любая случайная строка) |
| `AUTH_GOOGLE_ID` | — | Google OAuth Client ID |
| `AUTH_GOOGLE_SECRET` | — | Google OAuth Client Secret |
| `VAULT_PATH` | — | Абсолютный путь к Obsidian vault |
| `LOCAL_CORE_URL` | — | URL Local Core для STT (default: `http://localhost:8000`) |
| `YANDEX_OAUTH_TOKEN` | — | Yandex Cloud OAuth токен (для TTS) |
| `YANDEX_SPEECHKIT_FOLDER_ID` | — | Yandex Cloud Folder ID |

## Структура проекта

```
src/
├── app/
│   ├── api/
│   │   ├── chat/          # LLM чат (SSE streaming)
│   │   ├── tts/           # EdgeTTS
│   │   ├── tts-yandex/    # Yandex SpeechKit TTS
│   │   ├── voice-memory/  # Авто-сохранение из голоса
│   │   ├── vault-context/ # Поиск по заметкам
│   │   ├── settings/      # Пользовательские настройки
│   │   ├── token-usage/   # Статистика токенов
│   │   └── ...            # 17 API routes
│   ├── admin/             # Админ-панель
│   └── login/             # Страница входа
├── components/
│   ├── chat/              # ChatArea, InputBar, MessageBubble
│   ├── orb/               # 3D Orb (Three.js + AI Orb)
│   ├── settings/          # SettingsPanel
│   └── ui/                # shadcn/ui компоненты
├── hooks/
│   ├── useVoiceSession    # Голосовая сессия (STT → LLM → TTS)
│   ├── useTextChat        # Текстовый чат
│   └── useSpeechRecognition
├── lib/
│   ├── providers/         # LLM провайдеры (OpenAI, DeepSeek, Gemini)
│   ├── chatContext        # Контекст: память + vault + ChromaDB
│   ├── chatTools          # Function calling
│   ├── sseStream          # SSE обработка + DSML
│   ├── memoryStore        # Долговременная память (embeddings)
│   ├── vaultContext       # Чтение vault
│   └── vaultWriter        # Запись заметок
├── stores/                # Zustand stores
└── types/                 # TypeScript типы
```

## Голосовой pipeline

```
🎙 Микрофон
  → STT (faster-whisper / Browser API)
    → buildMemoryContext + buildEnrichedPrompt
      → LLM (DeepSeek / OpenAI / Gemini)
        → SSE streaming → sentence detection
          → TTS (EdgeTTS / Yandex)
            → 🔊 Динамик
```

Первое предложение ответа озвучивается пока LLM ещё генерирует остальное (zero-buffering passthrough).

## Скрипты

| Команда | Описание |
|---------|----------|
| `npm run dev` | Dev-сервер (0.0.0.0:3000) |
| `npm run build` | Production build |
| `npm run lint` | ESLint проверка |
| `npm run typecheck` | TypeScript проверка |
| `npm run tunnel` | Dev + Cloudflare tunnel (для телефона) |

## Документация

- [Self-Hosted Setup](docs/SELF-HOSTED.md) — установка на свой ПК с доступом с телефона

## Лицензия

Private repository.
