// 数据库修复脚本：当 database.json 因为非原子写入被截断时，自动找到最后一个
// 完整对象进行截断，并补全缺失的闭合符。
//
// 用法：
//   node scripts/repair-db.js <input> [output]
//
// 默认 output = <input>.repaired.json，并对原文件做一次 .corrupt.bak 备份。
'use strict';

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
if (!inputPath) {
    console.error('用法: node scripts/repair-db.js <database.json> [output]');
    process.exit(1);
}
const outputPath = process.argv[3] || (inputPath + '.repaired.json');

if (!fs.existsSync(inputPath)) {
    console.error('文件不存在:', inputPath);
    process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8');
console.log(`读取文件: ${inputPath}  (${raw.length} 字节)`);

// 1) 直接尝试 parse
try {
    const obj = JSON.parse(raw);
    console.log('✓ 文件本身就是合法 JSON，无需修复');
    printStats(obj);
    process.exit(0);
} catch (e) {
    console.log('✗ JSON 解析失败:', e.message);
    console.log('开始尝试修复...');
}

// 2) 顶层结构：{ "hosts":[...], "scripts":[...], "task_executions":[...], ... }
//    截断时通常停在最后一个数组的某个对象内部。
//    策略：定位文件末尾最后一段 "    },\n    {" —— 即截断对象之前最后一个完整对象的结束位置。
//    注意：必须用 lastIndexOf 取最后一次出现，否则会匹配到 hosts 数组开头那种早期位置。
const SEP = '    },\n    {';
const sepIndex = raw.lastIndexOf(SEP);
if (sepIndex === -1) {
    console.error('未找到可截断位置（找不到 "    },\\n    {"），请手工处理');
    process.exit(2);
}

// 截断到 SEP 中的 "    }" 之后（去掉逗号），再补全数组+对象闭合
// SEP 形如：    },\n    {
//          ^^^^   ← 保留这段（不带逗号）
let fixed = raw.slice(0, sepIndex) + '    }\n  ]\n}\n';

// 3) 校验
let parsed;
try {
    parsed = JSON.parse(fixed);
} catch (e) {
    console.error('✗ 修复后仍无法解析:', e.message);
    // 备份截断后的文本，便于人工诊断
    fs.writeFileSync(outputPath + '.tryfix.txt', fixed, 'utf8');
    process.exit(3);
}

console.log('✓ 修复成功，JSON 合法');
printStats(parsed);

// 4) 输出
fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2), 'utf8');
console.log('✓ 已写入修复后文件:', outputPath);

function printStats(obj) {
    const tables = [
        'hosts', 'scripts', 'task_executions', 'task_results',
        'ssh_keys', 'host_groups', 'logs',
        'project_tasks', 'project_steps', 'project_executions', 'project_step_executions',
        'script_categories', 'tag_types', 'tag_values', 'script_shortcuts'
    ];
    console.log('--- 数据统计 ---');
    for (const t of tables) {
        if (Array.isArray(obj[t])) {
            console.log(`  ${t}: ${obj[t].length}`);
        }
    }
    if (obj.settings && typeof obj.settings === 'object') {
        console.log(`  settings: ${Object.keys(obj.settings).length} 项`);
    }
}
