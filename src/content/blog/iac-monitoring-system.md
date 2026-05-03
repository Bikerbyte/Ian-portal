---
title: "IaC Monitoring System 實作紀錄"
excerpt: "以 Terraform、Ansible、Python agent、Prometheus 與 Grafana 組成一套可重複部署的 monitoring lab，並用 Docker Target Mode 與 Server Agent Mode 練習 IaC 工作流。"
date: 2026-04-30
category: "學習"
tags:
  - IaC
  - Terraform
  - Ansible
  - Docker
  - Monitoring
series: "IaC Lab"
seriesOrder: 3
featured: true
---

## Agenda

- 專案目標
- 整體架構
- Repository 結構
- Docker Target Mode
- Server Agent Mode
- Python Monitoring Agent
- Grafana 與 Prometheus
- 驗證與品質檢查
- 目前心得與後續方向

## 專案目標

這次實作的專案是 [iac-monitoring-system](https://github.com/Bikerbyte/iac-monitoring-system)。它不是單純把 Prometheus 和 Grafana 跑起來，而是把「監控系統如何被建立、派送、更新、驗證」都放進 Infrastructure as Code 的流程裡。

這個專案目前有兩條主要路線：

| 模式 | 目的 | 適合情境 |
|------|------|----------|
| Docker Target Mode | 用本機 Docker containers 模擬 app targets，快速展示新增、刪除、編輯與監控設定派送 | Demo、練習 Terraform/Ansible 串接 |
| Server Agent Mode | 針對既有 Linux servers 或 AWS EC2 部署 Python monitoring agent，再由 Prometheus/Grafana 收集與展示 | 接近真實主機監控的練習 |

我想練的核心不是「手動把監控服務裝好」，而是把每個步驟變成可以重複執行、可以版本控管、可以清楚驗證的流程：

- Terraform 管理目標資源與 desired state。
- Terraform 產生 Ansible inventory 和 group variables。
- Ansible 依照 Terraform output 部署 monitoring stack 或 agent。
- Prometheus scrape targets。
- Grafana 自動載入 datasource 和 dashboards。
- Makefile 統一常用操作與驗證入口。

也就是說，Terraform 負責描述「有哪些東西」，Ansible 負責把「該部署的服務與設定」派送出去，Prometheus/Grafana 負責觀察結果。

## 整體架構

專案 README 裡把架構整理成這個方向：

```text
Terraform -> Ansible -> Python Agent -> /var/log/monitor-agent.log
                       -> /metrics -> Prometheus -> Grafana Dashboard
```

實際上會依模式分成兩種流程。

Docker Target Mode 的流程比較適合本機 demo：

```text
Terraform
  -> 建立 Docker network
  -> 建立多個 HTTP app containers
  -> 產生 ansible/docker-target-inventory.ini
  -> 產生 ansible/group_vars/docker_target_stack/generated.yml

Ansible
  -> 部署 blackbox exporter
  -> 部署 Prometheus
  -> 部署 Grafana dashboards

Grafana
  -> 顯示 app up/down、latency、HTTP status code
```

Server Agent Mode 則比較接近真實主機監控：

```text
Terraform
  -> 使用既有 Linux server inventory
  -> 或選擇建立 AWS EC2
  -> 產生 ansible/inventory.ini

Ansible
  -> 將 Python monitoring agent 部署到遠端 servers
  -> 建立 systemd service
  -> 在 control node 部署 Prometheus/Grafana

Python agent
  -> 收集 CPU、memory、zombie process、DNS/TCP check
  -> 寫入 /var/log/monitor-agent.log
  -> 暴露 /metrics 給 Prometheus
```

這樣拆開之後，Docker 模式可以快速展示 IaC 的變更流程，Server Agent 模式可以練習更接近實務的遠端主機部署。

## Repository 結構

目前 repo 的主要結構如下：

```text
infra/
  docker/
    terraform/
      main.tf
      variables.tf
      outputs.tf
  server/
    terraform/
      main.tf
      variables.tf
      outputs.tf
ansible/
  docker-target.yml
  server-agent.yml
  templates/
  files/
agent/
  agent.py
  config.yml
systemd/
  monitor-agent.service
docs/
  system-usage.zh-TW.md
Makefile
requirements.txt
README.md
```

其中比較重要的分工是：

| 目錄或檔案 | 負責內容 |
|------------|----------|
| `infra/docker/terraform` | 建立本機 Docker app nodes、network，並產生 Docker 模式的 Ansible 設定 |
| `infra/server/terraform` | 管理 Linux server inventory，或在開啟選項後建立 AWS EC2 |
| `ansible/docker-target.yml` | 部署 Docker 模式的 blackbox exporter、Prometheus、Grafana |
| `ansible/server-agent.yml` | 部署遠端 Python agent 與本機 monitoring stack |
| `agent/agent.py` | 自製 monitoring agent |
| `systemd/monitor-agent.service` | 讓 agent 用 systemd 常駐與自動重啟 |
| `Makefile` | 包裝常用 demo、scale、edit、validate 指令 |

## Docker Target Mode

Docker Target Mode 是目前最適合拿來 demo 的路徑，因為不用先準備真的 server，也不用打開雲端資源。Terraform 會在本機建立多個 HTTP echo containers，用它們模擬被監控的 app nodes。

Terraform 的 Docker 模式主要管理這些資源：

| Resource | 說明 |
|----------|------|
| `docker_network.lab` | app containers 和 monitoring stack 共用的 Docker network |
| `docker_image.app` | 預設使用 `hashicorp/http-echo:1.0` |
| `docker_container.app_node` | 依 `node_count` 建立 1 到 5 個 app containers |
| `local_file.ansible_inventory` | 產生 `ansible/docker-target-inventory.ini` |
| `local_file.ansible_group_vars` | 產生 `ansible/group_vars/docker_target_stack/generated.yml` |

預設 app node 會從 `18080` 開始映射 host port：

```text
App node 1: http://localhost:18080
App node 2: http://localhost:18081
```

Prometheus、Grafana 和 blackbox exporter 則由 Ansible 部署：

```text
Grafana:    http://localhost:13000
Prometheus: http://localhost:19090
Blackbox:   http://localhost:19115
```

快速啟動可以用 Makefile：

```bash
make docker-up
```

它背後做的事相當於：

```bash
terraform -chdir=infra/docker/terraform init
terraform -chdir=infra/docker/terraform apply
ansible-playbook -i ansible/docker-target-inventory.ini ansible/docker-target.yml
```

### 模擬新增資源

把 app nodes 從預設數量調整成 3：

```bash
make docker-scale NODE_COUNT=3
```

這個流程會重新執行 Terraform，更新 app containers 和 Ansible 需要的 target 清單，再重新派送 Prometheus/Grafana 設定。這是我覺得這個 lab 最有價值的地方：target 數量不是手動去 Prometheus 裡改，而是從 Terraform desired state 往後一路更新。

### 模擬刪除資源

把 app nodes 縮回 1：

```bash
make docker-scale NODE_COUNT=1
```

這可以展示 Terraform 如何把環境拉回宣告的狀態，也可以看 Grafana dashboard 裡的 target 數量跟著變少。

### 模擬編輯資源

修改 app container 回應文字：

```bash
make docker-edit
```

這個 target 會用 Terraform 變數更新 `app_message_prefix`，適合展示「設定變更」如何透過 IaC 進行，而不是手動進 container 裡改。

### 模擬故障與恢復

也可以故意停掉其中一個 container：

```bash
docker stop iac-lab-app-node-01
```

幾秒後 Grafana 的 Docker Target dashboard 應該會看到 target down。恢復時再回到 Terraform：

```bash
cd infra/docker/terraform
terraform apply
```

這可以練習 drift 的概念：當實際環境被手動改掉，下一次 Terraform apply 會把它拉回 desired state。

## Server Agent Mode

Server Agent Mode 比較接近真實環境。它的 Terraform 目錄在：

```text
infra/server/terraform
```

這個模式預設不會建立 AWS 資源，而是用 `server_hosts` 產生 Ansible inventory。也就是說，預設是安全的 mock/existing server flow，可以先拿既有 Linux servers 或 VMware 主機練習，不會一執行就產生雲端費用。

如果要改成真的建立 AWS EC2，可以把：

```hcl
enable_aws_resources = true
```

並補上 AMI ID、SSH key、VPC/subnet/security group 相關設定。Terraform 裡已經有 AWS provider、key pair、security group、EC2 instance 的資源定義。

> [!WARNING]
> 如果真的開 AWS，`allowed_ssh_cidr_blocks` 和 `allowed_monitoring_cidr_blocks` 不建議維持 `0.0.0.0/0`。練習時也要記得最後執行 `terraform destroy`，避免產生不必要費用。

產生 inventory 的基本流程：

```bash
cd infra/server/terraform
terraform init
terraform apply
```

完成後可以檢查 output：

```bash
terraform output server_ip_addresses
terraform output ansible_inventory_path
terraform output system_mode
terraform output grafana_url
terraform output prometheus_url
```

部署 agent 和 monitoring stack：

```bash
make server-agent ANSIBLE_FLAGS="--ask-pass --ask-become-pass"
make server-stack ANSIBLE_FLAGS="--ask-become-pass"
```

如果 server 已經設定 SSH key，可以省略 `--ask-pass`。

## Python Monitoring Agent

這個專案裡有一個自製 Python agent，放在：

```text
agent/agent.py
```

Ansible 會把它部署到遠端 server 的：

```text
/opt/monitor-agent/agent.py
/etc/monitor-agent/config.yml
/var/log/monitor-agent.log
```

並透過：

```text
systemd/monitor-agent.service
```

讓它用 systemd 常駐。agent dependencies 會裝在 `/opt/monitor-agent/venv`，避免污染系統 Python。

agent 目前負責的檢查包含：

- CPU sample。
- Memory sample。
- Zombie process。
- DNS resolution check。
- TCP connectivity check。
- 錯誤分類，例如 DNS resolution error、TCP timeout、connection refused。
- 寫入 `/var/log/monitor-agent.log`。
- 暴露 Prometheus `/metrics` endpoint。

預設 config 在：

```text
agent/config.yml
```

README 提到的預設 network checks 包含：

- DNS：`www.graid.com`
- TCP internal：`192.168.1.254:443`
- TCP external：`google.com:443`

Server Agent Mode 部署完成後，可以在 server 上確認：

```bash
sudo systemctl status monitor-agent
sudo journalctl -u monitor-agent -n 50 --no-pager
sudo tail -f /var/log/monitor-agent.log
curl http://localhost:8000/metrics
```

本機開發時也可以只跑一次 agent：

```bash
python agent/agent.py --config agent/config.yml --log-file ./monitor-agent.log --once --disable-metrics
```

## Grafana 與 Prometheus

這個專案不是只把 Prometheus/Grafana container 開起來，而是把 datasource 和 dashboard provisioning 也放進 repo。

Docker Target Mode 的 dashboard 放在：

```text
ansible/files/docker-target/grafana/dashboards/
```

目前有：

```text
docker-target-overview.json
docker-target-details.json
```

Server Agent Mode 的 dashboard 放在：

```text
ansible/files/grafana/dashboards/
```

目前有：

```text
iac-agent-overview.json
```

Grafana datasource provisioning 則放在：

```text
ansible/files/**/grafana/provisioning/datasources/prometheus.yml
```

這樣做的好處是 dashboard 不需要登入 Grafana 手動建立。Ansible 重新部署後，Grafana 會自動載入 Prometheus datasource 和 dashboard JSON，整套監控視覺化也可以被版本控管。

## 驗證與品質檢查

repo 裡有一個很重要的入口：

```bash
make validate
```

它會執行：

- Docker Target Mode 的 `terraform fmt -check`、`terraform init -backend=false`、`terraform validate`。
- Server Agent Mode 的 `terraform fmt -check`、`terraform init -backend=false`、`terraform validate`。
- Ansible playbook syntax check。
- Grafana dashboard JSON 檢查。
- Python agent 語法檢查。

這讓專案比較不像一次性的 lab，而是有一個可以在本機或 CI 裡重複執行的品質門檻。

## 目前心得

這個專案目前比較完整的地方，是已經把「資源宣告」和「監控部署」串成一條可重複的流程。特別是 Docker Target Mode，很適合展示 IaC 的幾個重要行為：

- 新增資源：`NODE_COUNT=3`。
- 刪除資源：`NODE_COUNT=1`。
- 編輯資源：更新 app response text。
- 派送設定：Ansible 重新產生 Prometheus/Grafana 使用的設定。
- 模擬故障：手動 stop container，再用 Terraform 拉回 desired state。

Server Agent Mode 則把同樣概念延伸到遠端 Linux servers：Terraform 管 inventory，Ansible 派 agent，systemd 管生命週期，Prometheus/Grafana 管觀察。

這次我比較有感的是，監控系統本身也應該被 IaC 管起來。否則 dashboard、targets、agent config 如果都靠手動改，最後會很難重建，也很難說明目前環境到底是怎麼來的。

## 後續方向

README 裡也列了一些可以繼續加強的方向：

- 加入 centralized logging，例如 Loki、ELK 或 OpenSearch。
- 加入 alerting，例如 Alertmanager、Teams webhook 或 Slack webhook。
- Terraform backend 改成 remote backend，例如 S3 + DynamoDB lock。
- 將 Ansible 裡 shell-based Docker tasks 改成 `community.docker` modules。

我自己的下一步會想先把 Docker Target Mode 的 demo 流程再整理得更順，讓它可以很清楚地展示：

1. Terraform 建立 targets。
2. Ansible 派送 monitoring stack。
3. Grafana 顯示目前狀態。
4. Terraform scale/edit 後 dashboard 跟著更新。
5. 故障發生時，Grafana 能指出哪個 target 有問題。

等這條 demo 流程足夠穩，再把 Server Agent Mode 接到更真實的 Linux server 或 AWS EC2，讓整個專案從 lab 往實務監控系統再靠近一點。
