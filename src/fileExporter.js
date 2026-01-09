const fs = require('fs');
const path = require('path');
const { writeToPath } = require('fast-csv');
const logger = require('./logger');

class FileExporter {
    constructor() {
        this.outputDir = 'exports';
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir);
        }
    }

    async export(data, format, jobName, customPath = null) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${jobName}_${timestamp}.${format.toLowerCase()}`;

        let outputDir = this.outputDir;
        if (customPath) {
            outputDir = customPath;
            if (!fs.existsSync(outputDir)) {
                try {
                    fs.mkdirSync(outputDir, { recursive: true });
                } catch (err) {
                    logger.error(`Could not create custom output directory: ${outputDir}. Using default.`);
                    outputDir = this.outputDir;
                }
            }
        }

        const filePath = path.join(outputDir, fileName);

        logger.info(`Exporting data to ${filePath}`);

        try {
            switch (format.toUpperCase()) {
                case 'CSV':
                    await this.exportToCsv(data, filePath);
                    break;
                case 'JSON':
                    await this.exportToJson(data, filePath);
                    break;
                case 'TXT':
                    await this.exportToTxt(data, filePath);
                    break;
                default:
                    throw new Error(`Unsupported format: ${format}`);
            }
            return filePath;
        } catch (error) {
            logger.error(`Error exporting file: ${error.message}`);
            throw error;
        }
    }

    exportToCsv(data, filePath) {
        return new Promise((resolve, reject) => {
            writeToPath(filePath, data, { headers: true })
                .on('error', err => reject(err))
                .on('finish', () => resolve());
        });
    }

    async exportToJson(data, filePath) {
        const jsonContent = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, jsonContent);
    }

    async exportToTxt(data, filePath) {
        // Simple pipe-delimited TXT
        const stream = fs.createWriteStream(filePath);

        if (data.length > 0) {
            // Header
            const headers = Object.keys(data[0]);
            stream.write(headers.join('|') + '\n');

            // Rows
            for (const row of data) {
                const line = Object.values(row).join('|');
                stream.write(line + '\n');
            }
        }

        stream.end();

        return new Promise((resolve, reject) => {
            stream.on('finish', resolve);
            stream.on('error', reject);
        });
    }
}

module.exports = new FileExporter();
