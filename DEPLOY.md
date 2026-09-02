# 部署到 dare.example.com

> 目标服务器：Ubuntu，国内，域名已备案（所以 80/443 可用）。
> 待确认：具体 Ubuntu 版本、哪些端口被占、有没有 nginx/caddy/docker。

## 架构

```
dare.example.com:443
   └─ 现有反代（nginx 或 caddy）
        └─ proxy_pass 127.0.0.1:3100      Dare 应用
                          └─ 127.0.0.1:5432   Postgres（只绑本地，不对外）
                          └─ /var/lib/dare/storage   证据文件
```

**Postgres 只绑 `127.0.0.1`。** 应用和数据库同机走 localhost，延迟接近零，
也不用为数据库配任何防火墙规则。服务器上跑着别的项目也互不干扰。

## 一、Postgres

服务器上如果已经有 Postgres，建一个独立的库和用户就行，不用再装一个：

```bash
sudo -u postgres psql <<'SQL'
CREATE USER dare WITH PASSWORD '换成一个强密码';
CREATE DATABASE dare OWNER dare;
SQL
```

没有的话装一个：

```bash
sudo apt update && sudo apt install -y postgresql
```

确认它只监听本地（默认就是）：

```bash
sudo ss -tlnp | grep 5432   # 应当是 127.0.0.1:5432，不是 0.0.0.0:5432
```

建表：项目用 Drizzle，schema 是 Postgres 方言，第一次启动时
`src/lib/db.ts` 会检查 `activities` 表是否存在并自动建表。

## 二、应用

```bash
git clone <仓库> /opt/dare && cd /opt/dare
pnpm install --frozen-lockfile
cp .env.example .env.local
```

`.env.local` 里必须填的：

```bash
DATABASE_URL=postgres://dare:密码@127.0.0.1:5432/dare
DASHSCOPE_API_KEY=你的百炼 key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_PROFILE=live

# 证据 URL 要交给阿里百炼去拉，必须是公网能访问的绝对地址
PUBLIC_BASE_URL=https://dare.example.com

# 签名密钥。不设的话进程重启会让所有未过期的签名 URL 失效
STORAGE_SIGNING_SECRET=用 openssl rand -hex 32 生成

# 活动结束多少天后自动清掉数据（含磁盘上的证据文件）
RETENTION_DAYS=7
```

构建并起两个进程：

```bash
pnpm build
PORT=3100 pnpm start        # web
pnpm scheduler              # 状态推进 + 数据清理
```

两个都要 systemd 托管，见下方。

## 三、反代

### 如果服务器上已经有 nginx

**不要再起一个反代**，加一个 vhost 就行：

```nginx
# /etc/nginx/sites-available/dare
server {
    listen 443 ssl http2;
    server_name dare.example.com;

    ssl_certificate     /etc/letsencrypt/live/dare.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dare.example.com/privkey.pem;

    # 证据文件最大 200MB（视频），默认 1MB 会直接 413
    client_max_body_size 210m;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name dare.example.com;
    return 301 https://$host$request_uri;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/dare /etc/nginx/sites-enabled/
sudo certbot --nginx -d dare.example.com
sudo nginx -t && sudo systemctl reload nginx
```

**`client_max_body_size` 那行别漏。** nginx 默认 1MB，视频证据直接 413，
而且报错发生在 nginx 层，应用日志里什么都看不到。

### 如果服务器上是 caddy

```caddyfile
dare.example.com {
    reverse_proxy 127.0.0.1:3100
    request_body {
        max_size 210MB
    }
}
```

Caddy 自动申请证书，不需要 certbot。

### 如果 80/443 都被占且不方便共用

那就得换非标端口，但用户要手输 `:8443`，体验很差。优先考虑共用现有反代。

## 四、systemd

```ini
# /etc/systemd/system/dare-web.service
[Unit]
Description=Dare web
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/dare
Environment=PORT=3100
ExecStart=/usr/bin/pnpm start
Restart=always
User=dare

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/dare-scheduler.service
[Unit]
Description=Dare scheduler
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/dare
ExecStart=/usr/bin/pnpm scheduler
Restart=always
User=dare

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now dare-web dare-scheduler
```

**scheduler 必须单独跑。** 它负责到点自动分配任务、开投票、结算、
以及清理过期数据。不跑的话活动会永远停在 recruiting。

## 五、上线前自查

```bash
# 数据库不对外
sudo ss -tlnp | grep 5432          # 只能是 127.0.0.1

# 两个服务都活着
systemctl status dare-web dare-scheduler

# 证据目录权限
ls -ld /opt/dare/.storage           # 应当只有 dare 用户可读写

# 手机上开 https://dare.example.com
# 重点验：任务卡长按、上传页能唤起相机（这个必须 HTTPS 才行）
```

## 待办

- [ ] 确认 Ubuntu 版本和已占端口
- [ ] 确认现有反代是 nginx 还是 caddy
- [ ] 生成 STORAGE_SIGNING_SECRET
- [ ] 部署后手机验一遍全流程
