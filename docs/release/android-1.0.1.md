# Android 1.0.1 发布记录

- 名称：回款雷达；包名：`cn.huikuanleida.app`；versionCode：2。
- 保留原橙色雷达图标、既有正式签名和隐私同意状态。
- 新增 RadarFiles 原生插件：ACTION_CREATE_DOCUMENT 保存 JSON/ICS；实际写入成功后才反馈成功；取消返回 SAVE_CANCELLED。
- 插件限制可信域名、文件名、类型和大小，无新增存储权限。
- 独立 `.uitest` 包已在 HONOR300Pro / Android16 验证：系统窗口、取消、JSON写入读回、ICS保存读回。
- 正式包通过 apksigner 验证，签名与归档旧版一致；application-label 与 launcher-label 均为“回款雷达”。
- 已运行 Java 单元测试、lintRelease 与 release构建；签名密钥和安装包不进入 Git。
- 网站需要同时更新，老 APK 不具备新原生接口；新版网页会给老 APK 明确的更新提示。
- 系统日历导入后的通知、不同机型、正式账号全链路仍需进一步验收，不据此声明已上架。

覆盖升级示例：`adb install -r --user 0 <正式APK路径>`；不得卸载或执行 pm clear。
