import { NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../../../../package.json') as { version: string }

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'enterprise-rag-web',
    version: pkg.version,
  })
}
