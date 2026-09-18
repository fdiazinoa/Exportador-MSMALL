function resolveDestinationTarget(config, destinationType, destinationValue) {
  const raw = (destinationValue || '').trim();
  const explicitType = (destinationType || '').trim().toLowerCase();

  if (!raw) {
    return { type: 'local', key: null, path: null };
  }

  // New explicit format takes precedence.
  if (explicitType === 'ftp') {
    return { type: 'ftp', key: raw };
  }
  if (explicitType === 'webservice') {
    return { type: 'webservice', key: raw };
  }
  if (explicitType === 'local') {
    return { type: 'local', path: raw };
  }

  // Backward compatible prefixed destination values.
  if (raw.startsWith('ftp:')) {
    return { type: 'ftp', key: raw.slice(4) };
  }
  if (raw.startsWith('webservice:')) {
    return { type: 'webservice', key: raw.slice('webservice:'.length) };
  }

  // Legacy inference by existing config maps.
  if (config && config.ftpServers && config.ftpServers[raw]) {
    return { type: 'ftp', key: raw };
  }
  if (config && config.webServices && config.webServices[raw]) {
    return { type: 'webservice', key: raw };
  }

  return { type: 'local', path: raw };
}

module.exports = { resolveDestinationTarget };
