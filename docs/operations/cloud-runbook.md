# 回款雷达云端运行手册

## 1. 适用范围与责任边界

本手册用于 Ubuntu 24.04 LTS 云服务器上的单机 MVP：Caddy 对外提供 HTTPS，Fastify 提供账号 API，PostgreSQL 只在 Docker 私有网络内运行。当前应收记录仍保存在浏览器本地；云端只承载账号、会话、邮箱验证和密码重置。

购买服务器、域名实名、ICP备案、公安备案、DNS 修改、防火墙放行、生产部署和应用商店发布均属于外部操作，执行前必须由项目负责人明确确认。生产密钥不得发到聊天、提交 Git 或写进镜像。

## 2. 前置条件

- 腾讯云轻量应用服务器：上海，Ubuntu 24.04 LTS，建议 2 核 2 GB、40–50 GB SSD。
- 已完成实名与 ICP 备案的独立域名；DNS 的 A/AAAA 记录指向服务器公网地址。
- Docker Engine 与 Compose 插件；服务器安全组只放行 SSH、80、443。
- 可用 SMTP 发信账号；腾讯云 COS 私有存储桶和最小权限子账号。
- COSCLI 已通过 `coscli config add` 配置备份桶别名；密钥由服务器秘密管理，不进仓库。

## 3. 首次部署

```bash
git clone https://github.com/151381325/receivables-radar.git
cd receivables-radar
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，至少替换数据库密码、正式域名、SMTP 凭证、备份加密密钥和 COS 目标。`APP_ORIGIN` 与 `SITE_ADDRESS` 均使用同一个 `https://正式域名`。生成随机值可使用：

```bash
openssl rand -base64 36
```

检查配置并构建：

```bash
docker compose config --quiet
npm ci
npm run build
docker compose up --build -d
docker compose ps
curl --fail https://正式域名/api/health
```

API 启动时会在事务内自动执行数据库迁移。PostgreSQL 不得出现主机端口映射。

## 4. 日常检查

```bash
docker compose ps
docker compose logs --tail=200 web api db backup
curl --fail https://正式域名/api/health
docker compose exec db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

日志不得公开粘贴；先删除邮箱、Cookie、令牌、连接串及业务数据。

## 5. 备份与恢复演练

`backup` 服务每天用 `pg_dump` 生成自定义格式备份，以 AES-256-CBC/PBKDF2 加密后调用 `COS_UPLOAD_COMMAND` 上传，上传成功后删除容器内明文和密文临时文件。COS 应开启版本控制、服务端加密和生命周期策略。

恢复校验必须使用独立临时数据库，禁止指向生产库。先从 COS 下载最新的 `.dump.enc` 到只读挂载目录，然后执行：

```bash
docker compose run --rm \
  -e BACKUP_FILE=/backups/latest.dump.enc \
  -v /srv/receivables-backups:/backups:ro \
  --entrypoint /usr/local/bin/restore-check.sh backup
```

脚本会解密、创建随机命名的临时数据库、执行 `pg_restore`、检查迁移表与用户数，并在退出时删除临时数据库；它不会删除或覆盖生产数据库。建议每月至少演练一次并保留结果记录。

## 6. 升级与回滚

升级前确认备份已上传并通过恢复校验：

```bash
git fetch --tags origin
git checkout <reviewed-release-tag>
npm ci
npm test
npm run build
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail https://正式域名/api/health
```

回滚时切换到上一个已验收标签并重新构建。数据库迁移默认只向前兼容；若新版本包含不可逆迁移，必须先单独制定数据回滚方案，不能直接恢复旧备份覆盖生产数据。

## 7. 紧急处置

立即让所有账号退出登录：

```bash
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'TRUNCATE TABLE sessions;'
```

若怀疑密钥泄露：先暂停公网访问，再轮换数据库、SMTP、COS 和备份加密凭证，清空会话，检查访问日志，确认影响范围后恢复服务。不要把旧密钥提交到 Git 作为“删除”方式；Git 历史仍会保留内容。
