const configLoader = require('./configLoader');
const logger = require('./logger');
const { runJob } = require('./jobRunner');

class JobAlreadyRunningError extends Error {
    constructor(jobName) {
        super(`Job '${jobName}' is already running or queued.`);
        this.name = 'JobAlreadyRunningError';
        this.code = 'JOB_ALREADY_RUNNING';
    }
}

class JobExecutor {
    constructor(options = {}) {
        this.running = 0;
        this.activeNames = new Set();
        this.queue = [];
        this.runner = options.runner || runJob;
        this.configProvider = options.configProvider || (() => configLoader.load());
        this.log = options.logger || logger;
    }

    execute(jobName) {
        if (this.activeNames.has(jobName)) {
            return Promise.reject(new JobAlreadyRunningError(jobName));
        }
        this.activeNames.add(jobName);
        return new Promise((resolve, reject) => {
            this.queue.push({ jobName, resolve, reject });
            this._drain();
        });
    }

    _maxConcurrency() {
        const config = this.configProvider();
        const configured = Number((config.runtime && config.runtime.maxConcurrentJobs) || 2);
        return Number.isInteger(configured) && configured > 0 ? configured : 2;
    }

    _drain() {
        const maxConcurrency = this._maxConcurrency();
        while (this.running < maxConcurrency && this.queue.length > 0) {
            const item = this.queue.shift();
            this.running += 1;
            this.log.info(`Job '${item.jobName}' dequeued. active=${this.running} queued=${this.queue.length}`);
            this.runner(item.jobName)
                .then(item.resolve, item.reject)
                .finally(() => {
                    this.running -= 1;
                    this.activeNames.delete(item.jobName);
                    this._drain();
                });
        }
    }

    status() {
        return { running: this.running, queued: this.queue.length, activeJobs: Array.from(this.activeNames) };
    }
}

module.exports = new JobExecutor();
module.exports.JobExecutor = JobExecutor;
module.exports.JobAlreadyRunningError = JobAlreadyRunningError;
