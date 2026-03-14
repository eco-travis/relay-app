import Anthropic from '@anthropic-ai/sdk'
import { MCP_TOOLS, executeMCPTool } from './mcp-tools'

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
  prompt:         string
  pageTarget:     string
  existingFiles:  Record<string, string>
  attachments:    string[]
  repoPath?:      string  // Path to the repo for extended context
}

export interface GenerationOutput {
  files:   Array<{ path: string; content: string }>
  summary: string
}

const SYSTEM_PROMPT = `
You are an expert SEO engineer working on a Gatsby TypeScript/React site. Your job is to make
targeted, intelligent changes to page components based on SEO briefs.

IMPORTANT WORKFLOW:
1. Use read_file to examine 1-2 example pages (e.g., src/pages/index.tsx)
2. Study the patterns and structure
3. Generate the code changes
4. STOP using tools and return your JSON response

DO NOT exhaustively read every file - just enough to understand the patterns.
If a file doesn't exist, move on. Don't retry the same files multiple times.

SITE ARCHITECTURE:
- Pages: src/pages/*.tsx (Gatsby page components)
- Components: src/components/*.tsx (reusable UI components)
- Every page MUST export:
  1. Default export: The page component (uses Layout, Hero, etc.)
  2. Named export "Head": For meta tags using <SEO /> component

HEAD/SEO PATTERN (required for all pages):
export function Head() {
  return (
    <>
      <SEO
        title="Page Title | Islander Orthodontics"
        description="Meta description here"
        canonical="https://islanderortho.com/page-path"
      />
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage", // or LocalBusiness, etc.
          // ... schema markup
        })}
      </script>
    </>
  )
}

COMPONENT USAGE PATTERNS:
- Layout: Wrap entire page content
- Hero: Page header section
- Section: Content sections with optional background
- SectionTitle: Section headings
- Button: CTAs with variant/color props
- Study the EXISTING file to see exact prop usage!

RULES:
1. PRESERVE existing code structure, imports, and patterns
2. ONLY modify what the brief explicitly requests
3. Match the indentation and code style of the existing file
4. Include ALL necessary imports
5. For new pages: Copy structure from similar existing page
6. NEVER make assumptions - use what you see in the existing files
7. KEEP IT CONCISE: If creating a new page, use a simple structure - don't over-engineer

OUTPUT REQUIREMENTS:
- Return ONLY the JSON object, nothing else
- No explanations, no markdown, no preamble
- Start your response with { and end with }
- Format:
{
  "files": [
    { "path": "src/pages/example.tsx", "content": "...COMPLETE file content..." }
  ],
  "summary": "Brief description of changes made"
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

  console.log(`      🤖 Calling Claude with MCP tools enabled...`)
  const startTime = Date.now()

  const anthropic = getClient()

  // Multi-turn conversation with tool use
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ]

  let finalResponse: string = ''
  let toolUseCount = 0
  const MAX_TURNS = 15 // Allow more exploration but prevent infinite loops

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 16384, // Increased for large file generation
      system:     SYSTEM_PROMPT,
      messages,
      tools:      MCP_TOOLS as any,
      thinking: {
        type: 'enabled',
        budget_tokens: 4000,
      },
    })

    // Check if response was truncated
    if (response.stop_reason === 'max_tokens') {
      console.error(`      ⚠️  Response truncated at turn ${turn + 1} - hit max_tokens limit`)
      throw new Error(
        `Claude's response was truncated (hit ${response.usage.output_tokens} token limit). ` +
        `The generated file is too large. Try breaking the request into smaller changes.`
      )
    }

    // Check for tool use
    const toolUseBlocks = response.content.filter((block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use'
    )

    if (toolUseBlocks.length === 0) {
      // No more tools - get the final text response
      const textBlock = response.content.find((block): block is Anthropic.TextBlock =>
        block.type === 'text'
      )
      finalResponse = textBlock?.text || ''
      console.log(`      ✅ Claude finished after ${turn + 1} turn(s), ${toolUseCount} tool call(s)`)
      break
    }

    // Execute tools
    console.log(`      🔧 Claude is using ${toolUseBlocks.length} tool(s)...`)
    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const toolUse of toolUseBlocks) {
      toolUseCount++
      try {
        const result = await executeMCPTool(toolUse.name, toolUse.input as Record<string, any>)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        })
      } catch (err: any) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Error: ${err.message}`,
          is_error: true,
        })
      }
    }

    // Add assistant response and tool results to conversation
    messages.push(
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults }
    )
  }

  // If we hit MAX_TURNS, Claude never returned a final response
  if (!finalResponse) {
    throw new Error(
      `Claude exceeded maximum turns (${MAX_TURNS}) without generating a response. ` +
      `It may be stuck in an exploration loop. Consider simplifying the brief or providing more specific files.`
    )
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`      ⏱️  Completed in ${elapsed}s`)

  console.log(`      📦 Response size: ${finalResponse.length} chars`)

  // Extract JSON from response (Claude might include explanatory text)
  let jsonStr = finalResponse.trim()

  // Try to find JSON object in the response
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    jsonStr = jsonMatch[0]
  }

  try {
    const result = JSON.parse(jsonStr) as GenerationOutput
    console.log(`      ✅ Successfully parsed JSON response`)
    return result
  } catch (err) {
    console.error(`      ❌ Claude returned invalid JSON`)
    console.error(`      Attempted to parse: ${jsonStr.slice(0, 500)}`)
    console.error(`      Last 500 chars: ${jsonStr.slice(-500)}`)
    throw new Error(`Claude returned invalid JSON:\n${jsonStr.slice(0, 500)}`)
  }
}
