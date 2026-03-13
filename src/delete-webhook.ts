import dotenv from 'dotenv'
import path from 'path'

// Load .env.local for development, .env for production
const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.local'
dotenv.config({ path: path.resolve(process.cwd(), envFile) })

const API_KEY = process.env.TRELLO_API_KEY!
const TOKEN = process.env.TRELLO_TOKEN!

async function listAndDeleteWebhooks() {
  console.log('Fetching existing webhooks...\n')

  const res = await fetch(
    `https://api.trello.com/1/tokens/${TOKEN}/webhooks?key=${API_KEY}`,
    { method: 'GET' }
  )

  if (!res.ok) {
    throw new Error(`Failed to fetch webhooks: ${await res.text()}`)
  }

  const webhooks = await res.json()

  if (webhooks.length === 0) {
    console.log('No webhooks found.')
    return
  }

  console.log(`Found ${webhooks.length} webhook(s):`)
  webhooks.forEach((wh: any, i: number) => {
    console.log(`\n${i + 1}. ID: ${wh.id}`)
    console.log(`   URL: ${wh.callbackURL}`)
    console.log(`   Active: ${wh.active}`)
  })

  // Delete all webhooks
  console.log('\n\nDeleting webhooks...')
  for (const wh of webhooks) {
    const delRes = await fetch(
      `https://api.trello.com/1/webhooks/${wh.id}?key=${API_KEY}&token=${TOKEN}`,
      { method: 'DELETE' }
    )

    if (delRes.ok) {
      console.log(`✅ Deleted webhook: ${wh.id}`)
    } else {
      console.error(`❌ Failed to delete ${wh.id}: ${await delRes.text()}`)
    }
  }
}

listAndDeleteWebhooks().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
