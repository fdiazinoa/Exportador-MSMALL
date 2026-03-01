import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '../../lib/cn'

const toastClassNames = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  error: 'border-red-200 bg-red-50 text-red-700',
}

export default function ToastMessage({ toast }) {
  if (!toast) return null

  const Icon = toast.type === 'error' ? AlertCircle : CheckCircle2

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[60] w-full max-w-sm">
      <div
        className={cn(
          'pointer-events-auto rounded-xl border px-4 py-3 shadow-lg backdrop-blur',
          toastClassNames[toast.type] ?? toastClassNames.success,
        )}
      >
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5" />
          <div>
            <p className="text-sm font-semibold">{toast.title}</p>
            {toast.message ? <p className="mt-1 text-sm">{toast.message}</p> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
