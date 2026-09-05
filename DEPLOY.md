# 部署

单机部署：一台 Linux、一个 Postgres、一个反代。下面用 `dare.example.com` 代指你的域名，
`/opt/dare` 代指代码目录，自己替换。

**这份文档里带「坑」标记的几条都是真踩过的**，跳过任何一条都会得到一个
「看起来起来了但用不了」的部署。

## 架构

```
dare.example.com:443
   └─ nginx / caddy 反代
        └─ 127.0.0.1:3100        dare-web        Next 应用
           127.0.0.1:5432        Postgres        只绑本地，不对外
           /opt/dare/.storage    证据文件         由 dare-scheduler 到期清理
```

两个进程缺一不可：`dare-web` 处理请求，`dare-scheduler` 推进状态。

**坑：scheduler 不跑的话活动永远停在 `recruiting`。** 分配任务、开投票、结算、
清理过期数据全靠它，前端不会有任何报错，只是什么都不发生。

存储目录是**相对工作目录**的 `.storage`，写死在 `src/storage/local.ts` 里，
所以 systemd 的 `WorkingDirectory` 必须指对。

## 一、Postgres

```bash
sudo -u postgres psql <<'SQL'
CREATE USER dare WITH PASSWORD '换成一个强密码';
CREATE DATABASE dare OWNER dare;
SQL
```

确认只监听本地，`listen_addresses` 保持默认的 `localhost` 就行：

```bash
sudo ss -tlnp | grep 5432    # 只能出现 127.0.0.1
```

**坑：表不会自动建。**

`src/lib/db.ts` 里的 `ensureSchema()` **只在 PGlite 分支被调用**，配了
`DATABASE_URL` 走真 Postgres 时直接 return。仓库里也没有 drizzle 迁移文件，
`src/db/client.ts` 导出的 `DDL` 常量是 schema 的唯一真相。第一次部署要手工建表：

```bash
cd /opt/dare
cat > /tmp/init-db.mts <<'TS'
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { DDL } from "/opt/dare/src/db/client";

for (const line of readFileSync("/opt/dare/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
await sql.unsafe(DDL);
await sql.end();
console.log("建表完成");
TS
node node_modules/tsx/dist/cli.mjs /tmp/init-db.mts && rm /tmp/init-db.mts
```

## 二、应用

```bash
git clone <仓库> /opt/dare && cd /opt/dare
pnpm install --frozen-lockfile
cp .env.example .env.local
```

**坑：不能用 `pnpm install --prod`。** scheduler 走 `tsx` 跑 TypeScript 源码，
而 `tsx` 是 devDependency。只装生产依赖的话 scheduler 起不来。

`.env.local` 里必须填的：

```bash
DATABASE_URL=postgres://dare:密码@127.0.0.1:5432/dare

# live 走真厂商，mock 走内置的假 provider（不联网、不要 key）
AI_PROFILE=live

# key 的变量名不是固定的，由 providers.yaml 里那个 provider 的 apiKeyEnv 决定。
# 比如声明了 apiKeyEnv: MY_API_KEY，这里就写：
MY_API_KEY=你的 key
# 端点同理：providers.yaml 里写 baseUrl 是写死，写 baseUrlEnv 则从环境变量读

# 证据 URL 是交给 AI 厂商去拉的，必须是公网能访问的绝对地址。
# 不设这个变量，证据评审会全部静默失败，日志里只有一句
# 「The provided URL does not appear to be valid」
PUBLIC_BASE_URL=https://dare.example.com

# openssl rand -hex 32
# 不设的话进程一重启，所有还没过期的签名 URL 全部失效
STORAGE_SIGNING_SECRET=

# 活动结束多少天后自动清掉数据，含磁盘上的证据文件
RETENTION_DAYS=7
```

**`ENABLE_DEV_TOOLS` 绝对不要在生产设置。** `/api/dev/*` 那三个接口能凭空造参与者、
能直接判定猜中作废别人的奖励、能任意推进状态提前触发结算。默认关闭，保持关闭。

构建：

```bash
pnpm build
```

### 内存不够怎么办

`next build` 峰值接近 1G。可用内存低于这个数就会 OOM，而且**在小内存机器上它会把
整机拖垮**，同机的其它服务一起卡死。两个办法：

**A. 加 swap 并给构建套内存上限**

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 超了只杀构建自己，不拖垮整机
systemd-run --scope -p MemoryMax=1000M -p MemorySwapMax=2000M pnpm build
```

**B. 本地构建，只传产物**

```bash
tar czf - --exclude='.next/cache' .next public | ssh 服务器 'cd /opt/dare && tar xzf -'
```

**坑：传完必须修软链，否则所有读库的接口都 500。**

Turbopack 给 `serverExternalPackages` 里的包（`@electric-sql/pglite`、`postgres`）
在 `.next/node_modules/` 下建了**带哈希后缀的绝对路径软链**，指向构建机的 pnpm 存储：

```
.next/node_modules/postgres-<hash> -> /构建机路径/node_modules/.pnpm/postgres@x.y.z/node_modules/postgres
```

传到另一台机器上这些软链全部悬空。而 `src/lib/db.ts` 顶层 import 了 PGlite，
**不管走不走 PGlite 分支都要先加载它**，加载失败整个模块 reject，于是每个读库的
接口都报 `Failed to load external module ...: ERR_MODULE_NOT_FOUND`。
本地测不出来，本地软链是好的。

修法（哈希每次构建都变，所以每次传完都要跑）：

```bash
python3 - <<'PY'
import os, re
base, real = "/opt/dare/.next/node_modules", "/opt/dare/node_modules"
for dirpath, dirnames, filenames in os.walk(base):
    for name in list(dirnames) + list(filenames):
        p = os.path.join(dirpath, name)
        if not os.path.islink(p): continue
        pkg = re.sub(r"-[0-9a-f]{8,}$", "", os.path.relpath(p, base)).replace(os.sep, "/")
        target = os.path.join(real, *pkg.split("/"))
        if os.path.exists(target):
            os.remove(p); os.symlink(target, p); print("重指:", pkg)
PY
```

## 三、反代

```nginx
server {
    listen 80;
    server_name dare.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name dare.example.com;

    ssl_certificate     /etc/letsencrypt/live/dare.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dare.example.com/privkey.pem;

    # 证据文件最大 200MB（视频）
    client_max_body_size 210m;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**坑：`client_max_body_size` 那行别漏。** nginx 默认 1MB，视频证据直接 413，
而且报错发生在 nginx 层，应用日志里什么都看不到。

**坑：先确认 nginx 真的读 `sites-enabled`。**

不少机器上 `nginx.conf` 里没有 `include /etc/nginx/sites-enabled/*`，server 块
直接写在 `nginx.conf` 里。这种情况下往 `sites-available` 放文件再做软链是完全
无效的，请求会落到 80 端口上的第一个 server 块，表现为莫名其妙的 301 或者
打到了别的站上。先查：

```bash
nginx -T | grep -n 'include.*sites-enabled'
```

没有这行就把 vhost 直接写进 `nginx.conf` 的 `http {}` 块里，改前 `cp` 一份备份。

证书：

```bash
sudo certbot --nginx -d dare.example.com
sudo nginx -t && sudo systemctl reload nginx
```

**certbot 之前 DNS 必须已经生效。** Let's Encrypt 要通过这个域名访问到你的机器
才肯签发。用 `dig +trace dare.example.com` 确认，别只看域名商控制台的显示。

## 四、systemd

先建一个不能登录的服务用户：

```bash
sudo useradd --system --home-dir /opt/dare --shell /usr/sbin/nologin dare
sudo mkdir -p /opt/dare/.storage
sudo chown -R dare:dare /opt/dare
sudo chmod 600 /opt/dare/.env.local
```

```ini
# /etc/systemd/system/dare-web.service
[Unit]
Description=Dare web
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=dare
WorkingDirectory=/opt/dare
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/dare/node_modules/next/dist/bin/next start -p 3100
Restart=always
RestartSec=5
MemoryMax=500M

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/dare-scheduler.service
[Unit]
Description=Dare scheduler
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=dare
WorkingDirectory=/opt/dare
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/dare/node_modules/tsx/dist/cli.mjs /opt/dare/scripts/scheduler.ts
Restart=always
RestartSec=10
MemoryMax=300M

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dare-web dare-scheduler
```

`ExecStart` 直接指 node 和入口文件，不走 `pnpm start`：corepack 的 pnpm shim
会去找每个用户自己的缓存目录，在 `nologin` 的服务用户下容易出问题。

`MemoryMax` 是给小内存机器的护栏。超了只杀这个服务，不会把同机的其它站拖垮。

`next start` 会自己读 `WorkingDirectory` 下的 `.env.local`，不需要额外配置。
想让环境变量来源更显式也可以加 `EnvironmentFile=/opt/dare/.env.local`，
但那是 systemd 的解析器，值里不能有空格或者行内 `#`。

## 五、上线前自查

```bash
# 数据库不对外
sudo ss -tlnp | grep 5432                    # 只能是 127.0.0.1

# 两个服务都活着
systemctl status dare-web dare-scheduler

# scheduler 真的在转（每 30 秒一行）
journalctl -u dare-scheduler -n 5

# web 没在刷错误
journalctl -u dare-web --since '-5 min' | grep -c '⨯'

# 证据目录权限
ls -ld /opt/dare/.storage                    # 只有 dare 用户可读写

# 读库的接口通了（不是只有首页 200）
curl -s -o /dev/null -w '%{http_code}\n' https://dare.example.com/api/me/activities

# AI 厂商真的连得上
cd /opt/dare && node node_modules/tsx/dist/cli.mjs scripts/providers-check.ts
```

**首页 200 不代表部署成功。** 静态页面不碰数据库也不碰 AI，上面那两条才算数。

最后在手机上走一遍完整流程，重点验任务卡长按揭示、以及上传页能不能唤起相机
（相机必须 HTTPS 才能唤起）。

## 更新

```bash
cd /opt/dare
git pull
pnpm install --frozen-lockfile
pnpm build                                    # 或者本地构建后传产物 + 修软链
sudo chown -R dare:dare /opt/dare
sudo systemctl restart dare-web dare-scheduler
```

schema 有变更时记得手工跑一遍对应的 `ALTER`，前面说过表不会自动建也不会自动迁移。
