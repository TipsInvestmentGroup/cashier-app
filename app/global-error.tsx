'use client'
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error) }, [error])
  return (
    <html>
      <body style={{ fontFamily: 'Segoe UI, Arial, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', margin: 0 }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 420, textAlign: 'center', boxShadow: '0 1px 6px rgba(0,0,0,.1)' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h2 style={{ margin: '0 0 6px' }}>Something went wrong</h2>
          <p style={{ color: '#6b7280', fontSize: 14 }}>The error has been reported. Please try again.</p>
          <button onClick={() => reset()} style={{ marginTop: 16, padding: '10px 20px', background: '#4f46e5', color: '#fff', border: 0, borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>Try again</button>
        </div>
      </body>
    </html>
  )
}
