// 操作系统小 logo 模块
// 内置离线 SVG 图标（无需网络），按主机的 osType 字段匹配对应系统的简化品牌图标
// 供主机管理页「系统版本」列等处使用：OsLogos.getLogo(osType, size)
(function () {
    'use strict';

    // viewBox 统一为 0 0 24 24，颜色取品牌主色并做深色主题可辨识处理
    const ICONS = {
        // CentOS：紫色九宫格母题
        centos: '<svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#932279"/><rect x="10.2" y="10.2" width="3.6" height="3.6" fill="#fff"/><rect x="10.2" y="5" width="3.6" height="3.4" fill="#fff"/><rect x="10.2" y="15.6" width="3.6" height="3.4" fill="#fff"/><rect x="5" y="10.2" width="3.4" height="3.6" fill="#fff"/><rect x="15.6" y="10.2" width="3.4" height="3.6" fill="#fff"/><rect x="5" y="5" width="3.4" height="3.4" fill="#fff" opacity=".45"/><rect x="15.6" y="5" width="3.4" height="3.4" fill="#fff" opacity=".45"/><rect x="5" y="15.6" width="3.4" height="3.4" fill="#fff" opacity=".45"/><rect x="15.6" y="15.6" width="3.4" height="3.4" fill="#fff" opacity=".45"/></svg>',

        // Red Hat / RHEL：红底白色 fedora 帽剪影
        redhat: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#EE0000"/><path fill="#fff" d="M7 14.3c.3-3.1 1.2-5.6 2.6-7.1C10.3 6.4 11.1 6 12 6s1.7.4 2.4 1.2c1.4 1.5 2.3 4 2.6 7.1.7.2 1.2.8 1.2 1.5 0 .9-.7 1.6-1.6 1.6H7.4c-.9 0-1.6-.7-1.6-1.6 0-.7.5-1.3 1.2-1.5z"/></svg>',

        // Ubuntu：橙底圆点环绕母题
        ubuntu: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#E95420"/><circle cx="12" cy="12" r="3.1" fill="#fff"/><circle cx="12" cy="4.1" r="1.9" fill="#fff"/><circle cx="18.9" cy="16" r="1.9" fill="#fff"/><circle cx="5.1" cy="16" r="1.9" fill="#fff"/></svg>',

        // Debian：品红底白色旋涡弧线
        debian: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#D70A53"/><path fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" d="M13.8 8.3a3.8 3.8 0 1 0 2.1 6.9"/><path fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" d="M13.6 4.6a7.4 7.4 0 1 0 4.2 13.3"/></svg>',

        // Rocky Linux：绿底白色双峰山形
        rocky: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#10B981"/><path fill="#fff" d="M6.2 16.8 10.8 5.2l2.7 5.7 1.3-2.2 3 8.1z"/></svg>',

        // AlmaLinux：深蓝底白色 A 形山
        alma: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0F5298"/><path fill="#fff" d="M12 6.2 17.8 17.4h-3.2l-2.6-4.8-2.6 4.8H6.2z"/></svg>',

        // openEuler：蓝底白色欧拉曲线波
        openeuler: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0F5BB5"/><path fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" d="M6.5 9c2.8 0 2.8 6 5.5 6s2.7-6 5.5-6"/></svg>',

        // 麒麟（银河麒麟/中标麒麟）：深蓝底白色星形
        kylin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2E5AAC"/><path fill="#fff" d="M12 5.5l1.6 3.6 3.9.4-2.9 2.6.8 3.9-3.4-2-3.4 2 .8-3.9-2.9-2.6 3.9-.4z"/></svg>',

        // UOS / 统信 / Deepin：蓝底白色 U + 红点
        uos: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0B78D4"/><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" d="M8.5 7v5.5a3.5 3.5 0 0 0 7 0V7"/><circle cx="16.8" cy="8.2" r="1.5" fill="#E53935"/></svg>',

        // SUSE / openSUSE / SLES：绿底变色龙眼睛母题
        suse: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#30BA78"/><circle cx="14.4" cy="9.6" r="3" fill="#fff"/><circle cx="14.4" cy="9.6" r="1.4" fill="#30BA78"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" d="M4.6 13.2c1.5 3 4.4 4.9 7.9 4.9"/></svg>',

        // Fedora：深蓝底白色 f 字形
        fedora: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#294172"/><path fill="#fff" d="M14.8 6.2h-2.3c-2.3 0-3.9 1.6-3.9 4v1.2H7v2.4h1.6v4h2.5v-4h2.4v-2.4h-2.4v-1.3c0-.9.5-1.5 1.4-1.5h2.3z"/></svg>',

        // Oracle Linux：红底圆角方块 + 白色 O 环
        oracle: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="#C74634"/><circle cx="12" cy="12" r="5" fill="none" stroke="#fff" stroke-width="2.2"/></svg>',

        // Anolis OS 龙蜥：青绿底蜥蜴曲线
        anolis: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#00A19B"/><path fill="#fff" d="M6 14.5c1.8-3.8 4.6-6.2 8.4-7l-.9 2 2.3-.4-.9 1.9c1.1.2 2 .9 2.4 1.9.2.6-.5 1.1-1 .7-.5-.4-1.1-.6-1.7-.5-1.6.2-2.9 1.1-3.6 2.5-.3.6-1.2.3-1.1-.4.2-1.1.7-2 1.5-2.8-1.7.6-3 1.9-3.8 3.6-.4.8-1.9.4-1.6-.5z"/></svg>',

        // Alpine：深蓝雪峰
        alpine: '<svg viewBox="0 0 24 24"><path fill="#0D597F" d="M12 4 22 20h-6.5L12 15l-3.5 5H2z"/></svg>',

        // Arch：蓝色 A 形三角
        arch: '<svg viewBox="0 0 24 24"><path fill="#1793D1" d="M12 3.5 21 20h-6l-3-5-3 5H3z"/></svg>',

        // Windows：四格方块
        windows: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8.4" height="8.4" fill="#0078D6"/><rect x="12.6" y="3" width="8.4" height="8.4" fill="#0078D6"/><rect x="3" y="12.6" width="8.4" height="8.4" fill="#0078D6"/><rect x="12.6" y="12.6" width="8.4" height="8.4" fill="#0078D6"/></svg>',

        // 通用 Linux：Tux 企鹅
        tux: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="13.5" rx="5.6" ry="7" fill="#212121"/><ellipse cx="12" cy="15.5" rx="3.6" ry="4.6" fill="#fff"/><circle cx="12" cy="6.8" r="3.6" fill="#212121"/><circle cx="10.7" cy="6.2" r=".6" fill="#fff"/><circle cx="13.3" cy="6.2" r=".6" fill="#fff"/><path d="M11 7.2 12 8.9 13 7.2z" fill="#F5A623"/><ellipse cx="9" cy="20.6" rx="1.7" ry=".9" fill="#F5A623"/><ellipse cx="15" cy="20.6" rx="1.7" ry=".9" fill="#F5A623"/></svg>',

        // 未知系统兜底：终端提示符
        generic: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" fill="#5A6472"/><path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6.5 9l3.5 3-3.5 3"/><line x1="12.5" y1="15" x2="17" y2="15" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>'
    };

    // osType 关键词 → 图标键（顺序匹配，首次命中即返回）
    // osType 由 SSH 探测的 /etc/os-release NAME 清洗而来（已去掉 Enterprise/Linux/Server 等后缀）
    const MATCHERS = [
        [/centos/, 'centos'],
        [/red\s*hat|rhel/, 'redhat'],
        [/ubuntu/, 'ubuntu'],
        [/debian/, 'debian'],
        [/rocky/, 'rocky'],
        [/almalinux|\balma/, 'alma'],
        [/euler/, 'openeuler'],
        [/kylin|麒麟/, 'kylin'],
        [/uniontech|统信|deepin|\buos/, 'uos'],
        [/suse|sles/, 'suse'],
        [/fedora/, 'fedora'],
        [/oracle/, 'oracle'],
        [/anolis|龙蜥/, 'anolis'],
        [/alpine/, 'alpine'],
        [/\barch\b/, 'arch'],
        [/windows|microsoft/, 'windows'],
        [/linux/, 'tux']
    ];

    // 匹配 osType 对应的图标键；空值返回 ''，未匹配返回 'generic'
    function matchIcon(osType) {
        const s = String(osType || '').trim().toLowerCase();
        if (!s) return '';
        for (const item of MATCHERS) {
            if (item[0].test(s)) return item[1];
        }
        return 'generic';
    }

    // 获取 OS 小 logo 的 SVG HTML 字符串；osType 为空时返回 ''
    // size 为渲染像素尺寸，默认 14
    function getLogo(osType, size) {
        const px = parseInt(size, 10) || 14;
        const key = matchIcon(osType);
        const svg = key ? ICONS[key] : '';
        if (!svg) return '';
        return svg.replace('<svg ', '<svg width="' + px + '" height="' + px + '" ');
    }

    // 暴露到全局（本项目渲染层为多脚本全局作用域模式）
    window.OsLogos = {
        getLogo: getLogo,
        matchIcon: matchIcon
    };
})();
