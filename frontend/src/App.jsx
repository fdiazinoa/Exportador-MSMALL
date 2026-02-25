import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Server, Database, UploadCloud, CheckCircle } from 'lucide-react';
import parser from 'cron-parser';
import TokenAdminPanel from './TokenAdminPanel';

const API_URL = import.meta.env.PROD ? '' : 'http://localhost:3000';

// Helper function to get next run
const getNextRun = (schedule) => {
  try {
    const interval = parser.parseExpression(schedule);
    return interval.next().toString();
  } catch (err) {
    return 'Invalid Schedule';
  }
};

function App() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/config`);
        setConfig(res.data);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setMessage({ type: 'error', text: 'Error loading configuration' });
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const saveConfig = async () => {
    try {
      await axios.post(`${API_URL}/api/config`, config);
      setMessage({ type: 'success', text: 'Configuration saved successfully!' });
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Error saving configuration' });
    }
  };

  const testDbConnection = async (dbKey) => {
    try {
      const res = await axios.post(`${API_URL}/api/test/db`, { connectionName: dbKey });
      alert(`Connection Successful! ${res.data.message}`);
    } catch (err) {
      alert(`Connection Failed: ${err.response?.data?.error || err.message}`);
    }
  };

  const testFtpConnection = async (ftpKey) => {
    try {
      const res = await axios.post(`${API_URL}/api/test/ftp`, { serverName: ftpKey });
      alert(`Connection Successful! ${res.data.message}`);
    } catch (err) {
      alert(`Connection Failed: ${err.response?.data?.error || err.message}`);
    }
  };

  const updateDbConfig = (key, field, value) => {
    setConfig(prev => ({
      ...prev,
      databases: {
        ...prev.databases,
        [key]: {
          ...prev.databases[key],
          config: {
            ...prev.databases[key].config,
            [field]: value
          }
        }
      }
    }));
  };

  const updateJob = (index, field, value) => {
    const newJobs = [...(config.jobs || [])];
    newJobs[index] = { ...newJobs[index], [field]: value };
    setConfig(prev => ({ ...prev, jobs: newJobs }));
  };

  const addJob = () => {
    const newJob = {
      name: 'New Job',
      sourceConnection: Object.keys(config.databases || {})[0] || '',
      query: 'SELECT * FROM Table',
      mapping: {},
      format: 'csv',
      destination: '',
      schedule: '0 * * * *'
    };
    setConfig(prev => ({ ...prev, jobs: [...(prev.jobs || []), newJob] }));
  };

  const removeJob = (index) => {
    const newJobs = [...(config.jobs || [])];
    newJobs.splice(index, 1);
    setConfig(prev => ({ ...prev, jobs: newJobs }));
  };

  const fetchColumns = async (index) => {
    const job = config.jobs[index];
    if (!job.sourceConnection || !job.query) {
      alert('Please select a source connection and enter a query first.');
      return;
    }

    try {
      const res = await axios.post(`${API_URL}/api/schema`, {
        connectionName: job.sourceConnection,
        query: job.query
      });

      if (res.data.columns && res.data.columns.length > 0) {
        // Initialize mapping if empty
        const newMapping = { ...job.mapping };
        res.data.columns.forEach(col => {
          if (!newMapping[col]) {
            newMapping[col] = col; // Default to same name
          }
        });
        updateJob(index, 'mapping', newMapping);
        alert('Columns fetched successfully!');
      } else {
        alert('No columns found. Check your query.');
      }
    } catch (err) {
      console.error(err);
      alert(`Error fetching columns: ${err.response?.data?.error || err.message}`);
    }
  };

  const updateMapping = (jobIndex, sourceCol, targetCol) => {
    const job = config.jobs[jobIndex];
    const newMapping = { ...job.mapping, [sourceCol]: targetCol };
    updateJob(jobIndex, 'mapping', newMapping);
  };

  const updateFtpConfig = (key, field, value) => {
    setConfig(prev => ({
      ...prev,
      ftpServers: {
        ...prev.ftpServers,
        [key]: {
          ...prev.ftpServers[key],
          [field]: value
        }
      }
    }));
  };

  if (loading) return <div className="p-10">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans text-gray-800">
      <div className="max-w-4xl mx-auto bg-white shadow-lg rounded-xl overflow-hidden">
        <header className="bg-blue-600 text-white p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="w-8 h-8" />
            <h1 className="text-2xl font-bold">Exportador MSMall Config</h1>
          </div>
          <button
            onClick={saveConfig}
            className="flex items-center gap-2 bg-white text-blue-600 px-4 py-2 rounded-lg font-semibold hover:bg-blue-50 transition"
          >
            <Save className="w-4 h-4" /> Save Changes
          </button>
        </header>

        {message && (
          <div className={`p-4 ${message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            {message.text}
          </div>
        )}

        <div className="p-6 space-y-8">
          <TokenAdminPanel apiUrl={API_URL} />

          {/* Database Section */}
          <section>
            <h2 className="text-xl font-bold flex items-center gap-2 mb-4 text-gray-700 border-b pb-2">
              <Database className="w-5 h-5" /> Database Connections
            </h2>
            <div className="grid gap-6">
              {Object.entries(config.databases || {}).map(([key, db]) => (
                <div key={key} className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-semibold text-lg text-blue-800">{key}</h3>
                    <div className="flex gap-2">
                      <span className="px-2 py-1 bg-gray-200 rounded text-xs uppercase font-bold">{db.provider}</span>
                      <button
                        onClick={() => testDbConnection(key)}
                        className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                      >
                        Test Connection
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {db.provider === 'sqlserver' && (
                      <>
                        <label className="block">
                          <span className="text-sm font-medium">Server</span>
                          <input
                            type="text"
                            value={db.config.server}
                            onChange={e => updateDbConfig(key, 'server', e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm font-medium">Database</span>
                          <input
                            type="text"
                            value={db.config.database}
                            onChange={e => updateDbConfig(key, 'database', e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm font-medium">User</span>
                          <input
                            type="text"
                            value={db.config.user}
                            onChange={e => updateDbConfig(key, 'user', e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm font-medium">Password</span>
                          <input
                            type="password"
                            value={db.config.password}
                            onChange={e => updateDbConfig(key, 'password', e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                          />
                        </label>
                      </>
                    )}
                    {/* Add other providers here if needed */}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* FTP Section */}
          <section>
            <h2 className="text-xl font-bold flex items-center gap-2 mb-4 text-gray-700 border-b pb-2">
              <UploadCloud className="w-5 h-5" /> FTP Servers
            </h2>
            <div className="grid gap-6">
              {Object.entries(config.ftpServers || {}).map(([key, ftp]) => (
                <div key={key} className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-semibold text-lg text-blue-800">{key}</h3>
                    <button
                      onClick={() => testFtpConnection(key)}
                      className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                    >
                      Test Connection
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-sm font-medium">Protocol</span>
                      <select
                        value={ftp.protocol || 'ftp'}
                        onChange={e => updateFtpConfig(key, 'protocol', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                      >
                        <option value="ftp">FTP</option>
                        <option value="ftps">FTPS</option>
                        <option value="sftp">SFTP</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">Host</span>
                      <input
                        type="text"
                        value={ftp.host}
                        onChange={e => updateFtpConfig(key, 'host', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">Port</span>
                      <input
                        type="number"
                        value={ftp.port || (ftp.protocol === 'sftp' ? 22 : 21)}
                        onChange={e => updateFtpConfig(key, 'port', parseInt(e.target.value))}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">User</span>
                      <input
                        type="text"
                        value={ftp.user}
                        onChange={e => updateFtpConfig(key, 'user', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">Password</span>
                      <input
                        type="password"
                        value={ftp.password}
                        onChange={e => updateFtpConfig(key, 'password', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                      />
                    </label>
                    <label className="flex items-center mt-6">
                      <input
                        type="checkbox"
                        checked={ftp.secure || false}
                        onChange={e => updateFtpConfig(key, 'secure', e.target.checked)}
                        disabled={ftp.protocol === 'sftp'}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-900">Secure (FTPS)</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Jobs Section */}
          <section>
            <h2 className="text-xl font-bold flex items-center gap-2 mb-4 text-gray-700 border-b pb-2">
              <CheckCircle className="w-5 h-5" /> Export Jobs
            </h2>
            <div className="space-y-6">
              {config.jobs?.map((job, index) => (
                <div key={index} className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h3 className="font-semibold text-lg text-blue-800">{job.name}</h3>
                      <div className="text-xs text-gray-500 flex gap-4 mt-1">
                        <span>
                          <strong>Last Run:</strong> {job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never'}
                        </span>
                        <span>
                          <strong>Next Run:</strong> {getNextRun(job.schedule || '* * * * *')}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => removeJob(index)}
                      className="text-red-500 text-sm hover:underline"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-sm font-medium">Job Name</span>
                      <input
                        type="text"
                        value={job.name}
                        onChange={e => updateJob(index, 'name', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">Source DB</span>
                      <select
                        value={job.sourceConnection}
                        onChange={e => updateJob(index, 'sourceConnection', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
                      >
                        {Object.keys(config.databases || {}).map(db => <option key={db} value={db}>{db}</option>)}
                      </select>
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-sm font-medium">SQL Query</span>
                      <textarea
                        value={job.query}
                        onChange={e => updateJob(index, 'query', e.target.value)}
                        rows={3}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border font-mono text-sm"
                      />
                    </label>

                    {/* Visual Mapper */}
                    <div className="md:col-span-2 border p-3 rounded bg-white">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-medium text-sm">Field Mapping (Source &rarr; Target)</span>
                        <button
                          onClick={() => fetchColumns(index)}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                        >
                          Fetch Columns
                        </button>
                      </div>

                      {job.mapping && Object.keys(job.mapping).length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                          {Object.entries(job.mapping).map(([source, target]) => (
                            <div key={source} className="flex items-center gap-2 text-sm">
                              <span className="w-1/2 truncate font-mono text-gray-600" title={source}>{source}</span>
                              <span className="text-gray-400">&rarr;</span>
                              <input
                                type="text"
                                value={target}
                                onChange={e => updateMapping(index, source, e.target.value)}
                                className="w-1/2 border rounded px-1 py-0.5"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 italic">
                          Click "Fetch Columns" to load fields from the query.
                        </div>
                      )}
                    </div>

                    <label className="block">
                      <span className="text-sm font-medium">Export Format</span>
                      <select
                        value={job.format}
                        onChange={e => updateJob(index, 'format', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
                      >
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                        <option value="txt">TXT</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">Destination FTP</span>
                      <select
                        value={job.destination}
                        onChange={e => updateJob(index, 'destination', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
                      >
                        <option value="">(None - Local Only)</option>
                        {Object.keys(config.ftpServers || {}).map(ftp => <option key={ftp} value={ftp}>{ftp}</option>)}
                      </select>
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-sm font-medium">Schedule</span>
                      <div className="flex flex-col gap-2 mt-1">
                        <div className="flex gap-2">
                          <select
                            value={job.scheduleType || 'custom'}
                            onChange={e => {
                              const type = e.target.value;
                              let newSchedule = job.schedule;
                              if (type === 'hourly') newSchedule = '0 * * * *';
                              if (type === 'every2hours') newSchedule = '0 */2 * * *';
                              if (type === 'every4hours') newSchedule = '0 */4 * * *';
                              if (type === 'every6hours') newSchedule = '0 */6 * * *';
                              if (type === 'every8hours') newSchedule = '0 */8 * * *';
                              if (type === 'every12hours') newSchedule = '0 */12 * * *';
                              if (type === 'daily') newSchedule = '0 0 * * *';
                              if (type === 'weekly') newSchedule = '0 0 * * 0';

                              const newJobs = [...(config.jobs || [])];
                              newJobs[index] = { ...newJobs[index], scheduleType: type, schedule: newSchedule };
                              setConfig(prev => ({ ...prev, jobs: newJobs }));
                            }}
                            className="block w-1/3 rounded-md border-gray-300 shadow-sm p-2 border"
                          >
                            <option value="custom">Custom (Cron)</option>
                            <option value="hourly">Every Hour</option>
                            <option value="every2hours">Every 2 Hours</option>
                            <option value="every4hours">Every 4 Hours</option>
                            <option value="every6hours">Every 6 Hours</option>
                            <option value="every8hours">Every 8 Hours</option>
                            <option value="every12hours">Every 12 Hours</option>
                            <option value="daily">Daily (Midnight)</option>
                            <option value="weekly">Weekly (Sunday)</option>
                          </select>

                          <input
                            type="text"
                            value={job.schedule || '* * * * *'}
                            onChange={e => {
                              const newJobs = [...(config.jobs || [])];
                              newJobs[index] = { ...newJobs[index], schedule: e.target.value, scheduleType: 'custom' };
                              setConfig(prev => ({ ...prev, jobs: newJobs }));
                            }}
                            placeholder="* * * * *"
                            className="block w-2/3 rounded-md border-gray-300 shadow-sm p-2 border font-mono"
                          />
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {job.scheduleType === 'hourly' && "Runs at minute 0 of every hour (1:00, 2:00, ...)."}
                          {job.scheduleType === 'every2hours' && "Runs at minute 0 every 2 hours (0:00, 2:00, 4:00...)."}
                          {job.scheduleType === 'daily' && "Runs every day at 00:00 (Midnight)."}
                          {job.scheduleType === 'custom' && "Custom Cron Expression. Format: minute hour day month week"}
                        </div>
                      </div>
                    </label>

                    {/* Local Output Path if no FTP selected (or if destination is not a known FTP server) */}
                    {(!job.destination || !config.ftpServers?.[job.destination]) && (
                      <label className="block md:col-span-2">
                        <span className="text-sm font-medium">Local Output Path (Optional)</span>
                        <input
                          type="text"
                          value={config.ftpServers?.[job.destination] ? '' : (job.destination || '')}
                          onChange={e => updateJob(index, 'destination', e.target.value)}
                          placeholder="e.g., C:/Exports or /tmp/data"
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
                        />
                        <div className="text-xs text-gray-500 mt-1">
                          Leave empty to use default 'exports' folder. Enter a full path to save elsewhere.
                        </div>
                      </label>
                    )}

                    <div className="md:col-span-2 flex justify-end mt-2">
                      <button
                        onClick={async () => {
                          try {
                            if (!job.name) return alert('Save the job first (or give it a name).');
                            // We need to save config first to ensure backend has latest job definition
                            await saveConfig();
                            const res = await axios.post(`${API_URL}/api/jobs/${job.name}/run`);
                            alert(res.data.message);
                          } catch (err) {
                            alert(`Execution Failed: ${err.response?.data?.error || err.message}`);
                          }
                        }}
                        className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-indigo-700 transition"
                      >
                        <CheckCircle className="w-4 h-4" /> Run Now
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <button
                onClick={addJob}
                className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-500 transition"
              >
                + Add New Job
              </button>
            </div>
          </section>
        </div >
      </div >
    </div >
  );
}

export default App;
