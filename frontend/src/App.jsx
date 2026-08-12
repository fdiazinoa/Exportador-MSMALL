import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import {
  Activity,
  Database,
  Download,
  FileText,
  ListChecks,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  UploadCloud,
} from 'lucide-react'
import ConfigLayout from './components/config/ConfigLayout'
import ConnectionCard from './components/config/ConnectionCard'
import ConnectionSection from './components/config/ConnectionSection'
import FormField, { checkboxBaseClassName, inputBaseClassName } from './components/config/FormField'
import SecretField from './components/config/SecretField'
import ToastMessage from './components/config/ToastMessage'
import { cn } from './lib/cn'

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000')
const emptyLogs = { entries: [], exists: false, fileName: '' }

function errorMessage(error) {
  return error.response?.data?.error || error.message || 'Error inesperado'
}

function App() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('configuration')
  const [toast, setToast] = useState(null)
  const [health, setHealth] = useState(null)
  const [testing, setTesting] = useState({})
  const [running, setRunning] = useState({})
  const [logs, setLogs] = useState(emptyLogs)
  const [logType, setLogType] = useState('combined')
  const [logLevel, setLogLevel] = useState('all')
  const [logSearch, setLogSearch] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)

  const notify = useCallback((type, title, message = '') => {
    setToast({ type, title, message })
    window.setTimeout(() => setToast(null), 4500)
  }, [])

  useEffect(() => {
    Promise.all([
      axios.get(`${API_URL}/api/config`),
      axios.get(`${API_URL}/api/health`).catch(() => ({ data: null })),
    ])
      .then(([configResponse, healthResponse]) => {
        setConfig(configResponse.data)
        setHealth(healthResponse.data)
      })
      .catch(error => notify('error', 'No se pudo cargar la configuración', errorMessage(error)))
      .finally(() => setLoading(false))
  }, [notify])

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const response = await axios.get(`${API_URL}/api/logs/${logType}`, {
        params: { lines: 500, level: logLevel, search: logSearch },
      })
      setLogs(response.data)
    } catch (error) {
      notify('error', 'No se pudieron cargar los logs', errorMessage(error))
    } finally {
      setLogsLoading(false)
    }
  }, [logLevel, logSearch, logType, notify])

  useEffect(() => {
    if (activeTab === 'logs') fetchLogs()
  }, [activeTab, fetchLogs])

  const saveConfig = async ({ silent = false } = {}) => {
    setSaving(true)
    try {
      await axios.post(`${API_URL}/api/config`, config)
      if (!silent) notify('success', 'Configuración guardada', 'Los cambios ya están disponibles para el Exportador.')
      return true
    } catch (error) {
      notify('error', 'No se pudo guardar', errorMessage(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  const updateDatabase = (key, updater) => {
    setConfig(current => ({
      ...current,
      databases: {
        ...current.databases,
        [key]: updater(current.databases[key]),
      },
    }))
  }

  const updateDbConfig = (key, field, value) => {
    updateDatabase(key, database => ({
      ...database,
      config: { ...database.config, [field]: value },
    }))
  }

  const updateDbOption = (key, field, value) => {
    updateDatabase(key, database => ({
      ...database,
      config: {
        ...database.config,
        options: { ...(database.config.options || {}), [field]: value },
      },
    }))
  }

  const updateFtp = (key, field, value) => {
    setConfig(current => ({
      ...current,
      ftpServers: {
        ...current.ftpServers,
        [key]: { ...current.ftpServers[key], [field]: value },
      },
    }))
  }

  const updateJob = (index, field, value) => {
    setConfig(current => ({
      ...current,
      jobs: current.jobs.map((job, jobIndex) => jobIndex === index ? { ...job, [field]: value } : job),
    }))
  }

  const testConnection = async (kind, key) => {
    const statusKey = `${kind}:${key}`
    setTesting(current => ({ ...current, [statusKey]: true }))
    try {
      const payload = kind === 'db' ? { connectionName: key } : { serverName: key }
      const response = await axios.post(`${API_URL}/api/test/${kind}`, payload)
      setTesting(current => ({ ...current, [statusKey]: false, [`${statusKey}:status`]: { type: 'success', message: response.data.message } }))
    } catch (error) {
      setTesting(current => ({ ...current, [statusKey]: false, [`${statusKey}:status`]: { type: 'error', message: errorMessage(error) } }))
    }
  }

  const addJob = () => {
    const sourceConnection = Object.keys(config.databases || {})[0] || ''
    setConfig(current => ({
      ...current,
      jobs: [...(current.jobs || []), {
        name: `Nuevo Job ${(current.jobs || []).length + 1}`,
        sourceConnection,
        query: 'SELECT * FROM Tabla',
        mapping: {},
        format: 'csv',
        destination: '',
        schedule: '0 * * * *',
      }],
    }))
  }

  const removeJob = index => {
    setConfig(current => ({ ...current, jobs: current.jobs.filter((_, jobIndex) => jobIndex !== index) }))
  }

  const fetchColumns = async index => {
    const job = config.jobs[index]
    try {
      const response = await axios.post(`${API_URL}/api/schema`, {
        connectionName: job.sourceConnection,
        query: job.query,
      })
      const mapping = { ...(job.mapping || {}) }
      response.data.columns.forEach(column => { if (!mapping[column]) mapping[column] = column })
      updateJob(index, 'mapping', mapping)
      notify('success', 'Columnas cargadas', `${response.data.columns.length} columnas detectadas.`)
    } catch (error) {
      notify('error', 'No se pudieron obtener las columnas', errorMessage(error))
    }
  }

  const runJob = async (job, index) => {
    if (!job.name) return notify('error', 'El Job necesita un nombre')
    setRunning(current => ({ ...current, [index]: true }))
    try {
      const saved = await saveConfig({ silent: true })
      if (!saved) return
      const response = await axios.post(`${API_URL}/api/jobs/${encodeURIComponent(job.name)}/run`)
      notify('success', 'Job ejecutado', response.data.message || job.name)
    } catch (error) {
      notify('error', 'Falló la ejecución', errorMessage(error))
    } finally {
      setRunning(current => ({ ...current, [index]: false }))
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600">
        <LoaderCircle className="mr-3 h-5 w-5 animate-spin" />
        Cargando Exportador V16...
      </div>
    )
  }

  if (!config) {
    return <div className="p-10 text-center text-red-700">No fue posible cargar la configuración.</div>
  }

  const databases = Object.entries(config.databases || {})
  const ftpServers = Object.entries(config.ftpServers || {})
  const jobs = config.jobs || []

  return (
    <ConfigLayout onSave={() => saveConfig()} saving={saving} saveDisabled={!config}>
      <ToastMessage toast={toast} />

      <div className="mb-8 flex flex-col gap-4 rounded-xl border border-gray-200 bg-white/90 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Server className="h-5 w-5" /></div>
          <div>
            <p className="text-sm font-semibold text-gray-950">Exportador V{health?.version || '16.0'}</p>
            <p className="text-xs text-gray-500">Edición {health?.edition || 'Standard'} · {health?.ok ? 'Servicio disponible' : 'Estado no disponible'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
          <span className={cn('h-2.5 w-2.5 rounded-full', health?.ok ? 'bg-emerald-500' : 'bg-gray-300')} />
          {health?.ok ? 'Operativo' : 'Sin conexión'}
        </div>
      </div>

      <div className="mb-8 inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('configuration')}
          className={cn('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition', activeTab === 'configuration' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50')}
        >
          <Activity className="h-4 w-4" /> Configuración
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('logs')}
          className={cn('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition', activeTab === 'logs' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50')}
        >
          <FileText className="h-4 w-4" /> Logs
        </button>
      </div>

      {activeTab === 'configuration' ? (
        <div className="space-y-10">
          <ConnectionSection icon={Database} title="Conexiones de base de datos" description="Orígenes usados por los jobs de exportación." isEmpty={!databases.length} emptyMessage="No hay conexiones configuradas.">
            {databases.map(([key, database]) => {
              const db = database.config || {}
              const statusKey = `db:${key}`
              return (
                <ConnectionCard
                  key={key}
                  name={key}
                  typeLabel={database.provider}
                  tone={database.provider === 'sqlserver' ? 'blue' : 'orange'}
                  onTest={() => testConnection('db', key)}
                  testing={testing[statusKey]}
                  status={testing[`${statusKey}:status`]}
                >
                  {database.provider === 'sqlserver' ? (
                    <>
                      <FormField label="Servidor" className="md:col-span-6">
                        <input className={inputBaseClassName} value={db.server || ''} onChange={event => updateDbConfig(key, 'server', event.target.value)} placeholder="SERVIDOR\\INSTANCIA o servidor,1433" />
                      </FormField>
                      <FormField label="Base de datos" className="md:col-span-6">
                        <input className={inputBaseClassName} value={db.database || ''} onChange={event => updateDbConfig(key, 'database', event.target.value)} />
                      </FormField>
                      <FormField label="Perfil de compatibilidad" className="md:col-span-6" hint="Define la versión TDS usada por esta conexión.">
                        <select className={inputBaseClassName} value={db.compatibilityProfile || 'modern'} onChange={event => updateDbConfig(key, 'compatibilityProfile', event.target.value)}>
                          <option value="sqlserver2008">SQL Server 2008 · TDS 7.3A</option>
                          <option value="sqlserver2008r2">SQL Server 2008 R2 · TDS 7.3B</option>
                          <option value="modern">SQL Server 2012+ · TDS 7.4</option>
                        </select>
                      </FormField>
                      <FormField label="Seguridad" className="md:col-span-6">
                        <select className={inputBaseClassName} value={db.securityMode || 'modern'} onChange={event => updateDbConfig(key, 'securityMode', event.target.value)}>
                          <option value="modern">TLS moderno</option>
                          <option value="legacy_tls1">TLS 1.0 heredado</option>
                          <option value="unencrypted">Sin cifrado</option>
                        </select>
                      </FormField>
                      <FormField label="Usuario" className="md:col-span-6">
                        <input className={inputBaseClassName} value={db.user || ''} onChange={event => updateDbConfig(key, 'user', event.target.value)} />
                      </FormField>
                      <SecretField label="Contraseña" className="md:col-span-6" value={db.password || ''} onChange={value => updateDbConfig(key, 'password', value)} />
                      <FormField label="Timeout de conexión (ms)" className="md:col-span-4">
                        <input type="number" min="1000" className={inputBaseClassName} value={db.connectionTimeout || 30000} onChange={event => updateDbConfig(key, 'connectionTimeout', Number(event.target.value))} />
                      </FormField>
                      <FormField label="Timeout de consulta (ms)" className="md:col-span-4">
                        <input type="number" min="1000" className={inputBaseClassName} value={db.requestTimeout || 120000} onChange={event => updateDbConfig(key, 'requestTimeout', Number(event.target.value))} />
                      </FormField>
                      <FormField label="Timeout de cancelación (ms)" className="md:col-span-4">
                        <input type="number" min="1000" className={inputBaseClassName} value={db.options?.cancelTimeout || 15000} onChange={event => updateDbOption(key, 'cancelTimeout', Number(event.target.value))} />
                      </FormField>
                    </>
                  ) : (
                    <>
                      <FormField label="Host" className="md:col-span-6">
                        <input className={inputBaseClassName} value={db.host || ''} onChange={event => updateDbConfig(key, 'host', event.target.value)} />
                      </FormField>
                      <FormField label="Base de datos" className="md:col-span-6">
                        <input className={inputBaseClassName} value={db.database || ''} onChange={event => updateDbConfig(key, 'database', event.target.value)} />
                      </FormField>
                      <FormField label="Usuario" className="md:col-span-6">
                        <input className={inputBaseClassName} value={db.user || ''} onChange={event => updateDbConfig(key, 'user', event.target.value)} />
                      </FormField>
                      <SecretField label="Contraseña" className="md:col-span-6" value={db.password || ''} onChange={value => updateDbConfig(key, 'password', value)} />
                    </>
                  )}
                </ConnectionCard>
              )
            })}
          </ConnectionSection>

          <ConnectionSection icon={UploadCloud} title="Servidores FTP" description="Destinos FTP, FTPS y SFTP de las exportaciones." isEmpty={!ftpServers.length} emptyMessage="No hay servidores FTP configurados.">
            {ftpServers.map(([key, ftp]) => {
              const statusKey = `ftp:${key}`
              return (
                <ConnectionCard key={key} name={key} typeLabel={ftp.protocol || (ftp.secure ? 'ftps' : 'ftp')} tone="emerald" onTest={() => testConnection('ftp', key)} testing={testing[statusKey]} status={testing[`${statusKey}:status`]}>
                  <FormField label="Protocolo" className="md:col-span-4">
                    <select className={inputBaseClassName} value={ftp.protocol || 'ftp'} onChange={event => updateFtp(key, 'protocol', event.target.value)}>
                      <option value="ftp">FTP</option><option value="ftps">FTPS</option><option value="sftp">SFTP</option>
                    </select>
                  </FormField>
                  <FormField label="Host" className="md:col-span-5">
                    <input className={inputBaseClassName} value={ftp.host || ''} onChange={event => updateFtp(key, 'host', event.target.value)} />
                  </FormField>
                  <FormField label="Puerto" className="md:col-span-3">
                    <input type="number" className={inputBaseClassName} value={ftp.port || (ftp.protocol === 'sftp' ? 22 : 21)} onChange={event => updateFtp(key, 'port', Number(event.target.value))} />
                  </FormField>
                  <FormField label="Usuario" className="md:col-span-6">
                    <input className={inputBaseClassName} value={ftp.user || ''} onChange={event => updateFtp(key, 'user', event.target.value)} />
                  </FormField>
                  <SecretField label="Contraseña" className="md:col-span-6" value={ftp.password || ''} onChange={value => updateFtp(key, 'password', value)} />
                  <label className="col-span-12 flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input type="checkbox" className={checkboxBaseClassName} checked={Boolean(ftp.secure)} onChange={event => updateFtp(key, 'secure', event.target.checked)} disabled={ftp.protocol === 'sftp'} />
                    Usar conexión segura FTPS
                  </label>
                </ConnectionCard>
              )
            })}
          </ConnectionSection>

          <ConnectionSection
            icon={ListChecks}
            title="Jobs de exportación"
            description="Consultas, destinos y programación de cada proceso."
            isEmpty={!jobs.length}
            emptyMessage="No hay jobs configurados."
            actions={<button type="button" onClick={addJob} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="h-4 w-4" /> Nuevo Job</button>}
          >
            {jobs.map((job, index) => (
              <ConnectionCard key={`${job.name}-${index}`} name={job.name || `Job ${index + 1}`} typeLabel={job.type || job.format || 'job'} tone="violet" onDelete={() => removeJob(index)} deleteTitle="Eliminar Job">
                <FormField label="Nombre" className="md:col-span-6">
                  <input className={inputBaseClassName} value={job.name || ''} onChange={event => updateJob(index, 'name', event.target.value)} />
                </FormField>
                <FormField label="Conexión de origen" className="md:col-span-6">
                  <select className={inputBaseClassName} value={job.sourceConnection || ''} onChange={event => updateJob(index, 'sourceConnection', event.target.value)}>
                    <option value="">Seleccionar...</option>
                    {databases.map(([name]) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </FormField>
                <FormField label="Consulta SQL" className="md:col-span-12">
                  <textarea rows="5" className={cn(inputBaseClassName, 'font-mono')} value={job.query || ''} onChange={event => updateJob(index, 'query', event.target.value)} />
                </FormField>
                <div className="col-span-12 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-800">Mapeo de campos</p>
                    <button type="button" onClick={() => fetchColumns(index)} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">Obtener columnas</button>
                  </div>
                  {Object.keys(job.mapping || {}).length ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {Object.entries(job.mapping).map(([source, target]) => (
                        <label key={source} className="flex items-center gap-2 text-xs text-gray-600">
                          <span className="w-2/5 truncate font-mono" title={source}>{source}</span>
                          <span>→</span>
                          <input className={cn(inputBaseClassName, 'py-1.5')} value={target} onChange={event => updateJob(index, 'mapping', { ...job.mapping, [source]: event.target.value })} />
                        </label>
                      ))}
                    </div>
                  ) : <p className="text-xs text-gray-500">Obtén las columnas para crear el mapeo visual.</p>}
                </div>
                <FormField label="Formato" className="md:col-span-4">
                  <select className={inputBaseClassName} value={job.format || 'csv'} onChange={event => updateJob(index, 'format', event.target.value)}>
                    <option value="csv">CSV</option><option value="json">JSON</option><option value="txt">TXT</option>
                  </select>
                </FormField>
                <FormField label="Destino FTP o ruta local" className="md:col-span-4">
                  <input className={inputBaseClassName} list={`ftp-options-${index}`} value={job.destination || ''} onChange={event => updateJob(index, 'destination', event.target.value)} placeholder="ftp_main o C:\\Exports" />
                  <datalist id={`ftp-options-${index}`}>{ftpServers.map(([name]) => <option key={name} value={name} />)}</datalist>
                </FormField>
                <FormField label="Programación Cron" className="md:col-span-4" hint="minuto hora día mes semana">
                  <input className={cn(inputBaseClassName, 'font-mono')} value={job.schedule || ''} onChange={event => updateJob(index, 'schedule', event.target.value)} placeholder="0 * * * *" />
                </FormField>
                <div className="col-span-12 flex justify-end">
                  <button type="button" onClick={() => runJob(job, index)} disabled={running[index]} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                    {running[index] ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {running[index] ? 'Ejecutando...' : 'Ejecutar ahora'}
                  </button>
                </div>
              </ConnectionCard>
            ))}
          </ConnectionSection>
        </div>
      ) : (
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-950">Log de eventos</h2>
              <p className="mt-1 text-sm text-gray-500">Diagnóstico del Exportador sin acceder manualmente al servidor.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={fetchLogs} disabled={logsLoading} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                <RefreshCw className={cn('h-4 w-4', logsLoading && 'animate-spin')} /> Actualizar
              </button>
              <a href={`${API_URL}/api/logs/${logType}/download`} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                <Download className="h-4 w-4" /> Descargar
              </a>
            </div>
          </div>
          <div className="my-5 grid gap-3 md:grid-cols-12">
            <FormField label="Archivo" className="md:col-span-3">
              <select className={inputBaseClassName} value={logType} onChange={event => setLogType(event.target.value)}>
                <option value="combined">Todos los eventos</option><option value="error">Solo errores</option>
              </select>
            </FormField>
            <FormField label="Nivel" className="md:col-span-3">
              <select className={inputBaseClassName} value={logLevel} onChange={event => setLogLevel(event.target.value)}>
                <option value="all">Todos</option><option value="error">Error</option><option value="warn">Advertencia</option><option value="info">Información</option>
              </select>
            </FormField>
            <FormField label="Buscar" className="md:col-span-6">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <input className={cn(inputBaseClassName, 'pl-9')} value={logSearch} onChange={event => setLogSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') fetchLogs() }} placeholder="Timeout, CASA VIRGINIA, job..." />
              </div>
            </FormField>
          </div>
          <div className="max-h-[36rem] overflow-auto rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-200 shadow-inner">
            {logsLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-400"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Cargando eventos...</div>
            ) : logs.entries?.length ? logs.entries.map((entry, index) => (
              <div key={`${entry.timestamp}-${index}`} className="grid gap-2 border-b border-slate-800 py-2 last:border-0 md:grid-cols-[170px_70px_1fr]">
                <span className="text-slate-500">{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}</span>
                <span className={cn('font-bold uppercase', entry.level === 'error' ? 'text-red-400' : entry.level === 'warn' ? 'text-amber-400' : 'text-sky-400')}>{entry.level}</span>
                <span className="break-words">{entry.message}</span>
              </div>
            )) : (
              <div className="py-16 text-center text-slate-500">{logs.exists ? 'No hay eventos con estos filtros.' : 'El archivo de log todavía no contiene eventos.'}</div>
            )}
          </div>
        </section>
      )}
    </ConfigLayout>
  )
}

export default App
