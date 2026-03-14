# VoiceZettel — Self-Hosted Setup

Инструкция для пользователей, которые хотят запустить VoiceZettel на своём ПК и получить доступ с телефона.

> Общая документация проекта: [README.md](../README.md)

## Требования

- **Node.js** 18+ — [nodejs.org](https://nodejs.org)
- **Obsidian** + плагин **Local REST API**
- **cloudflared** (для мобильного доступа) — установка ниже

## 1. Установка

```bash
git clone https://github.com/speaker1991/voicezettel.git
cd voicezettel/temp-next
npm install
```

## 2. Настройка `.env.local`

Скопируй `.env.local.example` и заполни:

```env
OPENAI_API_KEY=sk-...

# Obsidian
OBSIDIAN_REST_URL=http://127.0.0.1:27123
OBSIDIAN_API_KEY=ваш_ключ_из_плагина
VAULT_PATH=C:/путь/к/вашему/vault

# Auth
AUTH_SECRET=любая_случайная_строка
```

## 3. Установка cloudflared

```powershell
# Вариант 1: winget (Windows 10/11)
winget install Cloudflare.cloudflared

# Вариант 2: chocolatey
choco install cloudflared

# Вариант 3: скачать вручную
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

## 4. Запуск

### Только локально (ПК):
```bash
npm run dev
```
Открой `http://localhost:3000`

### С мобильным доступом (ПК + телефон):
```bash
npm run tunnel
```
Скрипт запустит Next.js + cloudflared туннель и покажет HTTPS URL:
```
  Локально:  http://localhost:3000
  Телефон:   https://abc-xyz-123.trycloudflare.com
```
Открой ссылку на телефоне — всё работает как на ПК!

## 5. Obsidian

1. Установи плагин **Local REST API** из каталога плагинов Obsidian
2. Скопируй API Key из настроек плагина
3. Вставь в `.env.local` → `OBSIDIAN_API_KEY`
4. Укажи путь к vault → `VAULT_PATH`

## 6. Директория данных

Данные пользователей (чаты, память, настройки) хранятся в `data/` и **исключены из git**.
При первом запуске директории создаются автоматически. При ручной установке:

```bash
mkdir -p data/settings data/logs
```

> ⚠️ **Никогда не коммитьте файлы из `data/`** — они содержат персональные данные пользователей.

## Как это работает

```
📱 Телефон → cloudflared HTTPS → ПК (Next.js) → Vault на диске → iCloud/Syncthing → Obsidian
💻 ПК      → localhost:3000   → ПК (Next.js) → Vault на диске → Obsidian
```

Все данные хранятся **у вас** — сервер, заметки, память AI.
