# Odylic Studio

AI-powered ad creative generation. Enter a product URL, and the system researches your brand, selects templates, writes copy, and generates on-brand ad creatives.

## Important — Read Before Using

> **API Key Security:** This app requires your personal API keys for Google Gemini and Anthropic Claude. Your keys are stored **locally on your computer only** and are never sent to us or any third party. That said, **we cannot guarantee the security of your API keys.** We strongly recommend:
>
> - **Create NEW API keys** specifically for this app — do not reuse keys from other projects
> - **Set spend limits** on both accounts immediately after creating your keys
> - **Revoke the keys** if you stop using the app
>
> **Cost Warning:** This app makes API calls to generate ads, and **each generation costs real money.** Costs depend on how many ads you generate, the quality tier you use, and how many resizes you do. As a rough guide:
>
> | Action | Estimated Cost |
> |--------|---------------|
> | Brand research (Claude) | ~$0.05–0.15 |
> | Ad generation — Fast tier (Gemini) | ~$0.01–0.03 per image |
> | Ad generation — Quality tier (Gemini) | ~$0.02–0.05 per image |
> | Ad generation — Pro tier (Gemini) | ~$0.05–0.10 per image |
> | Resizing an ad | ~$0.02–0.05 per resize |
>
> A typical session generating 10–20 ads with resizes might cost **$0.50–$2.00.** Heavy usage (50+ ads, multiple brands) could be **$5–10+ per session.**
>
> **Set spend limits on your API accounts:**
> - **Gemini:** [Manage billing & limits](https://aistudio.google.com/)
> - **Claude:** [Manage billing & limits](https://console.anthropic.com/settings/billing)
>
> **We are not responsible for any API charges incurred.** By using this app, you acknowledge that you are using your own API keys at your own expense and discretion.

---

## Install (one command)

**Mac / Linux** — open Terminal and paste:
```bash
curl -fsSL https://raw.githubusercontent.com/peterquads/odylic-studio/main/install.sh | bash
```

**Windows** — open PowerShell and paste:
```powershell
irm https://raw.githubusercontent.com/peterquads/odylic-studio/main/install.ps1 | iex
```

Both commands auto-install Git and Node.js if needed, download ~4,000 ad templates, create a Desktop shortcut, and launch the app.

### Manual install

Requires [Node.js](https://nodejs.org/) 18+ and [Git](https://git-scm.com/).

```bash
git clone https://github.com/peterquads/odylic-studio.git ~/odylic-studio
cd ~/odylic-studio
npm install
npm start
```

The app opens at [http://localhost:3000](http://localhost:3000).

---

## API Keys Required

You'll need two API keys (both have free tiers). **Create new keys just for this app.**

1. **Google AI (Gemini)** — [Get key](https://aistudio.google.com/apikey)
   - Used for image generation and resizing

2. **Anthropic (Claude)** — [Get key](https://console.anthropic.com/settings/keys)
   - Used for brand research, copy writing, template selection, and QA review

Enter both keys on the Setup page when you first open the app.

---

## How It Works

1. **Brand DNA** — Claude analyzes your product URL and extracts brand colors, voice, audience, and visual style
2. **Assets** — Product images and logos are collected from the website (or uploaded manually)
3. **Templates** — AI selects best-matching ad formats from the ~4,000 bundled templates
4. **Briefing** — Claude writes a creative brief per ad: headline, copy, layout, and strategic angle
5. **Generation** — Gemini composites the brief + template + real product photos into finished ads
6. **QA** — Claude reviews each ad for brand consistency and text accuracy, iterating up to 2x

---

## Quality Tiers

| Tier | Model | Cost | Best for |
|------|-------|------|----------|
| **Fast** | Nano Banana | Free tier eligible | Quick drafts, testing |
| **Quality** | Nano Banana 2 | Paid | Production-ready ads |
| **Pro** | Nano Banana Pro | Paid | Highest image quality |

---

## What's Included

- **~4,000 ad templates** downloaded automatically during install
- Upload your own templates via Advanced Settings on the Setup page
- Cancel generation mid-way — already-completed ads are kept
- Resize any ad to 1:1, 3:4, or 9:16 with one click

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **State:** Zustand (localStorage + IndexedDB for persistence)
- **AI:** Claude (Anthropic) for strategy/copy, Gemini (Google) for image generation
- **No backend required** — runs entirely in the browser

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Node.js not found" | Install from [nodejs.org](https://nodejs.org) and re-run the install command |
| "Git not found" | Install from [git-scm.com](https://git-scm.com) and re-run |
| Ads fail to generate | Check your Gemini API key is valid. Free tier only supports the Fast model. |
| App won't open | Run `cd ~/odylic-studio && npm run dev` in Terminal, then open http://localhost:3000 |
| Uninstall | Delete the `~/odylic-studio` folder and the Desktop shortcut |

---

## License

For personal and internal use only. Not for redistribution.
