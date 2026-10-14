# Android 文件导出修复与验证

## 原问题

正式 APP 中点击导出仅有成功提示，没有系统保存窗口；检查 Downloads 未找到对应备份。原实现是网页 Blob 链接下载，原生容器没有文件保存处理，因此不能以 link.click() 代表文件已保存。

## 本次改动

- 网页 `src/file-export.js` 统一 JSON 和 ICS 导出；浏览器只提示“已发起下载”，Android 等待原生写入结果。
- 老 APK 缺少原生插件时明确要求更新，不再静默下载并显示成功。
- 原生代码位于 `.worktrees/android-mvp/android/app/src/main/java/cn/huikuanleida/app/`：RadarFilesPlugin 使用 ACTION_CREATE_DOCUMENT，由用户选择保存位置，写入并关闭输出流后才返回成功；取消和失败分开处理。
- 仅允许正式 HTTPS 域名，限定 JSON/ICS、文件名和 10 MiB 大小；不新增存储权限。
- 导入前备份在 Android 取消时中断导入；浏览器需用户确认备份已经保存。

## 隔离测试

- `gradlew testDebugUnitTest lintDebug assembleDebug -PradarUiTest=true` 已通过。
- 测试包 `cn.huikuanleida.app.uitest` 与正式包并存，不覆盖正式账号或数据。
- debug 专用 HTTP 访问用于 `adb reverse tcp:18765 tcp:18765` 的本机示例 API；release 不启用该入口，正式包名、图标、签名配置未变。
- `node scripts/ui-smoke.mjs --serve` 提供示例数据；无正式后端连接。
- 网页测试、构建和浏览器 UI smoke 已通过。当前 npm test 未配置测试数据库，数据库集成组跳过；此前带隔离 PostgreSQL 的完整验证结果见实现进度记录，不等同本次重新运行。

## 真机结果

1. 用户自行选择隐私同意后，已进入独立测试版示例工作台。
2. “我的”导出备份实际打开 Android DocumentsUI 保存窗口。
3. 原生保存取消返回 `SAVE_CANCELLED`；成功返回 `{saved:true}`。
4. 手机 `/sdcard/Download/radar-export-test-20261014.json` 实际存在，读回内容为 `{"testOnly":true,"records":[]}`。
5. 通过应收详情页的到期日历按钮导出，系统窗口文件名正确；保存后页面显示“文件已保存”，读回 ICS 含 VCALENDAR、VEVENT、VALARM。
6. 日历应用实际导入和提醒触发仍未验收，不宣称已验证。

过程中 ADB 调试通道一次无响应，重连后恢复；重新进行了独立取消及保存测试，没有据此判断 APP 本身黑屏。

尚未发布网站、提交 Git 或生成替换正式版 APK。正式用户获得修复需后续同时部署网页并更新原生 APK。
