---
title: "Ansible + Terraform 整合 Lab - 從建主機到部署應用"
excerpt: "把 Terraform 建出來的 EC2 自動交給 Ansible 設定的完整流程：Dynamic Inventory、Output 串接、CI 整合，避開常見坑。"
date: 2026-07-24
category: "學習"
tags:
  - Ansible
  - Terraform
  - IaC
  - DevOps
series: "IaC Lab"
seriesOrder: 5
featured: false
---

## Agenda

- 為什麼要兩個工具？分工原則
- Lab 目標
- 方法 A：Terraform output → Static Inventory（最簡）
- 方法 B：Dynamic Inventory（推薦）
- 方法 C：Terraform `local-exec` 直接觸發 Ansible（最快但不建議）
- 方法 D：Ansible run-as-Terraform-provider（少數情境）
- SSH key 怎麼共用
- CI/CD 整合：GitHub Actions
- 常見坑與排查
- 面試常考重點
- 小結

## 為什麼要兩個工具？分工原則

**Terraform 強項：**
- 雲端資源 provisioning（VPC、EC2、RDS、IAM）
- 宣告式 + state + dependency graph
- 多雲、跨平台 Provider 生態

**Ansible 強項：**
- 進入主機後做設定（裝套件、改設定檔、起服務）
- agentless、SSH 即用
- 軟體部署、配置管理

**為什麼不全用 Terraform？**

Terraform 也有 `remote-exec` provisioner 能跑 shell，但：
- 沒 idempotency 保證（每次都跑）
- state 不會記錄「軟體已裝」
- 失敗就要整個 resource recreate

**為什麼不全用 Ansible？**

Ansible 雖有 `ec2` 等 cloud module 能建資源，但：
- 沒 state，每次跑都得查實際狀態
- 沒 dependency graph，順序自己排
- 大規模基礎設施改變難 review

**最佳實踐：**

```
Terraform → 建雲端資源 → 輸出 hostname/IP
              ↓
Ansible → 連進主機 → 裝軟體 + 部署 app
```

## Lab 目標

把這套跑起來：

```
1. terraform apply
   → 建 VPC、EC2 (3 台 web)、RDS、SG
   → 輸出 web instance IP

2. ansible-playbook site.yml
   → 連進 3 台 web
   → 裝 nginx + 跑健康檢查
   → 部署 app + 起服務
```

兩個工具完全解耦，可以獨立跑。

## 方法 A：Terraform output → Static Inventory

**最簡單**：Terraform 跑完，把 IP 寫成 Ansible inventory 檔。

**Terraform 端：**

```hcl
resource "aws_instance" "web" {
  count         = 3
  ami           = var.ami
  instance_type = "t3.small"
  subnet_id     = var.private_subnet_ids[count.index]
  vpc_security_group_ids = [var.web_sg_id]
  key_name      = aws_key_pair.deploy.key_name

  tags = {
    Name = "web-${count.index}"
    Role = "web"
  }
}

output "web_ips" {
  value = aws_instance.web[*].private_ip
}
```

**用 template 生 inventory：**

```hcl
resource "local_file" "inventory" {
  filename = "${path.module}/../ansible/inventory.ini"
  content  = <<-EOT
    [web]
    %{ for i, ip in aws_instance.web[*].private_ip ~}
    web-${i} ansible_host=${ip}
    %{ endfor ~}

    [web:vars]
    ansible_user=ec2-user
    ansible_ssh_private_key_file=~/.ssh/deploy.pem
  EOT
}
```

Apply 完，`ansible/inventory.ini` 就有資料：

```ini
[web]
web-0 ansible_host=10.0.20.5
web-1 ansible_host=10.0.21.7
web-2 ansible_host=10.0.22.3

[web:vars]
ansible_user=ec2-user
ansible_ssh_private_key_file=~/.ssh/deploy.pem
```

**優點：**
- 設定簡單
- inventory 可以 commit（方便 debug）
- Ansible 端可獨立跑

**缺點：**
- ASG 自動 scale 時 inventory 不會更新
- 必須先跑 Terraform 才能跑 Ansible
- inventory 容易過時

**適合：** 固定數量的 server、變動不頻繁的環境。

## 方法 B：Dynamic Inventory（推薦）

不用 Terraform 寫檔，**Ansible 自己從 AWS 查當前的 EC2 清單**。

**安裝：**

```bash
pip install boto3 botocore
ansible-galaxy collection install amazon.aws
```

**`aws_ec2.yml`（dynamic inventory plugin 設定）：**

```yaml
plugin: amazon.aws.aws_ec2
regions:
  - ap-northeast-1
filters:
  tag:Environment: prod
  instance-state-name: running
keyed_groups:
  - key: tags.Role
    prefix: role
  - key: placement.availability_zone
    prefix: az
hostnames:
  - private-ip-address
compose:
  ansible_host: private_ip_address
```

意義：抓 region `ap-northeast-1` 內、`Environment=prod` tag、running 狀態的 instance；按 `Role` tag 分組（例如 `role_web`、`role_db`）。

**測試：**

```bash
ansible-inventory -i aws_ec2.yml --graph
# @all:
#   |--@aws_ec2:
#   |  |--web-0
#   |  |--web-1
#   |  |--web-2
#   |--@role_web:
#   |  |--web-0
#   |  |--web-1
#   |  |--web-2
```

**Playbook：**

```yaml
- hosts: role_web
  become: true
  roles:
    - common
    - nginx
    - app-deploy
```

**跑：**

```bash
ansible-playbook -i aws_ec2.yml site.yml
```

**優點：**
- ASG 自動 scale 也抓得到
- 不用 Terraform 跟 Ansible 之間傳檔
- 一個 source of truth（AWS 本身）

**缺點：**
- 設定稍複雜
- 需要 AWS credentials（IAM Role / access key）
- 沒網路就跑不了

**適合：** 大部分情境，特別是 ASG / auto-scaling 環境。

## 方法 C：Terraform `local-exec` 直接觸發

Terraform 在某資源建好後立刻跑 Ansible：

```hcl
resource "aws_instance" "web" {
  # ...

  provisioner "local-exec" {
    command = <<-EOT
      sleep 30                            # 等 SSH 起來
      ansible-playbook \
        -i '${self.private_ip},' \
        --user ec2-user \
        --private-key ~/.ssh/deploy.pem \
        site.yml
    EOT
  }
}
```

**優點：** 一條 `terraform apply` 跑完整套。

**缺點（多到不建議）：**
- provisioner 是 anti-pattern（HashiCorp 自己也這麼說）
- Ansible 失敗 → resource 標 tainted → 下次重建
- terraform plan 看不到 Ansible 變更
- 沒 idempotency 重跑會困難
- destroy 時 ansible 完全不參與

**只在 PoC / demo 用。**

## 方法 D：Ansible run-as-Terraform-provider

社群有 [terraform-provider-ansible](https://github.com/ansible/terraform-provider-ansible)，把 Ansible 包成 Terraform Provider，可以在 `.tf` 裡 declare ansible task。

**極少數情境**才有用，且大部分人不熟。一般不推薦。

## SSH key 怎麼共用

兩個工具都要進主機，key 怎麼管？

**選項 1：Terraform 建 key pair + 輸出**

```hcl
resource "tls_private_key" "deploy" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "deploy" {
  key_name   = "deploy-key"
  public_key = tls_private_key.deploy.public_key_openssh
}

resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.deploy.private_key_pem
  filename        = "${path.module}/deploy.pem"
  file_permission = "0600"
}
```

**注意：private key 進 Terraform state**，state 一定要加密 + 限存取（前面 Terraform on AWS 那篇講過）。

**選項 2：手動建 key、雙方都讀同一個檔**

更安全：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy
# Terraform 引用 ~/.ssh/deploy.pub
# Ansible 引用 ~/.ssh/deploy
```

**選項 3：AWS Systems Manager Session Manager（推薦）**

完全不用 SSH key，用 IAM 認證進主機：

```bash
ansible -i aws_ec2.yml all -m ping -e ansible_connection=community.aws.aws_ssm
```

需要 instance 裝 SSM Agent（AMI 多半預裝）+ IAM Role 給 `AmazonSSMManagedInstanceCore`。

**好處：** 無 SSH key 管理、port 22 不用開、所有 session 自動進 audit log。

**SRE 角度：** SSM Session Manager 是現代 AWS 上的標準做法。

## CI/CD 整合：GitHub Actions

把 Terraform + Ansible 整合進 PR-based workflow：

`.github/workflows/deploy.yml`：

```yaml
name: deploy
on:
  push:
    branches: [main]

jobs:
  terraform:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    outputs:
      web_ips: ${{ steps.tf.outputs.web_ips }}
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123:role/gha-deploy
          aws-region: ap-northeast-1
      - uses: hashicorp/setup-terraform@v3
      - name: Terraform apply
        id: tf
        working-directory: infra
        run: |
          terraform init
          terraform apply -auto-approve
          ips=$(terraform output -json web_ips)
          echo "web_ips=$ips" >> "$GITHUB_OUTPUT"

  ansible:
    needs: terraform
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123:role/gha-deploy
          aws-region: ap-northeast-1
      - run: pip install boto3 ansible
      - run: ansible-galaxy collection install amazon.aws
      - name: Wait for instances ready
        run: sleep 60
      - name: Ansible playbook
        working-directory: ansible
        run: |
          ansible-playbook -i aws_ec2.yml site.yml
```

**設計重點：**

- 兩個 job 分開，方便獨立 rerun
- OIDC 接 AWS（無靜態 access key）
- 用 Dynamic Inventory（不依賴 Terraform output 傳遞）
- `sleep 60` 等 instance 完成 cloud-init

**進階：把 Ansible 拆成獨立 workflow，trigger on `workflow_dispatch`**，工程師可以隨時對既有主機重跑 ansible，不用 terraform apply。

## 常見坑與排查

### 1. EC2 起來了但 SSH 連不上

```
ansible -i aws_ec2.yml all -m ping
# UNREACHABLE!
```

可能原因：
- **SG 沒開 22**：檢查 web_sg ingress
- **NACL block**：很少，但 default NACL 都是 allow
- **cloud-init 還沒跑完**：等 30–60 秒
- **SSH key 不對**：`ansible_ssh_private_key_file` 路徑、檔案權限要 0600
- **`ansible_user` 錯**：Amazon Linux 是 `ec2-user`、Ubuntu 是 `ubuntu`、RHEL 是 `ec2-user` 或 `root`
- **Private IP 但你不在 VPC 內**：用 bastion 或 SSM

驗證：

```bash
# 用 verbose
ansible -i aws_ec2.yml web -m ping -vvv

# 直接 SSH 試
ssh -i ~/.ssh/deploy.pem ec2-user@<IP>
```

### 2. Dynamic Inventory 抓不到 instance

```bash
ansible-inventory -i aws_ec2.yml --graph
# 沒結果
```

檢查：
- AWS credentials 是否設好（`aws sts get-caller-identity`）
- region 對嗎
- filter 條件是否太嚴（有沒有實際 instance 符合）
- instance state 是否 `running`

debug：

```bash
ansible-inventory -i aws_ec2.yml --list --vvv
```

### 3. Terraform 跟 Ansible 認知不一致

例：Terraform 建 3 台 instance，Ansible 只看到 2 台。

可能原因：
- 第 3 台還在 pending（race condition）
- Tag 沒套對（cloud-init 失敗）
- Filter 條件過嚴

解法：Terraform 等 instance ready 才結束：

```hcl
resource "aws_instance" "web" {
  # ...
  user_data = file("${path.module}/cloud-init.yml")
}

resource "null_resource" "wait_for_ready" {
  depends_on = [aws_instance.web]

  provisioner "local-exec" {
    command = "aws ec2 wait instance-status-ok --instance-ids ${join(" ", aws_instance.web[*].id)}"
  }
}
```

### 4. Ansible 沒有 idempotency

第二次跑 Ansible 顯示一堆 `changed`：

- `shell` / `command` module 預設不 idempotent → 改用 `apt` / `service` / `file` 或加 `creates` / `removes` / `changed_when`
- `git` module 預設會 update → 加 `version` 鎖住
- template 內有時間戳 → 拿掉時間戳或 ignore

### 5. SSH host key checking

CI 上跑 ansible 第一次會卡：

```
The authenticity of host 'X' can't be established.
Are you sure you want to continue connecting (yes/no)?
```

`ansible.cfg`：

```ini
[defaults]
host_key_checking = False
```

正式環境用 SSM 就沒這問題。

## 面試常考重點

**1. 為什麼要把 Terraform 跟 Ansible 切開？**  
Terraform 強項是基礎設施 provisioning（state、dependency graph、宣告式），Ansible 強項是進入主機後設定管理。把建主機跟設定主機切開，每個工具發揮所長。Terraform `remote-exec` provisioner 可以跑 shell 但 anti-pattern：沒 idempotency、失敗會 taint resource、plan 看不到變更。

**2. Static vs Dynamic inventory 怎麼選？**  
固定 server、變動少 → static（Terraform output 生 inventory）。ASG / 自動擴展、規模大 → dynamic（aws_ec2 plugin 直接查 AWS）。**Dynamic 是絕大多數場景的標準做法**。

**3. CI 上怎麼跑 Ansible 不用塞 SSH key？**  
- 用 SSM Session Manager：IAM 認證、不需要 SSH key
- 或 OIDC 給 CI 一個臨時 IAM Role，role 能讀 secret manager 拿 key
- 或 GitHub Actions secret 存 key（最常見，但有外洩風險）

**4. Terraform private key 進 state 安全嗎？**  
state 加密 + 限制 IAM 存取 + S3 versioning 鎖死，技術上 OK。但更建議：用既有 key pair（手動建好）、或 Ansible 用 SSM connection 完全不用 key。

**5. Terraform apply 失敗中途 instance 還在，怎麼辦？**  
Terraform 會記得在 state 內，下次 apply 會接續 / 修復。如果 instance state 跟 Terraform 認知不同（drift），跑 `terraform plan -refresh-only` 看差異。**不要直接 `terraform state rm` 然後手動刪 instance**，會造成 state 跟現實脫節。

**6. 不用 SSH，Ansible 怎麼進 AWS instance？**  
用 `community.aws.aws_ssm` connection plugin。需求：instance 裝 SSM Agent（多數官方 AMI 預裝）、IAM Instance Profile 有 `AmazonSSMManagedInstanceCore` policy。從 Ansible 端 inventory 加 `ansible_connection: aws_ssm`。

**7. Ansible 對同一台主機跑兩次顯示 `changed`，是 bug 嗎？**  
不是 bug，是寫法問題。**Ansible 大部分 module 是 idempotent，但 `shell`/`command` 不是**。檢查 playbook：把 `shell`/`command` 換成專屬 module（`apt`/`service`/`file`/`template`）；不能換的加 `creates`/`removes`/`changed_when`。

**8. 多環境（dev/staging/prod）怎麼共用 playbook？**  
- 用 group_vars / host_vars 區分變數
- inventory 用不同檔（`inventory/dev.yml`、`inventory/prod.yml`）
- Playbook 程式碼完全一致，只傳不同 inventory：`ansible-playbook -i inventory/prod.yml site.yml`

**9. Ansible task 失敗想忽略繼續，但要記錄？**  
```yaml
- name: risky task
  shell: /opt/risky.sh
  register: result
  failed_when: false        # 不視為失敗
  changed_when: result.rc == 0

- name: log if failed
  debug:
    msg: "Risky task failed but ignored: {{ result.stderr }}"
  when: result.rc != 0
```

或用 `block / rescue / always` 結構化處理。

**10. Terraform 改 EC2 規格會 destroy 重建嗎？**  
看屬性：`instance_type` 改是 in-place update（live migration），不會重建。`ami` 改會重建（資料消失）。`user_data` 改預設不會重啟（要 `user_data_replace_on_change = true` 才會）。實際前用 `terraform plan` 看是 `~` (modify) 還是 `-/+` (replace)。

## 小結

整合的關鍵概念：

```
[Terraform 建基礎設施] → AWS metadata
                            ↓ (Dynamic Inventory 查)
[Ansible 設定主機] → 完成
```

**最佳實踐 stack：**

| 元件 | 工具 |
|------|------|
| 雲端資源 | Terraform |
| Inventory | aws_ec2 dynamic inventory |
| 連線 | SSM Session Manager（無 SSH key） |
| 設定管理 | Ansible Role |
| CI/CD | GitHub Actions + OIDC |
| State | S3 + DynamoDB |
| Secret | AWS Secrets Manager |

跟你的 IaC Monitoring System side project 對照：你已經做了 Terraform + Ansible 整合，補上這篇可以把 Dynamic Inventory + SSM 那塊補齊，履歷上講得更完整。

下一篇進入 SRE 另一個核心：**Incident Response 與 Postmortem 文化**。
