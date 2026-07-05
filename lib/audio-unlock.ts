import { useEffect, useRef } from 'react'

/**
 * Browsers block audio that isn't started inside a real user gesture — an
 * AudioContext created/resumed later from an async poll/timer callback
 * often stays silently muted even if .resume() "succeeds". This hook warms
 * up (creates + resumes) an AudioContext on the page's very first tap, so
 * by the time a later async notification needs to beep, the context is
 * already unlocked and audible.
 */
export function useUnlockedAudio(): React.RefObject<AudioContext | null> {
  const audioRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        audioRef.current ??= new Ctx()
        if (audioRef.current.state === 'suspended') audioRef.current.resume()
      } catch { /* audio unsupported/blocked — ignore */ }
    }
    document.addEventListener('pointerdown', unlock, { once: true })
    return () => document.removeEventListener('pointerdown', unlock)
  }, [])

  return audioRef
}
