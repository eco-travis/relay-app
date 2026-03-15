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
app.head('/', (_req, res) => res.sendStatus(200))

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

async function handleWebhook(req: express.Request, res: express.Response) {
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

  // Determine event type
  let eventType: 'ready-to-build' | 'ready-to-publish' | null = null
  if (listAfter === LIST_IDS.readyToBuild) {
    eventType = 'ready-to-build'
  } else if (listAfter === LIST_IDS.readyToPublish) {
    eventType = 'ready-to-publish'
  }

  if (!eventType) return res.sendStatus(200)

  console.log(`🚀 Triggering background processing for card ${card.id}, event: ${eventType}`)

  // Trigger background function - await just to get the 202 response, then return
  const backgroundUrl = `${process.env.TRELLO_WEBHOOK_CALLBACK_URL}/.netlify/functions/process-card-background`

  try {
    const bgResponse = await fetch(backgroundUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    })

    if (bgResponse.ok || bgResponse.status === 202) {
      console.log(`✅ Background function triggered (status: ${bgResponse.status})`)
    } else {
      console.error(`❌ Background function returned status: ${bgResponse.status}`)
    }
  } catch (err) {
    console.error('❌ Failed to trigger background function:', err)
  }

  // Respond to Trello after triggering background function
  return res.sendStatus(200)
}

app.post('/webhook/trello', handleWebhook)

// Handle webhooks at root (for Netlify Functions routing)
app.post('/', async (req, res) => {
  // Check if this is a webhook call (has Trello signature) or just a regular request
  if (req.headers['x-trello-webhook']) {
    return handleWebhook(req, res)
  }
  // If not a webhook, return health check
  res.json({ status: 'ok', app: 'relay-app' })
})

// Health check
app.get('/', (_req, res) => res.json({ status: 'ok', app: 'relay-app' }))

// Only call listen() when running locally (not in Netlify Functions)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3002
  app.listen(PORT, () => console.log(`Relay running on http://localhost:${PORT}`))
}
