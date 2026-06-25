# V43: 部署准备 — pm2/nginx 配置 + 备份脚本 + .gitignore 清理

## 背景

项目将部署到腾讯云 Lighthouse 单机服务器。需要准备部署配置文件、备份脚本，并清理 .gitignore 确保仓库干净。

部署拓扑：
- Ubuntu 22.04+ 
- Node.js 20+ (via nvm)
- pm2 单实例运行 `next start`
- nginx 反代 + HTTPS + Basic Auth
- SQLite 在本地磁盘
- 数据目录：`/opt/quotation-mvp/data/`（图片、DB、导出文件）

## 实现

### 1. pm2 配置文件 `ecosystem.config.cjs`

```javascript
module.exports = {
  apps: [
    {
      name: "quotation-mvp",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/opt/quotation-mvp",
      instances: 1,        // SQLite 只能单实例写入
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/opt/quotation-mvp/logs/error.log",
      out_file: "/opt/quotation-mvp/logs/out.log",
      merge_logs: true,
    },
  ],
};
```

### 2. nginx 配置模板 `deploy/nginx.conf`

新建 `deploy/` 目录。

```nginx
server {
    listen 80;
    server_name _;

    # Redirect to HTTPS (uncomment when SSL is configured)
    # return 301 https://$host$request_uri;

    location / {
        auth_basic "Quotation System";
        auth_basic_user_file /etc/nginx/.htpasswd;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Next.js SSR responses can be large
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;

        # Long timeout for DeepSeek API calls proxied through Next.js
        proxy_read_timeout 120s;
    }

    # Static assets bypass auth
    location /_next/static {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 30d;
        add_header Cache-Control "public, immutable";
    }

    client_max_body_size 50M;
}
```

### 3. SQLite 备份脚本 `deploy/backup.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

DB_PATH="/opt/quotation-mvp/prisma/dev.db"
BACKUP_DIR="/opt/quotation-mvp/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/dev-${TIMESTAMP}.db"
KEEP_DAYS=30

mkdir -p "${BACKUP_DIR}"

# Use SQLite .backup command for safe live backup (no write lock needed)
sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'"

# Compress
gzip "${BACKUP_FILE}"

# Prune old backups
find "${BACKUP_DIR}" -name "dev-*.db.gz" -mtime +${KEEP_DAYS} -delete

echo "[$(date)] Backup complete: ${BACKUP_FILE}.gz"
```

### 4. 部署脚本 `deploy/deploy.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/quotation-mvp"
cd "${APP_DIR}"

echo "[$(date)] Starting deployment..."

# Pull latest code
git pull origin main

# Install dependencies
npm ci --production=false

# Build
npm run build

# Run backup before restart
bash deploy/backup.sh

# Restart
pm2 reload ecosystem.config.cjs

echo "[$(date)] Deployment complete."
```

### 5. 首次部署指南 `deploy/SETUP.md`

写一个简明的首次部署步骤文档：

```markdown
# 首次部署指南

## 服务器准备

1. 腾讯云 Lighthouse，Ubuntu 22.04，2C4G，50GB SSD
2. 安装 Node.js 20+、nginx、sqlite3、pm2：
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
   sudo apt install -y nodejs nginx sqlite3
   sudo npm install -g pm2
   ```

## 应用部署

3. 克隆仓库：
   ```bash
   sudo mkdir -p /opt/quotation-mvp
   sudo chown $USER:$USER /opt/quotation-mvp
   git clone <repo-url> /opt/quotation-mvp
   cd /opt/quotation-mvp
   ```

4. 同步数据（从开发机）：
   ```bash
   # 在开发机执行：
   rsync -avz --progress prisma/dev.db user@server:/opt/quotation-mvp/prisma/
   rsync -avz --progress data/images/ user@server:/opt/quotation-mvp/data/images/
   ```

5. 配置环境变量：
   ```bash
   cp .env.example .env.local
   # 编辑 .env.local，填入 DEEPSEEK_API_KEY
   ```

6. 构建和启动：
   ```bash
   npm ci
   npm run build
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup  # 设置开机自启
   ```

7. 配置 nginx：
   ```bash
   # 创建 Basic Auth 密码
   sudo apt install -y apache2-utils
   sudo htpasswd -c /etc/nginx/.htpasswd quotation

   # 部署 nginx 配置
   sudo cp deploy/nginx.conf /etc/nginx/sites-available/quotation
   sudo ln -sf /etc/nginx/sites-available/quotation /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl reload nginx
   ```

8. 配置定时备份：
   ```bash
   chmod +x deploy/backup.sh
   # 每天凌晨 3 点备份
   (crontab -l 2>/dev/null; echo "0 3 * * * /opt/quotation-mvp/deploy/backup.sh >> /opt/quotation-mvp/logs/backup.log 2>&1") | crontab -
   ```

## 日常更新

```bash
ssh user@server
cd /opt/quotation-mvp
bash deploy/deploy.sh
```

## 数据目录结构

```
/opt/quotation-mvp/
├── prisma/dev.db          # SQLite 数据库 (~49MB)
├── data/images/source/    # 产品图片 (~1.6GB, 9609 files)
├── outputs/               # 导出的报价单 Excel
├── backups/               # 自动备份
└── logs/                  # pm2 日志
```
```

### 6. .env.example 文件

创建 `.env.example`（如果不存在）：

```
# DeepSeek API Key (required for Chat)
DEEPSEEK_API_KEY=

# Optional: Custom port (default 3000)
# PORT=3000
```

### 7. .gitignore 补充

在现有 `.gitignore` 末尾追加：

```
# Deployment
logs/
*.log
deploy/.htpasswd
```

### 8. deploy/ 目录 .gitkeep

确保 `logs/` 目录有 `.gitkeep`：在 `.gitignore` 中排除了 `logs/`，但仓库需要记住这个目录结构的意图。不需要 .gitkeep —— `logs/` 会由 pm2 和备份脚本在运行时自动创建。

## 验证

```bash
npx tsc --noEmit
npm run test:quick
```

确认新增文件不破坏构建。

## 不做
- 不做 Docker 化（单机直接跑更简单）
- 不做 CI/CD pipeline（git pull + deploy.sh 够用）
- 不做 HTTPS 证书申请（手动 certbot，不在代码仓库范围）
- 不改应用代码
- 不做数据库 schema 变更
- 不删除任何数据
