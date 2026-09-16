// 脚本管理服务
class ScriptService {
    constructor() {
        this.scripts = [];
        // 检查是否在 Electron 环境中
        this.isElectron = typeof window !== 'undefined' && typeof require !== 'undefined';
        if (this.isElectron) {
            try {
                const { ipcRenderer } = require('electron');
                this.ipcRenderer = ipcRenderer;
                console.log('ScriptService: Electron环境，使用IPC通信');
            } catch (e) {
                console.error('ScriptService: 无法加载ipcRenderer', e);
                this.isElectron = false;
            }
        } else {
            console.log('ScriptService: 非Electron环境，使用localStorage');
        }
    }
    
    // 加载脚本数据
    async loadScripts() {
        try {
            if (this.isElectron) {
                // Electron环境，从数据库加载
                const result = await this.ipcRenderer.invoke('script:findAll');
                this.scripts = result || [];
            } else {
                // 非Electron环境，使用localStorage
                const storedScripts = localStorage.getItem('scripts');
                this.scripts = storedScripts ? JSON.parse(storedScripts) : this.getDefaultScripts();
            }
            console.log(`加载了 ${this.scripts.length} 个脚本`);
            return this.scripts;
        } catch (error) {
            console.error('加载脚本数据失败:', error);
            this.scripts = this.getDefaultScripts();
            return this.scripts;
        }
    }
    
    // 获取默认脚本（用于非Electron环境）
    getDefaultScripts() {
        // 返回空数组，不再提供默认脚本
        return [];
    }
    
    // 保存脚本数据
    async saveScripts() {
        try {
            if (this.isElectron) {
                // Electron环境不需要手动保存，数据库自动持久化
                return true;
            } else {
                localStorage.setItem('scripts', JSON.stringify(this.scripts));
            }
            console.log('脚本数据保存成功');
            return true;
        } catch (error) {
            console.error('保存脚本数据失败:', error);
            return false;
        }
    }
    
    // 获取所有脚本
    getAllScripts() {
        return [...this.scripts];
    }
    
    // 根据ID获取脚本
    getScriptById(id) {
        return this.scripts.find(script => script.id === id);
    }
    
    // 添加脚本
    async addScript(scriptData) {
        try {
            if (this.isElectron) {
                // Electron环境，通过IPC调用
                const script = await this.ipcRenderer.invoke('script:create', scriptData);
                await this.loadScripts(); // 重新加载
                console.log(`脚本 ${script.name} 添加成功`);
                return script;
            } else {
                // 非Electron环境
                const script = {
                    id: this.generateId(),
                    name: scriptData.name,
                    description: scriptData.description || '',
                    content: scriptData.content,
                    category: scriptData.category || 'custom',
                    language: scriptData.language || 'bash',
                    tags: scriptData.tags || [],
                    author: scriptData.author || '',
                    usage_notes: scriptData.usage_notes || '',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                
                // 验证脚本数据
                const validation = this.validateScript(script);
                if (!validation.isValid) {
                    throw new Error(validation.errors.join(', '));
                }
                
                this.scripts.push(script);
                await this.saveScripts();
                
                console.log(`脚本 ${script.name} 添加成功`);
                return script;
            }
        } catch (error) {
            console.error('添加脚本失败:', error);
            throw error;
        }
    }
    
    // 更新脚本
    async updateScript(id, updates) {
        try {
            if (this.isElectron) {
                // Electron环境
                const script = await this.ipcRenderer.invoke('script:update', id, updates);
                await this.loadScripts(); // 重新加载
                console.log(`脚本 ${script.name} 更新成功`);
                return script;
            } else {
                // 非Electron环境
                const index = this.scripts.findIndex(script => script.id === id);
                if (index === -1) {
                    throw new Error('脚本不存在');
                }
                
                const updatedScript = {
                    ...script,
                    ...updates,
                    updated_at: new Date().toISOString()
                };
                
                // 验证更新的数据
                const validation = this.validateScript(updatedScript);
                if (!validation.isValid) {
                    throw new Error(validation.errors.join(', '));
                }
                
                this.scripts[index] = updatedScript;
                await this.saveScripts();
                
                console.log(`脚本 ${updatedScript.name} 更新成功`);
                return updatedScript;
            }
        } catch (error) {
            console.error('更新脚本失败:', error);
            throw error;
        }
    }
    
    // 删除脚本
    async deleteScript(id) {
        try {
            if (this.isElectron) {
                // Electron环境
                await this.ipcRenderer.invoke('script:delete', id);
                await this.loadScripts(); // 重新加载
                console.log(`脚本删除成功`);
                return true;
            } else {
                // 非Electron环境
                const index = this.scripts.findIndex(script => script.id === id);
                if (index === -1) {
                    throw new Error('脚本不存在');
                }
                
                this.scripts.splice(index, 1);
                await this.saveScripts();
                
                console.log(`脚本 ${script.name} 删除成功`);
                return true;
            }
        } catch (error) {
            console.error('删除脚本失败:', error);
            throw error;
        }
    }
    
    // 复制脚本
    async duplicateScript(id) {
        try {
            if (this.isElectron) {
                // Electron环境：先查询原脚本，然后创建副本
                const originalScript = await this.ipcRenderer.invoke('script:findById', id);
                if (!originalScript) {
                    throw new Error('脚本不存在');
                }
                
                // 生成智能命名：原名_copy1, _copy2...
                const newName = this.generateCopyName(originalScript.name);
                
                const duplicatedData = {
                    name: newName,
                    description: originalScript.description,
                    content: originalScript.content,
                    category: originalScript.category,
                    language: originalScript.language,
                    tags: originalScript.tags,
                    author: originalScript.author,
                    usage_notes: originalScript.usage_notes
                };
                
                const duplicatedScript = await this.ipcRenderer.invoke('script:create', duplicatedData);
                await this.loadScripts(); // 重新加载
                console.log(`脚本复制成功: ${duplicatedScript.name}`);
                return duplicatedScript;
            } else {
                // 非Electron环境
                const originalScript = this.getScriptById(id);
                if (!originalScript) {
                    throw new Error('脚本不存在');
                }
                
                // 生成智能命名
                const newName = this.generateCopyName(originalScript.name);
                
                const duplicatedScript = {
                    ...originalScript,
                    id: this.generateId(),
                    name: newName,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                
                this.scripts.push(duplicatedScript);
                await this.saveScripts();
                
                console.log(`脚本复制成功: ${duplicatedScript.name}`);
                return duplicatedScript;
            }
        } catch (error) {
            console.error('复制脚本失败:', error);
            throw error;
        }
    }
    
    // 生成复制名称（智能递增）
    generateCopyName(originalName) {
        // 移除原有的 _copy 或 _copy数字 后缀
        const baseName = originalName.replace(/_copy\d*$/, '');
        
        // 查找所有以 baseName_copy 开头的脚本
        const copyPattern = new RegExp(`^${this.escapeRegex(baseName)}_copy(\\d*)$`);
        const existingCopies = this.scripts.filter(script => copyPattern.test(script.name));
        
        if (existingCopies.length === 0) {
            return `${baseName}_copy`;
        }
        
        // 找出最大的数字后缀
        let maxNum = 0;
        existingCopies.forEach(script => {
            const match = script.name.match(copyPattern);
            if (match) {
                const num = match[1] === '' ? 1 : parseInt(match[1]);
                if (num > maxNum) maxNum = num;
            }
        });
        
        return `${baseName}_copy${maxNum + 1}`;
    }
    
    // 转义正则表达式特殊字符
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    // 按分类获取脚本
    getScriptsByCategory(category) {
        if (!category) return this.scripts;
        return this.scripts.filter(script => script.category === category);
    }
    
    // 搜索脚本
    searchScripts(keyword) {
        if (!keyword) return this.scripts;
        
        const lowerKeyword = keyword.toLowerCase();
        return this.scripts.filter(script => 
            script.name.toLowerCase().includes(lowerKeyword) ||
            script.description.toLowerCase().includes(lowerKeyword) ||
            script.tags.some(tag => tag.toLowerCase().includes(lowerKeyword))
        );
    }
    
    // 获取分类统计
    getCategoryStatistics() {
        const categories = {};
        this.scripts.forEach(script => {
            categories[script.category] = (categories[script.category] || 0) + 1;
        });
        return categories;
    }
    
    // 验证脚本内容
    validateScriptContent(content, language) {
        const errors = [];
        
        if (!content || content.trim().length === 0) {
            errors.push('脚本内容不能为空');
            return { isValid: false, errors };
        }
        
        // 基本语法检查
        if (language === 'bash') {
            // 检查是否有shebang
            if (!content.startsWith('#!')) {
                errors.push('建议添加shebang行 (如: #!/bin/bash)');
            }
            
            // 检查危险命令
            const dangerousCommands = ['rm -rf /', 'dd if=', 'mkfs', 'fdisk', 'parted'];
            dangerousCommands.forEach(cmd => {
                if (content.includes(cmd)) {
                    errors.push(`检测到危险命令: ${cmd}`);
                }
            });
        }
        
        return {
            isValid: errors.length === 0,
            errors,
            warnings: errors.filter(e => e.startsWith('建议'))
        };
    }
    
    // 验证脚本数据
    validateScript(script) {
        const errors = [];
        
        if (!script.name || script.name.trim().length === 0) {
            errors.push('脚本名称不能为空');
        }
        
        if (!script.content || script.content.trim().length === 0) {
            errors.push('脚本内容不能为空');
        } else {
            const contentValidation = this.validateScriptContent(script.content, script.language);
            if (!contentValidation.isValid) {
                errors.push(...contentValidation.errors);
            }
        }
        
        // 检查名称重复
        const duplicate = this.scripts.find(s => 
            s.id !== script.id && s.name === script.name
        );
        if (duplicate) {
            errors.push('脚本名称已存在');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    // 生成唯一ID
    generateId() {
        return 'script_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    // 导出脚本
    exportScript(id) {
        const script = this.getScriptById(id);
        if (!script) {
            throw new Error('脚本不存在');
        }
        
        const exportData = {
            name: script.name,
            description: script.description,
            content: script.content,
            category: script.category,
            language: script.language,
            parameters: script.parameters,
            tags: script.tags,
            author: script.author,
            version: script.version,
            exportedAt: new Date().toISOString()
        };
        
        return JSON.stringify(exportData, null, 2);
    }
    
    // 导入脚本
    async importScript(scriptJson) {
        try {
            const scriptData = JSON.parse(scriptJson);
            
            // 基本字段检查
            if (!scriptData.name || !scriptData.content) {
                throw new Error('脚本数据格式不正确');
            }
            
            return await this.addScript(scriptData);
        } catch (error) {
            console.error('导入脚本失败:', error);
            throw error;
        }
    }
    
    // 从 Excel 导入脚本
    async importFromExcel(excelData) {
        try {
            const importResults = {
                imported: 0,
                errors: []
            };
            
            for (let i = 0; i < excelData.length; i++) {
                const row = excelData[i];
                try {
                    // 清理和验证数据
                    const scriptData = {
                        name: (row.name || '').trim(),
                        description: (row.description || '').trim(),
                        content: (row.content || '').trim(),
                        category: (row.category || 'custom').trim(),
                        language: (row.language || 'bash').trim(),
                        tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(t => t) : [],
                        author: (row.author || '').trim(),
                        usage_notes: (row.usage_notes || '').trim()
                    };
                    
                    // 基本验证
                    if (!scriptData.name || !scriptData.content) {
                        importResults.errors.push(`第${i + 1}行: 缺少必填字段（脚本名称、脚本内容）`);
                        continue;
                    }
                    
                    // 添加脚本
                    await this.addScript(scriptData);
                    importResults.imported++;
                    
                } catch (error) {
                    importResults.errors.push(`第${i + 1}行: ${error.message}`);
                }
            }
            
            return importResults;
        } catch (error) {
            console.error('Excel导入失败:', error);
            throw error;
        }
    }
}

// 导出服务
window.ScriptService = ScriptService;

// ============================================================
// 脚本目录服务
// ============================================================
class CategoryService {
    constructor() {
        this.isElectron = typeof window !== 'undefined' && typeof require !== 'undefined';
        if (this.isElectron) {
            try {
                const { ipcRenderer } = require('electron');
                this.ipcRenderer = ipcRenderer;
            } catch (e) {
                this.isElectron = false;
            }
        }
    }

    async getTree() {
        if (!this.isElectron) return [];
        return await this.ipcRenderer.invoke('category:getTree');
    }

    async getAll() {
        if (!this.isElectron) return [];
        return await this.ipcRenderer.invoke('category:getAll');
    }

    async create(data) {
        if (!this.isElectron) throw new Error('仅支持Electron环境');
        return await this.ipcRenderer.invoke('category:create', data);
    }

    async update(id, data) {
        if (!this.isElectron) throw new Error('仅支持Electron环境');
        return await this.ipcRenderer.invoke('category:update', id, data);
    }

    async delete(id) {
        if (!this.isElectron) throw new Error('仅支持Electron环境');
        return await this.ipcRenderer.invoke('category:delete', id);
    }
}

// ============================================================
// 标签服务
// ============================================================
class TagService {
    constructor() {
        this.isElectron = typeof window !== 'undefined' && typeof require !== 'undefined';
        if (this.isElectron) {
            try {
                const { ipcRenderer } = require('electron');
                this.ipcRenderer = ipcRenderer;
            } catch (e) {
                this.isElectron = false;
            }
        }
    }

    /** 返回 [{id, name, is_system, values:[{id,type_id,value}]}] */
    async getAllWithValues() {
        if (!this.isElectron) return [];
        return await this.ipcRenderer.invoke('tag:getAllValues');
    }

    async createValue(typeId, value) {
        if (!this.isElectron) throw new Error('仅支持Electron环境');
        return await this.ipcRenderer.invoke('tag:createValue', typeId, value);
    }

    async deleteValue(id) {
        if (!this.isElectron) throw new Error('仅支持Electron环境');
        return await this.ipcRenderer.invoke('tag:deleteValue', id);
    }
}

// ============================================================
// 快捷面板服务
// ============================================================
class ShortcutService {
    constructor() {
        this.isElectron = typeof window !== 'undefined' && typeof require !== 'undefined';
        if (this.isElectron) {
            try {
                const { ipcRenderer } = require('electron');
                this.ipcRenderer = ipcRenderer;
            } catch (e) {
                this.isElectron = false;
            }
        }
    }

    async getAll() {
        if (!this.isElectron) return [];
        return await this.ipcRenderer.invoke('shortcut:getAll');
    }

    async add(scriptId) {
        if (!this.isElectron) throw new Error('仅支持Electron环境');
        return await this.ipcRenderer.invoke('shortcut:add', scriptId);
    }

    async remove(scriptId) {
        if (!this.isElectron) throw new Error('仅支持Electron环境');
        return await this.ipcRenderer.invoke('shortcut:remove', scriptId);
    }

    async reorder(orderedScriptIds) {
        if (!this.isElectron) throw new Error('仅支持Electron环境');
        return await this.ipcRenderer.invoke('shortcut:reorder', orderedScriptIds);
    }
}

window.CategoryService = CategoryService;
window.TagService      = TagService;
window.ShortcutService = ShortcutService;