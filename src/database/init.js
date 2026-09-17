const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// 数据库文件路径
const DB_PATH = path.join(__dirname, '../../database/ssh_tools.db');

// 确保数据库目录存在
function ensureDatabaseDir() {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
}

// 数据库表结构定义
const TABLES = {
    // 主机信息表
    hosts: `
        CREATE TABLE IF NOT EXISTS hosts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hostname TEXT NOT NULL,
            ip TEXT NOT NULL,
            port INTEGER DEFAULT 22,
            username TEXT NOT NULL,
            password TEXT,
            private_key_path TEXT,
            public_key_path TEXT,
            description TEXT,
            group_name TEXT,
            tags TEXT, -- JSON字符串存储标签
            status TEXT DEFAULT 'unknown', -- online, offline, auth_failed, testing, unknown
            
            -- 扩展字段
            system_name TEXT DEFAULT '', -- 系统名称
            app_name TEXT DEFAULT '', -- 应用名称
            datacenter TEXT DEFAULT '', -- 机房位置
            environment TEXT DEFAULT '', -- 环境标识
            owner TEXT DEFAULT '', -- 负责人
            
            -- 硬件信息字段
            cpu_info TEXT DEFAULT '',
            memory_info TEXT DEFAULT '',
            disk_info TEXT DEFAULT '',
            os_info TEXT DEFAULT '',
            kernel_version TEXT DEFAULT '',  -- 内核版本，如 2.6.32-642.el6.x86_64
            os_type TEXT DEFAULT '',         -- 系统类型，如 Red Hat / CentOS / Ubuntu
            os_version TEXT DEFAULT '',      -- 系统版本，如 6.8 / 7.9 / 22.04
            
            -- 系统信息收集相关
            last_info_collected_at DATETIME,
            system_info_json TEXT DEFAULT '',
            
            last_connected_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ip, port, username)
        )
    `,
    
    // 脚本信息表
    scripts: `
        CREATE TABLE IF NOT EXISTS scripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'custom', -- system, network, database, custom等
            language TEXT DEFAULT 'bash', -- bash, python, powershell, shell等
            tags TEXT, -- JSON字符串存储标签
            is_builtin BOOLEAN DEFAULT 0,
            author TEXT,
            usage_notes TEXT, -- 使用说明
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // 任务执行历史表
    task_executions: `
        CREATE TABLE IF NOT EXISTS task_executions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_name TEXT NOT NULL,
            script_id INTEGER,
            script_content TEXT, -- 临时命令内容（仅用于临时命令）
            is_temporary_command BOOLEAN DEFAULT 0, -- 是否为临时命令
            is_file_upload BOOLEAN DEFAULT 0, -- 是否为文件上传任务
            upload_files TEXT, -- JSON数组存储上传文件列表（文件上传任务）
            target_path TEXT, -- 目标路径（文件上传任务）
            conflict_strategy TEXT, -- 文件冲突策略：overwrite, skip, backup（文件上传任务）
            path_create_strategy TEXT, -- 路径创建策略：auto, error（文件上传任务）
            execution_type TEXT DEFAULT 'immediate', -- 执行类型：immediate(立即)/scheduled(定时)
            scheduled_time TEXT, -- 计划执行时间（ISO 8601格式）
            host_ids TEXT NOT NULL, -- JSON数组存储主机ID列表
            parameters TEXT, -- JSON字符串存储执行参数
            status TEXT DEFAULT 'pending', -- pending, scheduled, running, completed, failed, cancelled
            start_time DATETIME,
            end_time DATETIME,
            total_hosts INTEGER DEFAULT 0,
            success_hosts INTEGER DEFAULT 0,
            failed_hosts INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (script_id) REFERENCES scripts (id)
        )
    `,
    
    // 任务执行结果详情表
    task_results: `
        CREATE TABLE IF NOT EXISTS task_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_execution_id INTEGER NOT NULL,
            host_id INTEGER NOT NULL,
            status TEXT DEFAULT 'pending', -- pending, running, success, failed, timeout
            stdout TEXT,
            stderr TEXT,
            exit_code INTEGER,
            start_time DATETIME,
            end_time DATETIME,
            duration INTEGER, -- 执行耗时（毫秒）
            error_message TEXT,
            FOREIGN KEY (task_execution_id) REFERENCES task_executions (id),
            FOREIGN KEY (host_id) REFERENCES hosts (id)
        )
    `,
    
    // 配置表
    settings: `
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            description TEXT,
            type TEXT DEFAULT 'string', -- string, number, boolean, json
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // SSH密钥管理表
    ssh_keys: `
        CREATE TABLE IF NOT EXISTS ssh_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            public_key_path TEXT NOT NULL,
            private_key_path TEXT NOT NULL,
            passphrase TEXT,
            description TEXT,
            is_default BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // 主机组表
    host_groups: `
        CREATE TABLE IF NOT EXISTS host_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            color TEXT DEFAULT '#3498db',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // 日志表
    logs: `
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT NOT NULL, -- debug, info, warn, error
            message TEXT NOT NULL,
            module TEXT,
            context TEXT, -- JSON字符串存储上下文信息
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `
};

// 索引定义
const INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_hosts_ip ON hosts(ip)',
    'CREATE INDEX IF NOT EXISTS idx_hosts_status ON hosts(status)',
    'CREATE INDEX IF NOT EXISTS idx_hosts_group ON hosts(group_name)',
    'CREATE INDEX IF NOT EXISTS idx_scripts_category ON scripts(category)',
    'CREATE INDEX IF NOT EXISTS idx_task_executions_status ON task_executions(status)',
    'CREATE INDEX IF NOT EXISTS idx_task_executions_created ON task_executions(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_task_results_task_id ON task_results(task_execution_id)',
    'CREATE INDEX IF NOT EXISTS idx_task_results_host_id ON task_results(host_id)',
    'CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)',
    'CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at)'
];

// 默认配置数据
const DEFAULT_SETTINGS = [
    {
        key: 'ssh_timeout',
        value: '30000',
        description: 'SSH连接超时时间（毫秒）',
        type: 'number'
    },
    {
        key: 'max_concurrent_connections',
        value: '20',
        description: '最大并发连接数',
        type: 'number'
    },
    {
        key: 'default_ssh_port',
        value: '22',
        description: '默认SSH端口',
        type: 'number'
    },
    {
        key: 'auto_save_interval',
        value: '300000',
        description: '自动保存间隔（毫秒）',
        type: 'number'
    },
    {
        key: 'theme',
        value: 'light',
        description: '界面主题',
        type: 'string'
    },
    {
        key: 'language',
        value: 'zh-CN',
        description: '界面语言',
        type: 'string'
    },
    {
        key: 'enable_logging',
        value: 'true',
        description: '启用日志记录',
        type: 'boolean'
    },
    {
        key: 'log_level',
        value: 'info',
        description: '日志级别',
        type: 'string'
    }
];

// 内置脚本数据
const BUILTIN_SCRIPTS = [
    {
        name: '系统信息收集',
        description: '收集服务器基本系统信息，包括CPU、内存、磁盘等',
        content: `#!/bin/bash
# 系统信息收集脚本

echo "=== 系统信息 ==="
echo "主机名: $(hostname)"
echo "操作系统: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'=' -f2 | tr -d '"')"
echo "内核版本: $(uname -r)"
echo "架构: $(uname -m)"

echo "=== CPU信息 ==="
echo "CPU核数: $(nproc)"
echo "CPU型号: $(cat /proc/cpuinfo | grep 'model name' | head -1 | cut -d':' -f2 | xargs)"

echo "=== 内存信息 ==="
free -h

echo "=== 磁盘信息 ==="
df -h

echo "=== 网络信息 ==="
ip addr show | grep inet | head -5

echo "=== 系统负载 ==="
uptime`,
        category: 'system',
        language: 'bash',
        tags: '["系统", "信息收集", "监控"]',
        is_builtin: 1,
        author: '万象匣',
        usage_notes: '无需参数，直接执行即可获取服务器完整系统信息'
    },
    {
        name: '端口扫描',
        description: '扫描指定IP的开放端口',
        content: `#!/bin/bash
# 端口扫描脚本

TARGET_IP=\${1:-"127.0.0.1"}
START_PORT=\${2:-1}
END_PORT=\${3:-1000}

echo "扫描目标: \$TARGET_IP"
echo "端口范围: \$START_PORT - \$END_PORT"
echo "开始扫描..."

for port in $(seq \$START_PORT \$END_PORT); do
    timeout 1 bash -c "echo >/dev/tcp/\$TARGET_IP/\$port" 2>/dev/null && echo "端口 \$port: 开放"
done

echo "扫描完成"`,
        category: 'network',
        language: 'bash',
        tags: '["网络", "端口扫描", "安全"]',
        is_builtin: 1,
        author: '万象匣',
        usage_notes: '参数1: 目标IP（默认127.0.0.1）\n参数2: 起始端口（默认1）\n参数3: 结束端口（默认1000）'
    },
    {
        name: '服务状态检查',
        description: '检查常见服务的运行状态',
        content: `#!/bin/bash
# 服务状态检查脚本

SERVICES=("ssh" "nginx" "apache2" "mysql" "redis" "docker")

echo "=== 服务状态检查 ==="

for service in "\${SERVICES[@]}"; do
    if systemctl is-active --quiet \$service; then
        echo "\$service: 运行中 ✓"
    elif systemctl is-enabled --quiet \$service 2>/dev/null; then
        echo "\$service: 已安装但未运行 ✗"
    else
        echo "\$service: 未安装 -"
    fi
done

echo "=== 监听端口 ==="
netstat -tlnp | head -10`,
        category: 'system',
        language: 'bash',
        tags: '["系统", "服务", "监控"]',
        is_builtin: 1,
        author: '万象匣',
        usage_notes: '自动检查ssh、nginx、apache2、mysql、redis、docker等常见服务状态'
    },
    {
        name: '磁盘空间清理',
        description: '查找并清理大文件和日志',
        content: `#!/bin/bash
# 磁盘空间清理脚本

echo "=== 磁盘使用情况 ==="
df -h

echo ""
echo "=== 查找大于100M的文件 ==="
find /var /tmp -type f -size +100M -exec ls -lh {} \; 2>/dev/null | head -20

echo ""
echo "=== 日志文件大小 ==="
du -sh /var/log/* 2>/dev/null | sort -rh | head -10

echo ""
echo "=== 清理建议 ==="
echo "1. 清理apt缓存: sudo apt clean"
echo "2. 清理日志: sudo journalctl --vacuum-time=7d"
echo "3. 删除旧内核: sudo apt autoremove"`,
        category: 'maintenance',
        language: 'bash',
        tags: '["维护", "清理", "磁盘"]',
        is_builtin: 1,
        author: '万象匣',
        usage_notes: '分析磁盘使用情况并提供清理建议，不会自动删除文件'
    }
];

// 数据库schema迁移（为已存在的数据库添加新字段）
async function migrateSchema() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) { return reject(err); }

            // 需要添加的新列：[列名, SQL类型+默认值]
            const newColumns = [
                ['kernel_version', "TEXT DEFAULT ''"],
                ['os_type',        "TEXT DEFAULT ''"],
                ['os_version',     "TEXT DEFAULT ''"]
            ];

            db.all('PRAGMA table_info(hosts)', (err, rows) => {
                if (err) { db.close(); return reject(err); }

                const existingCols = new Set(rows.map(r => r.name));
                const pending = newColumns.filter(([col]) => !existingCols.has(col));

                if (pending.length === 0) {
                    console.log('schema迁移：hosts表无需更新');
                    return db.close(() => resolve());
                }

                db.serialize(() => {
                    let done = 0;
                    pending.forEach(([col, def]) => {
                        db.run(`ALTER TABLE hosts ADD COLUMN ${col} ${def}`, (err) => {
                            if (err) console.error(`添加列 ${col} 失败:`, err);
                            else console.log(`schema迁移：已添加列 hosts.${col}`);
                            if (++done === pending.length) {
                                db.close(() => resolve());
                            }
                        });
                    });
                });
            });
        });
    });
}

// 数据库初始化函数
async function initDatabase() {
    return new Promise((resolve, reject) => {
        try {
            // 确保数据库目录存在
            ensureDatabaseDir();
            
            console.log('正在初始化数据库...');
            
            const db = new sqlite3.Database(DB_PATH, (err) => {
                if (err) {
                    console.error('数据库连接失败:', err);
                    reject(err);
                    return;
                }
                
                console.log('数据库连接成功');
                
                // 开始事务
                db.serialize(() => {
                    // 创建表
                    let tableCount = 0;
                    const tableNames = Object.keys(TABLES);
                    
                    tableNames.forEach(tableName => {
                        db.run(TABLES[tableName], (err) => {
                            if (err) {
                                console.error(`创建表 ${tableName} 失败:`, err);
                                reject(err);
                                return;
                            }
                            
                            console.log(`表 ${tableName} 创建成功`);
                            tableCount++;
                            
                            if (tableCount === tableNames.length) {
                                // 所有表创建完成，创建索引
                                createIndexes(db, () => {
                                    // 插入默认数据
                                    insertDefaultData(db, () => {
                                        db.close((err) => {
                                            if (err) {
                                                console.error('关闭数据库失败:', err);
                                                reject(err);
                                            } else {
                                                console.log('数据库初始化完成');
                                                resolve();
                                            }
                                        });
                                    });
                                });
                            }
                        });
                    });
                });
            });
            
        } catch (error) {
            console.error('数据库初始化失败:', error);
            reject(error);
        }
    });
}

// 创建索引
function createIndexes(db, callback) {
    let indexCount = 0;
    
    INDEXES.forEach(indexSql => {
        db.run(indexSql, (err) => {
            if (err) {
                console.error('创建索引失败:', err);
            } else {
                console.log('索引创建成功');
            }
            
            indexCount++;
            if (indexCount === INDEXES.length) {
                callback();
            }
        });
    });
}

// 插入默认数据
function insertDefaultData(db, callback) {
    // 插入默认配置
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value, description, type) VALUES (?, ?, ?, ?)');
    
    DEFAULT_SETTINGS.forEach(setting => {
        insertSetting.run(setting.key, setting.value, setting.description, setting.type);
    });
    insertSetting.finalize();
    
    // 插入内置脚本
    const insertScript = db.prepare('INSERT OR IGNORE INTO scripts (name, description, content, category, language, tags, is_builtin, author, usage_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    
    BUILTIN_SCRIPTS.forEach(script => {
        insertScript.run(
            script.name,
            script.description,
            script.content,
            script.category,
            script.language,
            script.tags,
            script.is_builtin,
            script.author,
            script.usage_notes
        );
    });
    insertScript.finalize();
    
    console.log('默认数据插入完成');
    callback();
}

// 获取数据库连接
function getDatabase() {
    return new sqlite3.Database(DB_PATH);
}

// 检查数据库是否存在
function databaseExists() {
    return fs.existsSync(DB_PATH);
}

module.exports = {
    initDatabase,
    migrateSchema,
    getDatabase,
    databaseExists,
    DB_PATH
};