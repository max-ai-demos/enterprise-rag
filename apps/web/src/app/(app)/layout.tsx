import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { NavBar } from '@/components/NavBar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <NavBar username={session.username} />
      <main className="flex-1 flex overflow-hidden min-h-0">{children}</main>
    </div>
  )
}
