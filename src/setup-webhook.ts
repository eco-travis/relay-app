import dotenv from 'dotenv'
import path from 'path'

// Load .env.local for development, .env for production
const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.local'
dotenv.config({ path: path.resolve(process.cwd(), envFile) })

const API_KEY  = process.env.TRELLO_API_KEY!
const TOKEN    = process.env.TRELLO_TOKEN!
const BOARD_ID = process.env.TRELLO_BOARD_ID!
const CALLBACK = process.env.TRELLO_WEBHOOK_CALLBACK_URL!

async function registerWebhook() {
  console.log('Registering Trello webhook...')
  console.log(`Board:    ${BOARD_ID}`)
  console.log(`Callback: ${CALLBACK}`)

  const res = await fetch('https://api.trello.com/1/webhooks', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key:         API_KEY,
      token:       TOKEN,
      idModel:     BOARD_ID,
      callbackURL: CALLBACK,
      description: 'Relay SEO pipeline',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to register webhook: ${err}`)
  }

  const data: any = await res.json()
  console.log('\n✅ Webhook registered successfully')
  console.log(`   ID:  ${data.id}`)
  console.log(`   URL: ${data.callbackURL}`)
}

registerWebhook().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
