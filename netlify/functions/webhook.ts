import serverless from 'serverless-http'
import { app } from '../../src/index'

// Wrap the Express app for Netlify's serverless environment
export const handler = serverless(app)
