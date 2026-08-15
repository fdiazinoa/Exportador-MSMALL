import { KeyRound, LoaderCircle, X } from 'lucide-react'
import { inputBaseClassName } from '../config/FormField'

export default function PasswordConfirmModal({ actionLabel, password, loading, error, onPasswordChange, onCancel, onConfirm }) {
  const submit = event => {
    event.preventDefault()
    onConfirm()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/50 px-4" role="dialog" aria-modal="true" aria-labelledby="service-confirm-title">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><KeyRound className="h-5 w-5" /></div>
          <button type="button" onClick={onCancel} disabled={loading} aria-label="Cerrar" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <h2 id="service-confirm-title" className="mt-4 text-xl font-semibold text-gray-950">Confirmar acción del servicio</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">Ingresa nuevamente la clave administrativa para <strong>{actionLabel.toLowerCase()}</strong>.</p>
        <label className="mt-5 block text-sm font-semibold text-gray-700">
          Clave administrativa
          <input type="password" autoComplete="current-password" required autoFocus maxLength="256" className={`${inputBaseClassName} mt-2`} value={password} onChange={event => onPasswordChange(event.target.value)} />
        </label>
        {error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={loading || !password} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300">
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Confirmar
          </button>
        </div>
      </form>
    </div>
  )
}
