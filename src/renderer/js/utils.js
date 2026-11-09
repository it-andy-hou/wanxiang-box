// 实用工具函数库

// DOM操作工具
const $ = (selector) => {
    try {
        return document.querySelector(selector);
    } catch (e) {
        console.error('选择器错误:', selector, e);
        return null;
    }
};

const $$ = (selector) => {
    try {
        return document.querySelectorAll(selector);
    } catch (e) {
        console.error('选择器错误:', selector, e);
        return [];
    }
};

// 事件处理工具
const on = (element, event, handler) => {
    try {
        if (typeof element === 'string') {
            element = $(element);
        }
        if (element && typeof handler === 'function') {
            element.addEventListener(event, handler);
        } else {
            console.warn('事件绑定失败 - 元素或处理器无效:', element, event);
        }
    } catch (e) {
        console.error('事件绑定错误:', e, { element, event });
    }
};

const off = (element, event, handler) => {
    try {
        if (typeof element === 'string') {
            element = $(element);
        }
        if (element && typeof handler === 'function') {
            element.removeEventListener(event, handler);
        }
    } catch (e) {
        console.error('事件解绑错误:', e);
    }
};

// 异步工具
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

const throttle = (func, limit) => {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
};

// 数据验证工具
const validators = {
    isRequired: (value) => value !== null && value !== undefined && value !== '',
    isEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    isIP: (ip) => /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip),
    isPort: (port) => {
        const num = parseInt(port);
        return num >= 1 && num <= 65535;
    },
    isHostname: (hostname) => /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/.test(hostname)
};

// 格式化工具
const formatters = {
    date: (date, format = 'YYYY-MM-DD HH:mm:ss') => {
        if (!date) return '';
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        
        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    },
    
    fileSize: (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
    
    duration: (ms) => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }
};

// 存储工具
const storage = {
    get: (key, defaultValue = null) => {
        try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : defaultValue;
        } catch (error) {
            console.error('Storage get error:', error);
            return defaultValue;
        }
    },
    
    set: (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('Storage set error:', error);
            return false;
        }
    },
    
    remove: (key) => {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error('Storage remove error:', error);
            return false;
        }
    },
    
    clear: () => {
        try {
            localStorage.clear();
            return true;
        } catch (error) {
            console.error('Storage clear error:', error);
            return false;
        }
    }
};

// HTTP请求工具
const http = {
    get: async (url, options = {}) => {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('HTTP GET error:', error);
            throw error;
        }
    },
    
    post: async (url, data = {}, options = {}) => {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                body: JSON.stringify(data),
                ...options
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('HTTP POST error:', error);
            throw error;
        }
    }
};

// 消息通知工具
const notify = {
    success: (message, duration = 3000) => {
        showNotification(message, 'success', duration);
    },
    
    error: (message, duration = 5000) => {
        showNotification(message, 'error', duration);
    },
    
    warning: (message, duration = 4000) => {
        showNotification(message, 'warning', duration);
    },
    
    info: (message, duration = 3000) => {
        showNotification(message, 'info', duration);
    }
};

function showNotification(message, type = 'info', duration = 3000) {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    // 支持换行显示
    if (message.includes('\n')) {
        notification.innerHTML = message.split('\n').map(line => `<div>${line}</div>`).join('');
    } else {
        notification.textContent = message;
    }
    
    // 添加样式
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 6px;
        color: var(--text-body);
        font-weight: 500;
        z-index: 10000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
        line-height: 1.4;
        background: var(--surface-float);
        border: 1px solid var(--border-default);
        box-shadow: var(--shadow-modal);
    `;
    
    // 左侧语义色边条
    const colors = {
        success: 'var(--status-healthy-fg)',
        error: 'var(--status-critical-fg)',
        warning: 'var(--status-warning-fg)',
        info: 'var(--status-info-fg)'
    };
    notification.style.borderLeft = `4px solid ${colors[type] || colors.info}`;
    
    // 添加到页面
    document.body.appendChild(notification);
    
    // 显示动画
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // 自动移除
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, duration);
}

// 加载状态管理
const loading = {
    show: (element = document.body, message = '') => {
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div style="text-align: center;">
                <div class="loading"></div>
                ${message ? `<div style="margin-top: 10px; color: var(--text-muted);">${message}</div>` : ''}
            </div>
        `;
        
        if (element === document.body) {
            overlay.style.position = 'fixed';
        } else {
            overlay.style.position = 'absolute';
            element.style.position = 'relative';
        }
        
        element.appendChild(overlay);
        return overlay;
    },
    
    hide: (overlay) => {
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    }
};

// CSV处理工具
const csv = {
    parse: (csvText) => {
        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length === 0) return [];
        
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const data = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
            if (values.length === headers.length) {
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index];
                });
                data.push(row);
            }
        }
        
        return data;
    },
    
    stringify: (data) => {
        if (!data || data.length === 0) return '';
        
        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => 
                headers.map(header => `"${row[header] || ''}"`).join(',')
            )
        ].join('\n');
        
        return csvContent;
    }
};



// 工具提示系统
const tooltip = {
    create: (element, text, options = {}) => {
        if (!element || !text) return;
        
        const settings = {
            placement: 'top',
            trigger: 'hover',
            delay: 200,
            ...options
        };
        
        let tooltipEl = null;
        let showTimer = null;
        let hideTimer = null;
        
        const showTooltip = (e) => {
            clearTimeout(hideTimer);
            
            showTimer = setTimeout(() => {
                if (tooltipEl) {
                    tooltipEl.remove();
                }
                
                tooltipEl = document.createElement('div');
                tooltipEl.className = 'tooltip-popup';
                tooltipEl.textContent = text;
                tooltipEl.style.cssText = `
                    position: absolute;
                    background: var(--surface-float);
                    color: var(--text-body);
                    border: 1px solid var(--border-default);
                    box-shadow: var(--shadow-card);
                    padding: 8px 12px;
                    border-radius: 4px;
                    font-size: 12px;
                    white-space: nowrap;
                    z-index: 10000;
                    pointer-events: none;
                    opacity: 0;
                    transform: translateY(4px);
                    transition: all 0.2s ease;
                `;
                
                document.body.appendChild(tooltipEl);
                
                // 计算位置
                const rect = element.getBoundingClientRect();
                const tooltipRect = tooltipEl.getBoundingClientRect();
                
                let top, left;
                switch (settings.placement) {
                    case 'top':
                        top = rect.top - tooltipRect.height - 8;
                        left = rect.left + (rect.width - tooltipRect.width) / 2;
                        break;
                    case 'bottom':
                        top = rect.bottom + 8;
                        left = rect.left + (rect.width - tooltipRect.width) / 2;
                        break;
                    case 'left':
                        top = rect.top + (rect.height - tooltipRect.height) / 2;
                        left = rect.left - tooltipRect.width - 8;
                        break;
                    case 'right':
                        top = rect.top + (rect.height - tooltipRect.height) / 2;
                        left = rect.right + 8;
                        break;
                }
                
                // 边界检查
                if (left < 8) left = 8;
                if (left + tooltipRect.width > window.innerWidth - 8) {
                    left = window.innerWidth - tooltipRect.width - 8;
                }
                if (top < 8) top = 8;
                if (top + tooltipRect.height > window.innerHeight - 8) {
                    top = window.innerHeight - tooltipRect.height - 8;
                }
                
                tooltipEl.style.top = top + 'px';
                tooltipEl.style.left = left + 'px';
                
                // 显示动画
                requestAnimationFrame(() => {
                    if (tooltipEl) {
                        tooltipEl.style.opacity = '1';
                        tooltipEl.style.transform = 'translateY(0)';
                    }
                });
            }, settings.delay);
        };
        
        const hideTooltip = () => {
            clearTimeout(showTimer);
            
            if (tooltipEl) {
                tooltipEl.style.opacity = '0';
                tooltipEl.style.transform = 'translateY(4px)';
                
                hideTimer = setTimeout(() => {
                    if (tooltipEl) {
                        tooltipEl.remove();
                        tooltipEl = null;
                    }
                }, 200);
            }
        };
        
        if (settings.trigger === 'hover') {
            element.addEventListener('mouseenter', showTooltip);
            element.addEventListener('mouseleave', hideTooltip);
        } else if (settings.trigger === 'click') {
            element.addEventListener('click', showTooltip);
            document.addEventListener('click', (e) => {
                if (!element.contains(e.target)) {
                    hideTooltip();
                }
            });
        }
        
        return {
            destroy: () => {
                element.removeEventListener('mouseenter', showTooltip);
                element.removeEventListener('mouseleave', hideTooltip);
                element.removeEventListener('click', showTooltip);
                clearTimeout(showTimer);
                clearTimeout(hideTimer);
                if (tooltipEl) {
                    tooltipEl.remove();
                }
            },
            updateText: (newText) => {
                text = newText;
                if (tooltipEl) {
                    tooltipEl.textContent = newText;
                }
            }
        };
    },
    
    // 为元素批量添加工具提示
    initAll: () => {
        const elements = document.querySelectorAll('[data-tooltip]');
        elements.forEach(el => {
            const text = el.getAttribute('data-tooltip');
            const placement = el.getAttribute('data-placement') || 'top';
            const trigger = el.getAttribute('data-trigger') || 'hover';
            
            tooltip.create(el, text, { placement, trigger });
        });
    }
};

// Lucide 内联 SVG 图标库：替代 UI 中的 emoji，统一专业风格
// 用法：Utils.icon('search') / Utils.icon('play', 14)
const icons = (() => {
    const P = {
        search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
        'eye-off': '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
        info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
        play: '<polygon points="6 3 20 12 6 21 6 3"/>',
        square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
        'bar-chart': '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
        'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
        server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
        folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
        upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
        zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
        clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
        'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
        key: '<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
        copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
        edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
        'trash-2': '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
        plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
        calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
        bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
        'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
        'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
        'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
        'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
        hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
        pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
        'skip-forward': '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
        'help-circle': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
        'grip-vertical': '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
        construction: '<rect width="20" height="8" x="2" y="4" rx="2"/><path d="M9 12h6"/><path d="M12 12v8"/>',
        clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
        'hard-drive': '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
        'file-spreadsheet': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
        scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>'
    };
    return (name, size = 16, sw = 2) => {
        const body = P[name];
        if (!body) return '';
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;" aria-hidden="true">${body}</svg>`;
    };
})();

// 导出工具对象
window.Utils = {
    $, $$, on, off,
    sleep, debounce, throttle,
    validators, formatters, storage, http,
    notify, loading, csv, tooltip,
    icons, icon: icons,
    // 添加确认对话框快捷方法（使用自定义组件，避免原生confirm导致的焦点锁定问题）
    confirm: async (message, title = '确认') => {
        // 使用项目自定义的ConfirmDialog组件
        if (window.Components && window.Components.ConfirmDialog) {
            return await window.Components.ConfirmDialog.show({
                title: title,
                message: message,
                confirmText: '确定',
                cancelText: '取消'
            });
        } else {
            // 降级方案：如果组件未加载，使用原生confirm
            return new Promise((resolve) => {
                if (window.confirm) {
                    resolve(window.confirm(message));
                } else {
                    resolve(true);
                }
            });
        }
    }
};

// 可搜索下拉面板：全局单例，主机管理页工具栏与各主机选择弹窗共用
// 拦截原生 select 的 mousedown，弹出带关键词过滤的面板；原生 select 仍承载数据与 change 事件
window.SelectSearch = (function() {
    let panel = null;
    let anchor = null;
    let cleanup = null;

    function close() {
        if (panel) {
            panel.remove();
            panel = null;
        }
        if (cleanup) {
            cleanup();
            cleanup = null;
        }
        anchor = null;
    }

    // 打开某个筛选下拉的搜索面板
    function open(select) {
        close();
        anchor = select;

        const escapeHtml = (str) => String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // 每次打开时从原生 select 现有 option 读取（选项被重写后自动同步）
        const allOption = Array.from(select.options)
            .find(o => o.value === '') || { value: '', label: '全部' };
        const valueOptions = Array.from(select.options)
            .filter(o => o.value !== '')
            .map(o => ({ value: o.value, label: o.textContent }));

        const rect = select.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = 'select-search-panel';
        // 面板最小宽度 200px：保证占位文案与选项文字完整展示，不被裁切
        el.style.left = `${rect.left}px`;
        el.style.top = `${rect.bottom + 4}px`;
        el.style.minWidth = `${Math.max(rect.width, 200)}px`;
        el.innerHTML = `
            <input type="text" class="form-control select-search-input" placeholder="输入关键词过滤" autocomplete="off">
            <div class="select-search-list"></div>
        `;
        document.body.appendChild(el);
        // 视口钳制：右缘放不下则左移；下方空间不足则翻转到 select 上方，避免文字被窗口裁切
        const maxLeft = window.innerWidth - el.offsetWidth - 8;
        if (maxLeft >= 0) {
            el.style.left = `${Math.min(rect.left, maxLeft)}px`;
        }
        if (rect.bottom + el.offsetHeight + 8 > window.innerHeight && rect.top - el.offsetHeight > 8) {
            el.style.top = `${rect.top - el.offsetHeight - 4}px`;
        }
        panel = el;

        const input = el.querySelector('.select-search-input');
        const listEl = el.querySelector('.select-search-list');
        let matched = [];       // 当前关键词过滤后的选项
        let activeIndex = -1;   // 键盘上下键高亮项

        // 选中某项：写回原生 select 并触发 change，复用既有筛选链路
        const chooseOption = (value) => {
            close();
            if (select.value !== value) {
                select.value = value;
                select.dispatchEvent(new Event('change'));
            }
        };

        // 渲染选项列表
        const renderList = () => {
            const kw = input.value.trim().toLowerCase();
            matched = valueOptions.filter(o =>
                o.label.toLowerCase().includes(kw) || o.value.toLowerCase().includes(kw));
            activeIndex = -1;
            if (matched.length === 0) {
                listEl.innerHTML = '<div class="select-search-empty">无匹配选项</div>';
                return;
            }
            listEl.innerHTML = matched.map((o, i) => `
                <div class="select-search-item${o.value === select.value ? ' selected' : ''}" data-idx="${i}">${escapeHtml(o.label)}</div>
            `).join('');
        };

        // 顶部固定一行「全部XX」，不受关键词影响，便于快速清除该筛选
        const allRow = document.createElement('div');
        allRow.className = 'select-search-all' + (select.value === '' ? ' selected' : '');
        allRow.textContent = allOption.label;
        allRow.addEventListener('click', () => chooseOption(''));
        el.insertBefore(allRow, listEl);

        renderList();

        // 点击选项
        listEl.addEventListener('click', (e) => {
            const item = e.target.closest('.select-search-item');
            if (!item) return;
            const idx = parseInt(item.dataset.idx, 10);
            if (matched[idx]) chooseOption(matched[idx].value);
        });

        // 输入关键词实时过滤
        input.addEventListener('input', renderList);

        // 键盘操作：上下移动高亮，Enter 选中，Esc 关闭
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (matched.length === 0) return;
                activeIndex = e.key === 'ArrowDown'
                    ? Math.min(activeIndex + 1, matched.length - 1)
                    : Math.max(activeIndex - 1, 0);
                listEl.querySelectorAll('.select-search-item').forEach((node, i) => {
                    node.classList.toggle('active', i === activeIndex);
                    if (i === activeIndex) node.scrollIntoView({ block: 'nearest' });
                });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (matched.length > 0) {
                    chooseOption(matched[Math.max(activeIndex, 0)].value);
                }
            } else if (e.key === 'Escape') {
                close();
            }
        });

        // 关闭时机：点击面板与下拉外部、面板外部滚动（避免面板与 select 脱节）；
        // 面板内部列表滚动（拖滚动条/滚轮）不关闭，否则滚动条一拖面板就被误关
        const onDocMousedown = (e) => {
            if (el.contains(e.target) || select.contains(e.target)) return;
            close();
        };
        const onScroll = (e) => {
            if (el.contains(e.target)) return; // 仅面板外部滚动才关闭
            close();
        };
        document.addEventListener('mousedown', onDocMousedown);
        window.addEventListener('scroll', onScroll, true);
        cleanup = () => {
            document.removeEventListener('mousedown', onDocMousedown);
            window.removeEventListener('scroll', onScroll, true);
        };

        setTimeout(() => input.focus(), 0);
    }

    // 绑定到某个原生 select
    function attach(select) {
        if (!select) return;
        select.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 阻止原生下拉展开
            // 再次点击已打开的下拉则收起
            if (anchor === select && panel) {
                close();
            } else {
                open(select);
            }
        });
    }

    return { attach, open, close };
})();

// 主机筛选选项构建：与主机管理页 updateFilters 同口径
// 双向级联：每个筛选项的可选值由「除自身外的所有筛选条件」计算，并附带主机数量统计
window.HostFilterOptions = (function() {
    const KEYS = ['systemName', 'appName', 'datacenter', 'environment', 'owner', 'osType'];

    // 兼容驼峰（hostService 转换后）与下划线（数据库原始行）两种字段命名
    const getValue = (host, key) => {
        if (key === 'systemName') return host.systemName || host.system_name || '';
        if (key === 'appName') return host.appName || host.app_name || '';
        if (key === 'osType') return host.osType || host.os_type || '';
        return host[key] || '';
    };

    const escapeHtml = (str) => String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // hosts 为主机数组，filters 为当前筛选值（缺省键视为不过滤）
    // 返回 { key: [{ value, label, count }] }，负责人按名称排序，其余按出现顺序
    function build(hosts, filters) {
        const result = {};
        KEYS.forEach(excludeKey => {
            const subset = hosts.filter(host => KEYS.every(key => {
                if (key === excludeKey || !filters[key]) return true;
                return getValue(host, key) === filters[key];
            }));
            const counts = {};
            subset.forEach(host => {
                const val = getValue(host, excludeKey);
                if (val) counts[val] = (counts[val] || 0) + 1;
            });
            let values = Object.keys(counts);
            if (excludeKey === 'owner') values = values.sort();
            result[excludeKey] = values.map(v => ({ value: v, label: v, count: counts[v] }));
        });
        return result;
    }

    // 将选项渲染进原生 select（含「全部XX」默认项与数量统计）
    // 若当前选中值不在可用选项中则回退为空，返回 true 表示发生了回退
    function render(selectEl, options, selectedValue, allLabel) {
        if (!selectEl) return false;
        const optionsHTML = [
            `<option value="">${escapeHtml(allLabel)}</option>`,
            ...options.map(opt =>
                `<option value="${escapeHtml(opt.value)}"${opt.value === selectedValue ? ' selected' : ''}>${escapeHtml(opt.label)}${opt.count != null ? ` (${opt.count})` : ''}</option>`)
        ].join('');
        selectEl.innerHTML = optionsHTML;
        if (selectedValue && !options.some(opt => opt.value === selectedValue)) {
            selectEl.value = '';
            return true;
        }
        return false;
    }

    return { build, render, getValue };
})();