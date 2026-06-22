'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { useAuth } from '@/contexts/AuthContext'
import { MYPOS_TABS } from '@/components/Layout/SectionTabs'

// MyPos hub — sends the user to the first MyPos group they can access.
export default function MyPosIndex() {
  const { user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    const first = MYPOS_TABS.find((t) => t.roles.includes(user?.role || ''))
    router.replace(first?.href || '/dashboard')
  }, [user, router])

  return (
    <AppShell>
      <div className="py-16 text-center text-gray-400">Opening MyPos…</div>
    </AppShell>
  )
}
