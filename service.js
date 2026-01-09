const Service = require('node-windows').Service;
const path = require('path');
const logger = require('./src/logger');

// Create a new service object
const svc = new Service({
    name: 'ExportadorMSMall',
    description: 'Servicio de exportacion de datos MSMall (Node.js)',
    script: path.join(__dirname, 'index.js'),
    nodeOptions: [
        '--harmony',
        '--max_old_space_size=4096'
    ]
    //, allowServiceLogon: true
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install', function () {
    logger.info('Service installed successfully.');
    svc.start();
});

svc.on('alreadyinstalled', function () {
    logger.warn('Service is already installed.');
});

svc.on('start', function () {
    logger.info('Service started.');
});

svc.on('stop', function () {
    logger.info('Service stopped.');
});

svc.on('uninstall', function () {
    logger.info('Service uninstalled.');
});

const args = process.argv.slice(2);

if (args.includes('--install')) {
    svc.install();
} else if (args.includes('--uninstall')) {
    svc.uninstall();
} else {
    console.log('Usage: node service.js --install | --uninstall');
}
