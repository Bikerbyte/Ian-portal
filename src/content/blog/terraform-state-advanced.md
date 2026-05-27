---
title: "Terraform State 進階操作與救援"
excerpt: "State 內部結構、state mv/rm/import、replace-provider、refactoring 不重建、backend migration、state 壞掉怎麼救、面試常考重點。"
date: 2026-09-11
category: "學習"
tags:
  - Terraform
  - IaC
  - DevOps
series: "IaC Lab"
seriesOrder: 9
featured: false
---

## Agenda

- State 內部結構是什麼
- `terraform state` 子指令總覽
- state mv：重構 resource 不重建
- state rm：把資源踢出 Terraform 管理
- state import 進階用法
- replace-provider：Provider 改名 / 換 source
- moved block：宣告式重構（1.1+）
- removed block：宣告式移除（1.7+）
- Backend migration：state 搬家
- 多人協作 state 衝突排查
- State 壞掉的救援 SOP
- 跟 Terragrunt / OpenTofu 的相容性
- 面試常考重點
- 小結

## State 內部結構是什麼

State 是個 JSON 檔，記錄「Terraform 管理的資源」的 metadata。簡化結構：

```json
{
  "version": 4,
  "terraform_version": "1.7.0",
  "serial": 42,
  "lineage": "8a7b6c5d-...",
  "outputs": {
    "vpc_id": { "value": "vpc-abc", "type": "string" }
  },
  "resources": [
    {
      "mode": "managed",
      "type": "aws_instance",
      "name": "web",
      "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
      "instances": [
        {
          "schema_version": 1,
          "attributes": {
            "id": "i-abc123",
            "ami": "ami-...",
            "instance_type": "t3.small",
            "tags": { "Name": "web" }
          },
          "dependencies": ["aws_vpc.main"]
        }
      ]
    }
  ]
}
```

**關鍵欄位：**

- `version`：state 格式版本（state schema，不是 Terraform 版本）
- `serial`：每次 apply 遞增，避免兩個 state 蓋對方
- `lineage`：唯一 ID，state init 時生成，防止「不同 state 互相覆蓋」
- `resources[]`：實際資源列表，每個有 type + name + attributes
- `dependencies`：算 graph 用

**為什麼 state 重要：**

Terraform 比較三方：
1. `.tf` 描述的目標
2. Provider 報告的實況
3. State 記錄的上次管理狀態

任何兩方不一致都會被偵測。沒 state Terraform 不知道資源是誰建的、要不要管。

## `terraform state` 子指令總覽

```bash
terraform state list                    # 列所有資源
terraform state show <addr>             # 顯示某資源的 attributes
terraform state mv <src> <dst>          # 重命名 / 移動 resource address
terraform state rm <addr>               # 從 state 移除（不刪實體）
terraform state pull > backup.tfstate   # 取下 remote state
terraform state push backup.tfstate     # 推回（危險）
terraform state replace-provider <old> <new>   # 換 provider source

# Refresh & taint
terraform refresh                        # 把實況同步進 state
terraform apply -refresh-only            # 同上但比較安全（要 review）
terraform apply -replace=<addr>          # 強制重建（取代舊的 taint）
```

**重要：所有 `state` 操作前**：

```bash
terraform state pull > backup-$(date +%s).tfstate
```

備份是救命線。

## state mv：重構 resource 不重建

**情境**：你把 `aws_instance.web` rename 成 `aws_instance.frontend`，直接改 `.tf` 跑 plan 會顯示「destroy old + create new」 — 但你只是改名而已，不該重建。

**解法 A：state mv（命令式）**

```bash
terraform state mv aws_instance.web aws_instance.frontend
terraform plan
# No changes ✅
```

**情境 2**：把 resource 從根目錄搬到 module。

```bash
# Before: aws_instance.web in main.tf
# After:  module.compute.aws_instance.web in module compute/

terraform state mv aws_instance.web module.compute.aws_instance.web
```

**情境 3**：count → for_each 重構

```bash
# Before: aws_instance.web[0], [1], [2]
# After:  aws_instance.web["a"], ["b"], ["c"]

terraform state mv 'aws_instance.web[0]' 'aws_instance.web["a"]'
terraform state mv 'aws_instance.web[1]' 'aws_instance.web["b"]'
terraform state mv 'aws_instance.web[2]' 'aws_instance.web["c"]'
```

**注意**：address 內有 `[]` 或 `"` 要用單引號包，不然 shell 會解釋。

## state rm：把資源踢出 Terraform 管理

**情境**：某個資源你想改成手動管理（或交給別的 Terraform），不要 destroy 重建。

```bash
terraform state rm aws_instance.web
```

State 內這筆資料消失，但**實體 instance 還在 AWS**。

之後 `terraform plan` 會顯示「要 create `aws_instance.web`」，因為 .tf 還在但 state 沒了。要嘛把 .tf 也刪、要嘛 `terraform import` 重新 import。

**常見用途：**

- 拆 monorepo：一份大 state 拆成多個小 state，先 `state rm` 再到新 root `import`
- Decommission Terraform 管理（移交手動）
- 救援：壞掉 / 卡住的 resource 先踢出 state 跳出循環

## state import 進階用法

把現有資源納入 Terraform：

```bash
# 1. 在 .tf 寫好空殼 resource block
resource "aws_instance" "legacy" {}

# 2. import
terraform import aws_instance.legacy i-0abc123

# 3. plan 看差異，補 .tf 到 plan 為 No changes
```

**1.5+ 用 import block 取代 CLI**：

```hcl
import {
  to = aws_instance.legacy
  id = "i-0abc123"
}

resource "aws_instance" "legacy" {
  # 之後補欄位
}
```

跑 `terraform plan -generate-config-out=generated.tf`：

```
generated.tf created with:

resource "aws_instance" "legacy" {
  ami           = "ami-..."
  instance_type = "t3.small"
  # ... 自動生成所有 attributes
}
```

**大量 import** 用 import block 比 CLI 一個一個快很多。

**注意：**

- import 不會驗證 .tf 跟實際差異，要自己 plan 看
- 某些 resource 不能 import（看 provider 文件）
- 複雜資源（aws_iam_policy + attachments）要 import 多筆

## replace-provider：Provider 改名 / 換 source

**情境**：HashiCorp 把 provider 從 `terraform-providers/aws` 改名為 `hashicorp/aws`，舊 state 還記錄舊 path → 升級報錯。

```bash
terraform state replace-provider \
  registry.terraform.io/-/aws \
  registry.terraform.io/hashicorp/aws
```

或從 HashiCorp 改 OpenTofu 自己的 provider mirror：

```bash
terraform state replace-provider \
  registry.terraform.io/hashicorp/aws \
  registry.opentofu.org/hashicorp/aws
```

State 內的 provider reference 全部換掉，不動 `.tf`。

## moved block：宣告式重構（1.1+）

`state mv` 是 CLI 命令式，每個工程師都要跑一次。**`moved` block 是宣告式**，寫在 .tf 內，所有人 apply 都自動處理：

```hcl
# 原本 aws_instance.web，rename 成 aws_instance.frontend
resource "aws_instance" "frontend" {
  # ... 設定
}

moved {
  from = aws_instance.web
  to   = aws_instance.frontend
}
```

Apply 時 Terraform 自動：
1. 看 moved block
2. 在 state 內把 `aws_instance.web` 改名為 `aws_instance.frontend`
3. 不 destroy / not create

**好處：** 比 `state mv` 安全（進 git review），跨環境一致。

**等所有環境都 apply 完**，可以把 moved block 刪掉。

## removed block：宣告式移除（1.7+）

對應 `state rm` 的宣告式版本：

```hcl
# 不要 destroy 這資源，只從 state 移除
removed {
  from = aws_instance.legacy
  lifecycle {
    destroy = false
  }
}
```

Apply 時把 `aws_instance.legacy` 從 state 拿掉但不 destroy 實體。

```hcl
# 把資源真的 destroy + 從 state 拿掉
removed {
  from = aws_instance.legacy
  lifecycle {
    destroy = true
  }
}
```

跟「在 .tf 直接刪 resource block」效果一樣，但 **declarative 比較明確**（review 時看得到意圖）。

## Backend migration：state 搬家

**情境**：把 local state 搬到 S3，或從一個 S3 bucket 搬到另一個。

```hcl
# Step 1: 加 backend 設定
terraform {
  backend "s3" {
    bucket = "myorg-new-tfstate"
    key    = "infra/terraform.tfstate"
    region = "ap-northeast-1"
  }
}
```

```bash
# Step 2: 跑 init，Terraform 偵測到 backend change
terraform init -migrate-state

# Terraform 問：
# Do you want to copy existing state to the new backend?
# Enter a value: yes
```

State 自動從舊位置搬到新位置。

**注意：**

- 一定先 `terraform state pull > backup.tfstate` 備份
- 搬完跑 `terraform plan` 確認 state 正確
- 舊 backend 內的 state 不會被刪，要手動清

**從 local 搬 remote** 是常見場景（PoC 開發完正式化）。

## 多人協作 state 衝突排查

**情境：** 兩人同時 apply，看到：

```
Error: Error acquiring the state lock

Lock Info:
  ID:        ab12cd34-...
  Path:      myorg-tfstate/prod/terraform.tfstate
  Operation: OperationTypeApply
  Who:       alice@laptop
  Created:   2026-09-10 14:23:00 UTC
  Info:      
```

**正確做法：**

1. 等對方完成
2. Slack 問「alice 你在跑 apply 嗎？」
3. 如果對方 kill 了沒解鎖：

```bash
terraform force-unlock ab12cd34-...
```

**錯誤做法：**

- 直接 `force-unlock` 不問 → 對方真在跑你就把 state 搞亂
- 刪 DynamoDB 內 lock entry → 同上

**最佳實踐：**

- CI/CD 集中跑 apply，不靠人本機
- Apply 前 Slack 公告
- Apply 進行中改 `.tf` 文件先讓 PR 暫不 merge

## State 壞掉的救援 SOP

### 場景 1：state file corrupted

```
Error: Failed to read state file
```

**救援：**

1. S3 backend + versioning：rollback 到上一版

```bash
aws s3api list-object-versions --bucket myorg-tfstate \
  --prefix infra/terraform.tfstate

aws s3api copy-object --bucket myorg-tfstate \
  --copy-source 'myorg-tfstate/infra/terraform.tfstate?versionId=<good-version>' \
  --key infra/terraform.tfstate
```

2. 本機備份：上次 `state pull` 的 backup

```bash
terraform state push backup.tfstate
```

3. 都沒備份 → 從零 import 所有資源（最慘但可行）

### 場景 2：state 跟實況不符（drift）

```
Plan: 5 to add, 0 to change, 3 to destroy
# 但你沒改任何 .tf
```

Drift detection：

```bash
terraform plan -refresh-only       # 看 state 跟實況差異
# 看完決定：
terraform apply -refresh-only       # 把實況同步進 state
# 或：
# 改 .tf 接受實況，或還原實況
```

### 場景 3：apply 跑到一半失敗

state 可能進入 inconsistent 狀態（某些 resource 已 create 但 state 沒寫到）。

```bash
# 1. 看哪些 resource 真的建好了
terraform state list
aws ec2 describe-instances --filters Name=tag:Name,Values=web

# 2. 沒在 state 但實際存在 → import
terraform import aws_instance.web i-abc

# 3. 在 state 但實際沒建好 → state rm + re-apply
terraform state rm aws_instance.broken
terraform apply
```

### 場景 4：lineage 衝突

兩個 state 不該合併（不同 lineage），但有人 `state push` 蓋掉了：

```
Error: Lineage mismatch
```

回到 S3 versioning rollback。沒備份就慘了。

## 跟 Terragrunt / OpenTofu 的相容性

**Terragrunt：** 上層 wrapper，state 操作底層還是 terraform。`terragrunt state list` 直接傳給 terraform。

**OpenTofu：** 跟 Terraform state 100% 相容（目前），`tofu state` 子指令一樣。從 Terraform 切換到 OpenTofu 不需要動 state。

注意：未來 OpenTofu 跟 Terraform 可能分歧（不同新功能），到時 state 結構可能不相容。

## 面試常考重點

**1. State 是什麼？為什麼這麼重要？**  
State 是 JSON 檔，記錄 Terraform 管理的資源 metadata。Terraform 靠比對「.tf 目標 / Provider 實況 / State 上次記錄」算 plan。沒 state 就不知道資源是誰建的、跟現實對得起來嗎、要不要管。

**2. `terraform state mv` vs `moved block`？**  
功能一樣（state 內 rename），差別在執行方式：`state mv` 是 CLI 命令式（每個人本機跑一次），`moved` block 寫在 .tf 是宣告式（進 git，review，所有人 apply 自動處理）。**新做法都用 moved block**。

**3. 怎麼處理「我把 resource rename 了，Terraform 想 destroy 再 create」？**  
- 用 `moved` block（推薦，宣告式）
- 用 `terraform state mv`（CLI 命令式）

**不要直接 apply**（會 destroy + recreate）。

**4. import 多個資源怎麼做？**  
1.5+ 用 declarative import block，搭配 `terraform plan -generate-config-out=generated.tf` 自動生資源 block。比 CLI 一個一個 import 快 10×。大量 legacy 資源遷移必備。

**5. state file 不見了怎麼辦？**  
按優先序：
1. S3 versioning rollback（前提：開了 versioning）
2. 本機備份（`terraform state pull > backup`）
3. 從零 `terraform import` 所有資源（痛苦但可行）
4. 認賠手動同步

預防 > 救援：**S3 backend 一定開 versioning**。

**6. 兩人同時 apply 卡 lock 怎麼辦？**  
等對方跑完。如果對方真的失聯 / 程式 kill 沒解鎖才用 `terraform force-unlock <LOCK_ID>`。**先問清楚**再 force unlock，不然真在跑會搞壞。長期解：CI/CD 集中跑，不靠本機 apply。

**7. 怎麼把 state 從 local 搬 S3？**  
1. `.tf` 加 backend "s3" 設定
2. `terraform init -migrate-state`
3. Terraform 問是否複製 state，回 yes
4. 跑 `terraform plan` 確認沒變化
5. 刪本機 `terraform.tfstate`（已存在 S3）

**8. `terraform state rm` 跟 `terraform destroy` 差在哪？**  
`destroy`：實體被刪 + state 也清。`state rm`：只清 state，**實體還在**。Use case：要把 resource 從 Terraform 管理移到別處（手動 / 別的 Terraform）。**用錯後果嚴重**：以為清 state 卻 destroy 了 prod RDS。

**9. lineage 是什麼？為什麼有用？**  
state init 時生成的唯一 ID。防止「兩個不同的 state 互相覆蓋」：如果你 `state push` 一個不同 lineage 的 state，Terraform 拒絕，避免把 dev state 推到 prod 之類的災難。

**10. drift detection 怎麼做？**  
定期排程跑：

```bash
terraform plan -refresh-only -detailed-exitcode
# exit code 2 = 有差異
```

差異發 Slack alert。常見原因：手動改 Console、別的腳本動到、HPA / ASG 自動變更。對外部正常變更用 `lifecycle.ignore_changes`。

**11. provider rename 怎麼處理 state？**  
`terraform state replace-provider <old> <new>`。例：HashiCorp BUSL 後切 OpenTofu，可能要 replace provider source。改 .tf 之外也要動 state，因為 state 內每個 resource 都記錄 provider 來源。

**12. State 包含敏感資訊嗎？**  
**是**。某些 attribute（DB password、private key、API token）會明文存 state。對策：
- S3 backend `encrypt = true`
- KMS 加密
- IAM 嚴格限制誰能讀 state bucket
- 真正敏感的不要 store in TF，改用 Secrets Manager + data source 查

## 小結

State 是 Terraform 的命脈：

| 操作 | 用途 |
|------|------|
| `state list / show` | 查看 |
| `state mv` / `moved` | rename / 重構 |
| `state rm` / `removed` | 從 TF 管理移除 |
| `state pull / push` | 備份 / 還原 |
| `state replace-provider` | provider 改 source |
| `import` block | 既有資源納入 |
| `force-unlock` | 解鎖（小心） |
| `refresh / -refresh-only` | 同步實況 |
| `-replace` | 強制重建 |
| backend migrate | 搬家 |

**面試心法：**
- 強調 state 重要性（backup、versioning、lock）
- 知道 `moved` / `removed` block 是新做法（取代 `state mv` / `state rm`）
- 講出 `state rm` vs `destroy` 差異
- 知道 state 救援 SOP（versioning → backup → import）
- 提到 lineage 防覆蓋

至此 **IaC Lab 系列共 9 篇** + **SRE 核心 + Observability 深入** 補完。整套筆記針對你履歷上的弱項（K8s/Ansible/Terraform/SRE/Observability）都有覆蓋面試會深問的內容。
