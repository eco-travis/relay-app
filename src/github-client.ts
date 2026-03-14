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
  const data = await gh(`/repos/${getOwner()}/${getRepo()}/git/ref/heads/master`)
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
  const data = await gh(`/repos/${getOwner()}/${getRepo()}/contents/${filePath}`)
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
  const refData    = await gh(`/repos/${getOwner()}/${getRepo()}/git/ref/heads/${branchName}`)
  const commitSha  = refData.object.sha
  const commitData = await gh(`/repos/${getOwner()}/${getRepo()}/git/commits/${commitSha}`)
  const treeSha    = commitData.tree.sha

  const tree = files.map(f => ({
    path:    f.path,
    mode:    '100644',
    type:    'blob',
    content: f.content,
  }))

  const newTree = await gh(`/repos/${getOwner()}/${getRepo()}/git/trees`, {
    method: 'POST',
    body:   JSON.stringify({ base_tree: treeSha, tree }),
  })

  const newCommit = await gh(`/repos/${getOwner()}/${getRepo()}/git/commits`, {
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
  })
}

export async function getPreviewUrl(prNumber: number): Promise<string | null> {
  const data     = await gh(`/repos/${getOwner()}/${getRepo()}/pulls/${prNumber}`)
  const sha      = data.head.sha
  const statuses = await gh(`/repos/${getOwner()}/${getRepo()}/statuses/${sha}`)
  const netlify  = statuses.find(
    (s: { context: string; target_url: string }) =>
      s.context?.includes('netlify') && s.target_url
  )
  return netlify?.target_url ?? null
}

export async function getPRForBranch(branchName: string): Promise<number | null> {
  const data = await gh(
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
    const data = await gh(`/repos/${getOwner()}/${getRepo()}/contents/${path}`)
    if (Array.isArray(data)) {
      return data.map((item: any) => item.name)
    }
    return []
  } catch {
    return []
  }
}
