// 数据备份与导入导出 - 前端 IPC 封装
(function () {
    function ipc() {
        if (window.require) {
            try { return window.require('electron').ipcRenderer; } catch (_) {}
        }
        return null;
    }

    async function call(channel, ...args) {
        const r = ipc();
        if (!r) throw new Error('当前环境不可用（非 Electron 渲染进程）');
        return r.invoke(channel, ...args);
    }

    const BackupService = {
        getSettings:   () => call('backup:get-settings'),
        saveSettings:  (payload) => call('backup:save-settings', payload),
        listHistory:   () => call('backup:list-history'),
        exportData:    () => call('backup:export'),
        // 不传 filePath 时主进程会弹文件选择对话框
        parseFile:     (filePath) => call('backup:parse-file', filePath),
        importData:    (filePath) => call('backup:import', filePath),
        deleteBackup:  (filePath) => call('backup:delete', filePath),
        showInFolder:  (filePath) => call('backup:show-in-folder', filePath),
        relaunchApp:   () => call('app:relaunch'),
        // 备份目录管理
        selectDirectory:    () => call('backup:select-directory'),
        probeDirectory:     (p) => call('backup:probe-directory', p),
        setDirectory:       (path, migrate = true) => call('backup:set-directory', { path, migrate }),
        resetDirectory:     (migrate = true) => call('backup:reset-directory', { migrate }),
        getDirectoryInfo:   () => call('backup:get-directory-info')
    };

    window.BackupService = BackupService;
})();
