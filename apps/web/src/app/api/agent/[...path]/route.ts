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

  const body = req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined

  const agentRes = await fetch(agentUrl, {
    method: req.method,
    headers,
    body,
    // @ts-expect-error duplex is not in the standard RequestInit type but needed for streaming
    duplex: 'half',
  })

  return new NextResponse(agentRes.body, {
    status: agentRes.status,
    headers: agentRes.headers,
  })
}

export const GET = proxy
export const POST = proxy
export const DELETE = proxy
