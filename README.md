# Greenlit

SEO pipeline: Trello card → Claude → GitHub PR → Netlify preview → merge to master.

## How it works

1. SEO person creates a Trello card with a page target in the title (e.g. `Update /invisalign SEO`) and writes the brief in the card description
2. Moving the card to **Ready to Build** triggers the pipeline
3. Claude reads the card, fetches the current page from GitHub, generates the changes
4. A PR is opened and the Netlify preview URL is posted back to the card
5. Moving the card to **Approved** merges the PR to master and triggers a live deploy

## Trello board setup

Your board needs these lists (in order):
- Backlog
- Ready to Build  ← moving here kicks off generation
- In Progress
- Preview Ready
- Approved        ← moving here merges to master
- Live
- Failed

## Getting started

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in all values in .env
```

**Getting Trello credentials:**
- API key + token: https://trello.com/app-key
- Board ID + List IDs: add `.json` to your Trello board URL

**Getting GitHub token:**
- https://github.com/settings/tokens → generate token with `repo` scope

### 3. Run locally
```bash
npm run dev
```

In a separate terminal, expose your local server:
```bash
npx ngrok http 3001
```

Set `TRELLO_WEBHOOK_CALLBACK_URL` to your ngrok URL, then register the webhook:
```bash
npm run setup-webhook
```

### 4. Deploy to Netlify
```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

Then update `TRELLO_WEBHOOK_CALLBACK_URL` in Netlify environment variables to your live URL and re-run:
```bash
npm run setup-webhook
```

## CLAUDE.md

Add a `CLAUDE.md` to your **Gatsby repo** (not this one) documenting your site's conventions — component patterns, SEO field names, import paths, etc. Claude reads this automatically and uses it to generate valid, mergeable code.
