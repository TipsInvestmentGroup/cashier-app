'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'

export default function ForgotPasswordPage() {
  const { request } = useApi()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
      setSent(true)
      setPreviewUrl(res.previewUrl || null)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
            <div className="text-5xl mb-3">🔑</div>
            <h1 className="text-2xl font-bold">Forgot Password</h1>
            <p className="text-indigo-200 text-sm mt-1">We&apos;ll email you a reset link</p>
          </div>

          <div className="p-8">
            {sent ? (
              <div className="text-center space-y-4">
                <div className="text-4xl">📬</div>
                <p className="text-gray-700 font-medium">
                  If <span className="font-semibold">{email}</span> is registered, a reset link is on its way. Check your inbox (and spam folder).
                </p>
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-sm font-semibold text-indigo-600 hover:text-indigo-700 underline"
                  >
                    Dev mode: preview the email →
                  </a>
                )}
                <Link href="/login" className="block mt-4 text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                  ← Back to Sign In
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:outline-none text-lg transition"
                    placeholder="you@tips.co.tz"
                    required
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-lg font-bold rounded-xl hover:opacity-90 transition disabled:opacity-60 shadow-lg"
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>

                <Link href="/login" className="block text-center text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                  ← Back to Sign In
                </Link>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
