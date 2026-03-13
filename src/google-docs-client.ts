/**
 * Extract Google Docs ID from various URL formats
 */
export function extractGoogleDocId(url: string): string | null {
  const patterns = [
    /\/document\/d\/([a-zA-Z0-9-_]+)/,
    /id=([a-zA-Z0-9-_]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }

  return null
}

/**
 * Fetch Google Docs content as plain text via the export API
 * No authentication required for publicly accessible docs
 */
export async function fetchGoogleDocContent(docId: string): Promise<string> {
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`

  console.log(`      📄 Fetching Google Doc: ${docId}`)

  const response = await fetch(exportUrl)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Google Doc (${response.status}): ${response.statusText}. ` +
      `Make sure the document is publicly accessible (Share > Anyone with the link can view)`
    )
  }

  const content = await response.text()
  console.log(`      ✅ Fetched ${content.length} characters from Google Doc`)

  return content
}

/**
 * Extract all Google Docs links from text
 */
export function extractGoogleDocLinks(text: string): string[] {
  const pattern = /https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9-_]+(?:\/[^\s]*)?/g
  const matches = text.match(pattern) || []
  return [...new Set(matches)] // Remove duplicates
}
