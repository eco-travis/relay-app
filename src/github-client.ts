const BASE  = 'https://api.github.com'
const OWNER = process.env.GITHUB_OWNER!
const REPO  = process.env.GITHUB_REPO!
const TOKEN = process.env.GITHUB_TOKEN!

const headers = () => ({
  Authorization:  `Bearer ${TOKEN}`,
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
  const data = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/master`)
  return data.object.sha
}

export async function createBranch(branchName: string, fromSha: string): Promise<void> {
  await gh(`/repos/${OWNER}/${REPO}/git/refs`, {
    method: 'POST',
    body:   JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
  })
}

export async function getFileContent(
  filePath: string
): Promise<{ content: string; sha: string }> {
  const data = await gh(`/repos/${OWNER}/${REPO}/contents/${filePath}`)
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
  const refData    = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${branchName}`)
  const commitSha  = refData.object.sha
  const commitData = await gh(`/repos/${OWNER}/${REPO}/git/commits/${commitSha}`)
  const treeSha    = commitData.tree.sha

  const tree = files.map(f => ({
    path:    f.path,
    mode:    '100644',
    type:    'blob',
    content: f.content,
  }))

  const newTree = await gh(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body:   JSON.stringify({ base_tree: treeSha, tree }),
  })

  const newCommit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body:   JSON.stringify({ message, tree: newTree.sha, parents: [commitSha] }),
  })

  await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${branchName}`, {
    method: 'PATCH',
    body:   JSON.stringify({ sha: newCommit.sha }),
  })
}

export async function openPR(
  branchName: string,
  title: string,
  body: string
): Promise<{ number: number; html_url: string }> {
  return gh(`/repos/${OWNER}/${REPO}/pulls`, {
    method: 'POST',
    body:   JSON.stringify({ title, body, head: branchName, base: 'master' }),
  })
}

export async function getPreviewUrl(prNumber: number): Promise<string | null> {
  const data     = await gh(`/repos/${OWNER}/${REPO}/pulls/${prNumber}`)
  const sha      = data.head.sha
  const statuses = await gh(`/repos/${OWNER}/${REPO}/statuses/${sha}`)
  const netlify  = statuses.find(
    (s: { context: string; target_url: string }) =>
      s.context?.includes('netlify') && s.target_url
  )
  return netlify?.target_url ?? null
}

export async function getPRForBranch(branchName: string): Promise<number | null> {
  const data = await gh(
    `/repos/${OWNER}/${REPO}/pulls?head=${OWNER}:${branchName}&state=open`
  )
  return data[0]?.number ?? null
}

export async function mergePR(prNumber: number, message: string): Promise<void> {
  await gh(`/repos/${OWNER}/${REPO}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    body:   JSON.stringify({ merge_method: 'squash', commit_message: message }),
  })
}
