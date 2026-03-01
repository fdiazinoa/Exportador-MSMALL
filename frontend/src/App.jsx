import { useEffect, useState } from 'react'
import axios from 'axios'
import { Cloud, Database, Globe, LoaderCircle } from 'lucide-react'
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
          </div>
        )}
      </ConfigLayout>
    </>
  )
}

export default App
