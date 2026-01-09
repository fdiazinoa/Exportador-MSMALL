const ftp = require('basic-ftp');
const path = require('path');
const configLoader = require('./configLoader');
const logger = require('./logger');

class FtpUploader {
    async upload(localFilePath, serverName) {
        const config = configLoader.load();
        const ftpConfig = config.ftpServers[serverName];

        if (!ftpConfig) {
            throw new Error(`FTP configuration '${serverName}' not found.`);
        }

        const fileName = path.basename(localFilePath);
        const remotePath = ftpConfig.path ? path.posix.join(ftpConfig.path, fileName) : fileName;

        if (ftpConfig.protocol === 'sftp') {
            const SftpClient = require('ssh2-sftp-client');
            const sftp = new SftpClient();
            try {
                logger.info(`Connecting to SFTP server: ${ftpConfig.host}`);
                await sftp.connect({
                    host: ftpConfig.host,
                    port: ftpConfig.port || 22,
                    username: ftpConfig.user,
                    password: ftpConfig.password
                });
                logger.info(`Uploading ${fileName} to ${remotePath}`);
                await sftp.put(localFilePath, remotePath);
                logger.info('SFTP Upload successful.');
            } catch (err) {
                logger.error(`SFTP Upload failed: ${err.message}`);
                throw err;
            } finally {
                await sftp.end();
            }
        } else {
            // FTP or FTPS
            const client = new ftp.Client();
            client.ftp.verbose = false;
            try {
                logger.info(`Connecting to FTP server: ${ftpConfig.host}`);
                await client.access({
                    host: ftpConfig.host,
                    port: ftpConfig.port || 21,
                    user: ftpConfig.user,
                    password: ftpConfig.password,
                    secure: ftpConfig.secure || false
                });
                logger.info(`Uploading ${fileName} to ${remotePath}`);
                await client.uploadFrom(localFilePath, remotePath);
                logger.info('FTP Upload successful.');
            } catch (error) {
                logger.error(`FTP Upload failed: ${error.message}`);
                throw error;
            } finally {
                client.close();
            }
        }
    }
}

module.exports = new FtpUploader();
