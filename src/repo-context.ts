import { getFileContent } from './github-client'

/**
 * Fetch related files from the repo to give Claude better context
 */
export async function getRepoContext(): Promise<Record<string, string>> {
  const contextFiles: Record<string, string> = {}

  // Key files that provide codebase context
  const filesToFetch = [
    'CLAUDE.md',                    // Project conventions
    'src/components/SEO.tsx',       // SEO component pattern
    'src/components/Layout.tsx',    // Layout wrapper
    'src/components/Hero.tsx',      // Hero component
    'src/components/Section.tsx',   // Section component
    'src/pages/index.tsx',          // Homepage example
  ]

  console.log(`      📚 Fetching ${filesToFetch.length} context files from repo...`)

  for (const filePath of filesToFetch) {
    try {
      const { content } = await getFileContent(filePath)
      contextFiles[filePath] = content
      console.log(`         ✅ ${filePath}`)
    } catch (err) {
      console.log(`         ⚠️  ${filePath} (not found, skipping)`)
    }
  }

  return contextFiles
}

/**
 * Fetch similar pages to use as examples
 */
export async function getSimilarPages(targetPath: string): Promise<Record<string, string>> {
  const pages: Record<string, string> = {}

  // Common pages that serve as good examples
  const examplePages = [
    'src/pages/index.tsx',
    'src/pages/about.tsx',
    'src/pages/invisalign.tsx',
    'src/pages/braces.tsx',
  ]

  console.log(`      📄 Fetching example pages for reference...`)

  for (const pagePath of examplePages) {
    // Skip if it's the target file (we already have it)
    if (pagePath === targetPath) continue

    try {
      const { content } = await getFileContent(pagePath)
      pages[pagePath] = content
      console.log(`         ✅ ${pagePath}`)
    } catch (err) {
      // Silently skip if file doesn't exist
    }
  }

  return pages
}
