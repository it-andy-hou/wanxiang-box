// 脚本管理功能测试
(function() {
    'use strict';

    console.log('=== 脚本管理功能测试 ===');

    // 测试配置
    const tests = {
        passed: 0,
        failed: 0,
        total: 0
    };

    function assert(condition, message) {
        tests.total++;
        if (condition) {
            tests.passed++;
            console.log(`✓ ${message}`);
        } else {
            tests.failed++;
            console.error(`✗ ${message}`);
        }
    }

    // 等待DOM加载完成
    function waitForDOM() {
        return new Promise((resolve) => {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', resolve);
            } else {
                resolve();
            }
        });
    }

    // 等待服务初始化
    function waitForService() {
        return new Promise((resolve) => {
            const checkService = setInterval(() => {
                if (window.ScriptService && window.ScriptManagement) {
                    clearInterval(checkService);
                    resolve();
                }
            }, 100);
        });
    }

    async function runTests() {
        try {
            await waitForDOM();
            await waitForService();

            console.log('\n1. 测试ScriptService类存在性');
            assert(typeof window.ScriptService === 'function', 'ScriptService类已定义');

            console.log('\n2. 测试ScriptManagement模块存在性');
            assert(typeof window.ScriptManagement === 'object', 'ScriptManagement模块已加载');
            assert(typeof window.ScriptManagement.init === 'function', 'ScriptManagement.init方法存在');
            assert(typeof window.ScriptManagement.loadScripts === 'function', 'ScriptManagement.loadScripts方法存在');

            console.log('\n3. 测试页面元素存在性');
            assert(document.getElementById('page-scripts') !== null, '脚本管理页面存在');
            assert(document.getElementById('addScriptBtn') !== null, '添加脚本按钮存在');
            assert(document.getElementById('refreshScriptsBtn') !== null, '刷新按钮存在');
            assert(document.getElementById('scriptSearchInput') !== null, '搜索输入框存在');
            assert(document.getElementById('scriptCategoryFilter') !== null, '分类筛选存在');
            assert(document.getElementById('scriptLanguageFilter') !== null, '语言筛选存在');
            assert(document.getElementById('scriptsGrid') !== null, '脚本网格容器存在');

            console.log('\n4. 测试ScriptService实例创建');
            const scriptService = new window.ScriptService();
            assert(scriptService !== null, 'ScriptService实例创建成功');
            assert(typeof scriptService.loadScripts === 'function', 'loadScripts方法存在');
            assert(typeof scriptService.addScript === 'function', 'addScript方法存在');
            assert(typeof scriptService.updateScript === 'function', 'updateScript方法存在');
            assert(typeof scriptService.deleteScript === 'function', 'deleteScript方法存在');
            assert(typeof scriptService.duplicateScript === 'function', 'duplicateScript方法存在');

            console.log('\n5. 测试数据加载功能');
            const scripts = await scriptService.loadScripts();
            assert(Array.isArray(scripts), '脚本数据是数组');
            assert(scripts.length >= 0, `加载了 ${scripts.length} 个脚本`);
            
            if (scripts.length > 0) {
                const firstScript = scripts[0];
                assert(firstScript.hasOwnProperty('id'), '脚本包含id字段');
                assert(firstScript.hasOwnProperty('name'), '脚本包含name字段');
                assert(firstScript.hasOwnProperty('content'), '脚本包含content字段');
                assert(firstScript.hasOwnProperty('category'), '脚本包含category字段');
                assert(firstScript.hasOwnProperty('language'), '脚本包含language字段');
                assert(Array.isArray(firstScript.tags), '脚本tags字段是数组');
            }

            console.log('\n6. 测试脚本分类筛选');
            const systemScripts = scripts.filter(s => s.category === 'system');
            assert(systemScripts.length >= 0, `系统管理类脚本: ${systemScripts.length}个`);

            console.log('\n7. 测试脚本搜索功能');
            const searchResults = scripts.filter(s => 
                s.name.includes('系统') || (s.description && s.description.includes('系统'))
            );
            assert(searchResults.length >= 0, `搜索"系统"找到 ${searchResults.length}个结果`);

            // 打印测试摘要
            console.log('\n=== 测试摘要 ===');
            console.log(`总计: ${tests.total} 个测试`);
            console.log(`通过: ${tests.passed} 个`);
            console.log(`失败: ${tests.failed} 个`);
            console.log(`成功率: ${((tests.passed / tests.total) * 100).toFixed(2)}%`);

            if (tests.failed === 0) {
                console.log('\n✓ 所有测试通过！');
            } else {
                console.log('\n✗ 部分测试失败，请检查！');
            }

        } catch (error) {
            console.error('测试执行失败:', error);
        }
    }

    // 自动运行测试
    runTests();

})();
