# 2026-10-14 服务器部署步骤

本机 GitHub 可用，但 SSH 连接 `111.229.174.165:22` 被关闭，尚未执行生产部署。以下命令仅供在既有 Ubuntu 云服务器终端执行，不在本机 PowerShell 执行。

## 1. 检查服务器工作区

```bash
cd ~/receivables-radar
git status -sb
git diff --stat
```

若有未保存改动，先核对并备份；不要执行 reset、clean 或 stash pop。已知历史上服务器移除了 Dockerfile 首行 syntax 注释，此改动可以保留；其他未知改动需先确认。

## 2. 备份并校验备份目录

```bash
cd ~/receivables-radar
set -e
umask 077
mkdir -p ~/receivables-backups
RADAR_BACKUP="$HOME/receivables-backups/pre-1.0.1-$(date +%Y%m%d-%H%M%S).dump"
sudo docker compose exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$RADAR_BACKUP"
test -s "$RADAR_BACKUP"
sudo docker compose exec -T db pg_restore --list < "$RADAR_BACKUP" > /dev/null
ls -lh "$RADAR_BACKUP"
```

目录校验只能确认格式可读，不等同完整恢复演练。正式升级前，建议依运行手册在独立临时库恢复校验；禁止覆盖生产数据库。

## 3. 拉取、构建、顺序更新

每组命令成功后再执行下一组；失败时停止并保留输出。

```bash
cd ~/receivables-radar
git pull --ff-only origin main
git rev-parse --short HEAD
sudo docker compose config --quiet
sudo docker compose build api web
```

```bash
sudo docker compose up -d --no-deps --wait --wait-timeout 120 api
sudo docker compose ps api
```

API 在监听端口前事务执行迁移004和005；旧数据库列保留。只更新 API 与 web，不重建数据库服务或数据卷。确认 API 健康后：

```bash
sudo docker compose up -d --no-deps --force-recreate --wait --wait-timeout 90 web
sudo docker compose ps api web
curl -fsS --max-time 20 https://huikuanleida.cn/api/health
curl -fsS --max-time 20 https://huikuanleida.cn/src/file-export.js | grep -F 'saveTextFile'
```

## 4. 使用核验

- 电脑刷新网站，确认科技风界面、“我的”、VIP规划说明和 APP 备案号。
- 升级同签名 APK 后验证登录保留、系统保存窗口、取消反馈、云端记录显示。
- 老 APK 在网页更新后会明确提示更新 APP 或使用浏览器导出，不再谎报备份成功。
- 不用真实客户数据做删除、到账纠错或导入测试。
- 日历文件已通过真机保存验证，系统日历实际通知仍需用户另行验证。

## 5. 回滚边界

发布前记录旧 commit 与 API/web 镜像 ID。本轮新增迁移是前向扩展，但应用回滚仍需核对兼容性；不删除新增表/列、不恢复旧备份覆盖当前生产数据。失败时先保留日志和备份，不自动重置 Git 或数据库。
