// AI 脚本分析 - 渲染层 IPC 封装
(function() {
    'use strict';

    class AiService {
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

        /** 获取大模型接入配置（不含 Key 原文） */
        async getSettings() {
            if (!this.isElectron) return { success: false, message: '仅支持 Electron 环境' };
            return await this.ipcRenderer.invoke('ai:getSettings');
        }

        /** 保存配置（apiKey 留空表示保留旧值） */
        async saveSettings(payload) {
            if (!this.isElectron) return { success: false, message: '仅支持 Electron 环境' };
            return await this.ipcRenderer.invoke('ai:saveSettings', payload);
        }

        /** 测试连接（用表单当前值，Key 留空则用已存 Key） */
        async testConnection(payload) {
            if (!this.isElectron) return { success: false, message: '仅支持 Electron 环境' };
            return await this.ipcRenderer.invoke('ai:testConnection', payload);
        }

        /** 单脚本分析 */
        async analyze(payload) {
            if (!this.isElectron) return { success: false, message: '仅支持 Electron 环境' };
            return await this.ipcRenderer.invoke('ai:analyze', payload);
        }

        /** AI 生成脚本草稿（一次性调用，不落库不缓存） */
        async generateScript(payload) {
            if (!this.isElectron) return { success: false, message: '仅支持 Electron 环境' };
            return await this.ipcRenderer.invoke('ai:generateScript', payload);
        }

        /** 读取某脚本的缓存分析记录 */
        async getAnalysis(scriptId) {
            if (!this.isElectron) return { success: false, message: '仅支持 Electron 环境' };
            return await this.ipcRenderer.invoke('ai:getAnalysis', scriptId);
        }

        /** 批量读取所有脚本的分析状态（列表页 AI 角标用） */
        async getAllAnalyses() {
            if (!this.isElectron) return { success: false, message: '仅支持 Electron 环境' };
            return await this.ipcRenderer.invoke('ai:getAllAnalyses');
        }

        /** 批量分析（进度通过 onBatchProgress 订阅） */
        async batchAnalyze(scriptIds, options) {
            if (!this.isElectron) return { success: false, message: '仅支持 Electron 环境' };
            return await this.ipcRenderer.invoke('ai:batchAnalyze', scriptIds, options);
        }

        /** 取消批量分析 */
        async batchCancel() {
            if (!this.isElectron) return { success: false, message: '仅支持 Electron 环境' };
            return await this.ipcRenderer.invoke('ai:batchCancel');
        }

        /** 删除指定脚本的分析记录 */
        async deleteAnalyses(scriptIds) {
            if (!this.isElectron) return { success: false, message: '仅支持 Electron 环境' };
            return await this.ipcRenderer.invoke('ai:deleteAnalyses', scriptIds);
        }

        /** 订阅批量分析进度事件，返回取消函数 */
        onBatchProgress(callback) {
            if (!this.isElectron || !callback) return () => {};
            const handler = (_event, progress) => callback(progress);
            this.ipcRenderer.on('ai:batch-progress', handler);
            return () => this.ipcRenderer.removeListener('ai:batch-progress', handler);
        }
    }

    window.AiService = AiService;
})();
