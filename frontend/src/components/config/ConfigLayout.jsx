import { LoaderCircle, Save } from 'lucide-react'

export default function ConfigLayout({
  children,
  onSave,
  saving = false,
  saveDisabled = false,
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-gray-950">
              Configuración MsExportador
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Administra conexiones de base de datos, FTP y web services desde una sola vista.
            </p>
          </div>

          <button
            type="button"
            onClick={onSave}
            disabled={saveDisabled || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </header>

      <main className="relative overflow-hidden bg-gray-50">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.12),transparent_65%)]" />
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  )
}
