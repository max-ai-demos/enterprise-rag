const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8001'

export async function agentFetch(path: string, init?: RequestInit) {
  const url = `${AGENT_URL}${path}`
  const res = await fetch(url, init)
  return res
}
