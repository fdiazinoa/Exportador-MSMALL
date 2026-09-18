export function createDatabaseTemplate(provider = 'sqlserver') {
  if (!['sqlserver', 'mysql', 'postgres'].includes(provider)) throw new Error('Proveedor no soportado')
  const config = { user: '', password: '', database: '' }
  if (provider === 'sqlserver') {
    Object.assign(config, {
      server: '',
      compatibilityProfile: 'modern',
      securityMode: 'modern',
      connectionTimeout: 30000,
      requestTimeout: 120000,
      options: { encrypt: true, trustServerCertificate: false, cancelTimeout: 15000 },
    })
  } else {
    config.host = ''
  }
  return { provider, config }
}

export function createFtpTemplate() {
  return { protocol: 'ftp', host: '', port: 21, user: '', password: '', secure: false }
}

export function addNamedConnection(collection, baseName, entry) {
  let key = baseName
  let suffix = 2
  while (Object.prototype.hasOwnProperty.call(collection || {}, key)) {
    key = `${baseName}_${suffix}`
    suffix += 1
  }
  return { ...(collection || {}), [key]: entry }
}
