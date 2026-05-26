---
title: "Terraform on AWS 實戰 - 從 VPC 到 EKS 端到端 Lab"
excerpt: "用 Terraform 從零建一套 production-ready AWS 環境：VPC、Subnet、NAT、IAM、Security Group、ALB、EC2 ASG、RDS、EKS，並串成可重複部署的 module 結構。"
date: 2026-07-10
category: "學習"
tags:
  - Terraform
  - AWS
  - IaC
  - DevOps
series: "IaC Lab"
seriesOrder: 4
featured: false
---

## Agenda

- Lab 目標與架構
- Repo 結構設計
- Backend：S3 + DynamoDB
- Provider 與版本鎖定
- Module 1：VPC（network 基礎）
- Module 2：IAM 與 SG
- Module 3：ALB + EC2 ASG（web 層）
- Module 4：RDS（資料庫層）
- Module 5：EKS（容器平台）
- 串起來：root 環境
- CI/CD 與 PR-based workflow 提要
- 常見坑與排查
- 面試常考重點
- 小結

## Lab 目標與架構

要做什麼：

```
┌──────────── AWS Region: ap-northeast-1 ──────────────────┐
│                                                          │
│  ┌─── VPC 10.0.0.0/16 ────────────────────────────────┐  │
│  │                                                    │  │
│  │   Public Subnets (3 AZ)                            │  │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐         │  │
│  │   │   ALB    │  │  NAT-GW  │  │  Bastion │         │  │
│  │   └─────┬────┘  └──────────┘  └──────────┘         │  │
│  │         │                                          │  │
│  │   Private Subnets (3 AZ)                           │  │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐         │  │
│  │   │  EC2 ASG │  │   EKS    │  │  RDS     │         │  │
│  │   │  web 層  │  │  Nodes   │  │ Postgres │         │  │
│  │   └──────────┘  └──────────┘  └──────────┘         │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  S3 (tfstate)   DynamoDB (lock)   KMS   IAM Roles        │
└──────────────────────────────────────────────────────────┘
```

可重複部署 dev / staging / prod 三套，差異只在 `tfvars`。

## Repo 結構設計

```
infra/
├── modules/                 # 可重用模組
│   ├── vpc/
│   ├── security-groups/
│   ├── alb-asg/
│   ├── rds/
│   └── eks/
├── envs/                    # 環境配置（per-env state）
│   ├── dev/
│   │   ├── main.tf          # 引用 modules
│   │   ├── backend.tf       # S3 backend，key 含環境
│   │   ├── terraform.tfvars # 環境變數
│   │   └── outputs.tf
│   ├── staging/
│   └── prod/
└── bootstrap/               # 第一次建 backend 用（雞生蛋）
    ├── main.tf              # S3 bucket + DynamoDB
    └── README.md
```

**為什麼這樣分：**
- `modules/`：可重複用，跟環境無關
- `envs/<env>/`：每環境一個資料夾、獨立 backend、獨立 state、獨立 IAM
- `bootstrap/`：S3 bucket 跟 DynamoDB table 不能放在 S3 state 內（會 chicken-and-egg），單獨用 local state 建好就好

## Backend：S3 + DynamoDB

**bootstrap/main.tf**（一次性建置）：

```hcl
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = "ap-northeast-1"
}

resource "aws_s3_bucket" "tfstate" {
  bucket = "myorg-tfstate-${random_id.suffix.hex}"
}

resource "random_id" "suffix" {
  byte_length = 4
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"          # 救援用
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "lock" {
  name         = "terraform-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "bucket_name" { value = aws_s3_bucket.tfstate.id }
output "table_name"  { value = aws_dynamodb_table.lock.name }
```

跑 `terraform apply` 後把 `bucket_name` / `table_name` 記下來，**各環境 backend 都指它**。

**envs/dev/backend.tf**：

```hcl
terraform {
  backend "s3" {
    bucket         = "myorg-tfstate-abcd1234"
    key            = "dev/infra.tfstate"        # 環境隔離靠 key prefix
    region         = "ap-northeast-1"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }
}
```

## Provider 與版本鎖定

`envs/dev/versions.tf`：

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Environment = var.env
      ManagedBy   = "terraform"
      Project     = "demo"
    }
  }
}
```

**`default_tags`** 給所有 AWS 資源自動套 tag，超實用。

## Module 1：VPC

**modules/vpc/main.tf**：

```hcl
locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 3)
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "${var.name}-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags = { Name = "${var.name}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 3
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.cidr_block, 8, count.index)        # /24
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags = {
    Name                                       = "${var.name}-public-${local.azs[count.index]}"
    "kubernetes.io/role/elb"                   = 1
    "kubernetes.io/cluster/${var.name}-eks"    = "shared"
  }
}

resource "aws_subnet" "private" {
  count             = 3
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr_block, 8, count.index + 10)
  availability_zone = local.azs[count.index]
  tags = {
    Name                                       = "${var.name}-private-${local.azs[count.index]}"
    "kubernetes.io/role/internal-elb"          = 1
    "kubernetes.io/cluster/${var.name}-eks"    = "shared"
  }
}

resource "aws_eip" "nat" {
  count  = var.single_nat ? 1 : 3
  domain = "vpc"
}

resource "aws_nat_gateway" "this" {
  count         = var.single_nat ? 1 : 3
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags = { Name = "${var.name}-nat-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}

resource "aws_route_table_association" "public" {
  count          = 3
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = 3
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[var.single_nat ? 0 : count.index].id
  }
}

resource "aws_route_table_association" "private" {
  count          = 3
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}
```

**variables.tf / outputs.tf：**

```hcl
variable "name"        { type = string }
variable "cidr_block"  { type = string, default = "10.0.0.0/16" }
variable "single_nat"  { type = bool, default = true }   # prod 改 false

output "vpc_id"             { value = aws_vpc.this.id }
output "public_subnet_ids"  { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
```

**設計重點：**
- `cidrsubnet()` 函式動態切 subnet，不寫死
- public / private subnet 都加 EKS / ELB tag（給 AWS LB Controller 用）
- `single_nat` 給 dev 省錢用，prod 一定 3 個

## Module 2：IAM 與 Security Group

**modules/security-groups/main.tf** 範例：

```hcl
resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "ALB SG"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "web" {
  name   = "${var.name}-web"
  vpc_id = var.vpc_id

  ingress {
    description     = "From ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]   # SG-to-SG，不寫 CIDR
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name   = "${var.name}-rds"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]    # 只允許 web SG 進來
  }
}
```

**重點：SG-to-SG 引用而非 CIDR**。SG 是 stateful firewall，互相引用是 AWS 推薦做法（IP 變動不影響規則）。

## Module 3：ALB + EC2 ASG

**modules/alb-asg/main.tf**（核心部分）：

```hcl
# Launch Template
resource "aws_launch_template" "web" {
  name_prefix   = "${var.name}-web-"
  image_id      = data.aws_ami.amzn2.id
  instance_type = var.instance_type

  vpc_security_group_ids = [var.web_sg_id]

  iam_instance_profile {
    name = aws_iam_instance_profile.web.name
  }

  user_data = base64encode(<<-EOT
    #!/bin/bash
    yum install -y nginx
    systemctl enable --now nginx
    echo "Hello from $(hostname)" > /usr/share/nginx/html/index.html
  EOT
  )

  lifecycle {
    create_before_destroy = true   # 換 AMI 不中斷
  }
}

# ASG
resource "aws_autoscaling_group" "web" {
  name                = "${var.name}-web-asg"
  vpc_zone_identifier = var.private_subnet_ids
  min_size            = var.min_size
  max_size            = var.max_size
  desired_capacity    = var.desired_capacity
  target_group_arns   = [aws_lb_target_group.web.arn]
  health_check_type   = "ELB"

  launch_template {
    id      = aws_launch_template.web.id
    version = "$Latest"
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.name}-web"
    propagate_at_launch = true
  }
}

# ALB
resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_sg_id]
  subnets            = var.public_subnet_ids
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name}-tg"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    path                = "/health"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

data "aws_ami" "amzn2" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}
```

**設計重點：**
- `create_before_destroy = true` 換 launch template 時 ASG 不會 downtime
- `instance_refresh` 自動滾動更新 instance
- ALB target group `target_type = instance` 用 NodePort 模式；EKS 環境可以改 `ip`
- ACM 證書 ARN 從外面傳

## Module 4：RDS

```hcl
resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-rds"
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier              = "${var.name}-postgres"
  engine                  = "postgres"
  engine_version          = var.engine_version
  instance_class          = var.instance_class
  allocated_storage       = var.allocated_storage
  storage_encrypted       = true
  kms_key_id              = var.kms_key_arn
  db_name                 = var.db_name
  username                = var.master_username
  manage_master_user_password = true                # 自動把密碼存 Secrets Manager

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.rds_sg_id]

  multi_az                = var.env == "prod"
  backup_retention_period = var.env == "prod" ? 14 : 1
  deletion_protection     = var.env == "prod"
  skip_final_snapshot     = var.env != "prod"

  performance_insights_enabled = true
  monitoring_interval          = 60
  monitoring_role_arn          = aws_iam_role.rds_monitoring.arn

  lifecycle {
    ignore_changes = [
      master_user_password,    # 由 Secrets Manager 管，避免 plan 一直 diff
    ]
  }
}
```

**重點：**
- `manage_master_user_password = true`：AWS 自動把密碼放 Secrets Manager，不用自己處理
- prod 開 `multi_az` / `deletion_protection`
- `lifecycle.ignore_changes` 避免不必要的 diff
- `storage_encrypted` 一定要 true

## Module 5：EKS

EKS 細節在前面 K8s Part 3 講過，這裡只放關鍵串接：

```hcl
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "${var.name}-eks"
  cluster_version = "1.30"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnet_ids

  cluster_endpoint_public_access = var.env != "prod"

  cluster_addons = {
    coredns                = {}
    kube-proxy             = {}
    vpc-cni                = {}
    aws-ebs-csi-driver     = {}
  }

  eks_managed_node_groups = {
    default = {
      instance_types = [var.eks_instance_type]
      min_size       = var.eks_min_size
      max_size       = var.eks_max_size
      desired_size   = var.eks_desired_size
    }
  }

  enable_cluster_creator_admin_permissions = true
}
```

## 串起來：root 環境

**envs/dev/main.tf**：

```hcl
module "vpc" {
  source     = "../../modules/vpc"
  name       = "demo-${var.env}"
  cidr_block = var.vpc_cidr
  single_nat = var.env != "prod"
}

module "sg" {
  source = "../../modules/security-groups"
  name   = "demo-${var.env}"
  vpc_id = module.vpc.vpc_id
}

module "alb_asg" {
  source              = "../../modules/alb-asg"
  name                = "demo-${var.env}"
  vpc_id              = module.vpc.vpc_id
  public_subnet_ids   = module.vpc.public_subnet_ids
  private_subnet_ids  = module.vpc.private_subnet_ids
  alb_sg_id           = module.sg.alb_sg_id
  web_sg_id           = module.sg.web_sg_id
  acm_certificate_arn = var.acm_arn
  instance_type       = var.web_instance_type
  desired_capacity    = var.web_desired
  min_size            = var.web_min
  max_size            = var.web_max
}

module "rds" {
  source             = "../../modules/rds"
  name               = "demo-${var.env}"
  env                = var.env
  private_subnet_ids = module.vpc.private_subnet_ids
  rds_sg_id          = module.sg.rds_sg_id
  kms_key_arn        = aws_kms_key.app.arn
  engine_version     = "16.3"
  instance_class     = var.rds_class
  allocated_storage  = var.rds_storage
  db_name            = "appdb"
  master_username    = "appadmin"
}

module "eks" {
  source             = "../../modules/eks"
  name               = "demo-${var.env}"
  env                = var.env
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  eks_instance_type  = var.eks_instance_type
  eks_min_size       = var.eks_min
  eks_max_size       = var.eks_max
  eks_desired_size   = var.eks_desired
}
```

**envs/dev/terraform.tfvars**：

```hcl
env                = "dev"
region             = "ap-northeast-1"
vpc_cidr           = "10.0.0.0/16"
acm_arn            = "arn:aws:acm:ap-northeast-1:123:certificate/abc"

web_instance_type  = "t3.small"
web_min            = 1
web_max            = 3
web_desired        = 1

rds_class          = "db.t4g.micro"
rds_storage        = 20

eks_instance_type  = "t3.medium"
eks_min            = 1
eks_max            = 3
eks_desired        = 1
```

**`envs/prod/terraform.tfvars`** 只改數字，**程式碼一行都不動**。這就是 IaC 的價值。

## CI/CD 與 PR-based workflow 提要

正式團隊用 PR-based workflow：

```
1. 開發者改 main.tf → 開 PR
2. CI 跑：terraform fmt -check + validate + plan
3. plan 結果 post 回 PR comment
4. Reviewer 看 plan 確認影響範圍
5. Merge 後 CI 自動 apply（或人工觸發）
```

兩個主流工具：

**GitHub Actions：**

```yaml
name: terraform
on:
  pull_request:
    paths: [infra/**]

jobs:
  plan:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123:role/gha-terraform
          aws-region: ap-northeast-1                          # OIDC，免存 access key
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init
        working-directory: infra/envs/dev
      - run: terraform plan -no-color | tee plan.txt
        working-directory: infra/envs/dev
      - uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const plan = fs.readFileSync('infra/envs/dev/plan.txt', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '```\n' + plan + '\n```'
            });
```

**Atlantis** 走另一個方向：自架 server 看 PR webhook，自動 `terraform plan`，PR comment 寫 `atlantis apply` 就 apply。

下一篇會專門講 Terraform CI/CD，這裡先有個輪廓。

## 常見坑與排查

**1. NAT Gateway 一個 AZ：dev 沒事，prod 必須三個**

`single_nat = true` 省一點錢，但這個 AZ NAT 掛了所有 private subnet 出不了網。prod `false`。

**2. SG 改不了：有 ENI 在用**

刪 SG 前先確認沒人引用：

```bash
aws ec2 describe-network-interfaces --filters Name=group-id,Values=sg-xxx
```

**3. RDS 改 instance class 會 downtime**

`aws_db_instance` 改 instance_class 預設立即重啟。要排維護時段：`apply_immediately = false`。

**4. ASG `desired_capacity` 跟 HPA 衝突**

如果 ASG 有外部 controller（Karpenter / k8s HPA）會動 desired_capacity，Terraform 每次 plan 都顯示要改回去。解法：

```hcl
lifecycle {
  ignore_changes = [desired_capacity]
}
```

**5. EKS 第一次建很久（15-20 分鐘）**

cluster control plane 建好就要 10 分鐘以上。可以開 `parallelism` 但不會明顯加速。

**6. State lock 卡住**

人 kill 了 apply、lock 沒釋放：

```bash
# 看 lock
aws dynamodb scan --table-name terraform-state-lock

# 確認沒人在跑後解鎖
terraform force-unlock <LOCK_ID>
```

## 面試常考重點

**1. 為什麼要分 modules / envs 兩層？**  
modules 可重用、跟環境無關；envs 每個一個獨立 backend、獨立 state、獨立 IAM。這樣 dev 出包不會搞到 prod、prod 變更 review 也獨立。比 workspace 安全。

**2. backend 為什麼用 S3 + DynamoDB？**  
S3 存 state（多版本、加密、團隊共享），DynamoDB 做 lock（避免兩人同時 apply）。S3 versioning 是救命的，state 壞了能 rollback。

**3. SG 用 SG-to-SG 比 CIDR 好在哪？**  
SG 內 instance IP 會變（重啟、replace），CIDR 規則就跟著錯。SG-to-SG 自動 follow 成員的 IP，加減 instance 規則永遠正確。

**4. ASG instance_refresh 是什麼？**  
換 launch template 後，ASG 預設不會替換現有 instance。`instance_refresh` 讓 ASG 自動滾動替換（按 `min_healthy_percentage` 控制節奏）。比手動 `terminate-instance-in-auto-scaling-group` 安全。

**5. `default_tags` 跟 module 內 tag 衝突？**  
module 內 tag 會覆蓋 default_tags 內同 key 的值。實務上 default_tags 放共通的（Environment、Project、ManagedBy），module 內加自己的（Name、Role）。

**6. 為什麼要 ignore_changes？**  
某些 attribute 由外部系統管理（ASG desired_capacity 給 HPA、RDS master password 給 Secrets Manager、Tags 給 cost team 加），Terraform plan 不該動它們，否則每次 apply 都改回去。

**7. 怎麼處理 prod 改設定的風險？**  
- 不直接 apply：先 plan -out 出 plan file，給 senior review
- `prevent_destroy` 鎖關鍵資源
- IAM 限制只有 CI/CD role 能 apply
- 改變只走 PR-based workflow，留 git history
- 重要 apply 在 maintenance window
- 開 deletion protection（RDS、ALB、EKS）

**8. EKS 跟 ASG 用 Terraform 建，差別在哪？**  
EKS 的 control plane AWS 託管，Terraform 只負責建（看不到實體）。EKS Node 你管，但有 manage node group 抽象、不用自己寫 launch template + ASG。複雜度差很多，建議用社群 module。

**9. 怎麼 import 既有手動建的資源？**  
傳統：`terraform import aws_instance.web i-abc123`，然後手動補 `.tf`。1.5+ 用 import block 比較好：

```hcl
import {
  to = aws_instance.web
  id = "i-abc123"
}
```

跑 `terraform plan -generate-config-out=generated.tf` 自動生 resource block。

**10. 大型 repo 跑 plan 很慢，怎麼辦？**  
- 切成多個小 root（按 layer：network / app / data），每個獨立 state
- 用 `-target` 局部 apply（debug 用，避免常態使用）
- 升 Terraform 版本（每版優化）
- 用 Terragrunt 管多環境，自動 cache provider

## 小結

這篇從 0 把 AWS 一套基礎設施用 Terraform 寫起來：

| 層級 | Module | 內容 |
|------|--------|------|
| Backend | bootstrap | S3 + DynamoDB |
| Network | vpc | VPC + 3-AZ subnets + NAT |
| Security | security-groups | ALB / Web / RDS SG |
| Compute | alb-asg | ALB + ASG + Launch Template |
| Data | rds | Postgres Multi-AZ + Secrets Manager |
| Container | eks | EKS + Node Group + Addon |

**重點觀念：**
- `modules/` + `envs/` 兩層結構，環境差異只在 tfvars
- backend bootstrap 單獨一份用 local state
- SG 互相引用而不寫 CIDR
- prod 特別嚴：multi_az、deletion_protection、3 NAT
- CI/CD 走 PR-based + OIDC 接 AWS（無 access key）

跟你 side project 的 IaC Monitoring System 對照：你那個是「Terraform 建 EC2 + Ansible 設定」，這篇把 AWS 全套基礎設施用 Terraform 包起來。下一篇進 SRE 核心理論：**SLI/SLO/Error Budget**。
