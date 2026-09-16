// Highlight.js 初始化脚本
(function() {
    'use strict';
    
    console.log('开始初始化 Highlight.js...');
    
    try {
        const path = require('path');
        
        // 获取lib目录的绝对路径
        const libDir = path.join(__dirname, '..', 'renderer', 'lib');
        console.log('lib目录路径:', libDir);
        
        // 使用绝对路径加载模块
        const hljs = require(path.join(libDir, 'highlight.js'));
        console.log('highlight.js 核心库已加载');
        
        // 加载 bash 语言定义
        const bashLang = require(path.join(libDir, 'bash.js'));
        console.log('bash.js 已加载');
        
        // 注册语言
        hljs.registerLanguage('bash', bashLang);
        hljs.registerLanguage('shell', bashLang);
        console.log('Bash 语言已注册');
        
        // 将 hljs 挂载到全局对象
        window.hljs = hljs;
        
        console.log('Highlight.js 初始化完成！');
        console.log('window.hljs:', window.hljs);
        console.log('已注册语言:', hljs.listLanguages());
        
    } catch (error) {
        console.error('Highlight.js 加载失败:', error);
        console.error('Error stack:', error.stack);
    }
})();
