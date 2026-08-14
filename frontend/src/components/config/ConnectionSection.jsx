import { createElement } from 'react'

export default function ConnectionSection({
  icon,
  title,
  description,
  actions = null,
  isEmpty = false,
  emptyMessage = 'No hay conexiones configuradas.',
  children,
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl border border-gray-200 bg-white p-2.5 shadow-sm">
            {createElement(icon, { className: 'h-5 w-5 text-gray-700' })}
          </div>
          <div>
            <h2 className="text-lg font-medium text-gray-900">{title}</h2>
            {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
          </div>
        </div>

        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      <div className="space-y-4">
        {isEmpty ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white/70 px-4 py-6 text-sm text-gray-500">
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
