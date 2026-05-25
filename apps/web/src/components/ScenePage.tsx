'use client'
import { useRouter } from 'next/navigation'

interface Highlight { icon: string; label: string }

interface ScenePageProps {
  title: string
  subtitle: string
  pains: string[]
  solutions: string[]
  highlights: Highlight[]
}

export function ScenePage({ title, subtitle, pains, solutions, highlights }: ScenePageProps) {
  const router = useRouter()
  return (
    <div className="w-full overflow-y-auto bg-slate-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <p className="text-slate-500 mt-1 text-sm">{subtitle}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center text-sm">🔴</div>
              <span className="font-semibold text-sm text-slate-800">企业痛点</span>
            </div>
            <ul className="space-y-2.5">
              {pains.map((p, i) => (
                <li key={i} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                  <span className="text-xs text-slate-500 leading-relaxed">{p}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center text-sm">✅</div>
              <span className="font-semibold text-sm text-slate-800">AI 解决方案</span>
            </div>
            <ul className="space-y-2.5">
              {solutions.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                  <span className="text-xs text-slate-500 leading-relaxed">{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-sm">⭐</div>
              <span className="font-semibold text-sm text-slate-800">功能亮点</span>
            </div>
            <div className="grid grid-cols-2 gap-2 flex-1">
              {highlights.map((h, i) => (
                <div key={i} className="bg-slate-50 rounded-lg p-2.5 flex items-center gap-2">
                  <span className="text-base">{h.icon}</span>
                  <span className="text-xs text-slate-600 font-medium">{h.label}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => router.push('/demo')}
              className="mt-4 w-full bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-lg shadow-[0_2px_8px_rgba(37,99,235,0.25)] hover:bg-blue-700 transition-colors"
            >
              立即体验 Demo →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
