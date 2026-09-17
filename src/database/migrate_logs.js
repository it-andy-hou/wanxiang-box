const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');

// 我们需要模拟 electron 的 app.getPath('userData')
// 在 Windows 上通常是 %APPDATA%/ssh-tools-box
// 但为了安全起见，我们从命令行参数获取或者尝试猜测
const userDataPath = process.argv[2] || path.join(os.homedir(), 'AppData/Roaming/ssh_tools_box');
const DATA_DIR = path.join(userDataPath, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const LOG_DIR = path.join(userDataPath, 'task_logs');

async function migrate() {
    console.log('开始迁移数据...');
    console.log('用户数据目录:', userDataPath);
    
    if (!fsSync.existsSync(DB_FILE)) {
        console.error('数据库文件不存在:', DB_FILE);
        return;
    }

    if (!fsSync.existsSync(LOG_DIR)) {
        await fs.mkdir(LOG_DIR, { recursive: true });
    }

    try {
        const rawData = await fs.readFile(DB_FILE, 'utf8');
        const dbData = JSON.parse(rawData);
        
        if (!dbData.task_results || !Array.isArray(dbData.task_results)) {
            console.log('未发现需要迁移的任务结果');
            return;
        }

        console.log(`发现 ${dbData.task_results.length} 条任务结果，正在处理...`);
        
        let migratedCount = 0;
        for (const result of dbData.task_results) {
            let changed = false;
            
            // 处理 stdout
            if (result.stdout && result.stdout.length > 0 && !result.stdout_path) {
                const fileName = `task_${result.task_execution_id}_host_${result.host_id}_stdout.log`;
                const filePath = path.join(LOG_DIR, fileName);
                await fs.writeFile(filePath, result.stdout, 'utf8');
                result.stdout_path = filePath;
                result.stdout = '';
                changed = true;
            }
            
            // 处理 stderr
            if (result.stderr && result.stderr.length > 0 && !result.stderr_path) {
                const fileName = `task_${result.task_execution_id}_host_${result.host_id}_stderr.log`;
                const filePath = path.join(LOG_DIR, fileName);
                await fs.writeFile(filePath, result.stderr, 'utf8');
                result.stderr_path = filePath;
                result.stderr = '';
                changed = true;
            }
            
            if (changed) migratedCount++;
        }
        
        if (migratedCount > 0) {
            console.log(`成功迁移 ${migratedCount} 条记录。正在保存数据库...`);
            await fs.writeFile(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
            console.log('数据库保存成功，迁移完成！');
        } else {
            console.log('没有发现需要迁移的大文本数据。');
        }
        
    } catch (error) {
        console.error('迁移过程中出错:', error);
    }
}

migrate();
