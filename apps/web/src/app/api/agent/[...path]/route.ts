import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8001'

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path } = await params
  const agentPath = '/' + path.join('/')
  const url = new URL(req.url)
  const agentUrl = `${AGENT_URL}${agentPath}${url.search}`

  const headers = new Headers(req.headers)
  headers.set('x-user-id', session.user_id)
  headers.delete('host')
  headers.delete('expect') // undici (Node.js fetch) doesn't support Expect: 100-continue

  const body = req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined

  try {
    // @ts-expect-error duplex is required for streaming request bodies in Node.js fetch
    const agentRes = await fetch(agentUrl, { method: req.method, headers, body, duplex: 'half' })
    // Strip hop-by-hop headers illegal in HTTP/2 (transfer-encoding, connection, keep-alive)
    const resHeaders = new Headers(agentRes.headers)
    resHeaders.delete('transfer-encoding')
    resHeaders.delete('connection')
    resHeaders.delete('keep-alive')
    return new NextResponse(agentRes.body, { status: agentRes.status, headers: resHeaders })
  } catch (err) {
    console.error('[proxy] fetch error:', err)
    return NextResponse.json({ error: 'Proxy error' }, { status: 500 })
  }
}

export const GET = proxy
export const POST = proxy
export const DELETE = proxy
