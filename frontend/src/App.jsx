import { useEffect, useState } from 'react'
import axios from 'axios'
import parser from 'cron-parser'
import {
  CheckCircle2,
  Cloud,
  Database,
  Globe,
  LoaderCircle,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import ConfigLayout from './components/config/ConfigLayout'
import ConnectionCard from './components/config/ConnectionCard'
import ConnectionSection from './components/config/ConnectionSection'
import FormField, {
  checkboxBaseClassName,
  inputBaseClassName,
} from './components/config/FormField'
import SecretField from './components/config/SecretField'
import ToastMessage from './components/config/ToastMessage'

const API_URL = import.meta.env.PROD ? '' : 'http://localhost:3000'

const TEST_CONFIG = {
  database: {
    endpoint: '/api/test/db',
    buildPayload: (name) => ({ connectionName: name }),
  },
  ftp: {
    endpoint: '/api/test/ftp',
    buildPayload: (name) => ({ serverName: name }),
  },
  webservice: {
    endpoint: '/api/test/webservice',
    buildPayload: (name) => ({ serverName: name }),
  },
}

const DB_BADGE_TONES = {
  sqlserver: 'blue',
  mysql: 'orange',
  postgres: 'sky',
}

const FTP_BADGE_TONES = {
  ftp: 'slate',
  ftps: 'emerald',
  sftp: 'violet',
}

const SCHEDULE_PRESETS = [
  { value: 'custom', label: 'Custom (Cron)', schedule: null },
  { value: 'hourly', label: 'Every Hour', schedule: '0 * * * *' },
  { value: 'every2hours', label: 'Every 2 Hours', schedule: '0 */2 * * *' },
  { value: 'every4hours', label: 'Every 4 Hours', schedule: '0 */4 * * *' },
  { value: 'every6hours', label: 'Every 6 Hours', schedule: '0 */6 * * *' },
  { value: 'every8hours', label: 'Every 8 Hours', schedule: '0 */8 * * *' },
  { value: 'every12hours', label: 'Every 12 Hours', schedule: '0 */12 * * *' },
  { value: 'daily', label: 'Daily (Midnight)', schedule: '0 0 * * *' },
  { value: 'weekly', label: 'Weekly (Sunday)', schedule: '0 0 * * 0' },
]

const SCHEDULE_PRESET_MAP = Object.fromEntries(
  SCHEDULE_PRESETS.map((preset) => [preset.value, preset]),
)

const SCHEDULE_PRESET_BY_CRON = Object.fromEntries(
  SCHEDULE_PRESETS.filter((preset) => preset.schedule).map((preset) => [preset.schedule, preset.value]),
)

const SCHEDULE_HELPER_TEXT = {
  custom: 'Custom Cron expression. Format: minute hour day month week',
  hourly: 'Runs at minute 0 of every hour.',
  every2hours: 'Runs at minute 0 every 2 hours.',
  every4hours: 'Runs at minute 0 every 4 hours.',
  every6hours: 'Runs at minute 0 every 6 hours.',
  every8hours: 'Runs at minute 0 every 8 hours.',
  every12hours: 'Runs at minute 0 every 12 hours.',
  daily: 'Runs every day at 00:00.',
  weekly: 'Runs every Sunday at 00:00.',
}

const textAreaBaseClassName = `${inputBaseClassName} min-h-[120px] resize-y`

function normalizeConnections(group) {
  return Object.entries(group || {}).map(([name, value]) => ({
    name,
    ...value,
  }))
}

function getTestStateKey(scope, name) {
  return `${scope}:${name}`
}

function parseNumberValue(value) {
  if (value === '') return ''
  const parsed = Number(value)
  return Number.isNaN(parsed) ? '' : parsed
}

function getNextRun(schedule) {
  if (!schedule) return 'No schedule'

  try {
    const interval = parser.parseExpression(schedule)
    return interval.next().toString()
  } catch {
    return 'Invalid schedule'
  }
}

function getSchedulePreset(job) {
  if (job?.scheduleType && SCHEDULE_PRESET_MAP[job.scheduleType]) {
    return job.scheduleType
  }

  return SCHEDULE_PRESET_BY_CRON[job?.schedule] || 'custom'
}

function App() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saveInFlight, setSaveInFlight] = useState(false)
  const [toast, setToast] = useState(null)
  const [testStates, setTestStates] = useState({})
  const [schemaLoadingStates, setSchemaLoadingStates] = useState({})
  const [jobRunStates, setJobRunStates] = useState({})

  useEffect(() => {
    async function fetchConfig() {
      try {
        const response = await axios.get(`${API_URL}/api/config`)
        setConfig(response.data)
      } catch (error) {
        console.error(error)
        setToast({
          type: 'error',
          title: 'No se pudo cargar la configuración',
          message: error.response?.data?.error || error.message,
        })
      } finally {
        setLoading(false)
      }
    }

    fetchConfig()
  }, [])

  useEffect(() => {
    if (!toast) return undefined

    const timeoutId = window.setTimeout(() => {
      setToast(null)
    }, 4000)

    return () => window.clearTimeout(timeoutId)
  }, [toast])

  async function persistConfig({ showSuccessToast = false } = {}) {
    await axios.post(`${API_URL}/api/config`, config)

    if (showSuccessToast) {
      setToast({
        type: 'success',
        title: 'Cambios guardados',
        message: 'La configuración quedó actualizada correctamente.',
      })
    }
  }

  async function handleSave() {
    if (!config) return

    setSaveInFlight(true)

    try {
      await persistConfig({ showSuccessToast: true })
    } catch (error) {
      console.error(error)
      setToast({
        type: 'error',
        title: 'No se pudieron guardar los cambios',
        message: error.response?.data?.error || error.message,
      })
    } finally {
      setSaveInFlight(false)
    }
  }

  function setConnectionStatus(scope, name, nextState) {
    const stateKey = getTestStateKey(scope, name)
    setTestStates((current) => ({
      ...current,
      [stateKey]: nextState,
    }))
  }

  async function handleTestConnection(scope, name) {
    const testConfig = TEST_CONFIG[scope]

    if (!config || !testConfig) return

    setConnectionStatus(scope, name, { loading: true, type: null, message: '' })

    try {
      await persistConfig()
      const response = await axios.post(
        `${API_URL}${testConfig.endpoint}`,
        testConfig.buildPayload(name),
      )

      setConnectionStatus(scope, name, {
        loading: false,
        type: 'success',
        message: response.data?.message || 'Conexión exitosa.',
      })
    } catch (error) {
      console.error(error)
      setConnectionStatus(scope, name, {
        loading: false,
        type: 'error',
        message: error.response?.data?.error || error.message,
      })
    }
  }

  function updateDbConfig(connectionName, field, value) {
    setConfig((current) => ({
      ...current,
      databases: {
        ...(current.databases || {}),
        [connectionName]: {
          ...(current.databases?.[connectionName] || {}),
          config: {
            ...(current.databases?.[connectionName]?.config || {}),
            [field]: value,
          },
        },
      },
    }))
  }

  function updateFtpConfig(connectionName, field, value) {
    setConfig((current) => ({
      ...current,
      ftpServers: {
        ...(current.ftpServers || {}),
        [connectionName]: {
          ...(current.ftpServers?.[connectionName] || {}),
          [field]: value,
        },
      },
    }))
  }

  function updateFtpProtocol(connectionName, protocol) {
    setConfig((current) => {
      const existing = current.ftpServers?.[connectionName] || {}
      const nextPort = protocol === 'sftp' ? 22 : existing.port || 21

      return {
        ...current,
        ftpServers: {
          ...(current.ftpServers || {}),
          [connectionName]: {
            ...existing,
            protocol,
            port: nextPort,
            secure: protocol === 'ftps',
          },
        },
      }
    })
  }

  function updateWebServiceConfig(connectionName, field, value) {
    setConfig((current) => ({
      ...current,
      webServices: {
        ...(current.webServices || {}),
        [connectionName]: {
          ...(current.webServices?.[connectionName] || {}),
          [field]: value,
        },
      },
    }))
  }

  function updateJob(index, field, value) {
    setConfig((current) => {
      const nextJobs = [...(current.jobs || [])]
      nextJobs[index] = { ...nextJobs[index], [field]: value }
      return { ...current, jobs: nextJobs }
    })
  }

  function addJob() {
    const newJob = {
      name: 'New Job',
      sourceConnection: Object.keys(config?.databases || {})[0] || '',
      query: 'SELECT * FROM Table',
      mapping: {},
      format: 'csv',
      destinationType: 'local',
      destination: '',
      schedule: '0 * * * *',
      scheduleType: 'hourly',
    }

    setConfig((current) => ({
      ...current,
      jobs: [...(current.jobs || []), newJob],
    }))
  }

  function removeJob(index) {
    setConfig((current) => ({
      ...current,
      jobs: (current.jobs || []).filter((_, currentIndex) => currentIndex !== index),
    }))
  }

  function updateMapping(jobIndex, sourceColumn, targetColumn) {
    const job = config?.jobs?.[jobIndex]
    if (!job) return

    updateJob(jobIndex, 'mapping', {
      ...(job.mapping || {}),
      [sourceColumn]: targetColumn,
    })
  }

  function getJobDestinationType(job) {
    if (!job) return 'local'
    if (job.destinationType) return job.destinationType
    if (job.destination && config?.ftpServers?.[job.destination]) return 'ftp'
    if (job.destination && config?.webServices?.[job.destination]) return 'webservice'
    return 'local'
  }

  async function fetchColumns(index) {
    const job = config?.jobs?.[index]

    if (!job?.sourceConnection || !job?.query) {
      setToast({
        type: 'error',
        title: 'No se pueden cargar columnas',
        message: 'Selecciona una conexión fuente y define un query primero.',
      })
      return
    }

    setSchemaLoadingStates((current) => ({
      ...current,
      [index]: true,
    }))

    try {
      const response = await axios.post(`${API_URL}/api/schema`, {
        connectionName: job.sourceConnection,
        query: job.query,
      })

      if (response.data.columns && response.data.columns.length > 0) {
        const nextMapping = { ...(job.mapping || {}) }
        response.data.columns.forEach((column) => {
          if (!nextMapping[column]) {
            nextMapping[column] = column
          }
        })

        updateJob(index, 'mapping', nextMapping)
        setToast({
          type: 'success',
          title: 'Columnas cargadas',
          message: `${response.data.columns.length} columnas listas para mapear.`,
        })
      } else {
        setToast({
          type: 'error',
          title: 'Sin columnas detectadas',
          message: 'El query no devolvió columnas. Revisa la consulta.',
        })
      }
    } catch (error) {
      console.error(error)
      setToast({
        type: 'error',
        title: 'Error al cargar columnas',
        message: error.response?.data?.error || error.message,
      })
    } finally {
      setSchemaLoadingStates((current) => ({
        ...current,
        [index]: false,
      }))
    }
  }

  async function handleRunJob(index) {
    const job = config?.jobs?.[index]

    if (!job?.name) {
      setToast({
        type: 'error',
        title: 'Job inválido',
        message: 'Asigna un nombre al job antes de ejecutarlo.',
      })
      return
    }

    setJobRunStates((current) => ({
      ...current,
      [index]: true,
    }))

    try {
      await persistConfig()
      const response = await axios.post(`${API_URL}/api/jobs/${encodeURIComponent(job.name)}/run`)
      setToast({
        type: 'success',
        title: 'Job ejecutado',
        message: response.data?.message || `Job '${job.name}' ejecutado correctamente.`,
      })
    } catch (error) {
      console.error(error)
      setToast({
        type: 'error',
        title: 'Error al ejecutar job',
        message: error.response?.data?.error || error.message,
      })
    } finally {
      setJobRunStates((current) => ({
        ...current,
        [index]: false,
      }))
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm font-medium text-gray-700 shadow-sm">
          <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />
          Cargando configuración...
        </div>
      </div>
    )
  }

  const databases = normalizeConnections(config?.databases)
  const ftpServers = normalizeConnections(config?.ftpServers)
  const webServices = normalizeConnections(config?.webServices)
  const jobs = config?.jobs || []

  return (
    <>
      <ToastMessage toast={toast} />

      <ConfigLayout onSave={handleSave} saving={saveInFlight} saveDisabled={!config}>
        {!config ? (
          <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-950">Configuración no disponible</h2>
            <p className="mt-2 text-sm text-gray-600">
              No fue posible cargar la configuración actual. Revisa el backend y vuelve a intentar.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="rounded-2xl border border-gray-200 bg-white/90 p-5 shadow-sm backdrop-blur">
              <p className="text-sm text-gray-600">
                Esta vista conserva el editor operativo de jobs y moderniza las conexiones sin
                perder compatibilidad con la rama de producción.
              </p>
            </div>

            <ConnectionSection
              icon={Database}
              title="Database Connections"
              description="Conexiones primarias para ERP, consultas y sincronización."
              isEmpty={databases.length === 0}
              emptyMessage="No hay conexiones de base de datos configuradas."
            >
              {databases.map((database) => (
                <ConnectionCard
                  key={database.name}
                  name={database.name}
                  typeLabel={String(database.provider || 'database').toUpperCase()}
                  tone={DB_BADGE_TONES[String(database.provider || '').toLowerCase()] || 'blue'}
                  onTest={() => handleTestConnection('database', database.name)}
                  testing={Boolean(testStates[getTestStateKey('database', database.name)]?.loading)}
                  status={testStates[getTestStateKey('database', database.name)]}
                >
                  {String(database.provider || '').toLowerCase() === 'mysql' ? (
                    <>
                      <FormField label="Host" className="col-span-12 md:col-span-8">
                        <input
                          type="text"
                          value={database.config?.host ?? ''}
                          onChange={(event) =>
                            updateDbConfig(database.name, 'host', event.target.value)
                          }
                          className={inputBaseClassName}
                        />
                      </FormField>

                      <FormField label="Database" className="col-span-12 md:col-span-4">
                        <input
                          type="text"
                          value={database.config?.database ?? ''}
                          onChange={(event) =>
                            updateDbConfig(database.name, 'database', event.target.value)
                          }
                          className={inputBaseClassName}
                        />
                      </FormField>

                      <FormField label="Port" className="col-span-12 md:col-span-4">
                        <input
                          type="number"
                          value={database.config?.port ?? ''}
                          onChange={(event) =>
                            updateDbConfig(database.name, 'port', parseNumberValue(event.target.value))
                          }
                          className={inputBaseClassName}
                          placeholder="3306"
                        />
                      </FormField>

                      <FormField label="User" className="col-span-12 md:col-span-4">
                        <input
                          type="text"
                          value={database.config?.user ?? ''}
                          onChange={(event) =>
                            updateDbConfig(database.name, 'user', event.target.value)
                          }
                          className={inputBaseClassName}
                        />
                      </FormField>

                      <SecretField
                        label="Password"
                        value={database.config?.password ?? ''}
                        onChange={(value) => updateDbConfig(database.name, 'password', value)}
                        className="col-span-12 md:col-span-4"
                      />
                    </>
                  ) : (
                    <>
                      <FormField label="Server" className="col-span-12 md:col-span-8">
                        <input
                          type="text"
                          value={database.config?.server ?? ''}
                          onChange={(event) =>
                            updateDbConfig(database.name, 'server', event.target.value)
                          }
                          className={inputBaseClassName}
                        />
                      </FormField>

                      <FormField label="Database" className="col-span-12 md:col-span-4">
                        <input
                          type="text"
                          value={database.config?.database ?? ''}
                          onChange={(event) =>
                            updateDbConfig(database.name, 'database', event.target.value)
                          }
                          className={inputBaseClassName}
                        />
                      </FormField>

                      <FormField label="User" className="col-span-12 md:col-span-6">
                        <input
                          type="text"
                          value={database.config?.user ?? ''}
                          onChange={(event) =>
                            updateDbConfig(database.name, 'user', event.target.value)
                          }
                          className={inputBaseClassName}
                        />
                      </FormField>

                      <SecretField
                        label="Password"
                        value={database.config?.password ?? ''}
                        onChange={(value) => updateDbConfig(database.name, 'password', value)}
                        className="col-span-12 md:col-span-6"
                      />
                    </>
                  )}
                </ConnectionCard>
              ))}
            </ConnectionSection>

            <ConnectionSection
              icon={Cloud}
              title="FTP Connections"
              description="Destinos remotos para exportaciones y archivos operativos."
              isEmpty={ftpServers.length === 0}
              emptyMessage="No hay servidores FTP, FTPS o SFTP configurados."
            >
              {ftpServers.map((ftp) => {
                const protocol = String(ftp.protocol || 'ftp').toLowerCase()

                return (
                  <ConnectionCard
                    key={ftp.name}
                    name={ftp.name}
                    typeLabel={protocol.toUpperCase()}
                    tone={FTP_BADGE_TONES[protocol] || 'slate'}
                    onTest={() => handleTestConnection('ftp', ftp.name)}
                    testing={Boolean(testStates[getTestStateKey('ftp', ftp.name)]?.loading)}
                    status={testStates[getTestStateKey('ftp', ftp.name)]}
                  >
                    <FormField label="Protocol" className="col-span-12 md:col-span-3">
                      <select
                        value={protocol}
                        onChange={(event) => updateFtpProtocol(ftp.name, event.target.value)}
                        className={inputBaseClassName}
                      >
                        <option value="ftp">FTP</option>
                        <option value="ftps">FTPS</option>
                        <option value="sftp">SFTP</option>
                      </select>
                    </FormField>

                    <FormField label="Host" className="col-span-12 md:col-span-7">
                      <input
                        type="text"
                        value={ftp.host ?? ''}
                        onChange={(event) => updateFtpConfig(ftp.name, 'host', event.target.value)}
                        className={inputBaseClassName}
                      />
                    </FormField>

                    <FormField label="Port" className="col-span-12 md:col-span-2">
                      <input
                        type="number"
                        value={ftp.port ?? (protocol === 'sftp' ? 22 : 21)}
                        onChange={(event) =>
                          updateFtpConfig(ftp.name, 'port', parseNumberValue(event.target.value))
                        }
                        className={inputBaseClassName}
                      />
                    </FormField>

                    <FormField label="User" className="col-span-12 md:col-span-6">
                      <input
                        type="text"
                        value={ftp.user ?? ''}
                        onChange={(event) => updateFtpConfig(ftp.name, 'user', event.target.value)}
                        className={inputBaseClassName}
                      />
                    </FormField>

                    <SecretField
                      label="Password"
                      value={ftp.password ?? ''}
                      onChange={(value) => updateFtpConfig(ftp.name, 'password', value)}
                      className="col-span-12 md:col-span-6"
                    />

                    <div className="col-span-12">
                      <label className="inline-flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={Boolean(ftp.secure)}
                          onChange={(event) =>
                            updateFtpConfig(ftp.name, 'secure', event.target.checked)
                          }
                          disabled={protocol === 'sftp'}
                          className={checkboxBaseClassName}
                        />
                        Secure transport
                        <span className="text-xs text-gray-500">
                          {protocol === 'sftp' ? 'Gestionado por SFTP.' : 'Activa TLS para FTPS.'}
                        </span>
                      </label>
                    </div>
                  </ConnectionCard>
                )
              })}
            </ConnectionSection>

            <ConnectionSection
              icon={Globe}
              title="Web Services"
              description="Integraciones HTTP para sincronización de servicios cloud y MsMall."
              isEmpty={webServices.length === 0}
              emptyMessage="No hay web services configurados."
            >
              {webServices.map((webService) => (
                <ConnectionCard
                  key={webService.name}
                  name={webService.name}
                  typeLabel="MSMALL"
                  tone="sky"
                  onTest={() => handleTestConnection('webservice', webService.name)}
                  testing={Boolean(
                    testStates[getTestStateKey('webservice', webService.name)]?.loading,
                  )}
                  status={testStates[getTestStateKey('webservice', webService.name)]}
                >
                  <FormField label="Base URL" className="col-span-12 md:col-span-8">
                    <input
                      type="text"
                      value={webService.baseUrl ?? ''}
                      onChange={(event) =>
                        updateWebServiceConfig(webService.name, 'baseUrl', event.target.value)
                      }
                      className={inputBaseClassName}
                      placeholder="https://msmall-api.example.com"
                    />
                  </FormField>

                  <FormField label="Mode" className="col-span-12 md:col-span-4">
                    <select
                      value={webService.mode ?? 'sync_rows'}
                      onChange={(event) =>
                        updateWebServiceConfig(webService.name, 'mode', event.target.value)
                      }
                      className={inputBaseClassName}
                    >
                      <option value="sync_rows">sync_rows</option>
                      <option value="manual_execute">manual_execute</option>
                    </select>
                  </FormField>

                  <FormField label="Client ID" className="col-span-12 md:col-span-6">
                    <input
                      type="text"
                      value={webService.clientId ?? ''}
                      onChange={(event) =>
                        updateWebServiceConfig(webService.name, 'clientId', event.target.value)
                      }
                      className={inputBaseClassName}
                    />
                  </FormField>

                  <SecretField
                    label="Client Secret"
                    value={webService.clientSecret ?? ''}
                    onChange={(value) =>
                      updateWebServiceConfig(webService.name, 'clientSecret', value)
                    }
                    className="col-span-12 md:col-span-6"
                  />

                  <FormField label="Mall ID" className="col-span-12 md:col-span-4">
                    <input
                      type="text"
                      value={webService.mallId ?? ''}
                      onChange={(event) =>
                        updateWebServiceConfig(webService.name, 'mallId', event.target.value)
                      }
                      className={inputBaseClassName}
                    />
                  </FormField>

                  <FormField label="Local ID" className="col-span-12 md:col-span-4">
                    <input
                      type="text"
                      value={webService.localId ?? ''}
                      onChange={(event) =>
                        updateWebServiceConfig(webService.name, 'localId', event.target.value)
                      }
                      className={inputBaseClassName}
                    />
                  </FormField>

                  <FormField label="Timeout (ms)" className="col-span-12 md:col-span-4">
                    <input
                      type="number"
                      value={webService.timeoutMs ?? 30000}
                      onChange={(event) =>
                        updateWebServiceConfig(
                          webService.name,
                          'timeoutMs',
                          parseNumberValue(event.target.value),
                        )
                      }
                      className={inputBaseClassName}
                    />
                  </FormField>

                  <FormField label="Config ID" className="col-span-12 md:col-span-4">
                    <input
                      type="text"
                      value={webService.configId ?? ''}
                      onChange={(event) =>
                        updateWebServiceConfig(webService.name, 'configId', event.target.value)
                      }
                      className={inputBaseClassName}
                    />
                  </FormField>

                  <FormField label="Sync Path" className="col-span-12 md:col-span-4">
                    <input
                      type="text"
                      value={webService.syncPath ?? '/api/v1/exporter/sync/ingest'}
                      onChange={(event) =>
                        updateWebServiceConfig(webService.name, 'syncPath', event.target.value)
                      }
                      className={inputBaseClassName}
                    />
                  </FormField>

                  <FormField label="Manual Execute Path" className="col-span-12 md:col-span-4">
                    <input
                      type="text"
                      value={
                        webService.manualExecutePath ??
                        '/api/v1/remote/execute-manual/exporter'
                      }
                      onChange={(event) =>
                        updateWebServiceConfig(
                          webService.name,
                          'manualExecutePath',
                          event.target.value,
                        )
                      }
                      className={inputBaseClassName}
                    />
                  </FormField>
                </ConnectionCard>
              ))}
            </ConnectionSection>

            <ConnectionSection
              icon={CheckCircle2}
              title="Export Jobs"
              description="Jobs de exportación y sincronización preservados para compatibilidad operativa."
              isEmpty={jobs.length === 0}
              emptyMessage="No hay jobs configurados."
            >
              {jobs.map((job, index) => {
                const destinationType = getJobDestinationType(job)
                const schedulePreset = getSchedulePreset(job)
                const schemaLoading = Boolean(schemaLoadingStates[index])
                const jobRunLoading = Boolean(jobRunStates[index])

                return (
                  <article
                    key={`${job.name || 'job'}-${index}`}
                    className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-950">
                          {job.name || `Job ${index + 1}`}
                        </h3>
                        <div className="mt-2 flex flex-col gap-1 text-sm text-gray-500 md:flex-row md:gap-6">
                          <span>
                            <span className="font-medium text-gray-700">Last Run:</span>{' '}
                            {job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never'}
                          </span>
                          <span>
                            <span className="font-medium text-gray-700">Next Run:</span>{' '}
                            {getNextRun(job.schedule)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => handleRunJob(index)}
                          disabled={jobRunLoading}
                          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                        >
                          {jobRunLoading ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          {jobRunLoading ? 'Running...' : 'Run Now'}
                        </button>

                        <button
                          type="button"
                          onClick={() => removeJob(index)}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-12 gap-4">
                      <FormField label="Job Name" className="col-span-12 md:col-span-6">
                        <input
                          type="text"
                          value={job.name || ''}
                          onChange={(event) => updateJob(index, 'name', event.target.value)}
                          className={inputBaseClassName}
                        />
                      </FormField>

                      <FormField label="Source DB" className="col-span-12 md:col-span-6">
                        <select
                          value={job.sourceConnection || ''}
                          onChange={(event) =>
                            updateJob(index, 'sourceConnection', event.target.value)
                          }
                          className={inputBaseClassName}
                        >
                          {Object.keys(config.databases || {}).map((databaseName) => (
                            <option key={databaseName} value={databaseName}>
                              {databaseName}
                            </option>
                          ))}
                        </select>
                      </FormField>

                      <FormField label="SQL Query" className="col-span-12">
                        <textarea
                          value={job.query || ''}
                          onChange={(event) => updateJob(index, 'query', event.target.value)}
                          rows={4}
                          className={`${textAreaBaseClassName} font-mono`}
                        />
                      </FormField>

                      <div className="col-span-12 rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900">Field Mapping</h4>
                            <p className="text-xs text-gray-500">
                              Mapea columnas de origen al payload final.
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => fetchColumns(index)}
                            disabled={schemaLoading}
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {schemaLoading ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : null}
                            {schemaLoading ? 'Loading columns...' : 'Fetch Columns'}
                          </button>
                        </div>

                        {job.mapping && Object.keys(job.mapping).length > 0 ? (
                          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                            {Object.entries(job.mapping).map(([source, target]) => (
                              <div
                                key={source}
                                className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-3"
                              >
                                <span
                                  className="truncate rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-mono text-gray-600"
                                  title={source}
                                >
                                  {source}
                                </span>
                                <span className="text-center text-gray-400">→</span>
                                <input
                                  type="text"
                                  value={target}
                                  onChange={(event) =>
                                    updateMapping(index, source, event.target.value)
                                  }
                                  className={inputBaseClassName}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-4 text-sm text-gray-500">
                            Haz clic en Fetch Columns para inicializar el mapping del job.
                          </p>
                        )}
                      </div>

                      <FormField label="Export Format" className="col-span-12 md:col-span-4">
                        <select
                          value={job.format || 'csv'}
                          onChange={(event) => updateJob(index, 'format', event.target.value)}
                          className={inputBaseClassName}
                        >
                          <option value="csv">CSV</option>
                          <option value="json">JSON</option>
                          <option value="txt">TXT</option>
                        </select>
                      </FormField>

                      <FormField label="Destination Type" className="col-span-12 md:col-span-4">
                        <select
                          value={destinationType}
                          onChange={(event) => {
                            const nextType = event.target.value
                            updateJob(index, 'destinationType', nextType)
                            if (nextType === 'ftp' || nextType === 'webservice') {
                              updateJob(index, 'destination', '')
                            }
                          }}
                          className={inputBaseClassName}
                        >
                          <option value="local">Local Folder</option>
                          <option value="ftp">FTP / SFTP</option>
                          <option value="webservice">Webservice (MsMall)</option>
                        </select>
                      </FormField>

                      {destinationType === 'ftp' ? (
                        <FormField label="Destination FTP/SFTP" className="col-span-12 md:col-span-4">
                          <select
                            value={config.ftpServers?.[job.destination] ? job.destination : ''}
                            onChange={(event) => {
                              updateJob(index, 'destinationType', 'ftp')
                              updateJob(index, 'destination', event.target.value)
                            }}
                            className={inputBaseClassName}
                          >
                            <option value="">(Select FTP/SFTP server)</option>
                            {Object.keys(config.ftpServers || {}).map((ftpName) => (
                              <option key={ftpName} value={ftpName}>
                                {ftpName}
                              </option>
                            ))}
                          </select>
                        </FormField>
                      ) : null}

                      {destinationType === 'webservice' ? (
                        <FormField
                          label="Destination Webservice"
                          className="col-span-12 md:col-span-4"
                        >
                          <select
                            value={config.webServices?.[job.destination] ? job.destination : ''}
                            onChange={(event) => {
                              updateJob(index, 'destinationType', 'webservice')
                              updateJob(index, 'destination', event.target.value)
                            }}
                            className={inputBaseClassName}
                          >
                            <option value="">(Select MsMall webservice)</option>
                            {Object.keys(config.webServices || {}).map((webServiceName) => (
                              <option key={webServiceName} value={webServiceName}>
                                {webServiceName}
                              </option>
                            ))}
                          </select>
                        </FormField>
                      ) : null}

                      {destinationType === 'local' ? (
                        <FormField
                          label="Destination (Local)"
                          className="col-span-12 md:col-span-4"
                          hint="Leave empty to use the default exports folder."
                        >
                          <input
                            type="text"
                            value={job.destination || ''}
                            onChange={(event) => {
                              updateJob(index, 'destinationType', 'local')
                              updateJob(index, 'destination', event.target.value)
                            }}
                            placeholder="Optional custom path"
                            className={inputBaseClassName}
                          />
                        </FormField>
                      ) : null}

                      <FormField label="Schedule" className="col-span-12">
                        <div className="grid grid-cols-12 gap-3">
                          <select
                            value={schedulePreset}
                            onChange={(event) => {
                              const nextPreset = event.target.value
                              const presetConfig = SCHEDULE_PRESET_MAP[nextPreset]

                              setConfig((current) => {
                                const nextJobs = [...(current.jobs || [])]
                                nextJobs[index] = {
                                  ...nextJobs[index],
                                  scheduleType: nextPreset,
                                  schedule:
                                    presetConfig?.schedule ?? nextJobs[index].schedule ?? '',
                                }
                                return { ...current, jobs: nextJobs }
                              })
                            }}
                            className={`col-span-12 md:col-span-4 ${inputBaseClassName}`}
                          >
                            {SCHEDULE_PRESETS.map((preset) => (
                              <option key={preset.value} value={preset.value}>
                                {preset.label}
                              </option>
                            ))}
                          </select>

                          <input
                            type="text"
                            value={job.schedule || ''}
                            onChange={(event) => {
                              setConfig((current) => {
                                const nextJobs = [...(current.jobs || [])]
                                nextJobs[index] = {
                                  ...nextJobs[index],
                                  schedule: event.target.value,
                                  scheduleType: 'custom',
                                }
                                return { ...current, jobs: nextJobs }
                              })
                            }}
                            placeholder="0 * * * *"
                            className={`col-span-12 font-mono md:col-span-8 ${inputBaseClassName}`}
                          />
                        </div>
                        <span className="mt-2 block text-xs text-gray-500">
                          {SCHEDULE_HELPER_TEXT[schedulePreset] || SCHEDULE_HELPER_TEXT.custom}
                        </span>
                      </FormField>
                    </div>
                  </article>
                )
              })}

              <button
                type="button"
                onClick={addJob}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-600 transition hover:border-blue-400 hover:text-blue-600"
              >
                <Plus className="h-4 w-4" />
                Add New Job
              </button>
            </ConnectionSection>
          </div>
        )}
      </ConfigLayout>
    </>
  )
}

export default App
