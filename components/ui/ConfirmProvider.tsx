'use client'
import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

type Opts = { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }

const ConfirmCtx = createContext<(o: Opts) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

/** App-wide styled confirm dialog. Usage: const confirm = useConfirm();
 *  if (!(await confirm({ message, danger: true }))) return */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<Opts | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((o: Opts) => new Promise<boolean>((resolve) => {
    resolver.current = resolve
    setOpts(o)
  }), [])

  const done = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null) }

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!opts} onClose={() => done(false)} title={opts?.title || 'Please confirm'}>
        <p className="text-sm text-gray-600 whitespace-pre-line">{opts?.message}</p>
        <div className="flex gap-2 mt-5">
          <Button variant="outline" className="flex-1" onClick={() => done(false)}>{opts?.cancelLabel || 'Cancel'}</Button>
          <Button variant={opts?.danger ? 'destructive' : 'primary'} className="flex-1" onClick={() => done(true)}>{opts?.confirmLabel || 'Confirm'}</Button>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  )
}
