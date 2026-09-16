// 数据备份与导入导出服务
// 功能：
//   1. 手动导出全量数据（明文 JSON，含 meta 头）
//   2. 手动导入全量数据（仅完全覆盖；导入前强制自动备份；调用方负责重启应用）
//   3. 每日定时备份（用户可配置时间，每分钟检查一次）
//   4. 应用退出前补一次（当天未备份时）
//   5. 备份历史查询（仅展示 daily 与 before_import 两类，5 分钟滚动备份不展示）
//   6. 备份目录独立配置（存于 backup-config.json，不受导入覆盖影响）
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { getDatabase } = require('../database/simple-db');

// 当前备份文件格式版本（不向后兼容时升级主版本号）
const BACKUP_VERSION = '1.0';
// 备份路径配置文件名（独立于 database.json，避免导入覆盖本机路径）
const BACKUP_CONFIG_FILE = 'backup-config.json';
// 备份失败连续超过该次数后自动回退默认路径
const MAX_BACKUP_FAILURES = 3;
// 禁止选为备份目录的系统敏感路径（不区分大小写匹配前缀）
const FORBIDDEN_PATH_PREFIXES = process.platform === 'win32'
    ? ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)']
    : ['/etc', '/bin', '/sbin', '/usr', '/var', '/boot', '/sys', '/proc', '/dev', '/'];

class BackupService {
    constructor() {
        const userDataDir = app.getPath('userData');
        this.userDataDir = userDataDir;
        this.dataDir = path.join(userDataDir, 'data');
        // 默认备份根路径（在 userData 下）
        this.defaultBackupRoot = path.join(userDataDir, 'backups');
        // 独立配置文件路径
        this.configFile = path.join(userDataDir, BACKUP_CONFIG_FILE);
        // 当前生效的备份根路径（读配置后覆盖）
        this.backupRoot = this.defaultBackupRoot;
        // 子目录（会随 backupRoot 动态计算）
        this.dailyDir = path.join(this.backupRoot, 'daily');
        this.beforeImportDir = path.join(this.backupRoot, 'before_import');
        this.timer = null;
        this.lastCheckDate = null;
        // 备份失败计数器（超过 MAX_BACKUP_FAILURES 则自动回退默认路径）
        this._failureCount = 0;
        // 是否已回退默认路径（UI 可查）
        this._fellbackToDefault = false;
        // 备份路径配置加载状态
        this._customBackupRoot = null;
        this._loadConfigSync();
    }

    // 同步加载配置（启动阶段）
    _loadConfigSync() {
        try {
            if (fsSync.existsSync(this.configFile)) {
                const raw = fsSync.readFileSync(this.configFile, 'utf8');
                const cfg = JSON.parse(raw);
                if (cfg && typeof cfg.backupRoot === 'string' && cfg.backupRoot.trim()) {
                    this._customBackupRoot = cfg.backupRoot;
                    this._applyBackupRoot(cfg.backupRoot);
                }
            }
        } catch (e) {
            console.warn('读取备份路径配置失败，将使用默认路径:', e.message);
        }
    }

    _applyBackupRoot(root) {
        this.backupRoot = root;
        this.dailyDir = path.join(root, 'daily');
        this.beforeImportDir = path.join(root, 'before_import');
    }

    async _saveConfig() {
        try {
            const cfg = { backupRoot: this._customBackupRoot || null };
            await fs.writeFile(this.configFile, JSON.stringify(cfg, null, 2), 'utf8');
        } catch (e) {
            console.error('保存备份路径配置失败:', e);
            throw e;
        }
    }

    async ensureDirs() {
        for (const dir of [this.backupRoot, this.dailyDir, this.beforeImportDir]) {
            if (!fsSync.existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }
        }
    }

    // 构造导出文件内容（meta + data）
    buildExportPayload() {
        const db = getDatabase();
        const data = db.getRawData();
        return {
            version: BACKUP_VERSION,
            appVersion: app.getVersion ? app.getVersion() : 'unknown',
            exportedAt: new Date().toISOString(),
            hostname: os.hostname(),
            // 简单统计便于导入前对比
            stats: {
                hosts: (data.hosts || []).length,
                scripts: (data.scripts || []).length,
                task_executions: (data.task_executions || []).length,
                project_tasks: (data.project_tasks || []).length
            },
            data
        };
    }

    // 写入备份文件（原子：tmp + rename，跨盘时降级为 copyFile）
    async writeBackupFile(filePath, payload) {
        await this.ensureDirs();
        const json = JSON.stringify(payload, null, 2);
        const tmp = filePath + '.tmp';
        const fh = await fs.open(tmp, 'w');
        try {
            await fh.writeFile(json, 'utf8');
            try { await fh.sync(); } catch (_) {}
        } finally {
            await fh.close();
        }
        // 原子 rename；跨盘时会报 EXDEV，降级为 copyFile + unlink
        try {
            await fs.rename(tmp, filePath);
        } catch (e) {
            if (e && (e.code === 'EXDEV' || e.code === 'EPERM')) {
                // 跨分区 / 权限问题 → 转为复制+删除
                await fs.copyFile(tmp, filePath);
                try { await fs.unlink(tmp); } catch (_) {}
            } else {
                throw e;
            }
        }
    }

    // ============================================================
    // 1. 手动导出
    // ============================================================
    async exportTo(filePath) {
        if (!filePath) throw new Error('未指定导出路径');
        const payload = this.buildExportPayload();
        // 确保父目录存在
        const parent = path.dirname(filePath);
        if (!fsSync.existsSync(parent)) {
            await fs.mkdir(parent, { recursive: true });
        }
        await this.writeBackupFile(filePath, payload);
        const stat = await fs.stat(filePath);
        return {
            success: true,
            filePath,
            size: stat.size,
            stats: payload.stats,
            exportedAt: payload.exportedAt
        };
    }

    // 生成默认导出文件名
    suggestExportFilename() {
        const ts = this.timestampForFilename(new Date());
        const safeHost = (os.hostname() || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_');
        return `wxbox-backup-${safeHost}-${ts}.json`;
    }

    timestampForFilename(d) {
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
               `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    // ============================================================
    // 2. 解析与校验导入文件（仅校验，不写入）
    // ============================================================
    async parseImportFile(filePath) {
        if (!filePath || !fsSync.existsSync(filePath)) {
            throw new Error('文件不存在');
        }
        const text = await fs.readFile(filePath, 'utf8');
        let payload;
        try {
            payload = JSON.parse(text);
        } catch (e) {
            throw new Error('文件不是合法的 JSON：' + e.message);
        }
        if (!payload || typeof payload !== 'object') {
            throw new Error('文件结构无效');
        }
        // 兼容裸 data（无 meta 头）
        let data, version, exportedAt, hostname, sourceAppVersion, stats;
        if (payload.data && typeof payload.data === 'object') {
            data = payload.data;
            version = payload.version || '0.0';
            exportedAt = payload.exportedAt || null;
            hostname = payload.hostname || null;
            sourceAppVersion = payload.appVersion || null;
            stats = payload.stats || null;
        } else if (Array.isArray(payload.hosts) || Array.isArray(payload.scripts)) {
            // 裸 database.json
            data = payload;
            version = '0.0';
        } else {
            throw new Error('文件结构无效（缺少 data 字段或核心表）');
        }

        // 版本兼容性：仅校验主版本号
        const major = parseInt(String(version).split('.')[0], 10);
        const currentMajor = parseInt(BACKUP_VERSION.split('.')[0], 10);
        if (major > currentMajor) {
            throw new Error(`备份文件版本（${version}）高于当前应用支持的版本（${BACKUP_VERSION}），请升级应用后再导入`);
        }

        // 计算导入后的统计
        const newStats = {
            hosts: (data.hosts || []).length,
            scripts: (data.scripts || []).length,
            task_executions: (data.task_executions || []).length,
            project_tasks: (data.project_tasks || []).length
        };

        // 当前数据统计
        const db = getDatabase();
        const cur = db.getRawData();
        const curStats = {
            hosts: (cur.hosts || []).length,
            scripts: (cur.scripts || []).length,
            task_executions: (cur.task_executions || []).length,
            project_tasks: (cur.project_tasks || []).length
        };

        return {
            valid: true,
            version,
            exportedAt,
            hostname,
            sourceAppVersion,
            stats: stats || newStats,
            currentStats: curStats,
            newStats,
            // 不直接返回大数据，只在确认导入时再读
            _data: data
        };
    }

    // ============================================================
    // 3. 执行导入：先备份当前 → 再覆盖
    // ============================================================
    async importFrom(filePath) {
        const parsed = await this.parseImportFile(filePath);

        // 强制：先把当前数据备份到 before_import 目录
        const beforeFile = path.join(
            this.beforeImportDir,
            `wxbox-before-import-${this.timestampForFilename(new Date())}.json`
        );
        await this.ensureDirs();
        const beforePayload = this.buildExportPayload();
        await this.writeBackupFile(beforeFile, beforePayload);

        // 覆盖
        const db = getDatabase();
        await db.replaceAllData(parsed._data);

        return {
            success: true,
            filePath,
            beforeImportFile: beforeFile,
            currentStats: parsed.currentStats,
            newStats: parsed.newStats,
            exportedAt: parsed.exportedAt
        };
    }

    // ============================================================
    // 4. 每日定时备份
    // ============================================================
    async runDailyBackupNow() {
        const db = getDatabase();
        const settings = db.getAllSettings ? db.getAllSettings() : {};
        const keep = parseInt(settings.backup_keep_count, 10) || 30;

        try {
            await this.ensureDirs();
            const dateStr = this.dateStr(new Date());
            const file = path.join(this.dailyDir, `wxbox-daily-${dateStr}.json`);
            const payload = this.buildExportPayload();
            await this.writeBackupFile(file, payload);

            // 更新 last_at
            try {
                await db.setSetting('backup_last_at', new Date().toISOString());
            } catch (e) {
                console.warn('更新 backup_last_at 失败:', e.message);
            }

            // 清理超额
            await this.cleanupDailyBackups(keep);

            // 备份成功 → 重置失败计数
            this._failureCount = 0;

            return { success: true, filePath: file, size: (await fs.stat(file)).size };
        } catch (e) {
            this._failureCount++;
            console.error(`每日备份失败（第 ${this._failureCount} 次）:`, e.message);
            // 自定义路径连续失败 → 自动回退默认
            if (
                this._customBackupRoot &&
                this._failureCount >= MAX_BACKUP_FAILURES &&
                path.resolve(this.backupRoot) !== path.resolve(this.defaultBackupRoot)
            ) {
                console.warn(`自定义备份路径连续 ${MAX_BACKUP_FAILURES} 次失败，自动回退到默认路径: ${this.defaultBackupRoot}`);
                this._customBackupRoot = null;
                this._fellbackToDefault = true;
                this._failureCount = 0;
                this._applyBackupRoot(this.defaultBackupRoot);
                try { await this._saveConfig(); } catch (_) {}
            }
            throw e;
        }
    }

    async cleanupDailyBackups(keep) {
        try {
            if (!fsSync.existsSync(this.dailyDir)) return;
            const files = (await fs.readdir(this.dailyDir))
                .filter(f => f.startsWith('wxbox-daily-') && f.endsWith('.json'))
                .sort(); // 文件名按日期升序
            while (files.length > keep) {
                const old = files.shift();
                try { await fs.unlink(path.join(this.dailyDir, old)); } catch (_) {}
            }
        } catch (e) {
            console.warn('清理每日备份失败:', e.message);
        }
    }

    dateStr(d) {
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    }

    // 启动定时调度器（每分钟检查一次）
    startScheduler() {
        if (this.timer) return;
        // 启动后立即执行一次检查（不阻塞）
        setImmediate(() => this.checkAndRun().catch(e => console.error('定时备份检查失败:', e)));
        this.timer = setInterval(() => {
            this.checkAndRun().catch(e => console.error('定时备份检查失败:', e));
        }, 60 * 1000);
        console.log('数据备份调度器已启动（每分钟检查一次）');
    }

    stopScheduler() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    // 检查是否需要执行备份
    async checkAndRun() {
        const db = getDatabase();
        if (!db || db.isReadOnly && db.isReadOnly()) return;
        const settings = db.getAllSettings ? db.getAllSettings() : {};
        if (settings.backup_enabled === false) return;

        const now = new Date();
        const todayStr = this.dateStr(now);

        // 已在今天备份过 → 跳过
        const lastAt = settings.backup_last_at;
        if (lastAt) {
            try {
                if (this.dateStr(new Date(lastAt)) === todayStr) return;
            } catch (_) {}
        }
        // 文件已存在也算今天备份过（防止 lastAt 缺失场景）
        const todayFile = path.join(this.dailyDir, `wxbox-daily-${todayStr}.json`);
        if (fsSync.existsSync(todayFile)) {
            try { await db.setSetting('backup_last_at', now.toISOString()); } catch (_) {}
            return;
        }

        // 检查是否到达设定时间
        const target = String(settings.backup_time || '02:00');
        const m = target.match(/^(\d{1,2}):(\d{1,2})$/);
        if (!m) return;
        const targetMinutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        if (nowMinutes < targetMinutes) return;

        try {
            await this.runDailyBackupNow();
            console.log(`每日定时备份完成: ${todayFile}`);
        } catch (e) {
            console.error('执行每日定时备份失败:', e);
        }
    }

    // 应用退出前补一次（当天未备份则补）
    async runOnQuitIfNeeded() {
        try {
            const db = getDatabase();
            if (!db || (db.isReadOnly && db.isReadOnly())) return;
            const settings = db.getAllSettings ? db.getAllSettings() : {};
            if (settings.backup_enabled === false) return;

            const todayStr = this.dateStr(new Date());
            const todayFile = path.join(this.dailyDir, `wxbox-daily-${todayStr}.json`);
            if (fsSync.existsSync(todayFile)) return;

            // 同步性写一次（避免退出过快）
            await this.runDailyBackupNow();
            console.log('退出前补做每日备份完成');
        } catch (e) {
            console.warn('退出前补做每日备份失败:', e.message);
        }
    }

    // ============================================================
    // 5. 备份历史
    // ============================================================
    async listHistory() {
        await this.ensureDirs();
        const collect = async (dir, type) => {
            if (!fsSync.existsSync(dir)) return [];
            const files = await fs.readdir(dir);
            const list = [];
            for (const f of files) {
                if (!f.endsWith('.json')) continue;
                const fp = path.join(dir, f);
                try {
                    const st = await fs.stat(fp);
                    list.push({
                        type,                       // 'daily' | 'import'
                        fileName: f,
                        filePath: fp,
                        size: st.size,
                        mtime: st.mtimeMs,
                        mtimeText: new Date(st.mtimeMs).toISOString()
                    });
                } catch (_) {}
            }
            return list;
        };
        const daily = await collect(this.dailyDir, 'daily');
        const importBackups = await collect(this.beforeImportDir, 'import');
        // 按 mtime 倒序
        return [...daily, ...importBackups].sort((a, b) => b.mtime - a.mtime);
    }

    // 删除单条备份
    async deleteBackup(filePath) {
        if (!filePath || !fsSync.existsSync(filePath)) {
            throw new Error('文件不存在');
        }
        // 安全校验：必须在备份目录之内
        const realPath = path.resolve(filePath);
        const root = path.resolve(this.backupRoot);
        if (!realPath.startsWith(root)) {
            throw new Error('非法路径');
        }
        await fs.unlink(realPath);
        return { success: true };
    }

    // 获取备份相关设置
    getSettings() {
        const db = getDatabase();
        const s = db.getAllSettings ? db.getAllSettings() : {};
        return {
            backup_enabled: s.backup_enabled !== false,
            backup_time: s.backup_time || '02:00',
            backup_keep_count: parseInt(s.backup_keep_count, 10) || 30,
            backup_last_at: s.backup_last_at || null,
            dailyDir: this.dailyDir,
            beforeImportDir: this.beforeImportDir,
            backupRoot: this.backupRoot,
            defaultBackupRoot: this.defaultBackupRoot,
            isCustomPath: !!this._customBackupRoot,
            fellbackToDefault: this._fellbackToDefault,
            failureCount: this._failureCount
        };
    }

    // ============================================================
    // 6. 备份目录路径管理
    // ============================================================

    // 路径合法性校验：只做静态判断，不写入
    // 返回 { ok, reason }
    validateBackupPath(targetPath) {
        if (!targetPath || typeof targetPath !== 'string') {
            return { ok: false, reason: '路径不能为空' };
        }
        let abs;
        try {
            abs = path.resolve(targetPath);
        } catch (e) {
            return { ok: false, reason: '路径格式无效' };
        }
        const lower = abs.toLowerCase();

        // 1. 系统敏感目录黑名单
        for (const p of FORBIDDEN_PATH_PREFIXES) {
            // Linux 下根目录 '/' 单独处理：必须严格等于才禁止
            if (p === '/') {
                if (abs === '/') return { ok: false, reason: '不允许选择系统根目录作为备份目录' };
                continue;
            }
            if (lower === p || lower.startsWith(p + path.sep) || lower.startsWith(p + '/')) {
                return { ok: false, reason: `不允许选择系统目录 ${p} 作为备份目录` };
            }
        }

        // 2. 不允许嵌套到 userData 数据目录
        const dataDirAbs = path.resolve(this.dataDir).toLowerCase();
        if (lower === dataDirAbs || lower.startsWith(dataDirAbs + path.sep)) {
            return { ok: false, reason: '不允许选择应用数据目录或其子目录作为备份目录' };
        }

        // 3. 不允许嵌套到 userData 根目录的子目录（除 backups 自身）
        //    防止用户选成 userData 本身
        const userDataAbs = path.resolve(this.userDataDir).toLowerCase();
        if (lower === userDataAbs) {
            return { ok: false, reason: '不允许直接选择应用配置根目录作为备份目录' };
        }

        return { ok: true, abs };
    }

    // 探测路径是否可写（必要时尝试创建目录），返回详细信息
    async probeBackupPath(targetPath) {
        const v = this.validateBackupPath(targetPath);
        if (!v.ok) return { ok: false, reason: v.reason };
        const abs = v.abs;
        try {
            // 创建（如果不存在）
            if (!fsSync.existsSync(abs)) {
                await fs.mkdir(abs, { recursive: true });
            } else {
                const st = await fs.stat(abs);
                if (!st.isDirectory()) {
                    return { ok: false, reason: '该路径已存在但不是目录' };
                }
            }
            // 写权限测试
            const probeFile = path.join(abs, `.wxbox-write-test-${Date.now()}.tmp`);
            await fs.writeFile(probeFile, 'ok', 'utf8');
            try { await fs.unlink(probeFile); } catch (_) {}
            return { ok: true, abs };
        } catch (e) {
            return { ok: false, reason: '无法写入该目录: ' + e.message };
        }
    }

    // 设置自定义备份目录：校验 → 迁移历史 → 持久化配置
    // migrate=true 时把旧目录的 daily/before_import 文件搬到新目录
    async setBackupRoot(targetPath, { migrate = true } = {}) {
        const probe = await this.probeBackupPath(targetPath);
        if (!probe.ok) {
            const err = new Error(probe.reason);
            err.code = 'INVALID_PATH';
            throw err;
        }
        const newRoot = probe.abs;
        const oldRoot = this.backupRoot;
        if (path.resolve(newRoot) === path.resolve(oldRoot)) {
            // 同一目录，无需切换
            return { success: true, changed: false, backupRoot: oldRoot, migrated: 0 };
        }

        const oldDaily = path.join(oldRoot, 'daily');
        const oldBeforeImport = path.join(oldRoot, 'before_import');

        // 切到新目录
        this._customBackupRoot = path.resolve(newRoot) === path.resolve(this.defaultBackupRoot)
            ? null
            : newRoot;
        this._fellbackToDefault = false;
        this._failureCount = 0;
        this._applyBackupRoot(newRoot);
        await this.ensureDirs();
        await this._saveConfig();

        // 迁移旧文件（best-effort）
        let migrated = 0;
        let migrateError = null;
        if (migrate) {
            try {
                migrated += await this._migrateDir(oldDaily, this.dailyDir);
                migrated += await this._migrateDir(oldBeforeImport, this.beforeImportDir);
            } catch (e) {
                migrateError = e.message;
                console.warn('迁移历史备份失败（已切换路径）:', e.message);
            }
        }
        return {
            success: true,
            changed: true,
            backupRoot: newRoot,
            migrated,
            migrateError
        };
    }

    // 重置回默认路径
    async resetBackupRoot({ migrate = true } = {}) {
        return this.setBackupRoot(this.defaultBackupRoot, { migrate });
    }

    async _migrateDir(srcDir, dstDir) {
        if (!fsSync.existsSync(srcDir)) return 0;
        if (path.resolve(srcDir) === path.resolve(dstDir)) return 0;
        if (!fsSync.existsSync(dstDir)) {
            await fs.mkdir(dstDir, { recursive: true });
        }
        const files = await fs.readdir(srcDir);
        let count = 0;
        for (const f of files) {
            if (!f.endsWith('.json')) continue;
            const src = path.join(srcDir, f);
            const dst = path.join(dstDir, f);
            try {
                if (fsSync.existsSync(dst)) {
                    // 目标已存在 → 加时间戳后缀避免覆盖
                    const ts = this.timestampForFilename(new Date());
                    const dst2 = dst.replace(/\.json$/, `-${ts}.json`);
                    await this._safeMove(src, dst2);
                } else {
                    await this._safeMove(src, dst);
                }
                count++;
            } catch (e) {
                console.warn(`迁移备份失败 ${src} → ${dst}: ${e.message}`);
            }
        }
        // 尝试删除空旧目录（best-effort）
        try {
            const remaining = await fs.readdir(srcDir);
            if (remaining.length === 0) await fs.rmdir(srcDir);
        } catch (_) {}
        return count;
    }

    async _safeMove(src, dst) {
        try {
            await fs.rename(src, dst);
        } catch (e) {
            if (e && (e.code === 'EXDEV' || e.code === 'EPERM')) {
                await fs.copyFile(src, dst);
                try { await fs.unlink(src); } catch (_) {}
            } else {
                throw e;
            }
        }
    }

    // 当前备份目录的统计信息：文件数 + 总大小
    async getDirectoryInfo() {
        const stat = async (dir) => {
            if (!fsSync.existsSync(dir)) return { count: 0, size: 0 };
            const files = await fs.readdir(dir);
            let count = 0, size = 0;
            for (const f of files) {
                if (!f.endsWith('.json')) continue;
                try {
                    const st = await fs.stat(path.join(dir, f));
                    count++;
                    size += st.size;
                } catch (_) {}
            }
            return { count, size };
        };
        const [d, b] = await Promise.all([stat(this.dailyDir), stat(this.beforeImportDir)]);
        return {
            backupRoot: this.backupRoot,
            defaultBackupRoot: this.defaultBackupRoot,
            isCustomPath: !!this._customBackupRoot,
            fellbackToDefault: this._fellbackToDefault,
            daily: d,
            beforeImport: b,
            totalCount: d.count + b.count,
            totalSize: d.size + b.size
        };
    }

    async saveSettings({ backup_enabled, backup_time, backup_keep_count }) {
        const db = getDatabase();
        if (typeof backup_enabled === 'boolean') {
            await db.setSetting('backup_enabled', backup_enabled);
        }
        if (typeof backup_time === 'string' && /^\d{1,2}:\d{1,2}$/.test(backup_time)) {
            // 规范化为 HH:MM
            const [h, m] = backup_time.split(':').map(n => parseInt(n, 10));
            const hh = String(Math.max(0, Math.min(23, h))).padStart(2, '0');
            const mm = String(Math.max(0, Math.min(59, m))).padStart(2, '0');
            await db.setSetting('backup_time', `${hh}:${mm}`);
        }
        if (backup_keep_count != null) {
            const k = Math.max(1, Math.min(365, parseInt(backup_keep_count, 10) || 30));
            await db.setSetting('backup_keep_count', k);
        }
        return this.getSettings();
    }
}

module.exports = { BackupService, BACKUP_VERSION };
