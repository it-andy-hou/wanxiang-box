const { getDatabase } = require('./simple-db');
const { LogService } = require('../main/logService');
function safeJsonParse(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (error) {
        console.warn('JSON parse failed, using fallback:', error.message);
        return fallback;
    }
}


// 主机模型
class HostModel {
    static async findAll() {
        try {
            const db = getDatabase();
            const hosts = db.getTable('hosts');
            return hosts.map(host => this.formatHost(host));
        } catch (error) {
            console.error('查询主机列表失败:', error);
            throw error;
        }
    }
    
    static async findById(id) {
        try {
            const db = getDatabase();
            const host = db.findById('hosts', parseInt(id));
            return this.formatHost(host);
        } catch (error) {
            console.error('查询主机失败:', error);
            throw error;
        }
    }
    
    static async create(hostData) {
        try {
            const db = getDatabase();
            const host = {
                hostname: hostData.hostname,
                system_name: hostData.system_name || '', // 系统名称
                app_name: hostData.app_name || '',       // 应用名称
                ip: hostData.ip,
                port: hostData.port || 22,
                username: hostData.username,
                password: hostData.password || '',
                private_key_path: hostData.private_key_path || '',
                public_key_path: hostData.public_key_path || '',
                description: hostData.description || '',
                tags: JSON.stringify(hostData.tags || []),
                status: 'unknown',
                
                // 硬件信息字段
                cpu_info: hostData.cpu_info || '',      // CPU信息
                memory_info: hostData.memory_info || '', // 内存信息
                disk_info: hostData.disk_info || '',     // 磁盘信息
                os_info: hostData.os_info || '',         // 操作系统信息
                kernel_version: hostData.kernel_version || '', // 内核版本
                os_type: hostData.os_type || '',         // 系统类型
                os_version: hostData.os_version || '',   // 系统版本
                
                // 环境和位置信息
                datacenter: hostData.datacenter || '',   // 机房位置
                environment: hostData.environment || '', // 环境标识
                owner: hostData.owner || '',             // 负责人
                
                // 系统信息收集相关
                last_info_collected_at: null,
                system_info_json: '',
                
                last_connected_at: null
            };
            
            return await db.insert('hosts', host);
        } catch (error) {
            console.error('创建主机失败:', error);
            throw error;
        }
    }
    
    static async update(id, hostData) {
        try {
            const db = getDatabase();
            const updates = {
                hostname: hostData.hostname,
                system_name: hostData.system_name,
                app_name: hostData.app_name,
                ip: hostData.ip,
                port: hostData.port,
                username: hostData.username,
                password: hostData.password,
                private_key_path: hostData.private_key_path,
                public_key_path: hostData.public_key_path,
                description: hostData.description,
                tags: Array.isArray(hostData.tags) ? JSON.stringify(hostData.tags) : hostData.tags,
                
                // 硬件信息字段
                cpu_info: hostData.cpu_info,
                memory_info: hostData.memory_info,
                disk_info: hostData.disk_info,
                os_info: hostData.os_info,
                kernel_version: hostData.kernel_version,
                os_type: hostData.os_type,
                os_version: hostData.os_version,
                
                // 环境和位置信息
                datacenter: hostData.datacenter,
                environment: hostData.environment,
                owner: hostData.owner,
                
                // 系统信息收集相关
                last_info_collected_at: hostData.last_info_collected_at,
                system_info_json: hostData.system_info_json
            };
            
            // 过滤掉undefined值，避免覆盖现有数据
            Object.keys(updates).forEach(key => {
                if (updates[key] === undefined) {
                    delete updates[key];
                }
            });
            
            console.log('更新主机数据:', { id, updates });
            
            // update现在返回更新后的记录，直接格式化
            const result = await db.update('hosts', parseInt(id), updates);
            return this.formatHost(result);
        } catch (error) {
            console.error('更新主机失败:', error);
            throw error;
        }
    }
    
    static async delete(id) {
        try {
            const db = getDatabase();
            return await db.delete('hosts', parseInt(id));
        } catch (error) {
            console.error('删除主机失败:', error);
            throw error;
        }
    }
    
    static async updateStatus(id, status) {
        try {
            const db = getDatabase();
            const updates = {
                status: status,
                last_connected_at: new Date().toISOString()
            };
            
            return await db.update('hosts', parseInt(id), updates);
        } catch (error) {
            console.error('更新主机状态失败:', error);
            throw error;
        }
    }
    
    static formatHost(row) {
        if (!row) return null;
        return {
            ...row,
            // 确保字段映射正确
            systemName: row.system_name || row.systemName || '',
            appName: row.app_name || row.appName || '',
            cpuInfo: row.cpu_info || row.cpuInfo || '',
            memoryInfo: row.memory_info || row.memoryInfo || '',
            osInfo: row.os_info || row.osInfo || '',
            kernelVersion: row.kernel_version || row.kernelVersion || '',
            osType: row.os_type || row.osType || '',
            osVersion: row.os_version || row.osVersion || '',
            privateKeyPath: row.private_key_path || row.privateKeyPath || '',
            publicKeyPath: row.public_key_path || row.publicKeyPath || '',
            tags: safeJsonParse(row.tags, [])
        };
    }
}

// 脚本模型
class ScriptModel {
    static async findAll() {
        try {
            const db = getDatabase();
            const scripts = db.getTable('scripts');
            return scripts.map(script => this.formatScript(script));
        } catch (error) {
            console.error('查询脚本列表失败:', error);
            throw error;
        }
    }
    
    static async findById(id) {
        try {
            const db = getDatabase();
            const script = db.findById('scripts', id);
            return this.formatScript(script);
        } catch (error) {
            console.error('查询脚本失败:', error);
            throw error;
        }
    }
    
    static async findByCategory(category) {
        try {
            const db = getDatabase();
            const scripts = db.getTable('scripts');
            return scripts
                .filter(script => script.category === category)
                .map(script => this.formatScript(script));
        } catch (error) {
            console.error('按分类查询脚本失败:', error);
            throw error;
        }
    }
    
    static async create(scriptData) {
        try {
            const db = getDatabase();
            const script = {
                name: scriptData.name,
                description: scriptData.description || '',
                content: scriptData.content,
                category: scriptData.category || 'custom',
                category_id: scriptData.category_id !== undefined ? scriptData.category_id : null,
                language: scriptData.language || 'bash',
                tags: JSON.stringify(scriptData.tags || []),
                is_builtin: scriptData.is_builtin || 0,
                author: scriptData.author || '',
                usage_notes: scriptData.usage_notes || ''
            };
            
            // 如果传入了ID，则保留（支持字符串ID）
            if (scriptData.id) {
                script.id = scriptData.id;
            }
            
            return await db.insert('scripts', script);
        } catch (error) {
            console.error('创建脚本失败:', error);
            throw error;
        }
    }
    
    static async update(id, scriptData) {
        try {
            const db = getDatabase();
            
            const updates = {
                name: scriptData.name,
                description: scriptData.description,
                content: scriptData.content,
                category: scriptData.category,
                category_id: scriptData.category_id,
                language: scriptData.language,
                tags: Array.isArray(scriptData.tags) ? JSON.stringify(scriptData.tags) : scriptData.tags,
                author: scriptData.author,
                usage_notes: scriptData.usage_notes
            };
            
            // 过滤掉undefined值
            Object.keys(updates).forEach(key => {
                if (updates[key] === undefined) {
                    delete updates[key];
                }
            });
            
            console.log('更新脚本数据:', { id, updates });
            
            // update现在返回更新后的记录，直接格式化
            const result = await db.update('scripts', id, updates);
            return this.formatScript(result);
        } catch (error) {
            console.error('更新脚本失败:', error);
            throw error;
        }
    }
    
    static async delete(id) {
        try {
            const db = getDatabase();
            return await db.delete('scripts', id);
        } catch (error) {
            console.error('删除脚本失败:', error);
            throw error;
        }
    }
    
    static async search(keyword) {
        try {
            const db = getDatabase();
            const scripts = db.getTable('scripts');
            const lowerKeyword = keyword.toLowerCase();
            
            return scripts
                .filter(script => {
                    return script.name.toLowerCase().includes(lowerKeyword) ||
                           (script.description && script.description.toLowerCase().includes(lowerKeyword)) ||
                           (script.tags && script.tags.toLowerCase().includes(lowerKeyword));
                })
                .map(script => this.formatScript(script));
        } catch (error) {
            console.error('搜索脚本失败:', error);
            throw error;
        }
    }
    
    static formatScript(row) {
        if (!row) return null;
        let tags = [];
        if (row.tags) {
            let parsed = row.tags;
            if (typeof parsed === 'string') {
                try {
                    parsed = JSON.parse(parsed);
                } catch (e) {
                    // 非 JSON 字符串，按逗号分隔处理为多个自定义标签
                    parsed = String(row.tags).split(',').map(s => s.trim()).filter(Boolean);
                }
            }
            if (Array.isArray(parsed)) {
                // 规范化：兼容各种历史格式，统一输出 { typeId, typeName, value }
                tags = parsed.map(t => {
                    // 1. 字符串 → 归入自定义标签
                    if (typeof t === 'string') {
                        return { typeId: 4, typeName: '自定义标签', value: t };
                    }
                    if (!t || typeof t !== 'object') return null;
                    // 2. 对象格式：容错多种字段名
                    const typeId = (t.typeId !== undefined && t.typeId !== null) ? Number(t.typeId)
                                  : (t.type_id !== undefined && t.type_id !== null) ? Number(t.type_id)
                                  : 4;
                    const value  = t.value !== undefined ? String(t.value)
                                  : t.name !== undefined ? String(t.name)
                                  : t.label !== undefined ? String(t.label)
                                  : '';
                    if (!value) return null;
                    const TYPE_NAME_MAP = { 1: '环境', 2: '架构', 3: '风险等级', 4: '自定义标签' };
                    const typeName = TYPE_NAME_MAP[typeId] || t.typeName || t.type_name || '自定义标签';
                    return { typeId, typeName, value };
                }).filter(Boolean);
            }
        }
        return {
            ...row,
            tags,
            category_id: row.category_id || null,
            usageNotes: row.usage_notes || row.usageNotes || ''
        };
    }
}

// ============================================================
// 脚本目录模型
// ============================================================
class ScriptCategoryModel {
    static getAll() {
        const db = getDatabase();
        return db.getTable('script_categories').sort((a, b) => {
            if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
            return a.name.localeCompare(b.name, 'zh');
        });
    }

    /** 构建树形结构 [{...cat, children:[...]}] */
    static buildTree() {
        const all = this.getAll();
        const top = all.filter(c => !c.parent_id);
        return top.map(cat => ({
            ...cat,
            children: all.filter(c => c.parent_id == cat.id)
        }));
    }

    static async create(data) {
        const db = getDatabase();
        const record = {
            name: data.name.trim(),
            parent_id: data.parent_id || null,
            sort_order: data.sort_order || 0
        };
        return await db.insert('script_categories', record);
    }

    static async update(id, data) {
        const db = getDatabase();
        const updates = {};
        if (data.name !== undefined) updates.name = data.name.trim();
        if (data.sort_order !== undefined) updates.sort_order = data.sort_order;
        return await db.update('script_categories', id, updates);
    }

    static async delete(id) {
        const db = getDatabase();
        // 先把该目录下的脚本 category_id 置为 null
        const scripts = db.getTable('scripts');
        for (const s of scripts) {
            if (s.category_id == id) {
                await db.update('scripts', s.id, { category_id: null });
            }
        }
        // 删除子目录及其脚本归属
        const children = db.getTable('script_categories').filter(c => c.parent_id == id);
        for (const child of children) {
            await this.delete(child.id);
        }
        return await db.delete('script_categories', id);
    }
}

// ============================================================
// 标签类型 / 标签值模型
// ============================================================
const DEFAULT_TAG_TYPES = [
    { id: 1, name: '环境',      is_system: true  },
    { id: 2, name: '架构',      is_system: true  },
    { id: 3, name: '风险等级',  is_system: true  },
    { id: 4, name: '自定义标签', is_system: false }
];

const DEFAULT_TAG_VALUES = [
    // 环境
    { id: 1, type_id: 1, value: '测试',      sort_order: 0 },
    { id: 2, type_id: 1, value: '预发',      sort_order: 1 },
    { id: 3, type_id: 1, value: '生产',      sort_order: 2 },
    // 架构
    { id: 4, type_id: 2, value: 'X86',       sort_order: 0 },
    { id: 5, type_id: 2, value: 'ARM',       sort_order: 1 },
    { id: 6, type_id: 2, value: '麒麟 SP2',  sort_order: 2 },
    { id: 7, type_id: 2, value: '麒麟 SP3',  sort_order: 3 },
    // 风险等级
    { id: 8, type_id: 3, value: '普通',      sort_order: 0 },
    { id: 9, type_id: 3, value: '高危',      sort_order: 1 }
];

class TagTypeModel {
    /** 若 tag_types 为空则写入种子数据 */
    static async seedIfEmpty() {
        const db = getDatabase();
        if (db.getTable('tag_types').length === 0) {
            for (const t of DEFAULT_TAG_TYPES) {
                const { created_at, updated_at, ...rest } = t;
                await db.insert('tag_types', { ...rest });
            }
        }
        if (db.getTable('tag_values').length === 0) {
            for (const v of DEFAULT_TAG_VALUES) {
                const { created_at, updated_at, ...rest } = v;
                await db.insert('tag_values', { ...rest });
            }
        }
    }

    static getAll() {
        const db = getDatabase();
        return db.getTable('tag_types').sort((a, b) => a.id - b.id);
    }

    static getValues(typeId) {
        const db = getDatabase();
        return db.getTable('tag_values')
            .filter(v => v.type_id == typeId)
            .sort((a, b) => a.sort_order - b.sort_order);
    }

    static getAllValues() {
        const db = getDatabase();
        return db.getTable('tag_values');
    }

    static async createValue(typeId, value) {
        const db = getDatabase();
        const existing = db.getTable('tag_values').filter(v => v.type_id == typeId);
        const maxOrder = existing.reduce((m, v) => Math.max(m, v.sort_order || 0), -1);
        return await db.insert('tag_values', { type_id: typeId, value: value.trim(), sort_order: maxOrder + 1 });
    }

    static async deleteValue(id) {
        const db = getDatabase();
        return await db.delete('tag_values', id);
    }
}

// ============================================================
// 快捷面板模型
// ============================================================
const MAX_SHORTCUTS = 10;

class ScriptShortcutModel {
    static getAll() {
        const db = getDatabase();
        const shortcuts = db.getTable('script_shortcuts').sort((a, b) => a.sort_order - b.sort_order);
        const scripts = db.getTable('scripts');
        return shortcuts.map(sc => {
            const script = scripts.find(s => String(s.id) === String(sc.script_id));
            return script ? { ...sc, script: ScriptModel.formatScript(script) } : null;
        }).filter(Boolean);
    }

    static async add(scriptId) {
        const db = getDatabase();
        const existing = db.getTable('script_shortcuts');
        if (existing.some(s => String(s.script_id) === String(scriptId))) {
            throw new Error('该脚本已在快捷面板中');
        }
        if (existing.length >= MAX_SHORTCUTS) {
            throw new Error(`快捷面板最多支持 ${MAX_SHORTCUTS} 个脚本`);
        }
        const maxOrder = existing.reduce((m, s) => Math.max(m, s.sort_order || 0), -1);
        return await db.insert('script_shortcuts', { script_id: scriptId, sort_order: maxOrder + 1 });
    }

    static async remove(scriptId) {
        const db = getDatabase();
        const item = db.getTable('script_shortcuts').find(s => String(s.script_id) === String(scriptId));
        if (!item) return false;
        return await db.delete('script_shortcuts', item.id);
    }

    static async reorder(orderedScriptIds) {
        const db = getDatabase();
        for (let i = 0; i < orderedScriptIds.length; i++) {
            const item = db.getTable('script_shortcuts').find(s => String(s.script_id) === String(orderedScriptIds[i]));
            if (item) {
                await db.update('script_shortcuts', item.id, { sort_order: i });
            }
        }
        return this.getAll();
    }
}

// 任务执行模型
class TaskModel {
    static async findAll() {
        try {
            const db = getDatabase();
            const tasks = db.getTable('task_executions');
            return tasks.map(task => this.formatTask(task));
        } catch (error) {
            console.error('查询任务列表失败:', error);
            throw error;
        }
    }
    
    static async findById(id) {
        try {
            const db = getDatabase();
            // 支持数字和字符串ID
            const task = db.findById('task_executions', id);
            return this.formatTask(task);
        } catch (error) {
            console.error('查询任务失败:', error);
            throw error;
        }
    }
    
    static async create(taskData) {
        try {
            const db = getDatabase();
            const task = {
                task_name: taskData.task_name,
                script_id: taskData.script_id,
                script_content: taskData.script_content || '', // 临时命令内容
                is_temporary_command: taskData.is_temporary_command ? 1 : 0, // 是否为临时命令
                is_file_upload: taskData.is_file_upload ? 1 : 0, // 是否为文件上传
                upload_files: taskData.upload_files ? JSON.stringify(taskData.upload_files) : '', // 上传文件列表
                target_path: taskData.target_path || '', // 目标路径
                conflict_strategy: taskData.conflict_strategy || 'backup', // 文件冲突策略
                path_create_strategy: taskData.path_create_strategy || 'error', // 路径创建策略
                execution_type: taskData.execution_type || 'immediate', // 执行类型
                scheduled_time: taskData.scheduled_time || null, // 计划执行时间
                host_ids: JSON.stringify(taskData.host_ids || []),
                parameters: JSON.stringify(taskData.parameters || {}),
                status: taskData.execution_type === 'scheduled' ? 'scheduled' : 'pending',
                total_hosts: taskData.host_ids ? taskData.host_ids.length : 0,
                success_hosts: 0,
                failed_hosts: 0
            };
            
            return await db.insert('task_executions', task);
        } catch (error) {
            console.error('创建任务失败:', error);
            throw error;
        }
    }
    
    static async update(id, taskData) {
        try {
            const db = getDatabase();
            const updates = {};
            
            if (taskData.task_name !== undefined) updates.task_name = taskData.task_name;
            if (taskData.script_id !== undefined) updates.script_id = taskData.script_id;
            if (taskData.script_content !== undefined) updates.script_content = taskData.script_content;
            if (taskData.host_ids !== undefined) updates.host_ids = JSON.stringify(taskData.host_ids);
            if (taskData.parameters !== undefined) updates.parameters = JSON.stringify(taskData.parameters);
            if (taskData.execution_type !== undefined) updates.execution_type = taskData.execution_type;
            if (taskData.scheduled_time !== undefined) updates.scheduled_time = taskData.scheduled_time;
            if (taskData.status !== undefined) updates.status = taskData.status;
            if (taskData.start_time !== undefined) updates.start_time = taskData.start_time;
            if (taskData.end_time !== undefined) updates.end_time = taskData.end_time;
            if (taskData.success_hosts !== undefined) updates.success_hosts = taskData.success_hosts;
            if (taskData.failed_hosts !== undefined) updates.failed_hosts = taskData.failed_hosts;
            
            console.log('更新任务数据:', { id, updates });
            
            // 支持数字和字符串ID
            const result = await db.update('task_executions', id, updates);
            // update现在返回更新后的记录，直接格式化
            return this.formatTask(result);
        } catch (error) {
            console.error('更新任务失败:', error);
            throw error;
        }
    }
    
    static async delete(id) {
        try {
            const db = getDatabase();
            // 先删除相关的任务结果（支持数字和字符串ID）
            const results = db.getTable('task_results');
            const strId = String(id);
            const filteredResults = results.filter(r => String(r.task_execution_id) === strId);
            
            for (const result of filteredResults) {
                await db.delete('task_results', result.id);
            }
            
            // 删除任务相关的日志文件
            await LogService.deleteLogsForTask(id);
            
            // 删除任务本身
            return await db.delete('task_executions', id);
        } catch (error) {
            console.error('删除任务失败:', error);
            throw error;
        }
    }
    
    static formatTask(row) {
        if (!row) return null;
        return {
            ...row,
            host_ids: safeJsonParse(row.host_ids, []),
            parameters: safeJsonParse(row.parameters, {}),
            upload_files: safeJsonParse(row.upload_files, [])
        };
    }
}

// 任务结果模型
class TaskResultModel {
    static async findByTaskId(taskId) {
        try {
            const db = getDatabase();
            const results = db.getTable('task_results');
            // 支持数字和字符串ID混合匹配
            const strTaskId = String(taskId);
            return results
                .filter(result => String(result.task_execution_id) === strTaskId)
                .map(result => this.formatResult(result));
        } catch (error) {
            console.error('查询任务结果失败:', error);
            throw error;
        }
    }
    
    static async create(resultData) {
        try {
            const db = getDatabase();
            const result = {
                task_execution_id: resultData.task_execution_id,
                host_id: resultData.host_id,
                status: resultData.status || 'pending',
                stdout: '',
                stderr: '',
                stdout_path: '',
                stderr_path: '',
                exit_code: resultData.exit_code,
                start_time: resultData.start_time,
                end_time: resultData.end_time,
                duration: resultData.duration,
                error_message: resultData.error_message || ''
            };
            
            // 如果提供了输出内容，保存到文件
            if (resultData.stdout) {
                result.stdout_path = await LogService.saveLog(result.task_execution_id, result.host_id, 'stdout', resultData.stdout);
            }
            if (resultData.stderr) {
                result.stderr_path = await LogService.saveLog(result.task_execution_id, result.host_id, 'stderr', resultData.stderr);
            }
            
            return await db.insert('task_results', result);
        } catch (error) {
            console.error('创建任务结果失败:', error);
            throw error;
        }
    }
    
    static async update(id, resultData) {
        try {
            const db = getDatabase();
            const current = db.findById('task_results', parseInt(id));
            const updates = {};
            
            if (resultData.status !== undefined) updates.status = resultData.status;
            
            // 处理 stdout
            if (resultData.stdout !== undefined) {
                const taskId = resultData.task_execution_id || current?.task_execution_id;
                const hostId = resultData.host_id || current?.host_id;
                if (taskId && hostId) {
                    updates.stdout_path = await LogService.saveLog(taskId, hostId, 'stdout', resultData.stdout);
                    updates.stdout = ''; // 清空数据库中的大文本
                } else {
                    updates.stdout = resultData.stdout;
                }
            }
            
            // 处理 stderr
            if (resultData.stderr !== undefined) {
                const taskId = resultData.task_execution_id || current?.task_execution_id;
                const hostId = resultData.host_id || current?.host_id;
                if (taskId && hostId) {
                    updates.stderr_path = await LogService.saveLog(taskId, hostId, 'stderr', resultData.stderr);
                    updates.stderr = ''; // 清空数据库中的大文本
                } else {
                    updates.stderr = resultData.stderr;
                }
            }

            if (resultData.exit_code !== undefined) updates.exit_code = resultData.exit_code;
            if (resultData.start_time !== undefined) updates.start_time = resultData.start_time;
            if (resultData.end_time !== undefined) updates.end_time = resultData.end_time;
            if (resultData.duration !== undefined) updates.duration = resultData.duration;
            if (resultData.error_message !== undefined) updates.error_message = resultData.error_message;
            
            // update现在返回更新后的记录，直接格式化
            const result = await db.update('task_results', parseInt(id), updates);
            return this.formatResult(result);
        } catch (error) {
            console.error('更新任务结果失败:', error);
            throw error;
        }
    }

    static async populateLogs(result) {
        if (!result) return result;
        if (result.stdout_path) {
            result.stdout = await LogService.readLog(result.stdout_path);
        }
        if (result.stderr_path) {
            result.stderr = await LogService.readLog(result.stderr_path);
        }
        return result;
    }
    
    static formatResult(row) {
        if (!row) return null;
        return { ...row };
    }
}

module.exports = {
    HostModel,
    ScriptModel,
    TaskModel,
    TaskResultModel
};

// ==================== 工程任务模型 ====================

// 工程任务模型
class ProjectTaskModel {
    static async findAll(options = {}) {
        try {
            const db = getDatabase();
            let tasks = db.getTable('project_tasks');
            // 过滤掉模板数据（模板功能已废弃，支持数字1和字符串"1"）
            tasks = tasks.filter(t => t.is_template !== 1 && t.is_template !== '1' && t.is_template !== true);
            return tasks.map(t => this.format(t)).sort((a, b) =>
                new Date(b.created_at) - new Date(a.created_at));
        } catch (error) {
            console.error('查询工程任务列表失败:', error);
            throw error;
        }
    }

    static async findById(id) {
        try {
            const db = getDatabase();
            const task = db.findById('project_tasks', parseInt(id));
            return task ? this.format(task) : null;
        } catch (error) {
            console.error('查询工程任务失败:', error);
            throw error;
        }
    }

    static async create(data) {
        try {
            const db = getDatabase();
            const record = {
                name: data.name,
                description: data.description || '',
                is_template: 0, // 模板功能已废弃，始终为0
                notify_webhook: data.notify_webhook || '',
                notify_on_success: data.notify_on_success !== false ? 1 : 0,
                notify_on_failure: data.notify_on_failure !== false ? 1 : 0,
                notify_on_interrupt: data.notify_on_interrupt !== false ? 1 : 0
            };
            const result = await db.insert('project_tasks', record);
            return this.format(result);
        } catch (error) {
            console.error('创建工程任务失败:', error);
            throw error;
        }
    }

    static async update(id, data) {
        try {
            const db = getDatabase();
            const updates = {};
            const fields = ['name', 'description', 'notify_webhook',
                'notify_on_success', 'notify_on_failure', 'notify_on_interrupt'];
            fields.forEach(f => { if (data[f] !== undefined) updates[f] = data[f]; });
            // is_template 字段不再更新（模板功能已废弃）
            const result = await db.update('project_tasks', parseInt(id), updates);
            return result ? this.format(result) : null;
        } catch (error) {
            console.error('更新工程任务失败:', error);
            throw error;
        }
    }

    static async delete(id) {
        try {
            const db = getDatabase();
            // 级联删除步骤
            const steps = db.getTable('project_steps').filter(s => s.project_task_id === parseInt(id));
            for (const step of steps) {
                await db.delete('project_steps', step.id);
            }
            return await db.delete('project_tasks', parseInt(id));
        } catch (error) {
            console.error('删除工程任务失败:', error);
            throw error;
        }
    }

    static format(row) {
        if (!row) return null;
        return { ...row };
    }
}

// 工程步骤模型
class ProjectStepModel {
    static async findByProjectTaskId(projectTaskId) {
        try {
            const db = getDatabase();
            return db.getTable('project_steps')
                .filter(s => s.project_task_id === parseInt(projectTaskId))
                .sort((a, b) => a.step_order - b.step_order)
                .map(s => this.format(s));
        } catch (error) {
            console.error('查询工程步骤失败:', error);
            throw error;
        }
    }

    static async findById(id) {
        try {
            const db = getDatabase();
            const step = db.findById('project_steps', parseInt(id));
            return step ? this.format(step) : null;
        } catch (error) {
            console.error('查询步骤失败:', error);
            throw error;
        }
    }

    static async create(data) {
        try {
            const db = getDatabase();
            const record = {
                project_task_id: parseInt(data.project_task_id),
                step_order: data.step_order || 0,
                step_name: data.step_name || '',
                step_type: data.step_type,          // upload/command/script
                host_ids: JSON.stringify(data.host_ids || []),
                config: JSON.stringify(data.config || {}),
                depends_on: JSON.stringify(data.depends_on || []),
                timeout: data.timeout || 300
            };
            const result = await db.insert('project_steps', record);
            return this.format(result);
        } catch (error) {
            console.error('创建工程步骤失败:', error);
            throw error;
        }
    }

    static async update(id, data) {
        try {
            const db = getDatabase();
            const updates = {};
            if (data.step_order !== undefined) updates.step_order = data.step_order;
            if (data.step_name !== undefined) updates.step_name = data.step_name;
            if (data.step_type !== undefined) updates.step_type = data.step_type;
            if (data.host_ids !== undefined) updates.host_ids = JSON.stringify(data.host_ids);
            if (data.config !== undefined) updates.config = JSON.stringify(data.config);
            if (data.depends_on !== undefined) updates.depends_on = JSON.stringify(data.depends_on);
            if (data.timeout !== undefined) updates.timeout = data.timeout;
            const result = await db.update('project_steps', parseInt(id), updates);
            return result ? this.format(result) : null;
        } catch (error) {
            console.error('更新工程步骤失败:', error);
            throw error;
        }
    }

    static async delete(id) {
        try {
            const db = getDatabase();
            return await db.delete('project_steps', parseInt(id));
        } catch (error) {
            console.error('删除工程步骤失败:', error);
            throw error;
        }
    }

    // 重新排序：stepOrders = [{stepId, order}, ...]
    static async reorder(projectTaskId, stepOrders) {
        try {
            const db = getDatabase();
            for (const { stepId, order } of stepOrders) {
                await db.update('project_steps', parseInt(stepId), { step_order: order });
            }
            return true;
        } catch (error) {
            console.error('重新排序步骤失败:', error);
            throw error;
        }
    }

    static format(row) {
        if (!row) return null;
        return {
            ...row,
            host_ids: safeJsonParse(row.host_ids, []),
            config: safeJsonParse(row.config, {}),
            depends_on: safeJsonParse(row.depends_on, [])
        };
    }
}

// 工程执行记录模型
class ProjectExecutionModel {
    static async findByProjectTaskId(projectTaskId) {
        try {
            const db = getDatabase();
            return db.getTable('project_executions')
                .filter(e => e.project_task_id === parseInt(projectTaskId))
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .map(e => this.format(e));
        } catch (error) {
            console.error('查询工程执行记录失败:', error);
            throw error;
        }
    }

    static async findById(id) {
        try {
            const db = getDatabase();
            const exec = db.findById('project_executions', parseInt(id));
            return exec ? this.format(exec) : null;
        } catch (error) {
            console.error('查询工程执行记录失败:', error);
            throw error;
        }
    }

    static async findScheduled() {
        try {
            const db = getDatabase();
            const now = new Date().toISOString();
            return db.getTable('project_executions')
                .filter(e => e.status === 'scheduled' && e.scheduled_time)
                .map(e => this.format(e));
        } catch (error) {
            console.error('查询待执行工程失败:', error);
            throw error;
        }
    }

    static async create(data) {
        try {
            const db = getDatabase();
            const record = {
                project_task_id: parseInt(data.project_task_id),
                status: data.status || (data.execution_type === 'scheduled' ? 'scheduled' : 'pending'),
                execution_type: data.execution_type || 'manual',
                scheduled_time: data.scheduled_time || null,
                started_at: null,
                completed_at: null,
                total_steps: data.total_steps || 0,
                completed_steps: 0,
                failed_steps: 0,
                error_message: '',
                notify_sent: 0
            };
            const result = await db.insert('project_executions', record);
            return this.format(result);
        } catch (error) {
            console.error('创建工程执行记录失败:', error);
            throw error;
        }
    }

    static async update(id, data) {
        try {
            const db = getDatabase();
            const updates = {};
            const fields = ['status', 'started_at', 'completed_at', 'total_steps',
                'completed_steps', 'failed_steps', 'error_message', 'notify_sent', 'scheduled_time'];
            fields.forEach(f => { if (data[f] !== undefined) updates[f] = data[f]; });
            const result = await db.update('project_executions', parseInt(id), updates);
            return result ? this.format(result) : null;
        } catch (error) {
            console.error('更新工程执行记录失败:', error);
            throw error;
        }
    }

    static format(row) {
        if (!row) return null;
        return { ...row };
    }
}

// 步骤执行详情模型
class ProjectStepExecutionModel {
    static async findByExecutionId(executionId) {
        try {
            const db = getDatabase();
            return db.getTable('project_step_executions')
                .filter(e => e.project_execution_id === parseInt(executionId))
                .map(e => this.format(e));
        } catch (error) {
            console.error('查询步骤执行详情失败:', error);
            throw error;
        }
    }

    static async create(data) {
        try {
            const db = getDatabase();
            const record = {
                project_execution_id: parseInt(data.project_execution_id),
                step_id: parseInt(data.step_id),
                status: data.status || 'pending',
                started_at: null,
                completed_at: null,
                host_results: JSON.stringify(data.host_results || []),
                error_message: data.error_message || ''
            };
            const result = await db.insert('project_step_executions', record);
            return this.format(result);
        } catch (error) {
            console.error('创建步骤执行详情失败:', error);
            throw error;
        }
    }

    static async update(id, data) {
        try {
            const db = getDatabase();
            const updates = {};
            if (data.status !== undefined) updates.status = data.status;
            if (data.started_at !== undefined) updates.started_at = data.started_at;
            if (data.completed_at !== undefined) updates.completed_at = data.completed_at;
            if (data.host_results !== undefined) updates.host_results = JSON.stringify(data.host_results);
            if (data.error_message !== undefined) updates.error_message = data.error_message;
            const result = await db.update('project_step_executions', parseInt(id), updates);
            return result ? this.format(result) : null;
        } catch (error) {
            console.error('更新步骤执行详情失败:', error);
            throw error;
        }
    }

    static format(row) {
        if (!row) return null;
        return {
            ...row,
            host_results: safeJsonParse(row.host_results, [])
        };
    }
}

// 重新导出所有模型
module.exports = {
    HostModel,
    ScriptModel,
    TaskModel,
    TaskResultModel,
    ProjectTaskModel,
    ProjectStepModel,
    ProjectExecutionModel,
    ProjectStepExecutionModel,
    ScriptCategoryModel,
    TagTypeModel,
    ScriptShortcutModel
};