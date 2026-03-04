import { useEffect, useState } from 'react'
import axios from 'axios'
import { Cloud, Database, Globe, LoaderCircle, Plus } from 'lucide-react'
import ConfigLayout from './components/config/ConfigLayout'
import ConnectionCard from './components/config/ConnectionCard'
import ConnectionSection from './components/config/ConnectionSection'
import FormField, {
  checkboxBaseClassName,
  inputBaseClassName,
} from './components/config/FormField'
import SecretField from './components/config/SecretField'
import ToastMessage from './components/config/ToastMessage'
import { cn } from './lib/cn'

const API_URL = import.meta.env.PROD ? '' : 'http://localhost:3100'

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

const sectionActionClassName =
  'inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:bg-gray-50'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const invalidInputClassName = 'border-red-300 focus:border-red-500 focus:ring-red-500/10'
const disabledInputClassName = 'bg-gray-50 text-gray-400'

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

function createUniqueConnectionKey(group, baseName) {
  const currentGroup = group || {}
  let candidate = baseName
  let suffix = 2

  while (currentGroup[candidate]) {
    candidate = `${baseName}_${suffix}`
    suffix += 1
  }

  return candidate
}

function createDatabaseTemplate(provider) {
  if (provider === 'mysql') {
    return {
      provider: 'mysql',
      config: {
        host: '',
        port: 3306,
        user: '',
        password: '',
        database: '',
      },
    }
  }

  return {
    provider: 'sqlserver',
    config: {
      server: '',
      user: '',
      password: '',
      database: '',
      options: {
        encrypt: true,
        trustServerCertificate: true,
      },
    },
  }
}

function createFtpTemplate() {
  return {
    protocol: 'ftp',
    host: '',
    port: 21,
    user: '',
    password: '',
    secure: false,
  }
}

function createWebServiceTemplate() {
  return {
    baseUrl: '',
    clientId: '',
    clientSecret: '',
    mallId: '',
    localId: '',
    configId: '',
    syncPath: '/api/v1/exporter/sync/ingest',
    manualExecutePath: '/api/v1/remote/execute-manual/exporter',
    auth: {
      tokenPath: '/auth/token',
      refreshPath: '/auth/refresh',
    },
    mode: 'sync_rows',
    chunkSize: 500,
    timeoutMs: 30000,
    retry: {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
    },
  }
}

function isUuid(value) {
  return UUID_PATTERN.test(String(value || '').trim())
}

function looksLikeServiceAccountId(value) {
  return /^msa_[a-z0-9]+$/i.test(String(value || '').trim())
}

function getResolvedWebServiceIdentity(webService) {
  const authState = webService?.authState || {}
  return {
    mallId: String(authState.mallId || webService?.mallId || '').trim(),
    localId: String(authState.localId || webService?.localId || '').trim(),
    tokenType: String(authState.tokenType || '').trim(),
  }
}

function getWebServiceValidationErrors(webService) {
  if (!webService) return []

  const errors = []
  const { mallId, localId } = getResolvedWebServiceIdentity(webService)
  const configId = String(webService.configId || '').trim()
  const mode = String(webService.mode || 'sync_rows').toLowerCase()

  if (mallId && !isUuid(mallId)) {
    errors.push('Mall ID debe ser el UUID real del mall en MsMall.')
  }

  if (localId) {
    if (looksLikeServiceAccountId(localId)) {
      errors.push(
        'Local ID no puede ser un Client ID (msa_*). Debe ser el UUID del local en MsMall.',
      )
    } else if (!isUuid(localId)) {
      errors.push('Local ID debe ser el UUID del local en MsMall (locales.id).')
    }
  }

  if (mode === 'manual_execute') {
    if (!configId) {
      errors.push('Config ID es obligatorio en modo manual_execute.')
    } else if (!isUuid(configId)) {
      errors.push('Config ID debe ser el UUID de la configuración/local usada en MsMall.')
    }
  }

  return errors
}

function getReferencedJobs(config, scope, connectionName) {
  const jobs = Array.isArray(config?.jobs) ? config.jobs : []

  return jobs
    .filter((job) => {
      if (scope === 'database') {
        return job.sourceConnection === connectionName
      }

      return job.destination === connectionName
    })
    .map((job) => job.name)
}

function buildUsageNotice(jobNames) {
  if (!jobNames.length) return null

  if (jobNames.length === 1) {
    return `Conexión referenciada por el job: ${jobNames[0]}.`
  }

  return `Conexión referenciada por los jobs: ${jobNames.join(', ')}.`
}

function removeKey(record, keyToRemove) {
  const nextRecord = { ...(record || {}) }
  delete nextRecord[keyToRemove]
  return nextRecord
}

function App() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saveInFlight, setSaveInFlight] = useState(false)
  const [toast, setToast] = useState(null)
  const [testStates, setTestStates] = useState({})

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

  function clearConnectionStatus(scope, name) {
    const stateKey = getTestStateKey(scope, name)

    setTestStates((current) => {
      const nextState = { ...current }
      delete nextState[stateKey]
      return nextState
    })
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

      if (scope === 'webservice' && response.data?.token?.resolvedIdentity) {
        const { mallId, localId } = response.data.token.resolvedIdentity
        setConfig((current) => {
          if (!current?.webServices?.[name]) return current
          const existing = current.webServices[name]
          return {
            ...current,
            webServices: {
              ...current.webServices,
              [name]: {
                ...existing,
                ...(mallId ? { mallId } : {}),
                ...(localId ? { localId } : {}),
                authState: {
                  ...(existing.authState || {}),
                  ...(mallId ? { mallId } : {}),
                  ...(localId ? { localId } : {}),
                },
              },
            },
          }
        })
      }

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
        ...current.databases,
        [connectionName]: {
          ...current.databases[connectionName],
          config: {
            ...current.databases[connectionName].config,
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
        ...current.ftpServers,
        [connectionName]: {
          ...current.ftpServers[connectionName],
          [field]: value,
        },
      },
    }))
  }

  function updateFtpProtocol(connectionName, protocol) {
    setConfig((current) => {
      const existing = current.ftpServers[connectionName] || {}
      const nextPort = protocol === 'sftp' ? 22 : existing.port || 21

      return {
        ...current,
        ftpServers: {
          ...current.ftpServers,
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
        ...current.webServices,
        [connectionName]: {
          ...current.webServices[connectionName],
          [field]: value,
        },
      },
    }))
  }

  function addDatabaseConnection(provider) {
    const baseName = provider === 'mysql' ? 'mysql_new' : 'sqlserver_new'

    setConfig((current) => {
      if (!current) return current

      const nextName = createUniqueConnectionKey(current.databases, baseName)

      setToast({
        type: 'success',
        title: 'Conexión agregada',
        message: `Se creó la conexión ${nextName}. Completa sus credenciales y guarda los cambios.`,
      })

      return {
        ...current,
        databases: {
          ...current.databases,
          [nextName]: createDatabaseTemplate(provider),
        },
      }
    })
  }

  function addFtpConnection() {
    setConfig((current) => {
      if (!current) return current

      const nextName = createUniqueConnectionKey(current.ftpServers, 'ftp_new')

      setToast({
        type: 'success',
        title: 'Servidor agregado',
        message: `Se creó la conexión ${nextName}. Completa sus credenciales y guarda los cambios.`,
      })

      return {
        ...current,
        ftpServers: {
          ...current.ftpServers,
          [nextName]: createFtpTemplate(),
        },
      }
    })
  }

  function addWebServiceConnection() {
    setConfig((current) => {
      if (!current) return current

      const nextName = createUniqueConnectionKey(current.webServices, 'msmall_new')

      setToast({
        type: 'success',
        title: 'Web service agregado',
        message: `Se creó la conexión ${nextName}. Completa sus credenciales y guarda los cambios.`,
      })

      return {
        ...current,
        webServices: {
          ...current.webServices,
          [nextName]: createWebServiceTemplate(),
        },
      }
    })
  }

  function handleDeleteConnection(scope, connectionName) {
    if (!config) return

    const referencedJobs = getReferencedJobs(config, scope, connectionName)

    if (referencedJobs.length > 0) {
      setToast({
        type: 'error',
        title: 'No se puede eliminar la conexión',
        message: `${connectionName} está en uso por: ${referencedJobs.join(', ')}.`,
      })
      return
    }

    const scopeLabels = {
      database: 'la conexión de base de datos',
      ftp: 'el servidor FTP',
      webservice: 'el web service',
    }

    if (!window.confirm(`¿Deseas eliminar ${scopeLabels[scope]} "${connectionName}"?`)) {
      return
    }

    setConfig((current) => {
      if (!current) return current

      if (scope === 'database') {
        return {
          ...current,
          databases: removeKey(current.databases, connectionName),
        }
      }

      if (scope === 'ftp') {
        return {
          ...current,
          ftpServers: removeKey(current.ftpServers, connectionName),
        }
      }

      return {
        ...current,
        webServices: removeKey(current.webServices, connectionName),
      }
    })

    clearConnectionStatus(scope, connectionName)
    setToast({
      type: 'success',
      title: 'Conexión eliminada',
      message: `${connectionName} fue removida de la configuración local.`,
    })
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
                Esta vista está enfocada en conexiones. Las definiciones de jobs existentes se
                conservan al guardar aunque no formen parte de este editor visual.
              </p>
            </div>

            <ConnectionSection
              icon={Database}
              title="Database Connections"
              description="Conexiones primarias para ERP, consultas y sincronización."
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => addDatabaseConnection('sqlserver')}
                    className={sectionActionClassName}
                  >
                    <Plus className="h-4 w-4" />
                    Agregar SQL Server
                  </button>
                  <button
                    type="button"
                    onClick={() => addDatabaseConnection('mysql')}
                    className={sectionActionClassName}
                  >
                    <Plus className="h-4 w-4" />
                    Agregar MySQL
                  </button>
                </>
              }
              isEmpty={databases.length === 0}
              emptyMessage="No hay conexiones de base de datos configuradas."
            >
              {databases.map((database) => {
                const referencedJobs = getReferencedJobs(config, 'database', database.name)

                return (
                  <ConnectionCard
                    key={database.name}
                    name={database.name}
                    typeLabel={String(database.provider || 'database').toUpperCase()}
                    tone={DB_BADGE_TONES[String(database.provider || '').toLowerCase()] || 'blue'}
                    onTest={() => handleTestConnection('database', database.name)}
                    onDelete={() => handleDeleteConnection('database', database.name)}
                    deleteTitle={
                      referencedJobs.length
                        ? `No se puede eliminar: usada por ${referencedJobs.join(', ')}`
                        : `Eliminar ${database.name}`
                    }
                    testing={Boolean(testStates[getTestStateKey('database', database.name)]?.loading)}
                    status={testStates[getTestStateKey('database', database.name)]}
                    notice={buildUsageNotice(referencedJobs)}
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
                              updateDbConfig(
                                database.name,
                                'port',
                                parseNumberValue(event.target.value),
                              )
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
                )
              })}
            </ConnectionSection>

            <ConnectionSection
              icon={Cloud}
              title="FTP Connections"
              description="Destinos remotos para exportaciones y archivos operativos."
              actions={
                <button
                  type="button"
                  onClick={addFtpConnection}
                  className={sectionActionClassName}
                >
                  <Plus className="h-4 w-4" />
                  Agregar FTP
                </button>
              }
              isEmpty={ftpServers.length === 0}
              emptyMessage="No hay servidores FTP, FTPS o SFTP configurados."
            >
              {ftpServers.map((ftp) => {
                const protocol = String(ftp.protocol || 'ftp').toLowerCase()
                const referencedJobs = getReferencedJobs(config, 'ftp', ftp.name)

                return (
                  <ConnectionCard
                    key={ftp.name}
                    name={ftp.name}
                    typeLabel={protocol.toUpperCase()}
                    tone={FTP_BADGE_TONES[protocol] || 'slate'}
                    onTest={() => handleTestConnection('ftp', ftp.name)}
                    onDelete={() => handleDeleteConnection('ftp', ftp.name)}
                    deleteTitle={
                      referencedJobs.length
                        ? `No se puede eliminar: usada por ${referencedJobs.join(', ')}`
                        : `Eliminar ${ftp.name}`
                    }
                    testing={Boolean(testStates[getTestStateKey('ftp', ftp.name)]?.loading)}
                    status={testStates[getTestStateKey('ftp', ftp.name)]}
                    notice={buildUsageNotice(referencedJobs)}
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
              actions={
                <button
                  type="button"
                  onClick={addWebServiceConnection}
                  className={sectionActionClassName}
                >
                  <Plus className="h-4 w-4" />
                  Agregar Web Service
                </button>
              }
              isEmpty={webServices.length === 0}
              emptyMessage="No hay web services configurados."
            >
              {webServices.map((webService) => {
                const referencedJobs = getReferencedJobs(config, 'webservice', webService.name)
                const mode = String(webService.mode || 'sync_rows').toLowerCase()
                const validationErrors = getWebServiceValidationErrors(webService)
                const resolvedIdentity = getResolvedWebServiceIdentity(webService)
                const mallIdInvalid =
                  Boolean(resolvedIdentity.mallId) && !isUuid(resolvedIdentity.mallId)
                const localIdLooksWrong = looksLikeServiceAccountId(resolvedIdentity.localId)
                const localIdInvalid =
                  Boolean(resolvedIdentity.localId) &&
                  (!isUuid(resolvedIdentity.localId) || localIdLooksWrong)
                const configIdInvalid =
                  mode === 'manual_execute' &&
                  (!String(webService.configId || '').trim() || !isUuid(webService.configId))
                const hasDerivedIdentity = Boolean(
                  webService.authState?.mallId || webService.authState?.localId,
                )

                return (
                  <ConnectionCard
                    key={webService.name}
                    name={webService.name}
                    typeLabel="MSMALL"
                    tone="sky"
                    onTest={() => handleTestConnection('webservice', webService.name)}
                    onDelete={() => handleDeleteConnection('webservice', webService.name)}
                    deleteTitle={
                      referencedJobs.length
                        ? `No se puede eliminar: usada por ${referencedJobs.join(', ')}`
                        : `Eliminar ${webService.name}`
                    }
                    testing={Boolean(
                      testStates[getTestStateKey('webservice', webService.name)]?.loading,
                    )}
                    status={testStates[getTestStateKey('webservice', webService.name)]}
                    notice={buildUsageNotice(referencedJobs)}
                  >
                    <div className="col-span-12 rounded-xl border border-sky-200 bg-sky-50/80 p-4 text-sm text-sky-900">
                      <p className="font-medium">Como llenar MsMall en este formulario</p>
                      <ul className="mt-2 space-y-1 text-sky-800">
                        <li>
                          `Client ID`: lo genera MsMall al crear el Service Account y suele empezar
                          con `msa_`.
                        </li>
                        <li>
                          `Mall ID` y `Local ID`: se autocompletan desde el token exporter despues
                          de `Test Connection`.
                        </li>
                        <li>
                          `Config ID`: solo se usa en `manual_execute`. En `sync_rows` puede quedar
                          vacio.
                        </li>
                      </ul>
                    </div>

                    {validationErrors.length > 0 ? (
                      <div className="col-span-12 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        <p className="font-medium text-red-800">Hay campos de MsMall pendientes o mal cargados</p>
                        <ul className="mt-2 space-y-1">
                          {validationErrors.map((error) => (
                            <li key={error}>- {error}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

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

                    <FormField
                      label="Modo"
                      className="col-span-12 md:col-span-4"
                      hint="sync_rows empuja filas directo a MsMall. manual_execute dispara la importacion remota usando Config ID."
                    >
                      <select
                        value={webService.mode ?? 'sync_rows'}
                        onChange={(event) =>
                          updateWebServiceConfig(webService.name, 'mode', event.target.value)
                        }
                        className={inputBaseClassName}
                      >
                        <option value="sync_rows">sync_rows (recomendado)</option>
                        <option value="manual_execute">manual_execute</option>
                      </select>
                    </FormField>

                    <FormField
                      label="Client ID"
                      className="col-span-12 md:col-span-6"
                      hint="Sale de MsMall al crear el Service Account. Ejemplo: msa_xxxxxxxxxxxxxxxx."
                    >
                      <input
                        type="text"
                        value={webService.clientId ?? ''}
                        onChange={(event) =>
                          updateWebServiceConfig(webService.name, 'clientId', event.target.value)
                        }
                        className={inputBaseClassName}
                        placeholder="msa_xxxxxxxxxxxxxxxx"
                      />
                    </FormField>

                    <SecretField
                      label="Client Secret"
                      value={webService.clientSecret ?? ''}
                      onChange={(value) =>
                        updateWebServiceConfig(webService.name, 'clientSecret', value)
                      }
                      className="col-span-12 md:col-span-6"
                      placeholder="Se revela una sola vez en MsMall"
                    />

                    <FormField
                      label="Mall ID"
                      className="col-span-12 md:col-span-4"
                      hint={
                        hasDerivedIdentity
                          ? 'Autocompletado desde el token exporter de MsMall. Solo lectura.'
                          : 'Se completa automaticamente al hacer Test Connection.'
                      }
                    >
                      <input
                        type="text"
                        value={resolvedIdentity.mallId}
                        readOnly
                        className={cn(
                          inputBaseClassName,
                          mallIdInvalid && invalidInputClassName,
                          disabledInputClassName,
                        )}
                        placeholder="Se completa con Test Connection"
                      />
                    </FormField>

                    <FormField
                      label="Local ID"
                      className="col-span-12 md:col-span-4"
                      hint={
                        hasDerivedIdentity
                          ? 'Autocompletado desde el token exporter. No uses codigos de tienda ni Client ID.'
                          : 'Se completa automaticamente con el UUID del local despues de Test Connection.'
                      }
                    >
                      <input
                        type="text"
                        value={resolvedIdentity.localId}
                        readOnly
                        className={cn(
                          inputBaseClassName,
                          localIdInvalid && invalidInputClassName,
                          disabledInputClassName,
                        )}
                        placeholder="Se completa con Test Connection"
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

                    <FormField
                      label="Config ID"
                      className="col-span-12 md:col-span-4"
                      hint={
                        mode === 'manual_execute'
                          ? 'UUID de la configuracion/local que MsMall usa para ejecutar la importacion remota.'
                          : 'No se usa en sync_rows. Dejalo vacio salvo que actives manual_execute.'
                      }
                    >
                      <input
                        type="text"
                        value={webService.configId ?? ''}
                        onChange={(event) =>
                          updateWebServiceConfig(webService.name, 'configId', event.target.value)
                        }
                        className={cn(
                          inputBaseClassName,
                          configIdInvalid && invalidInputClassName,
                          mode !== 'manual_execute' && disabledInputClassName,
                        )}
                        placeholder={
                          mode === 'manual_execute'
                            ? 'UUID de la configuracion/local en MsMall'
                            : 'No aplica en sync_rows'
                        }
                        disabled={mode !== 'manual_execute'}
                      />
                    </FormField>

                    <FormField
                      label="Sync Path"
                      className="col-span-12 md:col-span-4"
                      hint="Ruta usada solo en modo sync_rows."
                    >
                      <input
                        type="text"
                        value={webService.syncPath ?? '/api/v1/exporter/sync/ingest'}
                        onChange={(event) =>
                          updateWebServiceConfig(webService.name, 'syncPath', event.target.value)
                        }
                        className={inputBaseClassName}
                      />
                    </FormField>

                    <FormField
                      label="Manual Execute Path"
                      className="col-span-12 md:col-span-4"
                      hint="Ruta usada solo en modo manual_execute."
                    >
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
                )
              })}
            </ConnectionSection>
          </div>
        )}
      </ConfigLayout>
    </>
  )
}

export default App
