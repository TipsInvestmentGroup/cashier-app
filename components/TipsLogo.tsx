'use client'
import { useState } from 'react'

/**
 * Tips brand logo. Uses /tips-logo.png if it's present in /public; otherwise
 * falls back to a styled "tips" wordmark so branding always shows.
 * Drop the official logo at: cashier-app/public/tips-logo.png
 */
export function TipsLogo({ height = 56, className = '' }: { height?: number; className?: string }) {
  const [ok, setOk] = useState(true)
  if (ok) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/tips-logo.png" alt="Tips" style={{ height }} className={`mx-auto object-contain ${className}`} onError={() => setOk(false)} />
    )
  }
  return (
    <div className={`flex flex-col items-center leading-none ${className}`}>
      <span style={{ fontFamily: '"Segoe Script", "Brush Script MT", cursive', fontSize: height * 0.8 }} className="text-white italic">tips</span>
      <span className="text-white/80 tracking-[0.3em] text-[10px] mt-1">— EST. 2017 —</span>
    </div>
  )
}
