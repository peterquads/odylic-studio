# Odylic Studio

AI-powered ad creative generation. Enter a product URL, and the system researches your brand, selects templates, writes copy, and generates on-brand ad creatives.

## Getting Started

**Prerequisites:** [Node.js](https://nodejs.org/) 18+ (includes npm)

### Mac
Double-click **`start.command`** — it installs dependencies on first launch and opens the app in your browser.

### Windows
Double-click **`start.bat`** — same thing.

### Terminal
```bash
npm install
npm start
```

The app opens at [http://localhost:3000](http://localhost:3000).

## API Keys Required

You'll need two API keys (both have free tiers):

1. **Anthropic (Claude)** — [Get key](https://console.anthropic.com/settings/keys)
   - Used for brand research, copy writing, template selection, and QA review

2. **Google AI (Gemini)** — [Get key](https://aistudio.google.com/apikey)
   - Used for image generation and resizing

Enter both keys on the Setup page when you first open the app.

## What's Included

- **~4,000 ad templates** bundled in the `templates/` directory — no extra setup needed
- Upload your own templates via Advanced Settings on the Setup page

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **State:** Zustand (localStorage + IndexedDB for persistence)
- **AI:** Claude (Anthropic) for strategy/copy, Gemini (Google) for image generation
- **No backend required** — runs entirely in the browser

## How It Works

1. **Brand DNA** — Claude scrapes your product URL and extracts brand colors, voice, audience, and visual style
2. **Assets** — Product images and logos are collected from the website (or uploaded manually)
3. **Templates** — AI selects best-matching ad formats from the template library
4. **Briefing** — Claude writes a creative brief per ad: headline, copy, layout, and strategic angle
5. **Generation** — Gemini composites the brief + template + real product photos into finished ads
6. **QA** — Claude reviews each ad for brand consistency and text accuracy, iterating up to 2x
