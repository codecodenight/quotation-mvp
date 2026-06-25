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
   mkdir -p logs backups
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
   mkdir -p logs backups
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

```text
/opt/quotation-mvp/
├── prisma/dev.db          # SQLite 数据库 (~49MB)
├── data/images/source/    # 产品图片 (~1.6GB, 9609 files)
├── outputs/               # 导出的报价单 Excel
├── backups/               # 自动备份
└── logs/                  # pm2 日志
```
