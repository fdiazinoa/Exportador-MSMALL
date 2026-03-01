import { cn } from '../../lib/cn'

export const inputBaseClassName =
  'block w-full rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm transition outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10'

export const checkboxBaseClassName =
  'h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-4 focus:ring-blue-500/10'

export default function FormField({ label, className, children, hint }) {
  return (
    <label className={cn('col-span-12', className)}>
      <span className="mb-2 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint ? <span className="mt-2 block text-xs text-gray-500">{hint}</span> : null}
    </label>
  )
}
