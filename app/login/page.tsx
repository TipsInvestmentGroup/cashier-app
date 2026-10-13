'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth, type CompanyChoice } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, selectCompany } = useAuth()
  // Set when this login belongs to several companies and must pick one (second sign-in step).
  const [choice, setChoice] = useState<{ selectToken: string; companies: CompanyChoice[] } | null>(null)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await login(email, password)
      if (result.needsCompany) { setChoice({ selectToken: result.selectToken, companies: result.companies }); return }
      router.push('/dashboard')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const pickCompany = async (company: CompanyChoice) => {
    if (!choice) return
    setLoading(true)
    try {
      await selectCompany(choice.selectToken, company.id)
      router.push('/dashboard')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not sign in to that company')
      setChoice(null) // the selection token may have expired: start again
    } finally {
      setLoading(false)
    }
  }

  if (choice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
            <h1 className="text-2xl font-bold">Choose a company</h1>
            <p className="text-indigo-200 text-sm mt-1">Your account has access to more than one</p>
          </div>
          <div className="p-6 space-y-3">
            {choice.companies.map((c) => (
              <button key={c.id} disabled={loading} onClick={() => pickCompany(c)}
                className="w-full text-left px-5 py-4 rounded-xl border-2 border-gray-200 hover:border-indigo-500 hover:bg-indigo-50 transition disabled:opacity-60">
                <span className="block font-bold text-gray-900">{c.name}</span>
                {c.slug && <span className="block text-xs text-gray-400 font-mono">{c.slug}</span>}
              </button>
            ))}
            <button onClick={() => setChoice(null)} className="w-full text-sm font-semibold text-indigo-600 hover:text-indigo-700 pt-2">Back</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
            <div className="text-5xl mb-3">🍹</div>
            <h1 className="text-2xl font-bold">Cashier Management</h1>
            <p className="text-indigo-200 text-sm mt-1">Sales & Receivables System</p>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:outline-none text-lg transition"
                placeholder="you@tips.co.tz"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:outline-none text-lg transition"
                placeholder="••••••••"
                required
              />
              <div className="text-right mt-2">
                <Link href="/forgot-password" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                  Forgot password?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-lg font-bold rounded-xl hover:opacity-90 transition disabled:opacity-60 shadow-lg"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="border-t border-gray-100 p-4 text-center">
            <Link href="/mypos/staff-login" className="text-sm font-semibold text-gray-400 hover:text-indigo-600">
              ← Back to service login
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
