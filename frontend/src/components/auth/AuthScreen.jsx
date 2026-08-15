import { useState } from 'react'
import { KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'
import { inputBaseClassName } from '../config/FormField'

export default function AuthScreen({ status, loading, error, onSubmit }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const setup = status && !status.configured
  const unavailable = setup && !status.setupAllowed

  const submit = event => {
    event.preventDefault()
    if (setup && password !== confirmation) return
    onSubmit(password).then(success => {
      if (success) {
        setPassword('')
        setConfirmation('')
      }
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.14),transparent_65%)]" />
      <section className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-7 shadow-xl shadow-blue-950/5">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          {setup ? <ShieldCheck className="h-6 w-6" /> : <KeyRound className="h-6 w-6" />}
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-gray-950">
          {setup ? 'Proteger el Exportador' : 'Acceso administrativo'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          {setup
            ? 'Crea la clave que protegerá conexiones, jobs, consultas, logs y controles del servicio.'
            : 'Ingresa la clave administrativa para abrir la configuración de MsExportador.'}
        </p>

        {unavailable ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            La configuración inicial debe realizarse directamente en este servidor usando <strong>http://127.0.0.1:3000</strong>.
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <label className="block text-sm font-semibold text-gray-700">
              Clave administrativa
              <input
                type="password"
                autoComplete={setup ? 'new-password' : 'current-password'}
                minLength={status?.minimumPasswordLength || 12}
                maxLength="256"
                required
                autoFocus
                className={`${inputBaseClassName} mt-2`}
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            </label>
            {setup ? (
              <label className="block text-sm font-semibold text-gray-700">
                Confirmar clave
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={status?.minimumPasswordLength || 12}
                  maxLength="256"
                  required
                  className={`${inputBaseClassName} mt-2`}
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                />
                {confirmation && password !== confirmation ? <span className="mt-2 block text-xs text-red-600">Las claves no coinciden.</span> : null}
              </label>
            ) : null}
            {setup ? <p className="text-xs leading-5 text-gray-500">Mínimo {status?.minimumPasswordLength || 12} caracteres. No se guarda una copia recuperable de la clave.</p> : null}
            {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <button
              type="submit"
              disabled={loading || (setup && password !== confirmation)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {loading ? 'Validando…' : setup ? 'Crear clave y continuar' : 'Ingresar'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
