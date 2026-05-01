---
title: "IaC 學習筆記 & 實作紀錄 - Terraform"
excerpt: "Terraform 基礎觀念、Provider、State、Plan/Apply 流程與第一個本機實作紀錄。"
date: 2026-04-30
category: "學習"
tags:
  - IaC
  - Terraform
series: "IaC Lab"
seriesOrder: 2
featured: false
---

## Agenda

- Terraform 介紹
- 環境假設
- 安裝方式
- 第一個 Terraform 專案
- Terraform 常用指令
- State 觀念
- 小結

## Terraform 介紹

*[Terraform](https://developer.hashicorp.com/terraform)* 是 HashiCorp 推出的 Infrastructure as Code 工具，用來以宣告式設定檔管理基礎設施。

Terraform 的核心想法是：先用 `.tf` 檔描述想要的資源狀態，再由 Terraform 計算目前狀態與目標狀態之間的差異，最後執行建立、修改或刪除。

和 Ansible 相比，Terraform 更常被用在「基礎設施佈建」：

- 建立雲端 VM、VPC、Subnet、Security Group。
- 建立 DNS record、Load Balancer、Database。
- 管理 Kubernetes、GitHub、Cloudflare 等平台資源。

Ansible 比較像是進入主機後做設定管理；Terraform 則比較像是在平台層級建立與管理資源。

## 環境假設

這篇先用最小環境理解 Terraform 的操作流程：

- 一台 Ubuntu 作為操作環境。
- 已安裝 Terraform CLI。
- 先使用 `local` provider 做本機檔案實作，不需要雲端帳號。
- 後續若要操作 AWS、Azure、GCP，才需要另外設定對應 Provider 與 credentials。

## 安裝方式 (以 Ubuntu 為例)

先安裝必要套件：

```bash
sudo apt-get update
sudo apt-get install -y gnupg software-properties-common
```

匯入 HashiCorp GPG key：

```bash
wget -O- https://apt.releases.hashicorp.com/gpg | \
  gpg --dearmor | \
  sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg > /dev/null
```

加入 HashiCorp apt repository：

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(grep -oP '(?<=UBUNTU_CODENAME=).*' /etc/os-release || lsb_release -cs) main" | \
  sudo tee /etc/apt/sources.list.d/hashicorp.list
```

安裝 Terraform：

```bash
sudo apt-get update
sudo apt-get install terraform
terraform -version
```

官方安裝文件可以參考：[Install Terraform](https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli)。

## 第一個 Terraform 專案

先建立一個資料夾：

```bash
mkdir terraform-local-demo
cd terraform-local-demo
```

建立 `main.tf`：

```hcl
terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

resource "local_file" "note" {
  filename = "${path.module}/hello-terraform.txt"
  content  = "Hello Terraform\n"
}
```

這份設定代表：

- `required_providers`：宣告這個專案需要使用哪些 Provider。
- `local` provider：用來操作本機資源，例如本機檔案。
- `resource "local_file" "note"`：宣告一個本機檔案資源。
- `filename` 與 `content`：描述檔案最後應該存在的位置與內容。

接著初始化專案：

```bash
terraform init
```

查看 Terraform 預計做哪些變更：

```bash
terraform plan
```

套用變更：

```bash
terraform apply
```

執行後會看到目錄內產生 `hello-terraform.txt`。如果再次執行 `terraform plan`，在設定沒有改變的情況下，Terraform 會顯示沒有需要異動的資源。

## Terraform 常用指令

| 指令 | 說明 | 常見使用時機 |
|------|------|--------------|
| `terraform init` | 初始化專案並下載 Provider | 第一次建立專案或 Provider 有變更時 |
| `terraform fmt` | 格式化 `.tf` 檔案 | commit 前整理格式 |
| `terraform validate` | 檢查語法與設定是否有效 | 寫完設定後先檢查 |
| `terraform plan` | 預覽預計建立、修改、刪除的內容 | apply 前確認影響範圍 |
| `terraform apply` | 套用設定並更新實際資源 | 確認 plan 後執行 |
| `terraform destroy` | 刪除 Terraform 管理的資源 | 清除測試環境 |
| `terraform state list` | 查看 state 裡管理的資源 | 排查 Terraform 目前追蹤哪些資源 |

## State 觀念

Terraform 會透過 State 記錄「目前它管理的資源狀態」。預設情況下，State 會存在本機的 `terraform.tfstate`。

State 很重要，因為 Terraform 需要靠它比較：

- `.tf` 檔描述的目標狀態。
- Provider 回報的實際資源狀態。
- State 裡記錄的上次管理狀態。

因此實務上要特別注意：

- 不要隨意刪除 `terraform.tfstate`。
- 團隊協作時不要每個人各自使用本機 state。
- 正式環境通常會使用 remote backend，例如 S3、Terraform Cloud 等。
- State 可能包含敏感資訊，不應隨意公開。

## Variables 與 Outputs

Terraform 可以透過 variable 讓設定更容易重複使用。

建立 `variables.tf`：

```hcl
variable "note_content" {
  type        = string
  description = "Content written into the demo file."
  default     = "Hello Terraform\n"
}
```

把 `main.tf` 裡的 `content` 改成：

```hcl
content = var.note_content
```

也可以用 output 顯示結果：

```hcl
output "note_path" {
  value = local_file.note.filename
}
```

重新執行：

```bash
terraform fmt
terraform validate
terraform plan
terraform apply
```

這樣就能把可變內容抽出來，讓同一份 Terraform 設定可以在不同環境重複使用。

## Terraform 的 Idempotent 觀念

Terraform 也是以目標狀態為核心。當設定沒有改變、實際資源也沒有漂移時，重複執行 `terraform apply` 不應該一直產生新的變更。

這點和 Ansible 類似，都是 IaC 工具很重要的特性：

- 設定檔描述目標狀態。
- 工具負責比較差異。
- 有差異才進行變更。

差別在於 Terraform 更依賴 State 來追蹤資源，而 Ansible 多半是在執行時直接檢查目標主機狀態。

## 小結

這次先完成 Terraform 的基本操作流程：

- 安裝 Terraform CLI。
- 建立第一個 `.tf` 設定檔。
- 使用 `init`、`plan`、`apply` 套用資源。
- 理解 State 的用途。
- 使用 variable 與 output 讓設定更有彈性。

下一步可以繼續補 Provider 實作，例如用 AWS 建立 EC2、Security Group、VPC，或補 remote backend 與 module 的整理方式。
