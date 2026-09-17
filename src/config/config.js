const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { getDatabase } = require('../database/simple-db');

// 配置文件路径
const CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'app.json');
const USER_CONFIG_FILE = path.join(CONFIG_DIR, 'user.json');

// 默认配置
const DEFAULT_CONFIG = {
    // 应用基础配置
    app: {
        name: '万象匣',
        version: '1.0.0',
        debug: false,
        autoSave: true,
        autoSaveInterval: 300000, // 5分钟
        startMinimized: false,
        closeToTray: true
    },
    
    // 界面配置
    ui: {
        theme: 'light', // light, dark
        language: 'zh-CN',
        fontSize: 14,
        windowSize: {
            width: 1200,
            height: 800,
            minWidth: 1000,
            minHeight: 600
        },
        windowPosition: {
            x: null,
            y: null
        },
        showSidebar: true,
        sidebarWidth: 250
    },
    
    // SSH连接配置
    ssh: {
        defaultPort: 22,
        timeout: 30000,
        keepAlive: true,
        keepAliveInterval: 10000,
        maxConcurrentConnections: 20,
        retryAttempts: 3,
        retryDelay: 1000,
        compression: true,
        defaultUsername: '',
        defaultKeyPath: ''
    },
    
    // 任务执行配置
    execution: {
        maxConcurrentTasks: 10,
        taskTimeout: 300000, // 5分钟
        defaultConcurrency: 1, // 默认并发数（1-20）
        defaultTimeout: 300, // 默认超时时间（秒，最低10）
        logLevel: 'info', // debug, info, warn, error
        saveResults: true,
        resultsRetentionDays: 30,
        showProgressDetails: true
    },
    
    // 数据配置
    data: {
        autoBackup: true,
        backupInterval: 86400000, // 24小时
        maxBackups: 7,
        backupPath: path.join(app.getPath('userData'), 'backups'),
        exportFormat: 'csv' // csv, json, xlsx
    },
    
    // 安全配置
    security: {
        encryptPasswords: true,
        encryptPrivateKeys: true,
        sessionTimeout: 3600000, // 1小时
        autoLock: false,
        lockAfterInactivity: 1800000, // 30分钟
        requirePasswordForSensitiveOperations: true
    },
    
    // 日志配置
    logging: {
        enabled: true,
        level: 'info',
        maxFileSize: 10485760, // 10MB
        maxFiles: 5,
        logPath: path.join(app.getPath('userData'), 'logs')
    },
    
    // 更新配置
    updates: {
        autoCheck: true,
        checkInterval: 86400000, // 24小时
        includePrerelease: false,
        downloadPath: path.join(app.getPath('userData'), 'updates')
    }
};

// 用户自定义配置
let userConfig = {};
let isConfigLoaded = false;

// 配置管理类
class ConfigManager {
    constructor() {
        this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        this.userConfig = {};
        this.listeners = new Map();
    }
    
    // 初始化配置
    async init() {
        try {
            // 确保配置目录存在
            this.ensureConfigDir();
            
            // 加载用户配置
            await this.loadUserConfig();
            
            // 从数据库加载设置
            await this.loadDatabaseSettings();
            
            // 合并配置
            this.mergeConfigs();
            
            isConfigLoaded = true;
            console.log('配置管理系统初始化完成');
            
        } catch (error) {
            console.error('配置初始化失败:', error);
            throw error;
        }
    }
    
    // 确保配置目录存在
    ensureConfigDir() {
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }
        
        // 确保其他必要目录存在
        const dirs = [
            this.config.data.backupPath,
            this.config.logging.logPath,
            this.config.updates.downloadPath
        ];
        
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }
    
    // 加载用户配置文件
    async loadUserConfig() {
        try {
            if (fs.existsSync(USER_CONFIG_FILE)) {
                const data = fs.readFileSync(USER_CONFIG_FILE, 'utf8');
                this.userConfig = JSON.parse(data);
                console.log('用户配置加载成功');
            }
        } catch (error) {
            console.error('加载用户配置失败:', error);
            this.userConfig = {};
        }
    }
    
    // 从简化数据库加载设置
    async loadDatabaseSettings() {
        try {
            const db = getDatabase();
            const dbSettings = db.getAllSettings();
            
            // 将数据库设置映射到配置结构
            Object.keys(dbSettings).forEach(key => {
                this.setByPath(key, dbSettings[key]);
            });
            
            console.log('数据库设置加载成功');
        } catch (error) {
            console.error('加载数据库设置失败:', error);
        }
    }
    
    // 合并配置
    mergeConfigs() {
        // 使用深拷贝避免与 DEFAULT_CONFIG 共享引用，否则 setByPath 会同时修改 DEFAULT_CONFIG
        const baseConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        this.config = this.deepMerge(baseConfig, this.userConfig);
    }
    
    // 深度合并对象（确保所有嵌套对象都是独立副本）
    deepMerge(target, source) {
        const result = {};
        
        // 先深拷贝 target 的所有键
        for (const key in target) {
            if (target.hasOwnProperty(key)) {
                if (typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key])) {
                    result[key] = this.deepMerge(target[key], {});
                } else if (Array.isArray(target[key])) {
                    result[key] = [...target[key]];
                } else {
                    result[key] = target[key];
                }
            }
        }
        
        // 再用 source 的值覆盖（递归合并对象类型）
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                    result[key] = this.deepMerge(result[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }
        
        return result;
    }
    
    // 获取配置值
    get(path, defaultValue = null) {
        const value = this.getByPath(path);
        return value === undefined || value === null ? defaultValue : value;
    }
    
    // 设置配置值
    async set(path, value, saveToDatabase = false) {
        this.setByPath(path, value);
        
        // 保存到用户配置文件
        await this.saveUserConfig();
        
        // 保存到数据库
        if (saveToDatabase) {
            await this.saveToDatabese(path, value);
        }
        
        // 触发配置变更事件
        this.notifyListeners(path, value);
    }
    
    // 根据路径获取值
    getByPath(path) {
        const keys = path.split('.');
        let current = this.config;
        
        for (const key of keys) {
            if (current[key] === undefined) {
                return undefined;
            }
            current = current[key];
        }
        
        return current;
    }
    
    // 根据路径设置值
    setByPath(path, value) {
        const keys = path.split('.');
        let current = this.config;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[keys[keys.length - 1]] = value;
    }
    
    // 保存用户配置
    async saveUserConfig() {
        try {
            // 只保存与默认配置不同的值
            const diffConfig = this.getDifferenceFromDefault();
            
            fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(diffConfig, null, 2));
            console.log('用户配置保存成功');
        } catch (error) {
            console.error('保存用户配置失败:', error);
            throw error;
        }
    }
    
    // 保存到简化数据库
    async saveToDatabese(path, value) {
        try {
            const db = getDatabase();
            await db.setSetting(path, value);
        } catch (error) {
            console.error('保存配置到数据库失败:', error);
        }
    }
    
    // 获取与默认配置的差异
    getDifferenceFromDefault() {
        return this.getDifference(DEFAULT_CONFIG, this.config);
    }
    
    // 获取两个对象的差异
    getDifference(obj1, obj2) {
        const diff = {};
        
        for (const key in obj2) {
            if (obj2.hasOwnProperty(key)) {
                if (typeof obj2[key] === 'object' && obj2[key] !== null && !Array.isArray(obj2[key])) {
                    const nestedDiff = this.getDifference(obj1[key] || {}, obj2[key]);
                    if (Object.keys(nestedDiff).length > 0) {
                        diff[key] = nestedDiff;
                    }
                } else if (obj1[key] !== obj2[key]) {
                    diff[key] = obj2[key];
                }
            }
        }
        
        return diff;
    }
    
    // 重置配置
    async reset(section = null) {
        if (section) {
            this.config[section] = { ...DEFAULT_CONFIG[section] };
        } else {
            this.config = { ...DEFAULT_CONFIG };
        }
        
        await this.saveUserConfig();
        console.log(`配置重置完成: ${section || 'all'}`);
    }
    
    // 监听配置变更
    onChange(path, callback) {
        if (!this.listeners.has(path)) {
            this.listeners.set(path, []);
        }
        this.listeners.get(path).push(callback);
    }
    
    // 移除监听器
    removeListener(path, callback) {
        if (this.listeners.has(path)) {
            const listeners = this.listeners.get(path);
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }
    
    // 通知监听器
    notifyListeners(path, value) {
        if (this.listeners.has(path)) {
            this.listeners.get(path).forEach(callback => {
                try {
                    callback(value, path);
                } catch (error) {
                    console.error('配置监听器执行失败:', error);
                }
            });
        }
    }
    
    // 导出配置
    export(filePath, format = 'json') {
        try {
            let content;
            
            switch (format.toLowerCase()) {
                case 'json':
                    content = JSON.stringify(this.config, null, 2);
                    break;
                case 'yaml':
                    // 这里可以添加YAML序列化支持
                    throw new Error('YAML格式暂不支持');
                default:
                    throw new Error(`不支持的格式: ${format}`);
            }
            
            fs.writeFileSync(filePath, content);
            console.log(`配置导出成功: ${filePath}`);
        } catch (error) {
            console.error('配置导出失败:', error);
            throw error;
        }
    }
    
    // 导入配置
    async import(filePath, merge = true) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const importedConfig = JSON.parse(content);
            
            if (merge) {
                this.config = this.deepMerge(this.config, importedConfig);
            } else {
                this.config = { ...DEFAULT_CONFIG, ...importedConfig };
            }
            
            await this.saveUserConfig();
            console.log(`配置导入成功: ${filePath}`);
        } catch (error) {
            console.error('配置导入失败:', error);
            throw error;
        }
    }
    
    // 验证配置
    validate() {
        const errors = [];
        
        // 验证SSH配置
        if (this.config.ssh.defaultPort < 1 || this.config.ssh.defaultPort > 65535) {
            errors.push('SSH默认端口必须在1-65535之间');
        }
        
        if (this.config.ssh.timeout < 1000) {
            errors.push('SSH超时时间不能少于1秒');
        }
        
        if (this.config.ssh.maxConcurrentConnections < 1) {
            errors.push('最大并发连接数必须大于0');
        }
        
        // 验证UI配置
        if (this.config.ui.windowSize.width < this.config.ui.windowSize.minWidth) {
            errors.push('窗口宽度不能小于最小宽度');
        }
        
        if (this.config.ui.windowSize.height < this.config.ui.windowSize.minHeight) {
            errors.push('窗口高度不能小于最小高度');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    // 获取所有配置
    getAll() {
        return { ...this.config };
    }
}

// 创建全局配置管理器实例
const configManager = new ConfigManager();

// 加载配置
async function loadConfig() {
    await configManager.init();
    return configManager;
}

// 获取配置值
function getConfig(path, defaultValue = null) {
    if (!isConfigLoaded) {
        console.warn('配置尚未加载完成');
        return defaultValue;
    }
    return configManager.get(path, defaultValue);
}

// 设置配置值
async function setConfig(path, value, saveToDatabase = false) {
    await configManager.set(path, value, saveToDatabase);
}

module.exports = {
    ConfigManager,
    configManager,
    loadConfig,
    getConfig,
    setConfig,
    DEFAULT_CONFIG,
    CONFIG_DIR,
    CONFIG_FILE,
    USER_CONFIG_FILE
};