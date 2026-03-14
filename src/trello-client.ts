const BASE = 'https://api.trello.com/1'

const auth = () => ({
  key:   process.env.TRELLO_API_KEY!,
  token: process.env.TRELLO_TOKEN!,
})

function qs(params: Record<string, string>) {
  return new URLSearchParams(params).toString()
}

export interface TrelloCard {
  id:   string
  name: string   // card title  → e.g. "Update /invisalign SEO"
  desc: string   // card body   → the SEO prompt
  attachments: Array<{
    id:       string
    name:     string
    url:      string
    mimeType: string
  }>
  labels: Array<{ name: string; color: string }>
}

export async function getCard(cardId: string): Promise<TrelloCard> {
  const res = await fetch(
    `${BASE}/cards/${cardId}?attachments=true&${qs(auth())}`
  )
  if (!res.ok) throw new Error(`Trello getCard failed: ${res.statusText}`)
  return res.json() as Promise<TrelloCard>
}

export async function getAttachmentContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Authorization: `OAuth oauth_consumer_key="${auth().key}", oauth_token="${auth().token}"`,
    },
  })
  if (!res.ok) throw new Error(`Attachment fetch failed: ${res.statusText}`)
  return res.text()
}

export async function postComment(cardId: string, text: string): Promise<void> {
  await fetch(`${BASE}/cards/${cardId}/actions/comments?${qs(auth())}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text }),
  })
}

export async function moveCardToList(cardId: string, listId: string): Promise<void> {
  await fetch(`${BASE}/cards/${cardId}?${qs(auth())}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ idList: listId }),
  })
}
