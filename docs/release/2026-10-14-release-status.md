# 2026-10-14 发布状态

用户已明确授权生成正式签名 APK、提交推送与网站部署。

## 已完成

- 网页代码提交 `8b6237a` 已推送 GitHub `main`。
- Android源代码提交 `33ea5ee` 已推送 `codex/android-mvp`，包含最新网页实现与原生保存插件；未将私钥、keystore.properties、local.properties、安装包或构建目录提交。
- Android1.0.1（versionCode2）正式签名APK已归档至 `C:\Users\luo_w\Documents\huikuanleida-release\1.0.1\huikuanleida-1.0.1-release.apk`。
- APK SHA256：`528EC3D671AF38558C3457C6AF6F445B8B5BAB084FEE3C95D22D31C64241D64F`。
- 签名校验通过且与旧正式版一致，桌面/应用名称均为“回款雷达”；包名与橙色图标保留；release未启用调试或测试站点。
- 网页最终完整测试146项通过；Android分支完整测试155项通过（均含隔离PostgreSQL、无跳过）。Java测试、lintRelease、正式构建及浏览器UI smoke通过。
- 独立测试包已验证系统保存窗口、取消反馈、示例JSON/ICS实际落盘与读回。

## 尚未完成及阻断

- 服务器直连SSH被关闭，经现有本机代理尝试也未取得远程执行通道。未修改服务器配置、数据库、容器或生产文件。
- 生产网站尚未部署，不将GitHub推送成功当作网站更新成功。
- 手机当前正式包仍为1.0.0，未卸载、清数据或覆盖安装；建议服务器更新后再覆盖升级1.0.1。
- 系统日历实际导入与通知、多机型、正式新版账号全链路仍需后续验收。
- 应用商店未上传、未提交审核。

## 下一步

在既有云服务器终端执行 `cd ~/receivables-radar && git status -sb`，先检查本地改动，再按 `2026-10-14-server-deployment.md` 完成备份、构建、API迁移及web更新。

GitHub TLS问题已通过单次Git命令显式使用系统既有的本机代理解决；没有修改系统代理、Git持久配置或关闭证书校验。
