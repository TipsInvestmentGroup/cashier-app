'use client'
import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'

function ResetPasswordForm() {
  const { request } = useApi()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) return toast.error('Password must be at least 6 characters')
    if (password !== confirm) return toast.error('Passwords do not match')
    setLoading(true)
    try {
      await request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword: password }) })
      setDone(true)
      toast.success('Password reset! You can sign in now.')
      setTimeout(() => router.push('/login'), 1500)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <p className="text-gray-700 font-medium">This reset link is missing its token. Please request a new one.</p>
        <Link href="/forgot-password" className="block text-sm font-semibold text-indigo-600 hover:text-indigo-700">
          ← Request a new link
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="text-center space-y-4">
        <div className="text-4xl">✅</div>
        <p className="text-gray-700 font-medium">Your password has been reset. Redirecting to Sign In...</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">New Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:outline-none text-lg transition"
          placeholder="••••••••"
          minLength={6}
          required
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Confirm New Password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:outline-none text-lg transition"
          placeholder="••••••••"
          minLength={6}
          required
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-lg font-bold rounded-xl hover:opacity-90 transition disabled:opacity-60 shadow-lg"
      >
        {loading ? 'Resetting...' : 'Reset Password'}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
            <div className="text-5xl mb-3">🔒</div>
            <h1 className="text-2xl font-bold">Reset Password</h1>
            <p className="text-indigo-200 text-sm mt-1">Choose a new password below</p>
          </div>
          <div className="p-8">
            <Suspense fallback={<div className="text-center text-gray-400 py-8">Loading...</div>}>
              <ResetPasswordForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}
