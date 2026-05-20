import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getUserByUsername } from '@/lib/db'
import { signToken, cookieOptions, COOKIE_NAME } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()
  if (!username || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
  }
  const user = await getUserByUsername(username)
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  const token = await signToken({ user_id: user.id, username: user.username, role: user.role })
  const res = NextResponse.json({ username: user.username, role: user.role })
  res.cookies.set(COOKIE_NAME, token, cookieOptions())
  return res
}
