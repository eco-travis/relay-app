import {
  getCard,
  getAttachmentContent,
  postComment,
  moveCardToList,
} from './trello-client'

import {
  getMasterSha,
  createBranch,
  getFileContent,
  commitFiles,
  openPR,
  getPreviewUrl,
  getPRForBranch,
  mergePR,
} from './github-client'

import { generateChanges } from './claude-client'
import {
  extractGoogleDocLinks,
  extractGoogleDocId,
  fetchGoogleDocContent,
} from './google-docs-client'
import { getRepoContext, getSimilarPages } from './repo-context'

const LIST_IDS = {
  readyToPreview: process.env.TRELLO_LIST_READY_TO_PREVIEW!,
  readyToPublish: process.env.TRELLO_LIST_READY_TO_PUBLISH!,
  done:           process.env.TRELLO_LIST_DONE!,
}

// Parse page path from card title e.g. "Update /invisalign SEO" → "src/pages/invisalign.tsx"
// Returns null if no page path found in title
function parsePagePath(cardTitle: string): string | null {
  const match = cardTitle.match(/\/([a-z0-9-/]+)/i)
  if (!match) return null
  const slug = match[1].replace(/\/$/, '') || 'index'
  return `src/pages/${slug}.tsx`
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50)
}

export async function handleCardMoved(
  cardId: string,
  event: 'ready-to-build' | 'ready-to-publish'
) {
  if (event === 'ready-to-build') {
    await runBuildPipeline(cardId)
  } else if (event === 'ready-to-publish') {
    await runPublishPipeline(cardId)
  }
}

// ─── Stage 1: Build ──────────────────────────────────────────────────────────

async function runBuildPipeline(cardId: string) {
  let card

  try {
    console.log(`\n╔═══════════════════════════════════════════════════════════════`)
    console.log(`║ 🏗️  BUILD PIPELINE STARTED`)
    console.log(`╚═══════════════════════════════════════════════════════════════`)

    console.log(`\n[1/2] 📥 Fetching card details...`)
    card = await getCard(cardId)
    console.log(`      Card: "${card.name}"`)
    console.log(`      Description: ${card.desc.substring(0, 100)}${card.desc.length > 100 ? '...' : ''}`)

    // Check if this is a rebuild (existing PR) or initial build
    console.log(`\n[2/2] 🔍 Checking for existing PR...`)
    const branchName = `seo/${slugify(card.name)}-${cardId.slice(-6)}`
    const existingPR = await getPRForBranch(branchName)

    if (existingPR) {
      console.log(`      🔄 Found existing PR #${existingPR} - running rebuild`)
      await runRebuild(cardId, card, branchName, existingPR)
    } else {
      console.log(`      🆕 No existing PR - running initial build`)
      await runInitialBuild(cardId, card, branchName)
    }

  } catch (err: any) {
    console.error('\n╔═══════════════════════════════════════════════════════════════')
    console.error('║ ❌ BUILD PIPELINE FAILED')
    console.error('╚═══════════════════════════════════════════════════════════════')
    console.error('Error:', err)
    if (card) {
      await postComment(cardId, `❌ Build failed: ${err.message}`)
    }
    console.error('')
  }
}

// ─── Initial Build ───────────────────────────────────────────────────────────

async function runInitialBuild(cardId: string, card: any, branchName: string) {
  try {
    await postComment(cardId, '⚙️ Build started — generating SEO changes...')

    // Check for Google Docs links in description
    console.log(`\n[1/9] 🔍 Checking for Google Docs links...`)
    const googleDocLinks = extractGoogleDocLinks(card.desc)
    console.log(`      Found ${googleDocLinks.length} Google Doc link(s)`)

    // Try to parse page path from card title
    console.log(`\n[2/9] 🔍 Parsing page path from card title...`)
    const pagePath = parsePagePath(card.name)
    if (pagePath) {
      console.log(`      Target file: ${pagePath}`)
    } else {
      console.log(`      ℹ️  No page path in title — will let Claude determine target from brief`)
    }

    // Fetch current file from master (may not exist for new pages)
    console.log(`\n[3/9] 📂 Fetching existing file from GitHub...`)
    const existingFiles: Record<string, string> = {}
    if (pagePath) {
      try {
        const { content } = await getFileContent(pagePath)
        existingFiles[pagePath] = content
        console.log(`      ✅ Found existing file (${content.length} chars)`)
      } catch {
        console.log(`      ℹ️  File not found in master — will create new page`)
      }
    } else {
      console.log(`      ⏭️  Skipping (no specific target file)`)
    }

    // Pull down Google Docs content
    const attachments: string[] = []
    if (googleDocLinks.length > 0) {
      console.log(`\n[4/9] 📄 Fetching Google Docs content...`)
      for (const link of googleDocLinks) {
        const docId = extractGoogleDocId(link)
        if (docId) {
          try {
            const content = await fetchGoogleDocContent(docId)
            attachments.push(`[Google Doc: ${link}]\n${content}`)
          } catch (err: any) {
            console.warn(`      ⚠️  Could not fetch Google Doc: ${err.message}`)
          }
        }
      }
    } else {
      console.log(`\n[4/9] 📄 No Google Docs to fetch`)
    }

    // Pull down any text attachments (keyword briefs, etc.)
    console.log(`\n[5/9] 📎 Checking for Trello attachments...`)
    const textAttachments = (card.attachments ?? []).filter(
      (att: any) => att.mimeType?.startsWith('text') || att.name?.endsWith('.md')
    )
    console.log(`      Found ${textAttachments.length} text attachment(s)`)

    for (const att of textAttachments) {
      try {
        console.log(`      - Downloading: ${att.name}`)
        attachments.push(`[${att.name}]\n` + await getAttachmentContent(att.url))
      } catch {
        console.warn(`      ⚠️  Could not fetch attachment: ${att.name}`)
      }
    }

    // Generate changes with Claude
    console.log(`\n[6/9] 🤖 Calling Claude to generate changes...`)
    const generation = await generateChanges({
      prompt:        card.desc,
      pageTarget:    pagePath || 'To be determined from brief',
      existingFiles,
      attachments,
    })
    console.log(`      ✅ Generation complete`)
    console.log(`      Files modified: ${Object.keys(generation.files).length}`)

    // Create branch and commit
    console.log(`\n[7/9] 🌿 Creating Git branch: ${branchName}`)
    const masterSha  = await getMasterSha()
    console.log(`      Base SHA: ${masterSha.substring(0, 7)}`)

    await createBranch(branchName, masterSha)
    console.log(`      ✅ Branch created`)

    console.log(`\n[8/9] 💾 Committing files to branch...`)
    await commitFiles(
      branchName,
      generation.files,
      `seo: ${card.name}\n\nGenerated from Trello card ${cardId}`
    )
    console.log(`      ✅ Files committed`)

    // Open PR
    console.log(`\n[9/9] 📬 Opening Pull Request...`)
    const prBody = `
## SEO Change Request
**Trello card:** https://trello.com/c/${cardId}

**Brief:**
${card.desc}

## What Changed
${generation.summary}

---
*Generated by Greenlit. Review the preview and move to "Ready to Publish" when approved.*
    `.trim()

    const pr = await openPR(branchName, `SEO: ${card.name}`, prBody)
    console.log(`      ✅ PR opened: #${pr.number}`)
    console.log(`      URL: ${pr.html_url}`)

    await postComment(cardId, `✅ PR opened: ${pr.html_url}\n\n⏳ Waiting for Netlify preview...`)

    // Poll for Netlify preview URL (max ~5 min)
    console.log(`\n⏳ Waiting for Netlify preview URL...`)
    const previewUrl = await waitForPreview(pr.number)

    if (previewUrl) {
      console.log(`      ✅ Preview ready: ${previewUrl}`)
    } else {
      console.log(`      ⚠️  Preview URL not available after polling`)
    }

    const comment = previewUrl
      ? `🔍 **Preview ready:** ${previewUrl}\n\nPR: ${pr.html_url}\n\n✅ Move to **Ready to Publish** to go live\n🔄 Need changes? Update the card description and drag back to **Ready to Build**`
      : `🔍 PR ready: ${pr.html_url}\n\n_(Preview URL not yet available — check Netlify dashboard)_\n\n✅ Move to **Ready to Publish** to go live`

    await postComment(cardId, comment)

    console.log(`\n📌 Moving card to "Ready to Preview" list...`)
    await moveCardToList(cardId, LIST_IDS.readyToPreview)

    console.log(`\n╔═══════════════════════════════════════════════════════════════`)
    console.log(`║ ✅ INITIAL BUILD COMPLETED SUCCESSFULLY`)
    console.log(`╚═══════════════════════════════════════════════════════════════\n`)

  } catch (err: any) {
    console.error('\n╔═══════════════════════════════════════════════════════════════')
    console.error('║ ❌ INITIAL BUILD FAILED')
    console.error('╚═══════════════════════════════════════════════════════════════')
    console.error('Error:', err)
    throw err
  }
}

// ─── Rebuild ─────────────────────────────────────────────────────────────────

async function runRebuild(cardId: string, card: any, branchName: string, prNumber: number) {
  try {
    await postComment(cardId, '🔄 Rebuild started — updating preview with new changes...')

    console.log(`\n[1/6] 🔍 Checking for Google Docs links...`)
    const googleDocLinks = extractGoogleDocLinks(card.desc)
    console.log(`      Found ${googleDocLinks.length} Google Doc link(s)`)

    console.log(`\n[2/6] 🔍 Parsing page path from card title...`)
    const pagePath = parsePagePath(card.name)
    if (pagePath) {
      console.log(`      Target file: ${pagePath}`)
    } else {
      console.log(`      ℹ️  No page path in title — will let Claude determine target from brief`)
    }

    // Fetch current file from branch (not master - get the existing work)
    console.log(`\n[3/6] 📂 Fetching existing files from branch...`)
    const existingFiles: Record<string, string> = {}
    if (pagePath) {
      try {
        const { content } = await getFileContent(pagePath)
        existingFiles[pagePath] = content
        console.log(`      ✅ Found existing file (${content.length} chars)`)
      } catch {
        console.log(`      ℹ️  File not found — will create new page`)
      }
    }

    // Pull down Google Docs content
    const attachments: string[] = []
    if (googleDocLinks.length > 0) {
      console.log(`\n[4/6] 📄 Fetching Google Docs content...`)
      for (const link of googleDocLinks) {
        const docId = extractGoogleDocId(link)
        if (docId) {
          try {
            const content = await fetchGoogleDocContent(docId)
            attachments.push(`[Google Doc: ${link}]\n${content}`)
          } catch (err: any) {
            console.warn(`      ⚠️  Could not fetch Google Doc: ${err.message}`)
          }
        }
      }
    }

    // Pull down text attachments
    const textAttachments = (card.attachments ?? []).filter(
      (att: any) => att.mimeType?.startsWith('text') || att.name?.endsWith('.md')
    )
    for (const att of textAttachments) {
      try {
        attachments.push(`[${att.name}]\n` + await getAttachmentContent(att.url))
      } catch {
        console.warn(`      ⚠️  Could not fetch attachment: ${att.name}`)
      }
    }

    // Generate updated changes with Claude
    console.log(`\n[5/6] 🤖 Calling Claude to regenerate changes...`)
    const generation = await generateChanges({
      prompt:        card.desc,
      pageTarget:    pagePath || 'To be determined from brief',
      existingFiles,
      attachments,
    })
    console.log(`      ✅ Generation complete`)
    console.log(`      Files modified: ${Object.keys(generation.files).length}`)

    // Force-push updated files to existing branch
    console.log(`\n[6/6] 💾 Force-pushing updated files to branch...`)
    await commitFiles(
      branchName,
      generation.files,
      `seo: ${card.name} (updated)\n\nRegenerated from Trello card ${cardId}`
    )
    console.log(`      ✅ Files committed (Netlify will auto-rebuild)`)

    // Wait for new Netlify preview
    console.log(`\n⏳ Waiting for updated Netlify preview URL...`)
    await new Promise(r => setTimeout(r, 10_000)) // Give Netlify a moment to start
    const previewUrl = await waitForPreview(prNumber)

    if (previewUrl) {
      console.log(`      ✅ Preview ready: ${previewUrl}`)
    }

    const comment = previewUrl
      ? `🔄 **Preview updated:** ${previewUrl}\n\nPR: https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/pull/${prNumber}\n\n✅ Move to **Ready to Publish** to go live\n🔄 Need more changes? Update the description and drag back to **Ready to Build**`
      : `🔄 **Preview rebuilding...** Check PR for status: https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/pull/${prNumber}`

    await postComment(cardId, comment)

    console.log(`\n📌 Moving card back to "Ready to Preview" list...`)
    await moveCardToList(cardId, LIST_IDS.readyToPreview)

    console.log(`\n╔═══════════════════════════════════════════════════════════════`)
    console.log(`║ ✅ REBUILD COMPLETED SUCCESSFULLY`)
    console.log(`╚═══════════════════════════════════════════════════════════════\n`)

  } catch (err: any) {
    console.error('\n╔═══════════════════════════════════════════════════════════════')
    console.error('║ ❌ REBUILD FAILED')
    console.error('╚═══════════════════════════════════════════════════════════════')
    console.error('Error:', err)
    throw err
  }
}

// ─── Stage 2: Publish & Merge ────────────────────────────────────────────────

async function runPublishPipeline(cardId: string) {
  let card

  try {
    console.log(`\n╔═══════════════════════════════════════════════════════════════`)
    console.log(`║ 🚀 PUBLISH PIPELINE STARTED`)
    console.log(`╚═══════════════════════════════════════════════════════════════`)

    console.log(`\n[1/4] 📥 Fetching card details...`)
    card = await getCard(cardId)
    console.log(`      Card: "${card.name}"`)

    await postComment(cardId, '🚀 Publishing — merging to master...')

    console.log(`\n[2/4] 🔍 Looking up PR for branch...`)
    const branchName = `seo/${slugify(card.name)}-${cardId.slice(-6)}`
    console.log(`      Branch: ${branchName}`)

    const prNumber = await getPRForBranch(branchName)

    if (!prNumber) {
      throw new Error(`No open PR found for branch: ${branchName}`)
    }

    console.log(`      ✅ Found PR #${prNumber}`)

    console.log(`\n[3/4] 🔀 Merging PR to master...`)
    await mergePR(prNumber, `seo: ${card.name} [published via Trello]`)
    console.log(`      ✅ PR merged successfully`)

    console.log(`\n[4/4] 📌 Moving card to "Done" list...`)
    await postComment(cardId, '✅ Merged to master — Netlify is deploying. Changes will be live shortly.')
    await moveCardToList(cardId, LIST_IDS.done)

    console.log(`\n╔═══════════════════════════════════════════════════════════════`)
    console.log(`║ ✅ PUBLISH PIPELINE COMPLETED SUCCESSFULLY`)
    console.log(`╚═══════════════════════════════════════════════════════════════\n`)

  } catch (err: any) {
    console.error('\n╔═══════════════════════════════════════════════════════════════')
    console.error('║ ❌ PUBLISH PIPELINE FAILED')
    console.error('╚═══════════════════════════════════════════════════════════════')
    console.error('Error:', err)
    if (card) {
      await postComment(cardId, `❌ Publish failed: ${err.message}`)
    }
    console.error('')
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForPreview(
  prNumber: number,
  maxAttempts = 20,
  intervalMs  = 15_000
): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const url = await getPreviewUrl(prNumber)
    if (url) return url
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return null
}
