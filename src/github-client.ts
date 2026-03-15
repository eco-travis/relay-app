const BASE = 'https://api.github.com'

// Lazy getters to ensure env vars are loaded
const getOwner = () => {
  if (!process.env.GITHUB_OWNER) throw new Error('GITHUB_OWNER not set')
  return process.env.GITHUB_OWNER
}

const getRepo = () => {
  if (!process.env.GITHUB_REPO) throw new Error('GITHUB_REPO not set')
  return process.env.GITHUB_REPO
}

const getToken = () => {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not set')
  return process.env.GITHUB_TOKEN
}

const headers = () => ({
  Authorization:  `Bearer ${getToken()}`,
  Accept:         'application/vnd.github+json',
  'Content-Type': 'application/json',
})

async function gh(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(), ...(options?.headers as Record<string, string> ?? {}) },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${body}`)
  }
  return res.json()
}

export async function getMasterSha(): Promise<string> {
  const data: any = await gh(`/repos/${getOwner()}/${getRepo()}/git/ref/heads/master`)
  return data.object.sha
}

export async function createBranch(branchName: string, fromSha: string): Promise<void> {
  await gh(`/repos/${getOwner()}/${getRepo()}/git/refs`, {
    method: 'POST',
    body:   JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
  })
}

export async function getFileContent(
  filePath: string
): Promise<{ content: string; sha: string }> {
  const data: any = await gh(`/repos/${getOwner()}/${getRepo()}/contents/${filePath}`)
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha:     data.sha,
  }
}

export interface FileChange {
  path:    string
  content: string
}

export async function commitFiles(
  branchName: string,
  files: FileChange[],
  message: string
): Promise<void> {
  const refData: any    = await gh(`/repos/${getOwner()}/${getRepo()}/git/ref/heads/${branchName}`)
  const commitSha  = refData.object.sha
  const commitData: any = await gh(`/repos/${getOwner()}/${getRepo()}/git/commits/${commitSha}`)
  const treeSha    = commitData.tree.sha

  const tree = await Promise.all(files.map(async f => {
    // For image files (in public/images/), create a blob with base64 encoding
    if (f.path.startsWith('public/images/')) {
      const blob: any = await gh(`/repos/${getOwner()}/${getRepo()}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({
          content: f.content,
          encoding: 'base64',
        }),
      })

      return {
        path: f.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      }
    }

    // For text files, use content directly
    return {
      path: f.path,
      mode: '100644',
      type: 'blob',
      content: f.content,
    }
  }))

  const newTree: any = await gh(`/repos/${getOwner()}/${getRepo()}/git/trees`, {
    method: 'POST',
    body:   JSON.stringify({ base_tree: treeSha, tree }),
  })

  const newCommit: any = await gh(`/repos/${getOwner()}/${getRepo()}/git/commits`, {
    method: 'POST',
    body:   JSON.stringify({ message, tree: newTree.sha, parents: [commitSha] }),
  })

  await gh(`/repos/${getOwner()}/${getRepo()}/git/refs/heads/${branchName}`, {
    method: 'PATCH',
    body:   JSON.stringify({ sha: newCommit.sha }),
  })
}

export async function openPR(
  branchName: string,
  title: string,
  body: string
): Promise<{ number: number; html_url: string }> {
  return gh(`/repos/${getOwner()}/${getRepo()}/pulls`, {
    method: 'POST',
    body:   JSON.stringify({ title, body, head: branchName, base: 'master' }),
  }) as Promise<{ number: number; html_url: string }>
}

export async function getPreviewUrl(prNumber: number): Promise<string | null> {
  const data: any = await gh(`/repos/${getOwner()}/${getRepo()}/pulls/${prNumber}`)
  const sha = data.head.sha

  console.log(`      Checking for preview URL for SHA: ${sha.substring(0, 7)}`)

  // First try commit statuses (Netlify uses this for deploy previews)
  const statuses = (await gh(`/repos/${getOwner()}/${getRepo()}/commits/${sha}/statuses`)) as any[]

  console.log(`      Found ${statuses.length} commit status(es)`)

  for (const status of statuses) {
    console.log(`        - Context: ${status.context}, State: ${status.state}, URL: ${status.target_url || 'none'}`)

    // Look for Netlify deploy preview status
    if (status.context?.includes('netlify') && status.state === 'success' && status.target_url) {
      // The target_url might be the deploy details page, check the description for the actual preview URL
      const description = status.description || ''

      // Try to extract preview URL from description or use target_url
      const previewUrlMatch = description.match(/https:\/\/deploy-preview-\d+--[^.]+\.netlify\.app/)
      if (previewUrlMatch) {
        console.log(`      ✅ Found preview URL in description: ${previewUrlMatch[0]}`)
        return previewUrlMatch[0]
      }

      // If target_url looks like a deploy preview, use it
      if (status.target_url.includes('deploy-preview-')) {
        console.log(`      ✅ Found preview URL in target_url: ${status.target_url}`)
        return status.target_url
      }
    }
  }

  // Fall back to deployments API (in case Netlify is configured to use it)
  console.log(`      Checking deployments API...`)
  const deployments = (await gh(`/repos/${getOwner()}/${getRepo()}/deployments?sha=${sha}`)) as any[]

  console.log(`      Found ${deployments.length} deployment(s)`)

  for (const deployment of deployments) {
    const depStatuses = (await gh(
      `/repos/${getOwner()}/${getRepo()}/deployments/${deployment.id}/statuses`
    )) as any[]

    const successful = depStatuses.find((s: any) => s.state === 'success')
    if (successful?.environment_url) {
      console.log(`      ✅ Found preview URL in deployment: ${successful.environment_url}`)
      return successful.environment_url
    }
  }

  console.log(`      ❌ No preview URL found`)
  return null
}

export async function getPRForBranch(branchName: string): Promise<number | null> {
  const data: any = await gh(
    `/repos/${getOwner()}/${getRepo()}/pulls?head=${getOwner()}:${branchName}&state=open`
  )
  return data[0]?.number ?? null
}

export async function mergePR(prNumber: number, message: string): Promise<void> {
  await gh(`/repos/${getOwner()}/${getRepo()}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    body:   JSON.stringify({ merge_method: 'squash', commit_message: message }),
  })
}

export async function listDirectory(path: string): Promise<string[]> {
  try {
    const data: any = await gh(`/repos/${getOwner()}/${getRepo()}/contents/${path}`)
    if (Array.isArray(data)) {
      return data.map((item: any) => item.name)
    }
    return []
  } catch {
    return []
  }
}
