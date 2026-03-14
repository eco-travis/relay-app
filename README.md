# Greenlit

SEO pipeline: Trello card → Claude → GitHub PR → Netlify preview → merge to master.

## How it works

1. **Create card**: SEO person creates a Trello card with a page target in the title (e.g. `Update /invisalign SEO`) and writes the brief in the card description
2. **Build preview**: Move card to **Ready to Build** → Claude generates changes → PR opened → Netlify preview posted
3. **Review & iterate**:
   - ✅ Happy with preview? → Move to **Ready to Publish** (skip to step 4)
   - 🔄 Need changes? → Update card description with new instructions → Drag back to **Ready to Build** → Get updated preview
4. **Publish**: Move card to **Ready to Publish** → PR merges to master → Card moves to **Done**

## Trello board setup

Your board needs these lists (in order):
- **Ready to Build** ← Drag here to generate preview (initial build or rebuild)
- **Ready to Preview** ← Cards auto-move here after preview is ready
- **Ready to Publish** ← Drag here to merge to master and go live
- **Done** ← Cards auto-move here after publishing

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
