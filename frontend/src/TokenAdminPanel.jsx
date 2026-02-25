import React, { useState } from 'react';
import axios from 'axios';
import { KeyRound, ShieldCheck, RefreshCw, List } from 'lucide-react';

function parseScopes(text) {
  return text
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function TokenAdminPanel({ apiUrl = '' }) {
  const [authForm, setAuthForm] = useState({
    username: 'admin',
    password: 'admin123',
    mall_id: ''
  });
  const [adminToken, setAdminToken] = useState('');
  const [tokenForm, setTokenForm] = useState({
    mall_id: '',
    local_id: '',
    token_type: 'exporter',
    scopes: 'export:write mapping:read',
    expires_in: '',
    provision_service_account: true
  });
  const [createdToken, setCreatedToken] = useState(null);
  const [listFilters, setListFilters] = useState({ mall_id: '', local_id: '', token_type: '', status: '' });
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const authHeaders = adminToken ? { Authorization: `Bearer ${adminToken}` } : {};

  const signInAdmin = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await axios.post(`${apiUrl}/api/auth/token`, {
        grant_type: 'password',
        token_type: 'app',
        username: authForm.username,
        password: authForm.password,
        mall_id: authForm.mall_id,
        scope: ['tokens:manage', 'app:read', 'mapping:read', 'export:write']
      });
      setAdminToken(res.data.access_token);
      setSuccess('Admin token emitido. Usa este panel para crear/listar tokens.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const createToken = async () => {
    if (!adminToken) {
      setError('Primero emite un admin token.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        mall_id: tokenForm.mall_id,
        token_type: tokenForm.token_type,
        scopes: parseScopes(tokenForm.scopes)
      };
      if (tokenForm.token_type === 'exporter') {
        payload.local_id = tokenForm.local_id;
        payload.provision_service_account = tokenForm.provision_service_account;
      }
      if (tokenForm.expires_in) {
        payload.expires_in = Number(tokenForm.expires_in);
      }

      const res = await axios.post(`${apiUrl}/api/tokens`, payload, { headers: authHeaders });
      setCreatedToken(res.data);
      setSuccess('Token creado. El access/refresh solo se muestran una vez.');
      await fetchTokens();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTokens = async () => {
    if (!adminToken) {
      setError('Primero emite un admin token.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(listFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const url = `${apiUrl}/api/tokens${params.toString() ? `?${params}` : ''}`;
      const res = await axios.get(url, { headers: authHeaders });
      setTokens(res.data.items || []);
      setSuccess(`Listado actualizado (${(res.data.items || []).length} tokens).`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleTokenStatus = async (token) => {
    if (!adminToken) return;
    const nextStatus = token.status === 'active' ? 'inactive' : 'active';
    setLoading(true);
    setError(null);
    try {
      await axios.patch(`${apiUrl}/api/tokens/${token.id}/status`, { status: nextStatus }, { headers: authHeaders });
      await fetchTokens();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setLoading(false);
    }
  };

  return (
    <section>
      <h2 className="text-xl font-bold flex items-center gap-2 mb-4 text-gray-700 border-b pb-2">
        <KeyRound className="w-5 h-5" /> Tokens y Auth (MsMall / MsExportador)
      </h2>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
          <div>
            <h3 className="font-semibold text-lg text-blue-800 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Emitir Admin Token (app)
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Requiere usuario app con scope <code>tokens:manage</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Usuario</span>
              <input
                type="text"
                value={authForm.username}
                onChange={(e) => setAuthForm((prev) => ({ ...prev, username: e.target.value }))}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Password</span>
              <input
                type="password"
                value={authForm.password}
                onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium">mall_id</span>
              <input
                type="text"
                value={authForm.mall_id}
                onChange={(e) => setAuthForm((prev) => ({ ...prev, mall_id: e.target.value }))}
                placeholder="Ej: MALL-1"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
              />
            </label>
          </div>

          <button
            onClick={signInAdmin}
            disabled={loading}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-60"
          >
            <ShieldCheck className="w-4 h-4" /> Emitir Admin Token
          </button>

          {adminToken && (
            <div className="text-xs bg-blue-50 border border-blue-100 rounded p-3">
              <div className="font-semibold text-blue-800 mb-1">Bearer activo (UI local)</div>
              <code className="break-all text-blue-900">{adminToken}</code>
            </div>
          )}
        </div>

        <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
          <div>
            <h3 className="font-semibold text-lg text-blue-800">Crear Token Manual</h3>
            <p className="text-xs text-gray-500 mt-1">
              One-time reveal: access/refresh solo aparecen en la respuesta de creación/regeneración.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Tipo</span>
              <select
                value={tokenForm.token_type}
                onChange={(e) => setTokenForm((prev) => ({ ...prev, token_type: e.target.value }))}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
              >
                <option value="exporter">exporter</option>
                <option value="app">app</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">mall_id</span>
              <input
                type="text"
                value={tokenForm.mall_id}
                onChange={(e) => setTokenForm((prev) => ({ ...prev, mall_id: e.target.value }))}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
              />
            </label>
            {tokenForm.token_type === 'exporter' && (
              <label className="block">
                <span className="text-sm font-medium">local_id</span>
                <input
                  type="text"
                  value={tokenForm.local_id}
                  onChange={(e) => setTokenForm((prev) => ({ ...prev, local_id: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
                />
              </label>
            )}
            <label className="block">
              <span className="text-sm font-medium">expires_in (seg, opcional)</span>
              <input
                type="number"
                value={tokenForm.expires_in}
                onChange={(e) => setTokenForm((prev) => ({ ...prev, expires_in: e.target.value }))}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium">Scopes</span>
              <input
                type="text"
                value={tokenForm.scopes}
                onChange={(e) => setTokenForm((prev) => ({ ...prev, scopes: e.target.value }))}
                placeholder="export:write mapping:read"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border font-mono text-sm"
              />
            </label>
            {tokenForm.token_type === 'exporter' && (
              <label className="flex items-center gap-2 md:col-span-2 text-sm">
                <input
                  type="checkbox"
                  checked={tokenForm.provision_service_account}
                  onChange={(e) => setTokenForm((prev) => ({ ...prev, provision_service_account: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                />
                Provisionar credenciales `client_id/client_secret` para uso vía <code>/api/auth/token</code>
              </label>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={createToken}
              disabled={loading}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-60"
            >
              <KeyRound className="w-4 h-4" /> Crear Token
            </button>
            <button
              onClick={fetchTokens}
              disabled={loading}
              className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-semibold hover:bg-gray-100 transition disabled:opacity-60"
            >
              <List className="w-4 h-4" /> Listar Tokens
            </button>
          </div>
        </div>
      </div>

      {(error || success) && (
        <div className={`mt-4 p-3 rounded border text-sm ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
          {error || success}
        </div>
      )}

      {createdToken && (
        <div className="mt-4 border rounded-lg p-4 bg-white">
          <div className="flex items-center gap-2 text-blue-800 font-semibold mb-2">
            <RefreshCw className="w-4 h-4" /> Resultado de creación (one-time reveal)
          </div>
          <div className="grid gap-2 text-sm">
            <div><strong>token_id:</strong> <code>{createdToken.issued_token?.id}</code></div>
            <div><strong>type:</strong> <code>{createdToken.issued_token?.token_type}</code></div>
            <div><strong>access_token:</strong> <code className="break-all">{createdToken.access_token}</code></div>
            <div><strong>refresh_token:</strong> <code className="break-all">{createdToken.refresh_token}</code></div>
            {createdToken.client_credentials && (
              <>
                <div><strong>client_id:</strong> <code>{createdToken.client_credentials.client_id}</code></div>
                <div><strong>client_secret:</strong> <code className="break-all">{createdToken.client_credentials.client_secret}</code></div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 border rounded-lg p-4 bg-gray-50">
        <div className="flex flex-wrap gap-3 items-end mb-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-600">mall_id</span>
            <input
              type="text"
              value={listFilters.mall_id}
              onChange={(e) => setListFilters((prev) => ({ ...prev, mall_id: e.target.value }))}
              className="mt-1 rounded-md border-gray-300 shadow-sm p-2 border text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">local_id</span>
            <input
              type="text"
              value={listFilters.local_id}
              onChange={(e) => setListFilters((prev) => ({ ...prev, local_id: e.target.value }))}
              className="mt-1 rounded-md border-gray-300 shadow-sm p-2 border text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">tipo</span>
            <select
              value={listFilters.token_type}
              onChange={(e) => setListFilters((prev) => ({ ...prev, token_type: e.target.value }))}
              className="mt-1 rounded-md border-gray-300 shadow-sm p-2 border text-sm"
            >
              <option value="">Todos</option>
              <option value="app">app</option>
              <option value="exporter">exporter</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">estado</span>
            <select
              value={listFilters.status}
              onChange={(e) => setListFilters((prev) => ({ ...prev, status: e.target.value }))}
              className="mt-1 rounded-md border-gray-300 shadow-sm p-2 border text-sm"
            >
              <option value="">Todos</option>
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="revoked">revoked</option>
            </select>
          </label>
          <button
            onClick={fetchTokens}
            disabled={loading}
            className="bg-gray-800 text-white px-3 py-2 rounded text-sm hover:bg-gray-900 disabled:opacity-60"
          >
            Actualizar
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="py-2 pr-3">ID</th>
                <th className="py-2 pr-3">Mall</th>
                <th className="py-2 pr-3">Local</th>
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Último uso</th>
                <th className="py-2 pr-3">Acción</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-3 font-mono text-xs">{token.id.slice(0, 8)}...</td>
                  <td className="py-2 pr-3">{token.mall_id}</td>
                  <td className="py-2 pr-3">{token.local_id || '-'}</td>
                  <td className="py-2 pr-3">{token.token_type}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-1 rounded text-xs ${token.status === 'active' ? 'bg-green-100 text-green-700' : token.status === 'inactive' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                      {token.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs">{token.last_used_at ? new Date(token.last_used_at).toLocaleString() : 'Nunca'}</td>
                  <td className="py-2 pr-3">
                    {token.status !== 'revoked' && (
                      <button
                        onClick={() => toggleTokenStatus(token)}
                        className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100"
                      >
                        {token.status === 'active' ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {tokens.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-gray-500">Sin resultados</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
