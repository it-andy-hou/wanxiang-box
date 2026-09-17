// 简化版数据库 - 使用JSON文件存储
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { app } = require('electron');

// 数据文件路径
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const DB_TMP_FILE = DB_FILE + '.tmp';            // 原子写入临时文件
const DB_BACKUP_DIR = path.join(DATA_DIR, 'backups'); // 滚动备份目录
const MAX_BACKUPS = 10;                          // 保留最近 N 份备份
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;        // 最多每 5 分钟生成一份备份（限流）

// 默认数据结构
const DEFAULT_DATA = {
    hosts: [],
    scripts: [
        // 内置脚本已移除，用户可以自己添加脚本
    ],
    task_executions: [],
    task_results: [],
    settings: {
        ssh_timeout: 30000,
        max_concurrent_connections: 20,
        default_ssh_port: 22,
        auto_save_interval: 300000,
        theme: 'light',
        language: 'zh-CN',
        enable_logging: true,
        log_level: 'info',
        // 数据备份相关
        backup_enabled: true,        // 是否启用每日定时备份
        backup_time: '02:00',        // 每日备份时刻（HH:MM）
        backup_keep_count: 30,       // 保留份数（超出删最旧）
        backup_last_at: null         // 上次成功备份时间（ISO 字符串）
    },
    ssh_keys: [],
    host_groups: [],
    logs: [],
    // 工程任务相关表
    project_tasks: [],        // 工程任务（含模板）
    project_steps: [],        // 工程步骤
    project_executions: [],   // 工程执行记录
    project_step_executions: [], // 步骤执行详情
    // 脚本目录
    script_categories: [],    // 脚本分级目录（2级）
    // 标签体系
    tag_types: [],            // 标签类型（固定4种：环境/架构/风险等级/自定义标签）
    tag_values: [],           // 各类型下的标签值
    // 快捷面板
    script_shortcuts: []      // 脚本执行页快捷面板（全局，上限10个）
};

class SimpleDatabase {
    constructor() {
        this.data = { ...DEFAULT_DATA };
        this.isLoaded = false;
        this.saveTimer = null;
        this.pendingSave = null;
        this.pendingResolvers = []; // 存储等待保存完成的 Promise 解析函数
        this._batchMode = false;    // 批量操作模式标志
        this._batchBackup = null;   // 批量操作前的数据备份（用于回滚）
        this._readOnly = false;     // 损坏保护：主文件损坏后进入只读模式，拒绝写入
        this._lastBackupAt = 0;     // 上次生成滚动备份的时间戳
    }
    
    // 确保数据目录存在
    async ensureDataDir() {
        if (!fsSync.existsSync(DATA_DIR)) {
            await fs.mkdir(DATA_DIR, { recursive: true });
        }
        if (!fsSync.existsSync(DB_BACKUP_DIR)) {
            await fs.mkdir(DB_BACKUP_DIR, { recursive: true });
        }
    }
    
    // 初始化数据库
    async init() {
        try {
            await this.ensureDataDir();
            await this.load();
            this.isLoaded = true;
            console.log('简化数据库初始化完成');
        } catch (error) {
            console.error('数据库初始化失败:', error);
            throw error;
        }
    }
    
    // 加载数据
    // 重要：解析失败时不能静默重置内存并后续覆盖磁盘上的文件，
    //         否则会造成“截断的文件被空数据覆盖”这种不可逆丢失。
    //         这里依次尝试：主文件 → .tmp → 最近一份备份，并进入只读保护模式。
    async load() {
        // 1) 主文件
        if (fsSync.existsSync(DB_FILE)) {
            try {
                const data = await fs.readFile(DB_FILE, 'utf8');
                this.data = { ...DEFAULT_DATA, ...JSON.parse(data) };
                console.log('数据加载成功');
                return;
            } catch (error) {
                console.error('主数据文件解析失败:', error.message);
                // 把损坏的文件另存为 .corrupt.<时间戳>，避免被后续写覆盖
                try {
                    const ts = new Date().toISOString().replace(/[:.]/g, '-');
                    const corruptPath = `${DB_FILE}.corrupt.${ts}`;
                    await fs.copyFile(DB_FILE, corruptPath);
                    console.error(`损坏文件已备份到: ${corruptPath}`);
                } catch (e) {
                    console.error('备份损坏文件失败:', e.message);
                }
            }
        }
        
        // 2) 尝试从 .tmp 临时文件恢复（原子写中途崩溃的场景）
        if (fsSync.existsSync(DB_TMP_FILE)) {
            try {
                const data = await fs.readFile(DB_TMP_FILE, 'utf8');
                this.data = { ...DEFAULT_DATA, ...JSON.parse(data) };
                console.warn('已从 .tmp 临时文件恢复数据');
                this._readOnly = true; // 进入保护模式，避免被错误覆盖
                return;
            } catch (e) {
                console.error('.tmp 文件也无法解析:', e.message);
            }
        }
        
        // 3) 尝试从最近一份备份恢复
        const recovered = await this.tryRestoreFromBackup();
        if (recovered) {
            this._readOnly = true; // 从备份恢复后进入保护模式
            return;
        }
        
        // 4) 都没有 → 全新安装场景，创建默认文件
        if (!fsSync.existsSync(DB_FILE)) {
            await this.saveImmediately();
            console.log('创建默认数据文件');
            return;
        }
        
        // 5) 最后兑底：主文件存在但损坏且无可用备份，进入保护模式，绝不覆盖
        console.error('严重：数据文件损坏且无可用备份，已进入只读保护模式，任何写入被拒绝');
        this.data = { ...DEFAULT_DATA };
        this._readOnly = true;
    }
    
    // 尝试从最新一份备份恢复
    async tryRestoreFromBackup() {
        try {
            if (!fsSync.existsSync(DB_BACKUP_DIR)) return false;
            const files = (await fs.readdir(DB_BACKUP_DIR))
                .filter(f => f.startsWith('database.') && f.endsWith('.json'))
                .sort()
                .reverse(); // 按名字倒序 → 最新在前
            for (const f of files) {
                const p = path.join(DB_BACKUP_DIR, f);
                try {
                    const data = await fs.readFile(p, 'utf8');
                    this.data = { ...DEFAULT_DATA, ...JSON.parse(data) };
                    console.warn(`已从备份恢复数据: ${f}`);
                    return true;
                } catch (e) {
                    console.warn(`备份 ${f} 也损坏，尝试下一份:`, e.message);
                }
            }
            return false;
        } catch (e) {
            console.error('扫描备份目录失败:', e.message);
            return false;
        }
    }
    
    // 立即保存数据（原子写入 + 滚动备份）
    // 原子写入原理：先写到 .tmp，写完 fsync 后 rename 覆盖主文件。
    //                rename 在同一文件系统内是原子操作，进程被杀或断电
    //                只会剩下“旧版主文件”或“新版主文件”，不会出现被截断的中间态。
    async saveImmediately() {
        if (this._readOnly) {
            const err = new Error('数据库处于只读保护模式，拒绝写入（主文件损坏待人工恢复）');
            console.error(err.message);
            throw err;
        }
        if (this.pendingSave) return this.pendingSave;
        
        this.pendingSave = (async () => {
            try {
                // 清除定时器
                if (this.saveTimer) {
                    clearTimeout(this.saveTimer);
                    this.saveTimer = null;
                }
                
                const startTime = Date.now();
                const json = JSON.stringify(this.data, null, 2);
                
                // 限流生成滚动备份（在覆盖主文件之前）
                await this.maybeRotateBackup();
                
                // 原子写入：写 .tmp → fsync → rename
                const fh = await fs.open(DB_TMP_FILE, 'w');
                try {
                    await fh.writeFile(json, 'utf8');
                    // 刷盘，确保数据落到磁盘后再 rename
                    try { await fh.sync(); } catch (e) { /* 部分 FS 不支持，忽略 */ }
                } finally {
                    await fh.close();
                }
                // rename 是原子覆盖
                await fs.rename(DB_TMP_FILE, DB_FILE);
                
                console.log(`数据保存成功，耗时: ${Date.now() - startTime}ms`);
            } catch (error) {
                console.error('数据保存失败:', error);
                // 如果 .tmp 还在，尝试清理（下次 load 会优先读主文件，.tmp 只是中间态）
                try { if (fsSync.existsSync(DB_TMP_FILE)) await fs.unlink(DB_TMP_FILE); } catch (_) {}
                throw error;
            } finally {
                this.pendingSave = null;
            }
        })();
        
        return this.pendingSave;
    }
    
    // 限流生成滚动备份：起码间隔 BACKUP_INTERVAL_MS，超过 MAX_BACKUPS 则删除最旧
    async maybeRotateBackup() {
        try {
            // 主文件不存在或在首次创建阶段，跳过
            if (!fsSync.existsSync(DB_FILE)) return;
            
            const now = Date.now();
            if (this._lastBackupAt && (now - this._lastBackupAt) < BACKUP_INTERVAL_MS) {
                return;
            }
            
            // 备份名：database.YYYY-MM-DDTHH-MM-SS-sssZ.json
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(DB_BACKUP_DIR, `database.${ts}.json`);
            await fs.copyFile(DB_FILE, backupPath);
            this._lastBackupAt = now;
            
            // 清理超额备份
            const files = (await fs.readdir(DB_BACKUP_DIR))
                .filter(f => f.startsWith('database.') && f.endsWith('.json'))
                .sort();
            while (files.length > MAX_BACKUPS) {
                const old = files.shift();
                try { await fs.unlink(path.join(DB_BACKUP_DIR, old)); } catch (_) {}
            }
        } catch (e) {
            // 备份失败不应阻止主流程保存
            console.warn('生成备份失败:', e.message);
        }
    }
    
    // 节流保存数据
    async save() {
        // 批量模式下不触发保存
        if (this._batchMode) {
            return Promise.resolve();
        }
        
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        
        return new Promise((resolve, reject) => {
            // 将当前的 resolve/reject 加入队列
            this.pendingResolvers.push({ resolve, reject });
            
            this.saveTimer = setTimeout(async () => {
                // 提取当前所有的解析函数，并清空队列
                const resolvers = this.pendingResolvers;
                this.pendingResolvers = [];
                
                try {
                    await this.saveImmediately();
                    // 通知所有等待的调用者
                    resolvers.forEach(r => r.resolve());
                } catch (error) {
                    // 通知所有等待的调用者失败
                    resolvers.forEach(r => r.reject(error));
                }
            }, 500); // 500ms 节流
        });
    }
    
    // ========== 批量操作模式 ==========
    
    /**
     * 开始批量操作模式
     * 在此模式下，所有数据库操作（insert/update/delete）不会立即保存到磁盘
     * 需要手动调用 commit() 提交或 rollback() 回滚
     */
    beginBatch() {
        if (this._batchMode) {
            console.warn('已经在批量操作模式中');
            return;
        }
        this._batchMode = true;
        // 备份当前数据状态，用于可能的回滚
        this._batchBackup = JSON.parse(JSON.stringify(this.data));
        console.log('进入批量操作模式');
    }
    
    /**
     * 提交批量操作
     * 将所有内存中的更改一次性保存到磁盘
     */
    async commit() {
        if (!this._batchMode) {
            console.warn('不在批量操作模式中，无需提交');
            return;
        }
        this._batchMode = false;
        this._batchBackup = null;
        await this.saveImmediately();
        console.log('批量操作提交成功');
    }
    
    /**
     * 回滚批量操作
     * 恢复到 beginBatch() 之前的数据状态
     */
    rollback() {
        if (!this._batchMode) {
            console.warn('不在批量操作模式中，无法回滚');
            return false;
        }
        if (this._batchBackup) {
            this.data = this._batchBackup;
            console.log('批量操作已回滚');
        }
        this._batchMode = false;
        this._batchBackup = null;
        return true;
    }
    
    /**
     * 检查是否处于批量操作模式
     */
    isBatchMode() {
        return this._batchMode;
    }
    
    // 是否处于只读保护模式（主文件损坏后为防丢失会进入该模式）
    isReadOnly() {
        return !!this._readOnly;
    }
    
    // 获取完整原始数据（深拷贝，用于导出全量备份）
    getRawData() {
        return JSON.parse(JSON.stringify(this.data));
    }
    
    // 整体替换数据并立即落盘（用于导入/恢复）
    // 注意：调用前应在外部完成校验与「导入前自动备份」
    async replaceAllData(newData) {
        if (this._readOnly) {
            throw new Error('数据库处于只读保护模式，拒绝写入');
        }
        if (!newData || typeof newData !== 'object') {
            throw new Error('无效的数据');
        }
        // 与默认结构合并，确保新增字段不丢失
        this.data = { ...DEFAULT_DATA, ...newData };
        // 清除节流，立即写盘
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        await this.saveImmediately();
        return true;
    }
    
    // 手动解除只读保护（用户确认已妥善保管损坏文件后调用）
    clearReadOnly() {
        this._readOnly = false;
    }
    
    // 获取表数据
    getTable(tableName) {
        return this.data[tableName] || [];
    }
    
    // 设置表数据
    async setTable(tableName, data) {
        this.data[tableName] = data;
        await this.save();
    }
    
    // 添加记录
    async insert(tableName, record) {
        if (!this.data[tableName]) {
            this.data[tableName] = [];
        }
        
        // 只在没有提供ID时才自动生成数字ID
        if (!record.id) {
            const maxId = this.data[tableName].reduce((max, item) => {
                // 只考虑数字ID，忽略字符串ID
                const numId = typeof item.id === 'number' ? item.id : 0;
                return Math.max(max, numId);
            }, 0);
            record.id = maxId + 1;
        }
        
        record.created_at = new Date().toISOString();
        record.updated_at = new Date().toISOString();
        
        this.data[tableName].push(record);
        await this.save();
        return record;
    }
    
    // 更新记录（支持数字和字符串ID混合）
    async update(tableName, id, updates) {
        if (!this.data[tableName]) {
            return false;
        }
        
        // 先尝试严格匹配，如果找不到再尝试类型转换匹配
        let index = this.data[tableName].findIndex(item => item.id === id);
        if (index === -1) {
            // 尝试转换为字符串匹配
            const strId = String(id);
            index = this.data[tableName].findIndex(item => String(item.id) === strId);
        }
        
        if (index === -1) {
            return false;
        }
        
        this.data[tableName][index] = {
            ...this.data[tableName][index],
            ...updates,
            updated_at: new Date().toISOString()
        };
        
        await this.save();
        // 返回更新后的完整记录而不是布尔值
        return this.data[tableName][index];
    }
    
    // 删除记录（支持数字和字符串ID混合）
    async delete(tableName, id) {
        if (!this.data[tableName]) {
            return false;
        }
        
        // 先尝试严格匹配，如果找不到再尝试类型转换匹配
        let index = this.data[tableName].findIndex(item => item.id === id);
        if (index === -1) {
            // 尝试转换为字符串匹配
            const strId = String(id);
            index = this.data[tableName].findIndex(item => String(item.id) === strId);
        }
        
        if (index === -1) {
            return false;
        }
        
        this.data[tableName].splice(index, 1);
        await this.save();
        return true;
    }
    
    // 查找记录
    find(tableName, predicate) {
        if (!this.data[tableName]) {
            return [];
        }
        
        if (typeof predicate === 'function') {
            return this.data[tableName].filter(predicate);
        } else if (typeof predicate === 'object') {
            return this.data[tableName].filter(item => {
                return Object.keys(predicate).every(key => 
                    item[key] === predicate[key]);
            });
        }
        
        return this.data[tableName];
    }
    
    // 查找单个记录
    findOne(tableName, predicate) {
        const results = this.find(tableName, predicate);
        return results.length > 0 ? results[0] : null;
    }
    
    // 根据ID查找（支持数字和字符串ID混合查找）
    findById(tableName, id) {
        if (!this.data[tableName]) {
            return null;
        }
        
        // 先尝试严格匹配，如果找不到再尝试类型转换匹配
        let item = this.data[tableName].find(item => item.id === id);
        if (item) return item;
        
        // 尝试转换为字符串匹配
        const strId = String(id);
        item = this.data[tableName].find(item => String(item.id) === strId);
        
        return item || null;
    }
    
    // 获取设置
    getSetting(key, defaultValue = null) {
        const value = this.data.settings[key];
        return value === undefined || value === null ? defaultValue : value;
    }
    
    // 设置配置
    async setSetting(key, value) {
        this.data.settings[key] = value;
        await this.save();
    }
    
    // 获取所有设置
    getAllSettings() {
        return { ...this.data.settings };
    }
}

// 创建数据库实例
const db = new SimpleDatabase();

// 初始化函数
async function initDatabase() {
    await db.init();
    return db;
}

// 获取数据库实例
function getDatabase() {
    return db;
}

// 检查数据库是否存在
function databaseExists() {
    return fsSync.existsSync(DB_FILE);
}

module.exports = {
    initDatabase,
    getDatabase,
    databaseExists,
    SimpleDatabase
};