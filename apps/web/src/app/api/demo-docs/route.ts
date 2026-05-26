import { NextResponse } from 'next/server'

const AGENT = process.env.AGENT_URL ?? 'http://localhost:8001'

export async function GET() {
  try {
    const res = await fetch(`${AGENT}/documents/demo`, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json([])
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json([])
  }
}
