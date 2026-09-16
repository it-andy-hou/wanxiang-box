const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { app } = require('electron');

const LOG_DIR = path.join(app.getPath('userData'), 'task_logs');

class LogService {
    static async ensureLogDir() {
        if (!fsSync.existsSync(LOG_DIR)) {
            await fs.mkdir(LOG_DIR, { recursive: true });
        }
    }

    static getLogPath(taskId, hostId, type) {
        return path.join(LOG_DIR, `task_${taskId}_host_${hostId}_${type}.log`);
    }

    static async saveLog(taskId, hostId, type, content) {
        if (!content) return null;
        await this.ensureLogDir();
        const filePath = this.getLogPath(taskId, hostId, type);
        await fs.writeFile(filePath, content, 'utf8');
        return filePath;
    }

    static async readLog(filePath) {
        try {
            if (!filePath || !fsSync.existsSync(filePath)) return '';
            return await fs.readFile(filePath, 'utf8');
        } catch (error) {
            console.error('读取日志文件失败:', error, filePath);
            return '';
        }
    }

    static async deleteLogsForTask(taskId) {
        try {
            await this.ensureLogDir();
            const files = await fs.readdir(LOG_DIR);
            const taskPrefix = `task_${taskId}_`;
            for (const file of files) {
                if (file.startsWith(taskPrefix)) {
                    await fs.unlink(path.join(LOG_DIR, file));
                }
            }
        } catch (error) {
            console.error('删除任务日志失败:', error, taskId);
        }
    }
}

module.exports = { LogService };
