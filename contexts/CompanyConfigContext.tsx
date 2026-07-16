'use client'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { DEFAULT_COMPANY_CONFIG, normalizeCompanyConfig, type CompanyConfig } from '@/lib/company-config-shared'
import { setClientCompanyConfig } from '@/lib/utils'

/**
 * Client-side company preferences. Fetched once per page load (the API result
 * is served from the server's in-process cache, so this is cheap) and pushed
 * into lib/utils' module-level currency settings so formatCurrency() and
 * friends work everywhere without threading config through props. Components
 * that render branding (sidebar logo/app name, VAT labels) read the reactive
 * value from useCompanyConfig() instead.
 *
 * Defaults are this deployment's live values, so the first paint is already
 * correct unless an Admin changed preferences away from the defaults.
 */
const CompanyConfigContext = createContext<{ config: CompanyConfig; reload: () => void }>({
  config: DEFAULT_COMPANY_CONFIG,
  reload: () => {},
})

export function CompanyConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<CompanyConfig>(DEFAULT_COMPANY_CONFIG)

  const reload = React.useCallback(() => {
    fetch('/api/company-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (!raw) return
        const cfg = normalizeCompanyConfig(raw)
        setConfig(cfg)
        setClientCompanyConfig(cfg)
      })
      .catch(() => { /* offline/startup — defaults stay in effect */ })
  }, [])

  useEffect(() => { reload() }, [reload])

  return <CompanyConfigContext.Provider value={{ config, reload }}>{children}</CompanyConfigContext.Provider>
}

export function useCompanyConfig() {
  return useContext(CompanyConfigContext)
}
