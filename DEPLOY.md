# 部署到 dare.example.com

> 目标服务器实测（2026-09-03）：
> Ubuntu 24.04.4 LTS，nginx 1.24 已占 80/443，Postgres 已在 127.0.0.1:5432 运行，
> **没有 docker**，3002 端口已有另一个 Next 应用，
> **内存只有 1.6G，可用约 938M**，磁盘 26G 可用。

## 先解决内存

`next build` 在不到 1G 可用内存下**很可能 OOM**，而这台机器上已经跑着
另一个 Next 应用。两个办法，选一个：

**A. 加 swap（推荐，一次性）**

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # 确认 Swap 那行有 2G
```

**B. 本地构建，只传产物**

在你的开发机上 `pnpm build`，然后把 `.next/`、`public/`、`package.json`、
`pnpm-lock.yaml` 传上去，服务器只跑 `pnpm install --prod` 和 `pnpm start`。
省内存但每次更新都要手动传。

**建议 A。** 2G swap 对 40G 盘不算负担，之后构建、跑测试都不用再操心。

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

## 一、Postgres（已装好，只需建库）

实测已在 `127.0.0.1:5432` 运行且只绑本地，直接建库建用户：

```bash
sudo -u postgres psql <<'SQL'
CREATE USER dare WITH PASSWORD '换成一个强密码';
CREATE DATABASE dare OWNER dare;
SQL
```

已确认只监听 `127.0.0.1:5432`，不用改配置。

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

### 你的情况：nginx 1.24 已在 80/443，sites-enabled 里只有 default

**不要再起反代**，加一个 vhost：

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

### caddy 分支不适用

这台机器上是 nginx，跳过。

## 四、systemd

```ini
# /etc/systemd/system/dare-web.service
[Unit]
Description=Dare web
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/dare
Environment=PORT=3100   # 3002 已被另一个 Next 应用占用
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

- [x] Ubuntu 24.04.4，nginx 1.24 占 80/443，Postgres 已就绪，无 docker
- [ ] **先加 2G swap**，否则 next build 大概率 OOM
- [ ] 生成 STORAGE_SIGNING_SECRET（`openssl rand -hex 32`）
- [ ] 在 DNS 加 `dare.example.com` 的 A 记录指向本机
- [ ] 部署后手机验一遍全流程，重点是上传页能不能唤起相机
