---
title: "IaC 學習筆記 & 實作紀錄 - Terraform"
excerpt: "Terraform 從零到面試不怕被問：Provider、State、Module、Remote Backend、Workspace、Lifecycle、count/for_each、Import、面試重點。"
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
- 環境假設與安裝
- 第一個 Terraform 專案
- 核心指令與工作流程
- State 觀念與生命週期
- Variables、Outputs、Locals
- Data Source vs Resource
- Module 結構化
- Remote Backend 與 State Locking
- Workspaces 環境隔離
- Resource Lifecycle（create_before_destroy、ignore_changes、prevent_destroy）
- count、for_each、dynamic block
- Import 既有資源
- Sensitive 與密鑰管理
- Drift、Refresh、Replace
- Terraform 與其他工具比較
- 面試常考重點
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

## Locals

`variable` 是給外部傳入用的，`locals` 是內部運算結果的暫存：

```hcl
locals {
  common_tags = {
    Project     = "demo"
    Environment = var.env
    ManagedBy   = "terraform"
  }

  bucket_name = "${var.project}-${var.env}-${random_id.suffix.hex}"
}

resource "aws_s3_bucket" "log" {
  bucket = local.bucket_name
  tags   = local.common_tags
}
```

`locals` 不能從外部覆寫，適合放重複用的運算結果跟組合字串。

## Data Source vs Resource

- **`resource`**：Terraform 建立、管理、刪除的資源。
- **`data`**：唯讀，**查詢**現有資源資訊，不會建立也不會刪除。

```hcl
# 查現有 VPC
data "aws_vpc" "main" {
  filter {
    name   = "tag:Name"
    values = ["prod-vpc"]
  }
}

# 在那個 VPC 內建 subnet
resource "aws_subnet" "app" {
  vpc_id     = data.aws_vpc.main.id
  cidr_block = "10.0.10.0/24"
}
```

實務上：基礎設施 VPC、IAM 等共用資源用 `data` 查詢，新增的應用層資源用 `resource` 管理。

## Module 結構化

Module 是 Terraform 的「可重用包」。任何一個資料夾只要有 `.tf` 檔，就可以當 module 引用。

典型結構：

```
modules/
  ec2-instance/
    main.tf
    variables.tf
    outputs.tf
    README.md
```

`modules/ec2-instance/main.tf`：

```hcl
resource "aws_instance" "this" {
  ami           = var.ami_id
  instance_type = var.instance_type
  subnet_id     = var.subnet_id
  tags          = var.tags
}
```

`modules/ec2-instance/variables.tf`：

```hcl
variable "ami_id"        { type = string }
variable "instance_type" { type = string, default = "t3.micro" }
variable "subnet_id"     { type = string }
variable "tags"          { type = map(string), default = {} }
```

呼叫端：

```hcl
module "web" {
  source        = "./modules/ec2-instance"
  ami_id        = data.aws_ami.amazon_linux.id
  subnet_id     = data.aws_subnet.public.id
  instance_type = "t3.small"
  tags = {
    Name = "web-01"
  }
}

# 取 module output
output "web_ip" {
  value = module.web.public_ip
}
```

`source` 可以是：

- 本地路徑 `./modules/...`
- Git `git::https://github.com/org/repo.git//modules/vpc?ref=v1.2.0`
- Terraform Registry `terraform-aws-modules/vpc/aws`，可以指定 `version`

**版本鎖定**很重要，正式環境不要 source 指 main branch，會被上游隨時影響。

## Remote Backend 與 State Locking

預設 state 存本地 `terraform.tfstate`，但團隊協作會有兩個問題：
1. State 沒共享，每個人 apply 結果不一致
2. 兩個人同時 apply 會壞掉

解法是 **Remote Backend**。最常見組合：**S3 存 state + DynamoDB 做 locking**。

```hcl
terraform {
  backend "s3" {
    bucket         = "my-tfstate-bucket"
    key            = "prod/network.tfstate"
    region         = "ap-northeast-1"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }
}
```

DynamoDB table 結構：

```hcl
resource "aws_dynamodb_table" "tf_lock" {
  name         = "terraform-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

機制：

- S3 存 state JSON、開 versioning（出事可以 rollback）、開 encryption
- DynamoDB 存 lock，apply 時寫入 lock record，結束才釋放
- 第二個人同時 apply 會等鎖或直接報 `Error acquiring the state lock`

如果 lock 卡住（人 kill 了 apply），可以 `terraform force-unlock <LOCK_ID>`，但要先確認真的沒人在跑。

## Workspaces 環境隔離

同一份程式碼跑 dev/staging/prod，最簡單的方式是 **workspace**，會在同一個 backend 下用不同 prefix 存 state：

```bash
terraform workspace new dev
terraform workspace new prod
terraform workspace list
terraform workspace select prod
```

在 code 裡用 `terraform.workspace`：

```hcl
locals {
  env = terraform.workspace
  instance_count = local.env == "prod" ? 3 : 1
}
```

**注意**：Workspace 只隔離 state，**共用同一份程式碼**。差異大的環境（不同 VPC 結構、不同帳號）建議用「不同資料夾 + 不同 backend」隔離，或上 **Terragrunt**。

## Resource Lifecycle

`lifecycle` block 控制 Terraform 怎麼處理變更：

```hcl
resource "aws_instance" "web" {
  ami           = var.ami_id
  instance_type = "t3.small"

  lifecycle {
    create_before_destroy = true   # 先建新的、再砍舊的（避免 downtime）
    prevent_destroy       = true   # 防止意外砍掉（手動移除這行才能刪）
    ignore_changes        = [tags] # 忽略某些 attribute 的變化
  }
}
```

常見使用情境：

- **`create_before_destroy`**：LB、ASG 換 launch template 時保持 zero-downtime。
- **`prevent_destroy`**：保護資料庫、S3 bucket 等不可逆資源。
- **`ignore_changes`**：忽略 AWS Console 手動加的 tag、忽略 ASG 自動調整的 desired_capacity。

## count、for_each、dynamic block

**`count`**：用整數重複資源。

```hcl
resource "aws_instance" "worker" {
  count         = 3
  ami           = var.ami_id
  instance_type = "t3.micro"
  tags = {
    Name = "worker-${count.index}"
  }
}
```

`count` 的限制：中間刪掉一個會讓後面的 index 全部位移，整個 plan 變一坨重建。

**`for_each`**：用 map 或 set，**比 count 安全**。

```hcl
variable "users" {
  type = map(object({
    role  = string
    email = string
  }))
  default = {
    alice = { role = "admin",     email = "alice@example.com" }
    bob   = { role = "developer", email = "bob@example.com" }
  }
}

resource "aws_iam_user" "this" {
  for_each = var.users
  name     = each.key
  tags = {
    Role  = each.value.role
    Email = each.value.email
  }
}
```

中間刪 `alice` 只會砍 alice，其他不動。

**`dynamic block`**：動態產生巢狀 block，常用在 SG rules：

```hcl
resource "aws_security_group" "web" {
  name = "web"

  dynamic "ingress" {
    for_each = var.allowed_ports
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
}
```

## Import 既有資源

要把手動建立或別人管理的資源納入 Terraform，用 `import`：

```bash
# 1. 先在 .tf 寫好 resource block（內容會被覆蓋，先用空殼）
# 2. import 進 state
terraform import aws_instance.web i-0abcd1234

# 3. terraform plan 會顯示差異
# 4. 把 .tf 補完到跟實際資源一致，直到 plan 是 No changes
```

Terraform 1.5+ 支援 declarative import block（不用 CLI）：

```hcl
import {
  to = aws_instance.web
  id = "i-0abcd1234"
}
```

跑 `terraform plan -generate-config-out=generated.tf` 還能自動生 resource block。

## Sensitive 與密鑰管理

**標記 sensitive**，避免在 plan/apply 輸出洩漏：

```hcl
variable "db_password" {
  type      = string
  sensitive = true
}

output "db_endpoint" {
  value     = aws_db_instance.this.address
  sensitive = false
}
```

**真正的密鑰來源**不應該寫在 `.tf` 或 `.tfvars`（會進 git）。實務做法：

- AWS Secrets Manager / SSM Parameter Store + `data` 讀取
- Vault provider
- CI/CD 注入環境變數（`TF_VAR_db_password`）

**注意**：sensitive 變數的值還是會明文存在 state file 內，因此 state 一定要加密、限制存取。

## Drift、Refresh、Replace

**Drift（漂移）**：Terraform 以外的人/工具改了資源（手動改 Console、別的腳本動了），導致實際狀態跟 state 不一致。

```bash
# 把實際狀態抓回來更新 state
terraform refresh

# 或直接 plan -refresh-only 看差異
terraform plan -refresh-only

# 強制重建某個資源（取代舊版的 taint）
terraform apply -replace="aws_instance.web"

# 只對某個資源做變更（debug 用，正式環境少用）
terraform apply -target="module.vpc.aws_subnet.public[0]"
```

**plan -out 保存後 apply**：CI/CD 標準作法，避免 plan 跟 apply 之間環境有變化。

```bash
terraform plan -out=tfplan
terraform apply tfplan
```

## Terraform 與其他工具比較

| 工具 | 語言 | State | 多雲 | 特色 |
|------|------|-------|------|------|
| **Terraform** | HCL（宣告式） | 有 | ✅ | Provider 生態最廣 |
| **CloudFormation** | YAML/JSON | AWS 管 | ❌ 只支援 AWS | AWS 原生整合好 |
| **Pulumi** | Python/TS/Go | 有 | ✅ | 用一般程式語言 |
| **Crossplane** | K8s CRD | etcd | ✅ | K8s-native，GitOps 友好 |
| **CDK / CDKTF** | TS/Python | 視底層 | ✅ | 用程式語言但編譯成 CFN/Terraform |

選 Terraform 的常見原因：multi-cloud、社群 module 豐富、宣告式語法門檻低。

## 面試常考重點

**1. Terraform 跟 Ansible 差在哪？**  
Terraform 偏「基礎設施佈建」（建 VPC、EC2、RDS），Ansible 偏「設定管理」（裝套件、改設定檔）。Terraform 有 state、dependency graph、drift detection；Ansible 無 state、靠每次執行直接檢查目標。**常見組合：Terraform 建主機 → Ansible 上去做設定**。

**2. State 是什麼？為什麼這麼重要？**  
State 是 Terraform 記錄「目前管理的資源 metadata」的 JSON 檔。Terraform 靠比較三方（`.tf` 目標、Provider 實況、state 上次記錄）來算出 plan。沒有 state 就不知道資源是誰建的、有沒有漂移。

**3. State 不見了怎麼辦？**  
- 有 remote backend + versioning → rollback 到上一版
- 沒備份 → 用 `terraform import` 一個一個把現有資源拉回 state
- 預防：一律用 remote backend、開 S3 versioning、定期備份

**4. 兩個人同時 apply 怎麼辦？**  
Remote backend 搭 state locking（S3+DynamoDB、Terraform Cloud）會自動鎖。第二個人會等鎖或報 `Error acquiring the state lock`。卡死可以 `terraform force-unlock`，但先確認沒人真的在跑。

**5. `count` vs `for_each` 怎麼選？**  
**幾乎都選 `for_each`**。`count` 的問題是中間刪資源會 index 位移，導致後面的全部被重建。`for_each` 用 map key 當識別，刪掉中間項目其他不受影響。`count` 比較適合「就是要 N 個一模一樣」的情境，或快速條件性建立（`count = var.enable ? 1 : 0`）。

**6. `create_before_destroy` 解決什麼問題？**  
某些資源（LB target group、ASG launch template、IAM role）有 name unique constraint，預設「先砍再建」會中斷服務或失敗。設 `create_before_destroy = true` 改成「先建新的、切換、再砍舊的」，達到 zero-downtime。

**7. 怎麼避免 `terraform apply` 砍掉重要資源？**  
- `lifecycle { prevent_destroy = true }`
- IAM Policy 拒絕 `Delete*` 對特定資源
- 開 deletion protection（RDS、ASG、S3）
- 上線前一律 review `terraform plan` 輸出

**8. Module 怎麼寫才好用？**  
- 介面小：variables 少、outputs 完整
- 一個 module 做一件事（VPC module 就只做 VPC）
- 版本鎖死（Git tag、Registry version）
- 預設值合理、可被覆寫
- 寫 README 跟範例

**9. 密鑰怎麼處理？**  
- 變數標 `sensitive = true`
- 從 Secrets Manager / Vault / SSM 動態讀，不寫在 .tf
- `.tfvars` 不進 git，CI/CD 用環境變數 `TF_VAR_xxx`
- State 加密（S3 backend `encrypt = true`、限制 IAM 存取）

**10. Workspace 適合做環境隔離嗎？**  
小團隊或差異小（只是參數不同）可以用。**正式建議用資料夾隔離**：`environments/dev/`、`environments/prod/`，每個資料夾獨立 backend、獨立 state、獨立 IAM。或上 Terragrunt 處理多環境 DRY。原因是 workspace 共用程式碼，prod 的變更很容易意外影響 dev，反之亦然。

**11. `terraform refresh` 跟 `apply` 差別？**  
`refresh` 只更新 state（把 Provider 實際狀態回寫進 state），不改變實際資源。`apply` 會比對差異後實際變更。1.x 後 `plan` 預設會 refresh，避免一些不必要的混亂可以 `plan -refresh=false`。

**12. 怎麼知道某個資源是 Terraform 還是 Console 改的？**  
跑 `terraform plan` 看是否有 changes — 若 .tf 沒改但 plan 顯示有差異，就是 drift。也可以開 AWS Config、CloudTrail 追修改來源。最佳實踐是**鎖死 Console 寫入權限**，只能透過 Terraform 變更。

## 小結

這篇從基礎一路寫到面試會被問的核心：

- **核心觀念**：宣告式、state 為中心、plan 預覽 → apply 套用
- **進階寫法**：module 結構化、`for_each` 取代 count、lifecycle 控制變更行為
- **正式環境**：remote backend + state locking、密鑰外部化、workspace/資料夾隔離環境
- **疑難雜症**：drift detection、import 既有資源、`-replace` 取代 taint、`force-unlock` 救援

跟 Ansible 對照看：

| 面向 | Terraform | Ansible |
|------|-----------|---------|
| 主要任務 | 基礎設施佈建 | 設定管理、應用部署 |
| 狀態追蹤 | State file | 無，每次跑直接檢查 |
| 觀念 | 宣告式 + state | 宣告式 + 直接檢查 |
| 典型使用 | 建 VPC/EC2/RDS | 裝套件、改設定、部署 app |

下一篇進入 Kubernetes，把容器編排這塊補齊，跟 IaC 串起來就能涵蓋大部分 DevOps 面試題。
