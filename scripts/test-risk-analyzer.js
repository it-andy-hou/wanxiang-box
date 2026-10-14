// riskAnalyzer 规则引擎回归用例（node scripts/test-risk-analyzer.js 直接运行）
// 调整规则库后请重跑本用例，确保各档位命中/豁免行为不回退
const { RiskAnalyzer } = require('../src/renderer/js/services/riskAnalyzer.js');
const { analyzeRisk } = RiskAnalyzer;

const cases = [
    // [描述, 脚本, 期望等级, 期望包含的规则ID]
    ['全盘删除', 'rm -rf /', 'high', ['H1']],
    ['系统目录删除', 'rm -rf /etc/nginx', 'high', ['H1']],
    ['系统目录通配删除', 'rm -rf /usr/*', 'high', ['H1']],
    ['注释中的删除不报', '# rm -rf /\n echo ok', 'normal', []],
    ['行内注释不报', 'echo start # rm -rf /var', 'normal', []],
    ['未防护变量删除', 'rm -rf $DIR/*', 'high', ['H2']],
    ['未防护变量删除(花括号)', 'rm -rf ${APP_PATH}/', 'high', ['H2']],
    ['带防护豁免(内联)', 'rm -rf "${DIR:?DIR is unset}"/*', 'normal', []],
    ['带防护豁免(同行断言)', ': "${DIR:?DIR is unset}"\nrm -rf $DIR/*', 'normal', []],
    ['普通路径删除不报', 'rm -rf ./build /tmp/cache', 'normal', []],
    ['mkfs', 'mkfs.ext4 /dev/sdb1', 'high', ['H3']],
    ['fdisk', 'fdisk /dev/sdb', 'high', ['H3']],
    ['dd 覆写块设备', 'dd if=/dev/zero of=/dev/sda bs=1M', 'high', ['H4']],
    ['dd 覆写普通文件不报', 'dd if=a.img of=b.img', 'normal', []],
    ['管道执行网络脚本', 'curl -fsSL https://x/install.sh | bash', 'high', ['H5']],
    ['wget 管道 sh', 'wget -qO- https://x/s.sh | sh', 'high', ['H5']],
    ['管道但非 shell 不报', 'curl -s https://x/data.json | jq .', 'normal', []],
    ['eval 不可信输入', 'eval $1', 'high', ['H6']],
    ['eval "$@"', 'eval "$@"', 'high', ['H6']],
    ['sh -c 变量', 'sh -c "$CMD"', 'high', ['H6']],
    ['chmod 777', 'chmod -R 777 /data/app', 'medium', ['M1']],
    ['kill -9 1', 'kill -9 1', 'medium', ['M2']],
    ['killall', 'killall nginx', 'medium', ['M2']],
    ['防火墙 iptables -F', 'iptables -F', 'medium', ['M3']],
    ['关 firewalld', 'systemctl stop firewalld', 'medium', ['M3']],
    ['ufw disable', 'ufw disable', 'medium', ['M3']],
    ['重启', 'sudo reboot', 'medium', ['M4']],
    ['shutdown', 'shutdown -h now', 'medium', ['M4']],
    ['init 0', 'init 0', 'medium', ['M4']],
    ['sudoers', 'echo "user ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers', 'medium', ['M5']],
    ['明文密码', 'PASSWORD="mysecret123"', 'medium', ['M6']],
    ['通用 eval', 'eval "$cmd"', 'medium', ['M7']],
    ['停 sshd', 'systemctl restart sshd', 'medium', ['M8']],
    ['常规脚本', '#!/bin/bash\nset -euo pipefail\ndf -h\nuptime', 'normal', []],
    ['空内容', '', 'normal', []],
    ['仅 shebang', '#!/bin/bash\n', 'normal', []],
    ['多行综合取最高', '#!/bin/bash\necho hi\nchmod -R 777 /x\nrm -rf /var/log', 'high', ['H1', 'M1']],
];

let pass = 0, fail = 0;
for (const [desc, content, expLevel, expRules] of cases) {
    const r = analyzeRisk(content);
    const rules = r.findings.map(f => f.ruleId);
    const levelOk = r.level === expLevel;
    const rulesOk = expRules.every(id => rules.includes(id));
    // 行号抽查：全盘删除应报告第 1 行
    if (levelOk && rulesOk) { pass++; console.log(`PASS  ${desc}  -> ${r.level} ${rules.join(',') || '无命中'}`); }
    else {
        fail++;
        console.log(`FAIL  ${desc}  期望=${expLevel}(${expRules.join(',')}) 实际=${r.level}(${rules.join(',')})`);
        console.log('      findings:', JSON.stringify(r.findings, null, 1));
    }
}

// 行号正确性抽查
const r2 = analyzeRisk('#!/bin/bash\necho start\n\nrm -rf /etc');
const h1 = r2.findings.find(f => f.ruleId === 'H1');
if (h1 && h1.line === 4 && pass >= 0) { console.log('PASS  行号计算 (L' + h1.line + ')'); }
else { fail++; console.log('FAIL  行号计算:', JSON.stringify(h1)); }

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
