import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, signToken, cookieOptions, shouldRefreshToken, COOKIE_NAME } from '@/lib/auth'

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/health']

function buildLoginRedirect(loginUrl: string, originalUrl: string): string {
  if (loginUrl.startsWith('http')) {
    return `${loginUrl}?redirect=${encodeURIComponent(originalUrl)}`
  }
  return loginUrl
}

// Derive portal base URL from LOGIN_URL (strip /login suffix) or PORTAL_URL override.
// Zero-config: if LOGIN_URL=https://demo.luyaxiang.com/login, portal is https://demo.luyaxiang.com.
function portalUrl(): string {
  if (process.env.PORTAL_URL) return process.env.PORTAL_URL
  const u = process.env.LOGIN_URL ?? ''
  return u.startsWith('http') ? u.replace(/\/login(\?.*)?$/, '') : 'http://localhost:3002'
}

// In-process cache for app config from portal DB (TTL 5 min).
// In Next.js standalone, the process is persistent — the Map survives between requests.
const _cache = new Map<string, { cfg: DemoCfg | null; exp: number }>()

interface DemoCfg {
  status: 'active' | 'maintenance' | 'disabled'
  require_login: boolean
}

async function fetchDemoCfg(hostname: string): Promise<DemoCfg | null> {
  const hit = _cache.get(hostname)
  if (hit && Date.now() < hit.exp) return hit.cfg
  try {
    const res = await fetch(
      `${portalUrl()}/api/demo-apps/by-domain?domain=${encodeURIComponent(hostname)}`,
      { signal: AbortSignal.timeout(3000) }
    )
    const cfg: DemoCfg | null = res.ok ? await res.json() : null
    _cache.set(hostname, { cfg, exp: Date.now() + (res.ok ? 5 * 60_000 : 30_000) })
    return cfg
  } catch {
    _cache.set(hostname, { cfg: null, exp: Date.now() + 30_000 })
    return null
  }
}


// Reconstruct the public URL from forwarded headers so the ?redirect= param is correct.
function publicUrl(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.hostname
  const proto = req.headers.get('x-forwarded-proto') ?? (req.nextUrl.protocol.replace(':', ''))
  return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next()

  const loginUrl = process.env.LOGIN_URL ?? '/login'
  const hostname = req.headers.get('x-forwarded-host') ?? req.nextUrl.hostname

  // Check status and require_login from portal DB.
  // Fallback when portal is unreachable: treat as require_login=true (safe default).
  const cfg = await fetchDemoCfg(hostname)
  if (cfg?.status === 'disabled') {
    return new NextResponse('此应用已下线', {
      status: 410, headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  if (cfg?.status === 'maintenance') {
    return new NextResponse('此应用维护中，请稍后访问', {
      status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  if (cfg?.require_login === false) return NextResponse.next()

  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.redirect(buildLoginRedirect(loginUrl, publicUrl(req)))
  }
  const payload = await verifyToken(token)
  if (!payload) {
    const res = NextResponse.redirect(buildLoginRedirect(loginUrl, publicUrl(req)))
    res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
    return res
  }

  const res = NextResponse.next()
  if (shouldRefreshToken(payload)) {
    const newToken = await signToken({
      user_id:  payload.user_id,
      org_id:   payload.org_id,
      username: payload.username,
      role:     payload.role,
    })
    const opts = cookieOptions()
    res.cookies.set(COOKIE_NAME, newToken, opts)
    res.headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=${newToken}; Path=/; Max-Age=604800; Domain=.luyaxiang.com; Secure; HttpOnly; SameSite=Lax`
    )
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
