import { handleCardMoved } from '../../src/orchestrator'

// Netlify Background Function (can run up to 15 minutes)
// This function is invoked directly by Trello webhooks for long-running operations
export const handler = async (event: any) => {
  try {
    const body = JSON.parse(event.body || '{}')

    // Extract Trello webhook data
    const { action } = body
    if (!action || action.type !== 'updateCard') {
      console.log('⏭️  Skipping non-updateCard event')
      return  // Background functions don't need to return anything
    }

    const listAfter  = action.data?.listAfter?.id
    const listBefore = action.data?.listBefore?.id
    const card       = action.data?.card

    if (!card || listBefore === listAfter) {
      console.log('⏭️  Skipping - no card or no list change')
      return
    }

    // Determine event type based on target list
    const LIST_IDS = {
      readyToBuild:    process.env.TRELLO_LIST_READY_TO_BUILD!,
      readyToPublish:  process.env.TRELLO_LIST_READY_TO_PUBLISH!,
    }

    let eventType: 'ready-to-build' | 'ready-to-publish' | null = null
    if (listAfter === LIST_IDS.readyToBuild) {
      eventType = 'ready-to-build'
    } else if (listAfter === LIST_IDS.readyToPublish) {
      eventType = 'ready-to-publish'
    }

    if (!eventType) {
      console.log('⏭️  Skipping - not a tracked list')
      return
    }

    console.log(`\n🔄 Background processing started for card: ${card.id}, event: ${eventType}`)

    await handleCardMoved(card.id, eventType)

    console.log(`✅ Background processing completed for card: ${card.id}`)

    // Background functions don't need to return anything
    // Client gets automatic 202 response
  } catch (err: any) {
    console.error('❌ Background processing failed:', err)
    // Still don't need to return anything - just log the error
  }
}
