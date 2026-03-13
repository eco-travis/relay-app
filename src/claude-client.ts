import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set')
    }
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  }
  return client
}

export interface GenerationInput {
  prompt:        string
  pageTarget:    string
  existingFiles: Record<string, string>
  attachments:   string[]
}

export interface GenerationOutput {
  files:   Array<{ path: string; content: string }>
  summary: string
}

const SYSTEM_PROMPT = `
You are an SEO engineer working on a Gatsby site. Your job is to make targeted
changes to TypeScript/React page components based on SEO briefs.

SITE CONVENTIONS (read CLAUDE.md in the repo for full details):
- Pages live in src/pages/ as .tsx files
- Every page exports a Head component using Gatsby's Head API for meta tags:
    export function Head() {
      return <SEO title="..." description="..." canonical="..." />
    }
- The SEO component is imported from '../components/SEO'
- New pages must include a default export (the page component) and a Head export
- Use the existing page structure as a template — match indentation, imports, styling patterns
- GraphQL page queries use the useStaticQuery hook pattern already established in the codebase
- Schema markup (FAQ, LocalBusiness etc.) goes in a <script type="application/ld+json"> inside Head

RULES:
- Make the minimum change necessary to satisfy the brief
- Never change visual layout or component logic unless explicitly asked
- Always preserve existing content unless asked to replace it
- Return ONLY the files that need to change — don't return unchanged files
- If creating a new page, base it on the structure of a similar existing page

OUTPUT FORMAT:
Return a JSON object with this exact shape (no markdown fences, no preamble):
{
  "files": [
    { "path": "src/pages/invisalign.tsx", "content": "...full file content..." }
  ],
  "summary": "One paragraph describing exactly what changed and why"
}
`.trim()

export async function generateChanges(
  input: GenerationInput
): Promise<GenerationOutput> {
  console.log(`      📝 Preparing prompt for Claude...`)
  console.log(`         Target: ${input.pageTarget}`)
  console.log(`         Existing files: ${Object.keys(input.existingFiles).length}`)
  console.log(`         Attachments: ${input.attachments.length}`)

  const existingFilesBlock = Object.entries(input.existingFiles)
    .map(([path, content]) => `### ${path}\n\`\`\`tsx\n${content}\n\`\`\``)
    .join('\n\n')

  const attachmentsBlock = input.attachments.length
    ? `### SEO Supporting Documents\n${input.attachments.join('\n\n---\n\n')}`
    : ''

  const userMessage = `
## SEO Brief
${input.prompt}

## Target File
${input.pageTarget}

## Current File Content
${existingFilesBlock}

${attachmentsBlock}

Make the changes described in the brief. Return JSON only.
`.trim()

  console.log(`      🤖 Calling Claude API (model: claude-opus-4-5)...`)
  const startTime = Date.now()

  const anthropic = getClient()
  const response = await anthropic.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 4096,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userMessage }],
  })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`      ⏱️  Claude responded in ${elapsed}s`)

  const raw = response.content[0].type === 'text' ? response.content[0].text : ''

  console.log(`      📦 Response size: ${raw.length} chars`)

  try {
    const result = JSON.parse(raw) as GenerationOutput
    console.log(`      ✅ Successfully parsed JSON response`)
    return result
  } catch {
    console.error(`      ❌ Claude returned invalid JSON`)
    throw new Error(`Claude returned invalid JSON:\n${raw.slice(0, 500)}`)
  }
}
