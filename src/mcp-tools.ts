import { getFileContent, listDirectory as ghListDirectory } from './github-client'

/**
 * MCP-style tools for Claude to explore the GitHub repository
 * These tools allow Claude to read files, search, and understand the codebase
 */

export interface MCPTool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

export const MCP_TOOLS: MCPTool[] = [
  {
    name: 'read_file',
    description: 'Read a file from the GitHub repository. Use this to examine existing code, components, or documentation.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to repo root (e.g., "src/components/Hero.tsx")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files in a directory to understand the codebase structure.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path (e.g., "src/components" or "src/pages")',
        },
      },
      required: ['path'],
    },
  },
]

/**
 * Execute an MCP tool call
 */
export async function executeMCPTool(
  toolName: string,
  args: Record<string, any>
): Promise<string> {
  console.log(`         🔧 Tool: ${toolName}(${JSON.stringify(args)})`)

  switch (toolName) {
    case 'read_file':
      return await readFile(args.path)

    case 'list_directory':
      return await listDirectory(args.path)

    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

async function readFile(path: string): Promise<string> {
  try {
    const { content } = await getFileContent(path)
    console.log(`            ✅ Read ${path} (${content.length} chars)`)
    return content
  } catch (err: any) {
    const error = `File not found: ${path}`
    console.log(`            ❌ ${error}`)
    return error
  }
}

async function listDirectory(path: string): Promise<string> {
  try {
    const files = await ghListDirectory(path)
    console.log(`            ✅ Listed ${path}: ${files.length} files`)
    return JSON.stringify(files, null, 2)
  } catch (err: any) {
    const error = `Directory not found: ${path}`
    console.log(`            ❌ ${error}`)
    return error
  }
}
