import serverless from 'serverless-http'
import { app } from '../../src/index'

// Wrap the Express app for Netlify's serverless environment
// Using background function to allow longer execution time (up to 15 minutes)
const wrappedHandler = serverless(app)

export const handler = async (event: any, context: any) => {
  // Set longer timeout for background processing
  context.callbackWaitsForEmptyEventLoop = false

  return await wrappedHandler(event, context)
}
