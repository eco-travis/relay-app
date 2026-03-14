import dotenv from 'dotenv'
import path from 'path'
import express from 'express'
import crypto from 'crypto'
import { handleCardMoved } from './orchestrator'

// Load .env.local for development, .env for production
const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.local'
dotenv.config({ path: path.resolve(process.cwd(), envFile) })

export const app = express()
app.use(express.json())

const TRELLO_SECRET = process.env.TRELLO_WEBHOOK_SECRET!

const LIST_IDS = {
  readyToBuild:    process.env.TRELLO_LIST_READY_TO_BUILD!,
  readyToPublish:  process.env.TRELLO_LIST_READY_TO_PUBLISH!,
}

// Trello sends HEAD to verify endpoint exists
app.head('/webhook/trello', (_req, res) => res.sendStatus(200))

function verifyTrelloSignature(req: express.Request): boolean {
  const signature = req.headers['x-trello-webhook'] as string
  if (!signature) {
    console.log('❌ No signature in header')
    return false
  }

  const body = JSON.stringify(req.body)
  const callbackUrl = process.env.TRELLO_WEBHOOK_CALLBACK_URL!
  const content = body + callbackUrl

  const hash = crypto
    .createHmac('sha1', TRELLO_SECRET)
    .update(content)
    .digest('base64')

  return hash === signature
}

app.post('/webhook/trello', async (req, res) => {
  if (!verifyTrelloSignature(req)) {
    console.warn('Invalid Trello signature')
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const { action } = req.body
  if (action?.type !== 'updateCard') return res.sendStatus(200)

  const listAfter  = action.data?.listAfter?.id
  const listBefore = action.data?.listBefore?.id
  const card       = action.data?.card

  if (!card || listBefore === listAfter) return res.sendStatus(200)

  // Respond to Trello immediately — process async
  res.sendStatus(200)

  try {
    if (listAfter === LIST_IDS.readyToBuild) {
      await handleCardMoved(card.id, 'ready-to-build')
    } else if (listAfter === LIST_IDS.readyToPublish) {
      await handleCardMoved(card.id, 'ready-to-publish')
    }
  } catch (err) {
    console.error('Pipeline error:', err)
  }
})

// Health check
app.get('/', (_req, res) => res.json({ status: 'ok', app: 'relay-app' }))

// Only call listen() when running locally (not in Netlify Functions)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3002
  app.listen(PORT, () => console.log(`Relay running on http://localhost:${PORT}`))
}
