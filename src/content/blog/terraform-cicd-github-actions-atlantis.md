---
title: "Terraform CI/CD - GitHub Actions、OIDC、Atlantis 完整實戰"
excerpt: "把 Terraform 帶進 PR-based workflow：GitHub Actions + OIDC 免靜態 key、plan post 到 PR、Atlantis 自動 apply、tflint/tfsec/Checkov 安全掃描、面試常考重點。"
date: 2026-08-14
category: "學習"
tags:
  - Terraform
  - CI/CD
  - GitHub Actions
  - DevOps
series: "IaC Lab"
seriesOrder: 6
featured: false
---

## Agenda

- 為什麼 Terraform 需要 CI/CD
- PR-based workflow 核心觀念
- GitHub Actions + OIDC 接 AWS（無靜態 key）
- Plan 結果自動 post 回 PR
- 多環境 / 多目錄管理策略
- Atlantis 自動化 apply
- Pre-commit hooks（fmt、validate、tflint）
- 安全掃描：tfsec / Checkov / Terrascan
- Cost estimation：Infracost
- Drift detection 排程
- 常見坑與排查
- 面試常考重點
- 小結

## 為什麼 Terraform 需要 CI/CD

純 local 跑 Terraform 的問題：

- **權限分散**：每個工程師本機都有 admin credentials
- **狀態不一致**：A 改了沒 push，B apply 蓋掉
- **沒有 review**：壞改動直接進 prod
- **手動容易錯**：忘記 `terraform fmt`、忘記跑 plan
- **沒 audit trail**：誰什麼時候改了什麼？

CI/CD 解決：

- **集中認證**：CI 用 OIDC 拿臨時 credentials，工程師本機只需讀取權限
- **PR-based**：每個改動走 PR、過 review、自動 plan
- **強制 quality gates**：lint、validate、security scan 通過才能 merge
- **完整 audit**：git history + CI log + state versioning

## PR-based workflow 核心觀念

```
[工程師改 .tf]
     ↓
[git push 開 PR]
     ↓
[CI 跑]:
  1. terraform fmt -check
  2. terraform init
  3. terraform validate
  4. tflint / tfsec
  5. terraform plan
     ↓
[plan 結果 post 回 PR comment]
     ↓
[Reviewer 看 plan 確認影響範圍]
     ↓
[Merge → CI 自動 apply]
```

**關鍵原則：**

- **Plan 結果一定要被 review**：不是 review code，是 review **plan 輸出**（會建什麼、改什麼、刪什麼）
- **Apply 只有 CI 能做**：人工沒有 prod write 權限
- **失敗就停**：fmt / validate / plan / security scan 任一個 fail，不能 merge

## GitHub Actions + OIDC 接 AWS

傳統做法：把 AWS access key 存 GitHub Secrets。問題：
- key 是 long-lived
- 外洩風險高
- 輪替麻煩

**OIDC（OpenID Connect）做法：** GitHub Actions 跟 AWS 直接建立信任關係，每次 workflow 跑時用 GitHub 的 OIDC token 跟 AWS STS 換取**臨時 credentials**（15 分鐘）。

### AWS 端設定

1. **建 IAM OIDC Provider**：

```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
```

2. **建 IAM Role with trust policy 接 OIDC**：

```hcl
data "aws_iam_policy_document" "gha_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:myorg/infra:*"]      # 只允許這個 repo
    }
  }
}

resource "aws_iam_role" "gha_terraform" {
  name               = "gha-terraform"
  assume_role_policy = data.aws_iam_policy_document.gha_assume.json
}

resource "aws_iam_role_policy_attachment" "gha_terraform" {
  role       = aws_iam_role.gha_terraform.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"      # 縮到實際需要的
}
```

**重點：trust policy 的 `sub` condition** 可以鎖到 branch / environment：
- `repo:myorg/infra:ref:refs/heads/main` 只 main branch
- `repo:myorg/infra:environment:prod` 只 prod environment
- `repo:myorg/infra:pull_request` 只 PR

### GitHub Actions workflow

`.github/workflows/terraform.yml`：

```yaml
name: terraform

on:
  pull_request:
    paths: [infra/**]
  push:
    branches: [main]
    paths: [infra/**]

permissions:
  id-token: write          # 必須，給 OIDC 用
  contents: read
  pull-requests: write     # 給 PR comment 用

jobs:
  terraform:
    name: terraform
    runs-on: ubuntu-latest
    strategy:
      matrix:
        env: [dev, staging, prod]
    defaults:
      run:
        working-directory: infra/envs/${{ matrix.env }}

    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gha-terraform
          aws-region: ap-northeast-1

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.7.5

      - name: fmt check
        run: terraform fmt -check -recursive

      - name: init
        run: terraform init -input=false

      - name: validate
        run: terraform validate

      - name: tflint
        uses: terraform-linters/setup-tflint@v4
        with:
          tflint_version: latest
        # 然後 run tflint --init && tflint

      - name: tfsec
        uses: aquasecurity/tfsec-action@v1.0.3
        with:
          working_directory: infra/envs/${{ matrix.env }}

      - name: plan
        if: github.event_name == 'pull_request'
        id: plan
        run: |
          terraform plan -no-color -input=false -out=tfplan
          terraform show -no-color tfplan > plan.txt
        continue-on-error: true

      - name: comment PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const plan = fs.readFileSync('infra/envs/${{ matrix.env }}/plan.txt', 'utf8');
            const output = `### Terraform Plan – ${{ matrix.env }}
            <details><summary>Plan output</summary>

            \`\`\`hcl
            ${plan.substring(0, 60000)}
            \`\`\`

            </details>`;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: output
            });

      - name: plan status
        if: steps.plan.outcome == 'failure'
        run: exit 1

      - name: apply
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        run: terraform apply -auto-approve -input=false
```

### Plan output 怎麼漂亮 post

PR comment 直接貼 plan 不易讀。改進：

- 用 `terraform show -json | jq` 取結構化 diff
- 自製 marker 標 add / change / destroy
- 用 [GitHub Comment Action](https://github.com/dflook/terraform-github-actions)（社群 action 套件）

範例輸出：

```
### Terraform Plan – prod
Plan: 2 to add, 1 to change, 0 to destroy

✅ Adds:
  + aws_s3_bucket.logs
  + aws_s3_bucket_versioning.logs

🔧 Changes:
  ~ aws_db_instance.main (instance_class: db.t3.medium → db.t3.large)
```

## 多環境 / 多目錄管理

前篇推過 `envs/dev/`, `envs/staging/`, `envs/prod/` 結構。CI 的處理：

**Option A: matrix strategy**（上面範例）

```yaml
strategy:
  matrix:
    env: [dev, staging, prod]
```

每個 env 跑一個 job，平行。

**Option B: 偵測哪個 env 有變動才跑**

```yaml
- name: detect changed envs
  id: changes
  uses: dorny/paths-filter@v3
  with:
    filters: |
      dev: 'infra/envs/dev/**'
      staging: 'infra/envs/staging/**'
      prod: 'infra/envs/prod/**'

- name: plan dev
  if: steps.changes.outputs.dev == 'true'
  ...
```

**Option C: prod apply 需要 manual approval**

GitHub Environments：

```yaml
jobs:
  apply-prod:
    environment: production    # GitHub 端設 required reviewers
    if: github.ref == 'refs/heads/main'
    steps:
      ...
```

PR merge 後 prod apply 會卡在 environment approval，要 manager 點 approve 才繼續。

## Atlantis 自動化 apply

[Atlantis](https://www.runatlantis.io/) 是自架的 Terraform PR automation server。

**Workflow：**

1. 開 PR
2. Atlantis 看到 webhook → 自動 `atlantis plan`
3. plan 結果 post 回 PR
4. Reviewer 看完 plan，在 PR 留言 `atlantis apply`
5. Atlantis 跑 `terraform apply`

**範例設定 atlantis.yaml：**

```yaml
version: 3
projects:
  - name: dev
    dir: infra/envs/dev
    workflow: terraform

  - name: prod
    dir: infra/envs/prod
    workflow: terraform-with-approval

workflows:
  terraform:
    plan:
      steps: [init, plan]
    apply:
      steps: [apply]

  terraform-with-approval:
    plan:
      steps: [init, plan]
    apply:
      steps:
        - run: echo "Need approval"
        - apply
    apply_requirements: [approved, mergeable]
```

**Atlantis vs GitHub Actions 比較：**

| 面向 | GitHub Actions | Atlantis |
|------|---------------|---------|
| 部署 | 託管（GitHub 給） | 自架（要跑 server） |
| Trigger | event-based | PR comment 觸發 |
| Apply 方式 | merge to main 自動 | PR comment `atlantis apply` |
| Lock | 無內建 | 內建 lock per project |
| Lock UI | 無 | 內建 UI |
| 設定複雜度 | 中 | 中 |

選擇：
- 小團隊、不想多管一個服務 → GitHub Actions
- 中大團隊、需要 lock / 多人協作 / 看 status UI → Atlantis

## Pre-commit hooks

在工程師本機就阻擋常見錯誤：

`.pre-commit-config.yaml`：

```yaml
repos:
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.83.5
    hooks:
      - id: terraform_fmt
      - id: terraform_validate
      - id: terraform_tflint
        args:
          - --args=--config=.tflint.hcl
      - id: terraform_docs
        args:
          - --args=--config=.terraform-docs.yml
```

跑：

```bash
pip install pre-commit
pre-commit install        # 自動裝 git hook
```

之後每次 `git commit` 都會自動跑 fmt / validate / tflint。

## 安全掃描：tfsec / Checkov / Terrascan

| 工具 | 規則庫 | 特色 |
|------|--------|------|
| **tfsec**（已併入 Trivy） | AWS / Azure / GCP / K8s | Aqua 維護，社群活躍 |
| **Checkov** | 多 IaC（TF / CFN / K8s / Helm / Docker） | Bridgecrew / Palo Alto |
| **Terrascan** | 多 IaC | Accurics |
| **Snyk IaC** | TF / K8s | 商業，CVE 整合好 |

**tfsec 範例：**

```bash
tfsec infra/
```

輸出：

```
Result #1 HIGH (aws-s3-enable-bucket-encryption)
  /infra/modules/storage/main.tf:5
  resource "aws_s3_bucket" "data" {
    bucket = "my-data-bucket"
  }
  Bucket does not have encryption enabled
  → Set `server_side_encryption_configuration` block
```

**整合進 CI：**

```yaml
- name: tfsec
  uses: aquasecurity/tfsec-action@v1.0.3
  with:
    soft_fail: false       # critical 直接 fail
    additional_args: --minimum-severity HIGH
```

**例外處理：** 真的需要違反某條 rule（合理原因），用 inline ignore：

```hcl
#tfsec:ignore:aws-s3-enable-bucket-encryption
resource "aws_s3_bucket" "public_assets" {
  ...
}
```

但 review 時要交代為什麼。

## Cost Estimation：Infracost

Plan 階段算「這個變更會花多少錢」：

```bash
infracost breakdown --path infra/envs/prod
```

輸出：

```
Project: infra/envs/prod
+ Cost will increase by $245/month

  + aws_instance.web[0]    $30.66/mo
  + aws_instance.web[1]    $30.66/mo
  + aws_rds_instance.main  $124.10/mo
  + aws_nat_gateway.this   $45.00/mo
  ...
```

**整合 PR comment：**

```yaml
- uses: infracost/actions/setup@v3
  with:
    api-key: ${{ secrets.INFRACOST_API_KEY }}

- name: Infracost diff
  run: |
    infracost diff --path infra/envs/prod --format json --out-file diff.json
    infracost comment github --path diff.json \
      --repo ${{ github.repository }} \
      --pull-request ${{ github.event.number }} \
      --github-token ${{ secrets.GITHUB_TOKEN }}
```

PR 上會自動出現「這個變更 +$245/月」comment，PM / Eng 一目了然。

## Drift Detection 排程

state 跟實際資源不一致是常見問題（手動改、Console 動到、別的腳本動）。

**做法：定期排程跑 `terraform plan` 看有沒有意外 diff。**

```yaml
on:
  schedule:
    - cron: '0 9 * * 1-5'    # 工作日早上 9 點

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - ...
      - run: terraform plan -detailed-exitcode
        id: plan
        continue-on-error: true
      - name: alert if drift
        if: steps.plan.outputs.exitcode == '2'
        run: |
          # exit code 2 = 有 plan diff
          curl -X POST -H 'Content-Type: application/json' \
            -d '{"text":"⚠️ Terraform drift detected in prod"}' \
            ${{ secrets.SLACK_WEBHOOK }}
```

**`-detailed-exitcode`** 是關鍵：
- 0 = no changes
- 1 = error
- 2 = changes detected

## 常見坑與排查

### 1. plan 跟 apply 結果不同

Apply 前環境變了（別人手動改、其他 pipeline 跑了）。**解法：**

```bash
terraform plan -out=tfplan
terraform apply tfplan        # 一定要傳這個檔，apply 才是 plan 那刻的 snapshot
```

CI 內存 plan 檔當 artifact，apply job 載下來用。

### 2. CI 跑卡在 backend 初始化

backend 設定的 IAM role / S3 / DynamoDB 沒權限。檢查：
- OIDC role 有 S3 read/write（state bucket）
- DynamoDB read/write（lock table）
- KMS decrypt（如果 state 加密）

### 3. Plan output 太長被 GitHub 截斷

PR comment 最大 65536 字元。對策：
- 用 fold 隱藏多餘細節
- 把完整 plan 存 artifact
- 用社群 action（dflook/terraform-github-actions）

### 4. 多人同時 PR plan，state lock 卡死

兩個 PR 同時跑 plan，DynamoDB lock 互相等。**Plan 其實不需要 lock**（read only）：

```bash
terraform plan -lock=false
```

但 apply **一定要 lock**。

### 5. drift detection 一直 false positive

某些 attribute 由外部管（ASG desired_capacity、tag、RDS password）。對策：

```hcl
lifecycle {
  ignore_changes = [tags, desired_capacity]
}
```

## 面試常考重點

**1. 為什麼 Terraform 要走 CI/CD？**  
集中認證（CI 才有 prod write 權限）、PR review 強制（plan 結果 review）、quality gate（fmt / validate / security scan）、audit trail（git + CI log + state versioning）、減少人為錯誤。

**2. GitHub Actions + OIDC vs static AWS key 差在哪？**  
OIDC 用臨時 credentials（15 分鐘）、無長期 secret 在 GitHub、可細到 branch / environment 級別權限。Static key 是 long-lived、外洩風險高、輪替麻煩。**OIDC 是現代標準**。

**3. plan 跟 apply 應該分開嗎？**  
**Plan：每個 PR 自動跑，post 回 comment 給 review。Apply：只有 merge to main 才跑（或 manual approval）。** 嚴格控制：apply 只 CI 能做，工程師本機只能 plan / read state。

**4. plan output 在 PR 上 review 該看什麼？**  
- 「to destroy」的資源 — 是否該被刪
- 「to replace」(`-/+`) — 是不是會中斷服務
- 「to change」(`~`) — attribute 變化是否符合預期
- 數量是否合理（10 個資源變 1000 個 = 出事）
- 是否動到不該動的（prod DB、production VPC）

**5. Atlantis 跟 GitHub Actions 怎麼選？**  
Atlantis：PR comment 觸發 apply、內建 lock 跟 UI、適合多人協作 / 大團隊。GitHub Actions：託管不用維運、設定簡單、適合中小團隊。能力上各有優劣，看團隊規模跟需求。

**6. 怎麼避免 prod apply 出意外？**  
- GitHub Environments + required reviewers（merge 後 prod apply 卡住等批准）
- IAM 限制：CI role 只能 in business hours apply
- `terraform plan -detailed-exitcode` 偵測差異，意外 diff 不准 apply
- `lifecycle { prevent_destroy = true }` 鎖關鍵資源
- 開 deletion protection（RDS、ALB）
- Cost estimation post 到 PR，超預算 warn

**7. tfsec / Checkov 該擋什麼？**  
- 沒加密的 S3 / EBS / RDS
- 對 0.0.0.0/0 開放的 SG
- public IAM policy（`Principal: "*"`）
- VPC flow log 沒開
- KMS key 沒設 rotation
- Lambda 沒設 timeout
- 各種 CIS Benchmark 違反

依專案調整 severity threshold。

**8. drift detection 怎麼做？**  
排程 cron 跑 `terraform plan -detailed-exitcode`，exit code 2 = 有 diff，發 Slack alert。常見原因：手動改 Console、其他自動化動到、第三方系統（HPA / ASG）外部變更。對外部正常變更用 `ignore_changes` 過濾。

**9. plan 跑很久怎麼辦？**  
- 切小 root（多個獨立 state）
- 用 `-refresh=false` skip refresh（快但可能漏 drift）
- 升 Terraform 版本
- 用 Terragrunt cache provider
- 多開 CI 平行（matrix）

**10. CI 內 plan 寫到 PR comment 太長怎麼辦？**  
- `<details>` 折疊
- 用 jq parse plan 算 add/change/destroy 摘要再 post
- 完整 plan 存 artifact，comment 給 link
- 用社群 action（dflook 等）

**11. Module 改 module，所有引用該 module 的 root 都該重跑 plan 嗎？**  
是。CI 該偵測：module 變更時 plan 全部依賴它的 envs。否則 module bug 上 main 後直到下次正式 plan 才會被發現。

**12. 怎麼處理 break change 的 Terraform / Provider 升級？**  
- 升級先在 dev 環境
- `terraform plan` 看是否所有資源都顯示無變化
- Provider major version 升級必看 release notes（有時資源 schema 變、state 要 migrate）
- `terraform state mv` / `state replace-provider` 處理 path 變化
- 大規模升級先寫 staging soak

## 小結

Terraform CI/CD 的完整 stack：

| 階段 | 工具 |
|------|------|
| Lint | terraform fmt, tflint |
| Validate | terraform validate |
| Security | tfsec, Checkov |
| Cost | Infracost |
| Plan/Apply | GitHub Actions / Atlantis |
| 認證 | OIDC（無 static key） |
| Drift | scheduled plan + Slack alert |
| Audit | git history + CI log + S3 versioning |

**面試心法：**
- 強調 OIDC 取代 static key（modern 做法）
- 強調 plan review = code review 同等重要
- 知道 plan 跟 apply 該怎麼切（plan PR 自動、apply 限 main + approval）
- 提到 cost / security / drift 三件事都該整合進 pipeline
- Atlantis vs GitHub Actions 能講出取捨

跟你 Jenkins 經驗對照：Jenkins 也能做這套（terraform plugin、credentials store），核心邏輯一樣，只是換個工具。GitHub Actions + OIDC 是新標準，可以加深履歷。
