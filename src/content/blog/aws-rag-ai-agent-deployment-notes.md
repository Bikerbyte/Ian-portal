---
title: "AWS EC2 部署 RAG AI Agent：Dify、Ollama、Web UI 與外部訪問規劃"
excerpt: "假設要把 rag-ai-agent 部署到 AWS EC2，整理 Dify/Ollama/Web UI 的服務邊界、Security Group、HTTPS reverse proxy、密碼卡控與清理檢查。"
date: 2026-05-03
category: "學習"
tags:
  - AWS
  - EC2
  - RAG
  - Dify
  - Security
featured: true
---

## Agenda

- 目標與前提
- 最新專案狀態
- 建議部署架構
- EC2 規格與成本思考
- Security Group 規劃
- Server 基本安裝
- Dify + Ollama 部署
- Web UI 部署
- 密碼卡控與安全設定
- 外部網路訪問
- Telegram Bridge
- systemd 服務化
- 驗證 Checklist
- 清理與成本控管
- 下一步

## 目標與前提

這篇是假設我要把 [rag-ai-agent](https://github.com/Bikerbyte/rag-ai-agent) 部署到 AWS EC2，並且讓自己可以從外部網路安全訪問 Web UI。

目前先以學習和 PoC 為主，不直接追求完整 production architecture。目標是先練會：

- 在 EC2 上跑 Dify。
- 在 EC2 上跑 Ollama local model runtime。
- 啟動 repo 內的 Python Web UI。
- 透過 HTTPS reverse proxy 或 ALB 對外開 Web UI。
- Dify / Ollama / database / Redis / vector store 不直接對外開。
- Web UI 必須有登入密碼卡控。
- 後續再接 Telegram bridge。

> [!WARNING]
> RAG 系統通常會存文件、API key、對話紀錄和向量資料。就算只是 PoC，也不要把 Dify、Ollama、Postgres、Redis、Docker daemon port 直接暴露到 Internet。

截圖預留：

```text
[截圖 TODO：rag-ai-agent GitHub repo 最新 README]
[截圖 TODO：EC2 instance summary]
```

## 最新專案狀態

這次參考的是 `rag-ai-agent` 最新 `main`。目前專案方向已經從舊版 AnythingLLM PoC 轉成：

- Dify：負責 RAG app、知識庫、Prompt / Workflow、檢索設定、對話紀錄與 App API。
- Ollama：在 Ubuntu server 上提供本機 LLM 與 embedding model。
- Web UI：本 repo 的 `web_ui/`，提供登入保護、Dify/Ollama health check、Dify App API chat 測試、測試案例管理和批次驗證。
- Telegram bridge：本 repo 的 `telegram_bot/`，負責 Telegram channel、allowlist、API key 保護和錯誤處理。

目前 repo 的重要檔案：

| 路徑 | 說明 |
|------|------|
| `docs/dify-ubuntu-setup.md` | Ubuntu 上部署 Dify + Ollama 的筆記 |
| `docs/aws-deployment-security.md` | AWS 部署 Web UI 的安全清單 |
| `web_ui/main.py` | FastAPI Web UI 入口 |
| `web_ui/auth.py` | 登入驗證、session cookie、password hash |
| `web_ui/security.py` | security headers、trusted host、origin check、request size limit、login rate limit |
| `scripts/hash-web-ui-password.py` | 產生 `WEB_UI_PASSWORD_HASH` |
| `.env.telegram.example` | Dify、Ollama、Web UI、Telegram 設定範例 |

## 建議部署架構

第一版可以先做單台 EC2：

```text
Internet
  -> HTTPS Reverse Proxy / ALB
  -> Web UI 127.0.0.1:8090
  -> Dify App API 127.0.0.1:8081/v1
  -> Ollama 127.0.0.1:11434
```

如果用 Telegram：

```text
Telegram
  -> Python Telegram Bridge
  -> Dify App API
  -> Dify Knowledge / Workflow
  -> Ollama
```

核心原則：

- 對外只開 HTTPS。
- Web UI 放在 HTTPS reverse proxy 或 ALB 後面。
- Dify、Ollama、Postgres、Redis、Weaviate、Docker daemon 不開 public inbound。
- Web UI 必須登入後才能使用。
- Dify App API key 留在 server 上，不放到前端或公開文件。

> [!NOTE]
> 如果 Web UI 只給自己使用，其實更建議用 VPN、Tailscale、Zero Trust tunnel、IP allowlist 或 SSM port forwarding，而不是直接公開到全網。

## EC2 規格與成本思考

Dify + Ollama 會比一般 Nginx lab 重很多，尤其本機 LLM 需要記憶體與磁碟。

初始練習可以分兩階段：

| 階段 | 目的 | 建議 |
|------|------|------|
| Phase 1 | 先跑 Dify + Web UI，不跑大模型 | 小規格 EC2，確認服務和 reverse proxy |
| Phase 2 | 加 Ollama + `qwen2.5:7b-instruct` + `bge-m3` | 需要更多 RAM / disk，必要時再升級 |

磁碟建議先抓：

```text
Root EBS: 30 GiB gp3 起跳
```

如果要拉 Ollama models、Dify images、向量資料和文件，上 50 GiB 會比較舒服。

> [!WARNING]
> Ollama model、Docker images、Dify uploaded files、database、vector store 都會吃磁碟。EC2 停止後 EBS 仍可能計費。練習完要記得清理。

截圖預留：

```text
[截圖 TODO：EC2 instance type 選擇]
[截圖 TODO：EBS root volume 設定]
```

## Security Group 規劃

練習用 Security Group 先保守：

| Port | Source | 用途 |
|------|--------|------|
| 22 | My IP `/32` | SSH |
| 80 | `0.0.0.0/0` | HTTP to HTTPS redirect 或申請憑證 |
| 443 | `0.0.0.0/0` | HTTPS Web UI |

不要對外開：

| Port | 服務 | 原因 |
|------|------|------|
| 8081 | Dify | 應由 reverse proxy 或 local 連 |
| 8090 | Web UI raw uvicorn | 應放 reverse proxy 後 |
| 11434 | Ollama | 模型 API 不應公開 |
| 5432 | Postgres | Dify database 不應公開 |
| 6379 | Redis | Dify cache/queue 不應公開 |
| 2375/2376 | Docker daemon | 高風險 |

截圖預留：

```text
[截圖 TODO：Security Group inbound rules]
```

## Server 基本安裝

登入 EC2 後，先安裝基本套件：

```bash
sudo apt update
sudo apt install -y git curl ca-certificates python3 python3-venv python3-pip nginx
```

安裝 Docker Engine 與 Compose plugin 後確認：

```bash
docker --version
docker compose version
```

建立專案目錄：

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/Bikerbyte/rag-ai-agent.git
git clone https://github.com/langgenius/dify.git
```

截圖預留：

```text
[截圖 TODO：docker --version 與 docker compose version]
[截圖 TODO：專案 clone 完成]
```

## Dify + Ollama 部署

`rag-ai-agent` 的最新文件建議 Dify 用官方 Docker Compose。

```bash
cd ~/Projects/dify/docker
cp .env.example .env
```

如果 EC2 上的 80 port 要留給 Nginx reverse proxy，Dify 可以改成 host port `8081`：

```text
EXPOSE_NGINX_PORT=8081
EXPOSE_NGINX_SSL_PORT=8443
DEBUG=false
```

啟動：

```bash
env -u DEBUG docker compose up -d
docker compose ps
```

開初始化頁：

```text
http://<server-private-or-public-ip>:8081/install
```

> [!WARNING]
> 這個 `8081` 只是初期 setup 用。正式對外不建議直接公開 Dify。可以先用 SSH tunnel 或只允許自己的 IP 暫時連線，完成初始化後收掉 inbound。

### Ollama

可以用 Docker 跑 Ollama：

```bash
docker run -d --restart unless-stopped \
  -v ollama:/root/.ollama \
  -p 11434:11434 \
  --name ollama \
  ollama/ollama
```

拉模型：

```bash
docker exec ollama ollama pull qwen2.5:7b-instruct
docker exec ollama ollama pull bge-m3
```

或使用 repo script：

```bash
cd ~/Projects/rag-ai-agent
bash scripts/install-ollama-models.sh
```

Dify 裡設定模型：

- LLM provider：Ollama
- Chat model：`qwen2.5:7b-instruct`
- Embedding model：`bge-m3`
- Knowledge base 使用 `bge-m3`

> [!NOTE]
> 如果 Dify 在 Docker container 裡，`127.0.0.1:11434` 會指向 Dify container 自己，不一定連得到 host 上的 Ollama。需要讓 Dify 使用 Docker 可達的 host address，或把 Ollama 放到可互通的 Docker network。

## Web UI 部署

進入 `rag-ai-agent`：

```bash
cd ~/Projects/rag-ai-agent
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.telegram.example .env
```

`.env` 初始設定可以先這樣：

```text
APP_ENV=production
DIFY_API_BASE_URL=http://127.0.0.1:8081/v1
DIFY_APP_API_KEY=app-xxxxxxxx
OLLAMA_BASE_URL=http://127.0.0.1:11434

WEB_UI_USERNAME=admin
WEB_UI_PASSWORD_HASH=pbkdf2_sha256$...
WEB_UI_SESSION_SECRET=<long-random-secret>
WEB_UI_SESSION_HOURS=12
WEB_UI_COOKIE_SECURE=true
WEB_UI_TRUSTED_HOSTS=rag.example.com
WEB_UI_MAX_BODY_BYTES=1048576
WEB_UI_LOGIN_MAX_ATTEMPTS=8
WEB_UI_LOGIN_WINDOW_SECONDS=300
```

產生 password hash：

```bash
python scripts/hash-web-ui-password.py
```

本機測試啟動：

```bash
uvicorn web_ui.main:app --host 127.0.0.1 --port 8090 --proxy-headers
```

Web UI 內建功能：

- 登入卡控與登出。
- Dify / Ollama health check。
- Dify App API 聊天測試。
- 測試案例新增、編輯、刪除。
- 批次驗證與通過 / 失敗紀錄。
- 本機驗證紀錄保存於 `data/`。

截圖預留：

```text
[截圖 TODO：Web UI login page]
[截圖 TODO：Web UI health check]
[截圖 TODO：Dify chat test]
```

## 密碼卡控與安全設定

最新版 `web_ui` 已經有基礎防護，部署到 AWS 時要啟用。

### 必填 production 設定

正式環境至少要有：

```text
APP_ENV=production
WEB_UI_PASSWORD_HASH=pbkdf2_sha256$...
WEB_UI_SESSION_SECRET=<long-random-secret>
WEB_UI_COOKIE_SECURE=true
WEB_UI_TRUSTED_HOSTS=rag.example.com
```

如果缺少這些設定，`WebConfig.validate_security()` 會讓 Web UI 在 production 模式報錯，避免用不安全設定啟動。

### 已內建的保護

| 保護 | 目前狀態 |
|------|----------|
| 登入卡控 | 已有 |
| Password hash | 已有 `pbkdf2_sha256` |
| Session cookie 簽章 | 已有 |
| Login rate limit | 已有 |
| Host allowlist | 已有 |
| Origin / Referer check | 已有 |
| Request body size limit | 已有 |
| Security headers | 已有 CSP、X-Frame-Options、X-Content-Type-Options 等 |
| HSTS | `WEB_UI_COOKIE_SECURE=true` 時啟用 |

### WIP：密碼管理決策

目前我會先採用：

```text
WEB_UI_PASSWORD_HASH + WEB_UI_SESSION_SECRET
```

後續可改成：

- AWS SSM Parameter Store。
- AWS Secrets Manager。
- systemd environment file 並設定檔案權限。
- 反向代理再加 Basic Auth 或 IP allowlist。
- Tailscale / VPN / SSM port forwarding，避免公開 Web UI。

> [!WARNING]
> 不要在 production `.env` 裡放 `WEB_UI_PASSWORD` 明文。至少使用 `WEB_UI_PASSWORD_HASH`。

## 外部網路訪問

### 選項 A：Nginx reverse proxy + HTTPS

Nginx 對外收 HTTPS，轉到 local Web UI：

```text
https://rag.example.com -> 127.0.0.1:8090
```

Nginx 範例：

```nginx
server {
    listen 80;
    server_name rag.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name rag.example.com;

    ssl_certificate /etc/letsencrypt/live/rag.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rag.example.com/privkey.pem;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Web UI 啟動要加：

```bash
uvicorn web_ui.main:app --host 127.0.0.1 --port 8090 --proxy-headers
```

### 選項 B：ALB + Target Group

如果想練 AWS networking，可以用：

```text
Route 53 / Domain
  -> ACM Certificate
  -> Application Load Balancer 443
  -> Target Group
  -> EC2 private port 8090
```

這比較貼近正式架構，但成本會比單純 Nginx 高。初期有 AWS credit 可以練一次，但不用時要清掉 ALB。

> [!WARNING]
> ALB 會產生費用。練習完如果不用，Target Group、ALB、ACM/Route 53 相關設定都要檢查。

## Telegram Bridge

Telegram bridge 還是可以留在同一台 EC2 跑。

`.env` 設定：

```text
TELEGRAM_BOT_TOKEN=123456:telegram-token
TELEGRAM_ALLOWED_USER_IDS=123456789
TELEGRAM_REQUIRE_ALLOWLIST=true
DIFY_API_BASE_URL=http://127.0.0.1:8081/v1
DIFY_APP_API_KEY=app-xxxxxxxx
DIFY_TIMEOUT_SECONDS=120
TELEGRAM_MAX_MESSAGE_LENGTH=3900
```

啟動：

```bash
python -m telegram_bot.main
```

設計重點：

- 使用者只透過 Telegram 問問題。
- Dify API key 留在 server。
- `TELEGRAM_REQUIRE_ALLOWLIST=true`，只允許指定 Telegram user id。
- 每個 user 可用獨立 session，避免對話全混在一起。

## systemd 服務化

### Web UI service

```ini
[Unit]
Description=RAG Knowledge Agent Web UI
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/Projects/rag-ai-agent
EnvironmentFile=/home/ubuntu/Projects/rag-ai-agent/.env
ExecStart=/home/ubuntu/Projects/rag-ai-agent/.venv/bin/uvicorn web_ui.main:app --host 127.0.0.1 --port 8090 --proxy-headers
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Telegram bridge service

```ini
[Unit]
Description=RAG Knowledge Agent Telegram Bridge
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/Projects/rag-ai-agent
EnvironmentFile=/home/ubuntu/Projects/rag-ai-agent/.env
ExecStart=/home/ubuntu/Projects/rag-ai-agent/.venv/bin/python -m telegram_bot.main
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

啟用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rag-web-ui
sudo systemctl enable --now rag-telegram-bot
sudo systemctl status rag-web-ui
sudo systemctl status rag-telegram-bot
```

> [!NOTE]
> systemd `EnvironmentFile` 很方便，但要注意 `.env` 權限。至少限制成只有服務使用者和 root 可讀。

## 驗證 Checklist

### Local service

```bash
bash scripts/test-local-services.sh
```

檢查：

- Dify 是否可連。
- Ollama 是否可連。
- Web UI 是否啟動。

### Web UI

- [ ] 未登入訪問 `/` 會跳 `/login`。
- [ ] 錯誤密碼多次會被 rate limit。
- [ ] 登入後可以看 Dify/Ollama health check。
- [ ] Chat 測試可以取得 Dify 回答。
- [ ] `WEB_UI_TRUSTED_HOSTS` 設錯時會拒絕不合法 Host。
- [ ] Cookie 有 `Secure`。

### AWS

- [ ] Security Group 只有 22、80、443 對外。
- [ ] 22 只允許 My IP。
- [ ] 沒有公開 8081、8090、11434、5432、6379。
- [ ] EBS encrypted。
- [ ] `.env` 權限已限制。
- [ ] Dify database / uploaded files / vector store 有備份策略。

截圖預留：

```text
[截圖 TODO：登入後 Web UI 首頁]
[截圖 TODO：curl local Dify/Ollama health]
[截圖 TODO：Security Group 最終 inbound rules]
```

## 清理與成本控管

如果只是練習，不用時要檢查：

- EC2 instance 是否還 running。
- EBS volume 是否還存在。
- Snapshot 是否需要保留。
- ALB / Target Group 是否已刪除。
- Elastic IP 是否 release。
- Route 53 hosted zone / record 是否仍需要。
- CloudWatch Logs 是否持續累積。
- Dify Docker volumes 是否還需要。

如果確定整個 lab 不用了：

```bash
cd ~/Projects/dify/docker
docker compose down
docker ps -a
```

再視情況 terminate EC2。

## 下一步

這篇先把 EC2 外部訪問部署路線整理出來。下一步我會想拆成幾個更小的實作：

1. EC2 上跑 Dify + Ollama，先不公開。
2. Web UI 用 `127.0.0.1:8090` 本機測通。
3. 加 Nginx HTTPS reverse proxy。
4. 啟用 `APP_ENV=production` 和 `WEB_UI_PASSWORD_HASH`。
5. 測試 Web UI 登入與 Dify chat。
6. 接 Telegram bridge，開 allowlist。
7. 整理備份與清理流程。

等密碼卡控和 HTTPS 流程穩了，再考慮是否要用 ALB、Route 53、ACM 或搬到 ECS。
