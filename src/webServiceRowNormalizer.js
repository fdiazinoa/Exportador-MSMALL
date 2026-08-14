const logger = require('./logger');

const DEFAULT_FIELD_CANDIDATES = {
  documento_numero: [
    'documento_numero',
    'factura_numero',
    'ticket_numero',
    'invoice_no',
    'ticket_no',
    'InvoiceNo',
    'FacturaNo',
    'TicketNo',
  ],
  documento_tipo: ['documento_tipo', 'tipo_documento', 'document_type', 'DocumentType'],
  fecha_venta: ['fecha_venta', 'sale_date', 'fecha', 'SaleDate', 'FechaVenta'],
  hora_venta: ['hora_venta', 'sale_time', 'hora', 'SaleTime', 'HoraVenta'],
  total_bruto: ['total_bruto', 'gross_total', 'gross', 'monto_bruto', 'GrossTotal', 'TotalBruto'],
  total_impuesto: ['total_impuesto', 'total_impuestos', 'tax_total', 'impuesto_total', 'TaxTotal', 'TotalImpuesto'],
  total_neto: ['total_neto', 'net_total', 'net', 'monto_neto', 'NetTotal', 'TotalNeto'],
  resumen_id: ['resumen_id', 'summary_id'],
  cantidad_documentos: ['cantidad_documentos', 'document_count', 'cantidad_docs'],
};

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

function normalizeGranularity(value) {
  const normalized = String(value || 'transaction').trim().toLowerCase();
  if (normalized === 'daily' || normalized === 'daily_summary') return 'daily';
  return 'transaction';
}

function buildFieldCandidates(contractConfig, fieldName) {
  const customCandidates = contractConfig && contractConfig.fields && contractConfig.fields[fieldName];
  const defaults = DEFAULT_FIELD_CANDIDATES[fieldName] || [];
  const merged = [fieldName, ...asArray(customCandidates), ...defaults];
  const unique = [];
  for (const candidate of merged) {
    if (!candidate) continue;
    const c = String(candidate);
    if (!unique.includes(c)) unique.push(c);
  }
  return unique;
}

function pickFirstField(row, candidates) {
  for (const field of candidates) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
    const value = row[field];
    if (!hasValue(value)) continue;
    return { value, sourceField: field };
  }
  return { value: undefined, sourceField: null };
}

function inferDocumentType({ explicitType, documentSourceField }) {
  if (hasValue(explicitType)) return String(explicitType).trim().toLowerCase();
  const f = String(documentSourceField || '').toLowerCase();
  if (f.includes('factura') || f.includes('invoice')) return 'factura';
  if (f.includes('ticket')) return 'ticket';
  return undefined;
}

function coerceNumber(value, fieldName, rowIndex, errors) {
  if (!hasValue(value)) return undefined;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    errors.push(`row ${rowIndex}: field '${fieldName}' is not a finite number`);
    return undefined;
  }

  if (typeof value === 'string') {
    const raw = value.trim();
    const normalized = raw.includes(',') && !raw.includes('.')
      ? raw.replace(',', '.')
      : raw;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
    errors.push(`row ${rowIndex}: field '${fieldName}' must be numeric (got '${raw}')`);
    return undefined;
  }

  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  errors.push(`row ${rowIndex}: field '${fieldName}' must be numeric`);
  return undefined;
}

function buildCanonicalRow(row, contractConfig, granularity, rowIndex, errors) {
  const preserveOriginalFields = contractConfig.preserveOriginalFields !== false;
  const out = preserveOriginalFields ? { ...row } : {};

  const fieldValues = {};
  const fieldSources = {};
  for (const canonicalField of Object.keys(DEFAULT_FIELD_CANDIDATES)) {
    const match = pickFirstField(row, buildFieldCandidates(contractConfig, canonicalField));
    fieldValues[canonicalField] = match.value;
    fieldSources[canonicalField] = match.sourceField;
  }

  let totalBruto = coerceNumber(fieldValues.total_bruto, 'total_bruto', rowIndex, errors);
  let totalImpuesto = coerceNumber(fieldValues.total_impuesto, 'total_impuesto', rowIndex, errors);
  let totalNeto = coerceNumber(fieldValues.total_neto, 'total_neto', rowIndex, errors);

  const calculateNet = contractConfig.calculateNetFromGrossAndTax === true;
  if (totalNeto == null && calculateNet && totalBruto != null && totalImpuesto != null) {
    totalNeto = totalBruto - totalImpuesto;
  }

  const documentoNumero = hasValue(fieldValues.documento_numero)
    ? String(fieldValues.documento_numero).trim()
    : undefined;
  const documentoTipo = inferDocumentType({
    explicitType: fieldValues.documento_tipo,
    documentSourceField: fieldSources.documento_numero,
  });
  const fechaVenta = hasValue(fieldValues.fecha_venta) ? String(fieldValues.fecha_venta).trim() : undefined;
  const horaVenta = hasValue(fieldValues.hora_venta) ? String(fieldValues.hora_venta).trim() : undefined;
  const resumenId = hasValue(fieldValues.resumen_id) ? String(fieldValues.resumen_id).trim() : undefined;
  const cantidadDocumentos = coerceNumber(fieldValues.cantidad_documentos, 'cantidad_documentos', rowIndex, errors);

  if (fechaVenta != null) out.fecha_venta = fechaVenta;
  if (horaVenta != null) out.hora_venta = horaVenta;
  if (granularity === 'daily' && !Object.prototype.hasOwnProperty.call(out, 'hora_venta')) {
    out.hora_venta = null;
  }
  if (totalBruto != null) out.total_bruto = totalBruto;
  if (totalImpuesto != null) out.total_impuesto = totalImpuesto;
  if (totalNeto != null) out.total_neto = totalNeto;
  if (documentoNumero != null) out.documento_numero = documentoNumero;
  if (documentoTipo != null) out.documento_tipo = documentoTipo;
  if (resumenId != null) out.resumen_id = resumenId;
  if (cantidadDocumentos != null) out.cantidad_documentos = cantidadDocumentos;

  const requiredFields = granularity === 'daily'
    ? ['fecha_venta', 'total_bruto', 'total_impuesto', 'total_neto']
    : ['documento_numero', 'fecha_venta', 'hora_venta', 'total_bruto', 'total_impuesto', 'total_neto'];

  for (const requiredField of requiredFields) {
    if (!hasValue(out[requiredField])) {
      errors.push(`row ${rowIndex}: missing required field '${requiredField}' for granularity '${granularity}'`);
    }
  }

  if (granularity === 'daily' && !hasValue(out.documento_numero)) {
    if (contractConfig.requireDocumentNumberInDaily === true) {
      errors.push(`row ${rowIndex}: missing required field 'documento_numero' for granularity 'daily'`);
    }
    if (!hasValue(out.resumen_id) && contractConfig.requireSummaryId !== false) {
      errors.push(`row ${rowIndex}: missing required field 'resumen_id' for granularity 'daily'`);
    }
  }

  return out;
}

function getContractConfig(job = {}) {
  if (!isPlainObject(job.webserviceContract)) return null;
  if (job.webserviceContract.enabled === false) return null;
  const type = String(job.webserviceContract.type || 'msmall_sales_v1').trim().toLowerCase();
  if (type !== 'msmall_sales_v1') {
    logger.warn(`Unknown webserviceContract.type '${job.webserviceContract.type}' in job '${job.name}'. Skipping normalization.`);
    return null;
  }
  return job.webserviceContract;
}

function normalizeRowsForWebservice(rows, job = {}) {
  if (!Array.isArray(rows)) {
    throw new Error('normalizeRowsForWebservice expects an array of rows');
  }

  const contractConfig = getContractConfig(job);
  if (!contractConfig) {
    return {
      rows,
      meta: {},
    };
  }

  const granularity = normalizeGranularity(contractConfig.granularity || job.webserviceGranularity);
  const errors = [];
  const normalizedRows = rows.map((row, idx) => {
    if (!isPlainObject(row)) {
      errors.push(`row ${idx + 1}: expected object row`);
      return row;
    }
    return buildCanonicalRow(row, contractConfig, granularity, idx + 1, errors);
  });

  if (errors.length > 0) {
    const details = errors.slice(0, 10).join('; ');
    const extra = errors.length > 10 ? ` (+${errors.length - 10} more)` : '';
    throw new Error(`MsMall webservice row normalization failed for job '${job.name || 'unknown'}': ${details}${extra}`);
  }

  return {
    rows: normalizedRows,
    meta: {
      granularity,
      contract_type: 'msmall_sales_v1',
    },
  };
}

module.exports = { normalizeRowsForWebservice };
