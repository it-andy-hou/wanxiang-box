# SSH兼容性说明文档

## 📋 概述

本系统已针对老旧Linux系统进行了SSH兼容性适配，支持连接到不同版本的OpenSSH服务器。

## ✅ 已实现的兼容性功能

### 1. **算法兼容性配置**

系统已配置以下SSH算法，优先使用安全算法，当目标系统不支持时自动降级到兼容算法：

#### 密钥交换算法 (KEX)
- **现代安全算法**：
  - curve25519-sha256
  - ecdh-sha2-nistp256/384/521
  - diffie-hellman-group14-sha256/group16-sha512
  
- **老系统兼容算法**：
  - diffie-hellman-group14-sha1 ⚠️
  - diffie-hellman-group1-sha1 ⚠️（极老系统）

#### 加密算法 (Cipher)
- **现代安全加密**：
  - aes128-gcm, aes256-gcm
  - aes128-ctr, aes192-ctr, aes256-ctr
  
- **老系统兼容加密**：
  - aes128-cbc, aes192-cbc, aes256-cbc ⚠️
  - 3des-cbc ⚠️（极老系统）

#### 服务器主机密钥
- **现代安全密钥**：
  - ssh-ed25519
  - ecdsa-sha2-nistp256/384/521
  - rsa-sha2-512, rsa-sha2-256
  
- **老系统兼容密钥**：
  - ssh-rsa ⚠️
  - ssh-dss ⚠️（极老系统）

#### HMAC算法
- **现代算法**：hmac-sha2-256, hmac-sha2-512
- **老系统兼容**：hmac-sha1 ⚠️, hmac-md5 ⚠️（极老系统）

### 2. **错误提示增强**

系统会针对不同的连接错误提供详细的中文提示：

| 错误类型 | 提示信息 | 建议操作 |
|---------|---------|---------|
| 连接超时 | "连接超时：无法在指定时间内连接到主机" | 检查网络连接和防火墙 |
| 连接被拒绝 | "连接被拒绝：目标端口可能未开放或服务未运行" | 检查SSH服务状态和端口 |
| 主机不可达 | "主机不可达：请检查网络连接和IP地址" | 验证IP地址和网络路由 |
| 认证失败 | "认证失败：用户名、密码或私钥不正确" | 核对认证凭据 |
| 权限被拒绝 | "权限被拒绝：请检查用户权限和认证信息" | 检查用户权限配置 |
| **算法不匹配** | "SSH算法不匹配：目标系统SSH版本过旧，已启用兼容模式，请重试" | 重试连接，或升级目标SSH |
| **协议握手失败** | "SSH协议握手失败：可能是SSH版本不兼容，已启用兼容算法，请重试" | 重试连接 |

### 3. **自动兼容模式**

系统会自动按以下优先级协商算法：
1. 优先尝试现代安全算法
2. 如果失败，自动降级到兼容算法
3. 提供明确的错误提示指导用户

## 🔍 支持的系统版本

### ✅ 完全支持
- CentOS/RHEL 7.x, 8.x, 9.x
- Ubuntu 16.04+, 18.04+, 20.04+, 22.04+
- Debian 9+, 10+, 11+
- OpenSSH 7.0+ 及以上

### ⚠️ 兼容支持（可能需要降级算法）
- CentOS/RHEL 6.x
- Ubuntu 14.04
- Debian 8
- OpenSSH 5.3 - 6.9

### ⚡ 有限支持（极老系统）
- CentOS/RHEL 5.x
- OpenSSH 5.0 - 5.2
- 需要启用弱加密算法（3des-cbc, hmac-md5）

## 🛡️ 安全建议

### ⚠️ 警告
标记为 ⚠️ 的算法为**已弃用的弱算法**，仅用于兼容老系统：
- diffie-hellman-group1-sha1：易受攻击
- 3des-cbc：加密强度低
- ssh-dss：密钥强度不足
- hmac-md5：哈希碰撞风险

### 🔒 最佳实践
1. **优先升级目标系统**：建议将老旧系统的OpenSSH升级到7.0+
2. **限制使用场景**：仅在内网或受信任网络中使用兼容模式
3. **监控连接日志**：定期检查是否使用了弱算法
4. **制定升级计划**：逐步淘汰使用弱算法的老系统

## 🔧 常见问题排查

### Q1: 连接老系统提示"算法不匹配"
**现象**：连接CentOS 6.x等老系统失败  
**解决**：
1. 系统已自动启用兼容算法，请重试
2. 如仍失败，检查目标系统SSH配置：
   ```bash
   # 查看SSH版本
   ssh -V
   
   # 查看支持的算法
   ssh -Q kex
   ssh -Q cipher
   ```

### Q2: 连接极老系统（CentOS 5.x）失败
**现象**：OpenSSH 5.0-5.2版本连接失败  
**解决**：
1. 目标系统可能需要启用更弱的算法
2. 建议在目标系统sshd_config中添加：
   ```
   Ciphers aes128-cbc,3des-cbc
   MACs hmac-sha1,hmac-md5
   KexAlgorithms diffie-hellman-group1-sha1
   ```
3. **强烈建议升级系统**而非降低安全性

### Q3: 如何检查使用了哪些算法？
**方法**：在目标Linux系统上执行：
```bash
# 查看SSH连接日志
tail -f /var/log/secure  # CentOS/RHEL
tail -f /var/log/auth.log # Ubuntu/Debian

# 日志会显示协商的算法，如：
# kex: server->client cipher: aes128-ctr
```

## 📊 技术实现

### 代码位置
- 主要实现：`src/main/sshService.js`
- 兼容性配置方法：`getCompatibilityAlgorithms()`
- 应用位置：
  - `testConnection()` - 连接测试
  - `collectHostInfo()` - 主机信息收集
  - `executeCommand()` - 命令执行
  - `executeScript()` - 脚本执行
  - `configurePublicKey()` - 公钥配置
  - `uploadFile()` - 文件上传

### 配置示例
```javascript
algorithms: {
    kex: ['curve25519-sha256', ..., 'diffie-hellman-group1-sha1'],
    cipher: ['aes128-gcm', ..., 'aes128-cbc', '3des-cbc'],
    serverHostKey: ['ssh-ed25519', ..., 'ssh-rsa', 'ssh-dss'],
    hmac: ['hmac-sha2-256', ..., 'hmac-sha1', 'hmac-md5']
}
```

## 📝 更新日志

**v1.0.1** (2025-12-04)
- ✅ 添加SSH兼容性算法配置
- ✅ 支持老旧Linux系统连接
- ✅ 增强错误提示信息
- ✅ 添加算法协商失败的专门提示

## 📞 技术支持

如遇到SSH连接问题：
1. 查看本文档的常见问题排查部分
2. 检查系统控制台日志（开发者工具 - Console）
3. 记录错误信息和目标系统版本
4. 联系技术团队获取支持

---

**注意**：本兼容性配置平衡了安全性和兼容性，但仍建议优先升级老旧系统以提高整体安全水平。
