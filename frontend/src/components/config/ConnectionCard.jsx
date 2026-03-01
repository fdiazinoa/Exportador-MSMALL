import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react'
import { cn } from '../../lib/cn'

const toneClassNames = {
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  orange: 'border-amber-200 bg-amber-50 text-amber-700',
  slate: 'border-slate-200 bg-slate-100 text-slate-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  violet: 'border-violet-200 bg-violet-50 text-violet-700',
  sky: 'border-sky-200 bg-sky-50 text-sky-700',
}

const statusClassNames = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  error: 'border-red-200 bg-red-50 text-red-700',
}

export default function ConnectionCard({
  name,
  typeLabel,
  tone = 'slate',
  onTest,
  testing = false,
  status,
  children,
}) {
  const statusTone = status?.type ? statusClassNames[status.type] : null
  const StatusIcon = status?.type === 'error' ? AlertCircle : CheckCircle2

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-950">{name}</h3>
          <p className="mt-1 text-sm text-gray-500">
            Connection key preserved for existing jobs and service references.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]',
              toneClassNames[tone] ?? toneClassNames.slate,
            )}
          >
            {typeLabel}
          </span>

          <button
            type="button"
            onClick={onTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {testing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-12 gap-4">{children}</div>

      {status?.message ? (
        <div
          className={cn(
            'mt-4 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
            statusTone,
          )}
        >
          <StatusIcon className="h-4 w-4" />
          <span>{status.message}</span>
        </div>
      ) : null}
    </article>
  )
}
