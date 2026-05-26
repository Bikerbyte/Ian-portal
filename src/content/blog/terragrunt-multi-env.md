---
title: "Terragrunt 多環境 DRY 管理 - 從原生 Terraform 到工程化"
excerpt: "原生 Terraform 多環境的痛、Terragrunt 解決什麼、目錄結構、include / inputs / dependency、跟 vanilla Terraform 比較、面試常考重點。"
date: 2026-09-04
category: "學習"
tags:
  - Terraform
  - Terragrunt
  - IaC
  - DevOps
series: "IaC Lab"
seriesOrder: 8
featured: false
---

## Agenda

- 原生 Terraform 多環境的痛
- Terragrunt 是什麼
- 安裝與基本用法
- 目錄結構：layer + env
- `include` 共用 backend 設定
- `inputs` 傳變數給 module
- `dependency` 跨 module 依賴
- generate block：動態產生 .tf
- run-all：批次操作
- Terragrunt vs vanilla Terraform 比較
- 跟 OpenTofu / CDK / Pulumi 的競爭
- 常見坑與排查
- 面試常考重點
- 小結

## 原生 Terraform 多環境的痛

前面文章用 `envs/dev/`、`envs/staging/`、`envs/prod/` 結構，但仔細看會發現**大量重複**：

每個 env 都有：
- 一份 `backend.tf`（只有 key prefix 不同）
- 一份 `provider.tf`（region 可能不同，其他一樣）
- 一份 `versions.tf`（完全相同）
- 一份 `main.tf` 引用一堆 module（每個 env 都要寫一遍）
- 一份 `terraform.tfvars`（這個才真的該不同）

加新 module 時要**改 3 個 env 的 main.tf**。改 backend 設定要改 3 份。這就是 **DRY violation**。

**Workspace 不解決這問題**：workspace 共用 code，只是切 state，不能處理「dev 用 t3.micro / prod 用 t3.large」這類差異（除非用 `terraform.workspace` 寫滿 if-else，又是另一個 anti-pattern）。

## Terragrunt 是什麼

[Terragrunt](https://terragrunt.gruntwork.io/) 是 Gruntwork 出的 Terraform wrapper，**核心理念：keep your Terraform code DRY**。

它做的事：

- 包 Terraform 的 CLI，加上 multi-env / multi-module orchestration
- 自動產生 backend 設定
- 集中管理 provider / version
- 跨 module 依賴 (`dependency`)
- `run-all` 批次 plan / apply 多個 module

**Terragrunt 不取代 Terraform**，它是 Terraform 上的薄層工具。底層還是跑 `terraform plan` / `terraform apply`。

## 安裝與基本用法

```bash
# macOS
brew install terragrunt

# Linux
wget https://github.com/gruntwork-io/terragrunt/releases/download/v0.55.0/terragrunt_linux_amd64
chmod +x terragrunt_linux_amd64
sudo mv terragrunt_linux_amd64 /usr/local/bin/terragrunt

terragrunt --version
```

基本指令跟 Terraform 對應：

```bash
terragrunt init       # 等於 terraform init
terragrunt plan
terragrunt apply
terragrunt destroy

# 批次（跨多個 module）
terragrunt run-all plan
terragrunt run-all apply
```

## 目錄結構：layer + env

Terragrunt 推薦的結構：

```
infrastructure/
├── terragrunt.hcl                     # 全域共用設定（root）
├── _envcommon/                        # 跨 env 共用的 module 設定
│   ├── vpc.hcl
│   ├── eks.hcl
│   └── rds.hcl
├── dev/
│   ├── env.hcl                        # dev 環境變數
│   ├── ap-northeast-1/
│   │   ├── region.hcl
│   │   ├── vpc/
│   │   │   └── terragrunt.hcl
│   │   ├── eks/
│   │   │   └── terragrunt.hcl
│   │   └── rds/
│   │       └── terragrunt.hcl
├── staging/
│   └── ap-northeast-1/
│       ├── vpc/
│       ├── eks/
│       └── rds/
└── prod/
    └── ap-northeast-1/
        ├── vpc/
        ├── eks/
        └── rds/

modules/                                # 普通 Terraform module
├── vpc/
├── eks/
└── rds/
```

**每層 `terragrunt.hcl`：**

- `infrastructure/terragrunt.hcl`：全域設定（remote state、provider generation）
- `dev/env.hcl`：dev 變數（vpc_cidr、instance type defaults）
- `dev/ap-northeast-1/region.hcl`：region 變數
- `dev/ap-northeast-1/vpc/terragrunt.hcl`：module-specific（source、inputs）

## `include` 共用 backend 設定

**root `terragrunt.hcl`**（infrastructure/ 根目錄）：

```hcl
# infrastructure/terragrunt.hcl

remote_state {
  backend = "s3"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    bucket         = "myorg-tfstate"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = "ap-northeast-1"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents = <<EOF
provider "aws" {
  region = "${local.region_vars.locals.aws_region}"

  default_tags {
    tags = {
      Environment = "${local.env_vars.locals.env}"
      ManagedBy   = "terragrunt"
    }
  }
}
EOF
}

locals {
  env_vars    = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))
}
```

**重點：**

- `key = "${path_relative_to_include()}/terraform.tfstate"`：state path 自動跟目錄結構對應  
  → `dev/ap-northeast-1/vpc/terragrunt.hcl` 的 state 變成 `s3://bucket/dev/ap-northeast-1/vpc/terraform.tfstate`
- `generate "provider"`：自動產生 `provider.tf`，每個 module 不用重寫
- `read_terragrunt_config` + `find_in_parent_folders`：讀上層的設定檔

**`dev/env.hcl`：**

```hcl
locals {
  env              = "dev"
  vpc_cidr         = "10.0.0.0/16"
  eks_node_size    = "t3.medium"
  rds_class        = "db.t4g.micro"
  rds_multi_az     = false
  enable_nat_ha    = false
}
```

**`prod/env.hcl`：**

```hcl
locals {
  env              = "prod"
  vpc_cidr         = "10.1.0.0/16"
  eks_node_size    = "m6i.large"
  rds_class        = "db.r6g.large"
  rds_multi_az     = true
  enable_nat_ha    = true
}
```

**這就是 DRY 的成果：環境差異只在一個 env.hcl 內。**

## `inputs` 傳變數給 module

**`dev/ap-northeast-1/vpc/terragrunt.hcl`：**

```hcl
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../../modules/vpc"
}

inputs = {
  name       = "demo-${include.root.locals.env_vars.locals.env}"
  cidr_block = include.root.locals.env_vars.locals.vpc_cidr
  single_nat = !include.root.locals.env_vars.locals.enable_nat_ha
}
```

跑：

```bash
cd dev/ap-northeast-1/vpc
terragrunt apply
```

Terragrunt 會：
1. 從 source 抓 module code（local 或 Git）
2. 動態產生 `backend.tf` + `provider.tf`
3. 把 `inputs` 變成 `terraform.tfvars`
4. 跑 `terraform init` + `terraform apply`

## `dependency` 跨 module 依賴

**痛點**：EKS module 需要 VPC ID 跟 subnet ID，原本要：

```hcl
# 手動傳
inputs = {
  vpc_id     = "vpc-abc123"        # hardcode 抄來
  subnet_ids = ["subnet-x", "subnet-y"]
}
```

抄錯就壞、VPC 重建 ID 變要記得改、跨人協作易亂。

**Terragrunt 解決：**

`dev/ap-northeast-1/eks/terragrunt.hcl`：

```hcl
include "root" {
  path = find_in_parent_folders()
}

dependency "vpc" {
  config_path = "../vpc"
}

terraform {
  source = "../../../../modules/eks"
}

inputs = {
  cluster_name = "demo-eks-${include.root.locals.env_vars.locals.env}"
  vpc_id       = dependency.vpc.outputs.vpc_id
  subnet_ids   = dependency.vpc.outputs.private_subnet_ids
  node_size    = include.root.locals.env_vars.locals.eks_node_size
}
```

`dependency.vpc.outputs.vpc_id` 從 VPC module 的 output 拿。Terragrunt 自動：
1. 先確保 VPC module 已 apply（讀它的 state）
2. 把 outputs 拿給 EKS module 用

**好處**：所有依賴宣告式、跨 module 引用不寫死 ID。

### Mock outputs

如果 VPC 還沒 apply 就跑 EKS plan 會失敗（dependency 沒輸出）。可以給 mock outputs：

```hcl
dependency "vpc" {
  config_path = "../vpc"
  mock_outputs = {
    vpc_id             = "vpc-fake"
    private_subnet_ids = ["subnet-fake1", "subnet-fake2"]
  }
  mock_outputs_allowed_terraform_commands = ["plan", "validate"]
}
```

plan 時可以跑，apply 一定要實際依賴存在才行。

## `generate` block：動態產生 .tf

除了 backend / provider，可以動態產生任何 .tf 檔：

```hcl
generate "versions" {
  path      = "versions.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
EOF
}
```

或從外部模板：

```hcl
generate "common_tags" {
  path      = "common_tags.tf"
  if_exists = "overwrite_terragrunt"
  contents  = templatefile("${get_terragrunt_dir()}/tags.tftpl", {
    env  = local.env
    team = "platform"
  })
}
```

## `run-all`：批次操作

對整個 env 跑 plan / apply：

```bash
# 在 dev/ap-northeast-1/ 跑
terragrunt run-all plan
terragrunt run-all apply
```

Terragrunt 看 `dependency` 自動算依賴順序：

```
VPC → SG → ALB → EKS
        ↘ RDS
```

從沒依賴的開始平行跑。比手動切 vpc → eks → rds 依序 apply 快。

**注意：**`run-all destroy` 很危險，會把整 env 砍掉。生產環境慎用，或乾脆禁用：

```hcl
terraform {
  before_hook "no_destroy_all" {
    commands = ["destroy-all", "run-all destroy"]
    execute  = ["sh", "-c", "echo 'BLOCKED' && exit 1"]
  }
}
```

## Terragrunt vs Vanilla Terraform 比較

| 面向 | Vanilla Terraform | Terragrunt |
|------|------------------|-----------|
| 多環境 DRY | 各 env 重複 | `include` + `env.hcl` 集中 |
| Backend 設定 | 每 env 寫一次 | generate 自動產生 |
| 跨 module 依賴 | 手動 ID / `terraform_remote_state` data source | `dependency` 宣告式 |
| 批次操作 | 自寫 shell script | `run-all` 內建 |
| 學習曲線 | 標準 | + 一層 Terragrunt 語法 |
| 工具支援 | 完整 | tflint / tfsec 通用，但 CI 整合要適應 |
| 社群 | HashiCorp / Hashicorp | Gruntwork |

**何時用 Terragrunt：**
- 多環境（dev / staging / prod）+ 多 region
- 多個獨立 module 有相互依賴
- 團隊 ≥ 5 人協作
- 已被 DRY violation 折磨過

**何時不用：**
- 只有單一環境
- module 少
- 團隊小、設定簡單
- 不想多一層工具

## 跟 OpenTofu / CDK / Pulumi 的競爭

**OpenTofu**：HashiCorp 改 BUSL license 後社群 fork，跟 Terraform 100% 相容（目前），自由度高。Terragrunt 已支援 OpenTofu。

**CDK / CDK for Terraform (CDKTF)**：用程式語言（TS / Python）寫 infra，背後編譯成 Terraform / CloudFormation。可程式化能力強，但學習曲線陡，社群比 Terraform 小。

**Pulumi**：類 CDK，用一般語言寫 infra，自帶 state、有 SaaS。Multi-cloud、開發者體驗好，但收費（OSS 也有但功能少）。

**選擇：**

- 主流團隊：Terraform + Terragrunt 多環境
- 已 all-in HashiCorp 改 BUSL 不爽：OpenTofu + Terragrunt
- 開發者背景重、要寫複雜邏輯：Pulumi 或 CDKTF
- 純 AWS 想要原生整合：CloudFormation / SAM / AWS CDK

## 常見坑與排查

### 1. `path_relative_to_include()` 拿錯 path

把 `terragrunt.hcl` 內 `find_in_parent_folders()` 跟 `path_relative_to_include` 搞混。

- `find_in_parent_folders()`：向上找指定檔案（常用找 root `terragrunt.hcl`）
- `path_relative_to_include()`：當前 module 相對於 include 的 root 的路徑
- `path_relative_from_include()`：反向

### 2. dependency 抓不到 output

```
Error: ... has no output named "vpc_id"
```

可能原因：
- VPC module 沒 apply（沒 state）
- VPC module 沒 `output "vpc_id"`
- mock_outputs 沒設，plan 時找不到

debug：

```bash
cd ../vpc
terragrunt output           # 確認有沒有那個 output
```

### 3. run-all 太多平行卡死

依賴複雜時平行度太高會炸 API rate limit。降低：

```bash
terragrunt run-all plan --terragrunt-parallelism 4
```

或 `.terraformrc` 限制 provider concurrency。

### 4. backend key 衝突

不同 env 不小心用同一個 backend key → state 互相覆蓋。Terragrunt 預設用 `path_relative_to_include()` 避開這問題，但手動寫 backend 時要小心。

### 5. 改 root terragrunt.hcl 影響所有 module

root 變動會影響全部，要小心。實務做法：
- root 設定盡量穩定
- backend bucket / DynamoDB 不要常動
- 改 generate 內容前在一個 module 試

## 面試常考重點

**1. Terragrunt 解決什麼問題？**  
原生 Terraform 多環境會 DRY violation（dev / staging / prod 每個都有重複的 backend.tf / provider.tf / main.tf）。Terragrunt 用 include + generate + env.hcl 集中管理共用部分，環境差異只放 env.hcl。

**2. Terragrunt 跟 Workspace 差在哪？**  
Workspace 只切 state，共用 code，差異只能靠 `terraform.workspace` 變數寫 if-else（容易亂）。Terragrunt 用實體資料夾 + include 模式，差異明顯、適合 dev/prod 規模差異大的情境。**正式團隊大都選 Terragrunt 而不是 workspace**。

**3. `dependency` vs `terraform_remote_state` data source？**  
都能跨 module 拿 output。`terraform_remote_state` 是原生 Terraform 功能，需要硬寫 backend config。`dependency` 是 Terragrunt 的抽象，宣告式更乾淨、跟 run-all 整合好（自動算順序）。

**4. `generate` block 怎麼用？**  
動態產生 .tf 檔（backend / provider / common config）。讓每個 module 不用重複寫共用設定。執行時 Terragrunt 寫到 module 目錄，跑 `terraform init`。

**5. `run-all` 安全嗎？**  
plan 安全，destroy 危險。`run-all destroy` 會把整個 env 砍掉，要明確限制（hook 阻擋）。prod 不該用 run-all destroy。

**6. 為什麼不直接寫 shell script 包 Terraform？**  
- 沒處理跨 module 依賴順序
- 沒處理 backend 共用
- 沒處理 dependency outputs 拿取
- 沒社群 / 文檔支援
- 沒 standardize 工程實踐

Terragrunt 是「標準化的 shell script」，省自己造輪子。

**7. Terragrunt 跟 CDK / Pulumi 怎麼選？**  
Terragrunt：仍在 HCL 生態，輕度 wrapper，學習曲線淺。CDK / Pulumi：用程式語言寫 infra，可寫複雜邏輯，但社群小於 Terraform 主流。多數團隊還是 Terraform + Terragrunt，CDK / Pulumi 是少數選擇。

**8. Terragrunt 怎麼整合 CI/CD？**  
跟 Terraform 類似但跑 `terragrunt` 不是 `terraform`。GitHub Actions 範例：

```yaml
- run: terragrunt run-all plan
- run: terragrunt run-all apply -auto-approve  # 只 main branch
```

OIDC + IAM role 跟 vanilla 一樣。Atlantis 也有 Terragrunt 支援。

**9. Terragrunt 跟 OpenTofu 相容嗎？**  
是。Terragrunt 是 wrapper，可以指定底層 binary：

```hcl
terraform_binary = "tofu"
```

社群在 HashiCorp BUSL 之後很多人 migrate 到 OpenTofu，Terragrunt 直接支援。

**10. `include "root"` 跟 `include` 一個 module 怎麼分？**  
`include` 標準用法是「include parent terragrunt.hcl」，傳統 syntax。新 syntax 可以 named include：

```hcl
include "root" {
  path = find_in_parent_folders()
}
```

允許 multi-level include，例如 include root + include common envcommon。實務 named include 比較常用。

**11. Terragrunt 的缺點？**  
- 多一層工具學習
- 錯誤訊息有時不直觀（要看 underlying Terraform）
- 跟某些工具整合要適應（Terraform Cloud / Spacelift 直接支援 vanilla，Terragrunt 要看版本）
- HCL 內巢狀 include / dependency / generate 可能複雜
- 大專案 run-all parallelism 要調

**12. Terragrunt 適合所有專案嗎？**  
不是。小專案、單一環境、少 module 用 vanilla Terraform 就好。Terragrunt 是 mid-size 以上專案的工程化選擇。**用之前先確認 DRY 真的痛**，否則只是多一層複雜度。

## 小結

Terragrunt 把 Terraform 從「能用」升級到「工程化」：

| 痛點 | Terragrunt 解法 |
|------|----------------|
| 多環境 DRY | include + env.hcl |
| Backend / provider 重複 | generate block |
| 跨 module 依賴 | dependency + outputs |
| 批次操作 | run-all |
| 環境差異 | env.hcl + region.hcl 集中 |

**面試心法：**
- 講出原生 Terraform 多環境的痛
- 知道 `dependency` vs `terraform_remote_state` 差異
- 強調 `run-all destroy` 危險性
- 提到 Terragrunt + OpenTofu 是 BUSL 後的常見組合
- 知道何時不該用 Terragrunt（小專案）

跟你做的 IaC Monitoring System 對照：你的 side project 規模不需要 Terragrunt，但**履歷面試被問「規模做大怎麼辦」時，答 Terragrunt + dependency + run-all 是標準答案**。
