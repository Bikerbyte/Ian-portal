---
title: "IaC Monitoring System 實作紀錄"
excerpt: "使用 Terraform 建立 Docker app 環境，並輸出 Ansible inventory 與 group variables，作為後續監控系統自動化部署的基礎。"
date: 2026-04-30
category: "學習"
tags:
  - IaC
  - Terraform
  - Ansible
  - Docker
  - Monitoring
featured: true
---

## Agenda

- 專案目標
- 實作環境
- Terraform 管理的資源
- Terraform State 檢查
- Terraform 與 Ansible 的銜接
- 目前進度與下一步

## 專案目標

這次實作的專案是 [iac-monitoring-system](https://github.com/Bikerbyte/iac-monitoring-system)，目標是用 Infrastructure as Code 的方式建立一套本機可重複部署的 app 與 monitoring lab。

目前的重點不是一次把監控系統全部完成，而是先把基礎流程打通：

- 用 Terraform 建立 Docker network。
- 用 Terraform build app container image。
- 用 Terraform 啟動多個 app container。
- 用 Terraform 產生 Ansible 需要的 inventory 與 group variables。
- 後續再用 Ansible 部署 monitoring stack，例如 Prometheus、Grafana 或相關 exporter。

也就是說，Terraform 負責「把基礎設施生出來」，Ansible 負責「進一步設定與部署服務」。

## 實作環境

目前是在 Ubuntu 上進行實作，主要工具包含：

- Ubuntu 作為操作環境。
- Docker 作為本機 container runtime。
- Terraform 管理 Docker resource 與本機產出的設定檔。
- Ansible 讀取 Terraform 產生的 inventory 與變數檔。

這樣的組合很適合拿來練習 IaC 流程，因為不用先準備雲端帳號，也能模擬多服務、多節點與監控部署的情境。

> [!NOTE]
> 目前這個 lab 先以本機 Docker 為主，重點是把 Terraform 到 Ansible 的交接流程做穩。等流程成熟後，再把同樣概念搬到雲端 VM 或 Kubernetes 會比較順。

## Terraform 管理的資源

目前執行 `terraform state list` 可以看到 Terraform 已經管理以下資源：

```bash
terraform state list
docker_container.app_node[0]
docker_container.app_node[1]
docker_image.app
docker_network.lab
local_file.ansible_group_vars
local_file.ansible_inventory
```

這代表目前 Terraform state 中有 6 個資源，分別涵蓋 Docker app、共用網路，以及給 Ansible 使用的設定檔。

| Resource | 說明 |
|----------|------|
| `docker_container.app_node[0]` | 第一個 app container 節點 |
| `docker_container.app_node[1]` | 第二個 app container 節點 |
| `docker_image.app` | app container 使用的 image |
| `docker_network.lab` | app 與 monitoring stack 共用的 Docker network |
| `local_file.ansible_inventory` | 產生給 Ansible 使用的主機清單 |
| `local_file.ansible_group_vars` | 產生給 Ansible 使用的 Terraform output 變數 |

## Docker Image 與 App Containers

`docker_image.app` 是 app container 會使用的 image。這個資源讓 image build 納入 Terraform 管理，後續只要 app image 設定或 build context 有變動，就可以透過 Terraform 流程重新建立。

目前也已經建立兩個 app node：

```bash
docker_container.app_node[0]
docker_container.app_node[1]
```

這種寫法通常代表 Terraform 設定裡使用了 `count` 或類似方式來建立多個相同角色的 container。對監控練習來說，這很有幫助，因為可以模擬多個 app target，讓 Prometheus 之類的監控服務後續能 scrape 多個節點。

## Docker Network

`docker_network.lab` 是 app 與 monitoring stack 共用的網路。

把 app container 和 monitoring stack 放在同一個 Docker network 裡，後續會比較容易讓監控服務透過 container name 或固定的 service name 找到 target。這也可以避免每次 container IP 改變時，都要手動修改監控設定。

這個 network 在整個 lab 裡扮演基礎層角色：

- app containers 會連到這個 network。
- monitoring stack 後續也會連到這個 network。
- Prometheus 可以透過 network 內部名稱連到 app target。
- Grafana 可以連到 Prometheus 讀取 metrics。

## Terraform State 檢查

`terraform state list` 是確認目前 Terraform 管理範圍的好方法。

目前看到的 state 結果表示 Terraform 已經成功追蹤：

- Docker image。
- Docker network。
- 兩個 app containers。
- 兩個 Ansible 相關 local files。

這一步很重要，因為 Terraform 後續執行 `plan` 或 `apply` 時，就是根據 state、實際環境與 `.tf` 設定檔去比較差異。

如果 state 裡已經有資源，但 Docker 實際環境被手動改掉，下一次 `terraform plan` 就可能看到 drift。這也是 IaC 實作中需要避免手動改環境的原因：盡量讓環境變更都回到程式碼與 Terraform 流程裡。

> [!WARNING]
> 不建議手動刪除 `terraform.tfstate` 或直接改 Docker 裡的受管理資源。除非是刻意練習修復流程，否則 state 與實際環境不同步時，後續排查會變得很麻煩。

## Terraform 與 Ansible 的銜接

這次實作裡比較關鍵的設計，是 Terraform 會產生 Ansible 需要的檔案：

```bash
local_file.ansible_inventory
local_file.ansible_group_vars
```

`local_file.ansible_inventory` 是給 Ansible 的主機清單。它可以把 Terraform 建立出來的 app container 資訊整理成 Ansible 可讀的 inventory。

`local_file.ansible_group_vars` 則是把 Terraform output 或環境變數整理成 Ansible group variables。這樣 Ansible playbook 就不用硬編碼 container name、network name 或 target 位址，而是直接讀 Terraform 產生的結果。

這個流程可以把兩個工具的責任切開：

| 工具 | 負責內容 |
|------|----------|
| Terraform | 建立 Docker image、network、container，並輸出部署資訊 |
| Ansible | 讀取 inventory 與 variables，部署或設定 monitoring stack |

這樣做的好處是，當 app node 數量或 network 設定調整時，只要重新執行 Terraform，Ansible 使用的設定檔也會跟著更新。

## 目前進度

目前已完成的部分：

- Terraform 可以建立 app image。
- Terraform 可以建立共用 Docker network。
- Terraform 可以建立兩個 app container。
- Terraform 可以產生 Ansible inventory。
- Terraform 可以產生 Ansible group variables。
- `terraform state list` 已確認上述資源都被 Terraform 管理。

接下來可以繼續補上：

- 使用 `terraform output` 檢查輸出的 app target 資訊。
- 用 Ansible 讀取產生的 inventory。
- 建立 monitoring stack 的 playbook。
- 部署 Prometheus 並設定 scrape targets。
- 部署 Grafana 並匯入 dashboard。
- 加入 destroy / rebuild 流程，確認整個 lab 可以重複建立與清除。

## 小結

這次的重點是把 IaC monitoring lab 的基礎打起來。Terraform 目前已經可以管理 app container、Docker network，以及 Ansible 會用到的設定檔。

下一步會進入 Ansible 與 monitoring stack 的部分，把 Terraform 產出的 inventory 和 variables 接起來，讓 Prometheus / Grafana 的部署也能維持可重複、可版本控管的流程。
