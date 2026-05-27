---
title: "Kubernetes 學習筆記 - EKS on AWS 實戰"
excerpt: "EKS 從 0 到 1：架構、用 Terraform 建叢集、VPC CNI 與 IP 管理、IRSA、AWS Load Balancer Controller、Karpenter、EBS CSI、面試常考重點。"
date: 2026-05-29
category: "學習"
tags:
  - Kubernetes
  - K8s
  - AWS
  - EKS
  - Terraform
series: "Kubernetes"
seriesOrder: 3
featured: false
---

## Agenda

- 為什麼選 EKS（vs 自建、vs ECS、vs K3s）
- EKS 整體架構與 AWS 整合點
- 用 Terraform 建一個能跑的 EKS
- Node 選擇：Managed Node Group / Self-managed / Fargate
- VPC CNI 與 Pod IP 規劃
- IRSA（IAM Roles for Service Accounts）
- AWS Load Balancer Controller
- EBS CSI Driver 與 Storage
- Karpenter：下一代 autoscaler
- EKS 版本升級流程
- 成本、安全與監控
- 面試常考重點
- 小結

## 為什麼選 EKS

當你決定上雲跑 K8s 時，AWS 上的選項：

| 方案 | 控制平面誰管 | 適合情境 |
|------|-------------|---------|
| **EKS** | AWS 管 control plane（$0.10/hr/cluster） | 標準選擇，要 K8s 完整功能 |
| **EKS Auto Mode** | AWS 全託管（含 Node、addon） | 想完全不管基礎設施 |
| **自建 K8s on EC2** | 自己管 | 客製化需求高、要省 control plane 費用 |
| **ECS** | AWS 管 | 不要 K8s 學習曲線、AWS 原生整合 |
| **K3s on EC2** | 自己管 | edge、輕量、單 binary |

**為什麼 prod 環境通常選 EKS 而不是 K3s 或自建？**

- K3s 是輕量 K8s（去掉 etcd 改 SQLite、整合多個元件成單一 binary），適合 edge 跟資源受限場景。Prod 環境需要 HA、多 master、社群 ecosystem 完整支援，K3s 雖然可以但維護成本高。
- 自建 K8s on EC2 要自己處理 control plane HA、etcd backup、版本升級，吃力不討好。
- EKS 把 control plane HA、etcd、版本升級、API server 高可用都包了，Node 還是自己控制，是「掌控度」跟「託管程度」的平衡點。

## EKS 整體架構

```
┌─────────────────────── AWS 帳號 ────────────────────────┐
│                                                        │
│  ┌─── EKS Cluster (你看不到) ────────────────────────┐  │
│  │   apiserver  etcd  scheduler  controller-manager  │  │
│  │   ↑ 多 AZ HA，AWS 負責                            │  │
│  └─────────────────────────────────────────────────┘   │
│                       ↑                                │
│                       │ kubectl / pod 通訊             │
│                       │                                │
│  ┌─── VPC ─────────────────────────────────────────┐   │
│  │  ┌─ Subnet AZ-a ─┐  ┌─ Subnet AZ-b ─┐  ...     │   │
│  │  │  EC2 Node     │  │  EC2 Node     │           │   │
│  │  │  ├─ kubelet   │  │  ├─ kubelet   │           │   │
│  │  │  ├─ kube-proxy│  │  ├─ kube-proxy│           │   │
│  │  │  └─ Pods      │  │  └─ Pods      │           │   │
│  │  └───────────────┘  └───────────────┘           │   │
│  │                                                  │   │
│  │  ┌─ ALB / NLB ─┐   ┌─ EBS / EFS ─┐               │   │
│  │  └─────────────┘   └─────────────┘               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                        │
│  IAM Roles  Secrets Manager  ECR  CloudWatch  Route53  │
└────────────────────────────────────────────────────────┘
```

**重要整合點：**

- **VPC**：EKS 跑在你的 VPC 內，Pod IP 直接從 subnet 拿（VPC CNI）
- **IAM**：透過 IRSA 把 IAM Role 綁到 K8s ServiceAccount
- **ALB/NLB**：透過 AWS Load Balancer Controller 把 K8s Service / Ingress 變成 AWS LB
- **EBS / EFS / S3**：透過 CSI Driver 提供持久化儲存
- **CloudWatch / X-Ray**：可以跟 Prometheus 並行或互補

## 用 Terraform 建一個能跑的 EKS

直接刻 EKS 很繁瑣，社群已經有 production-ready module。最常用的：[terraform-aws-modules/eks](https://github.com/terraform-aws-modules/terraform-aws-eks)。

`main.tf`：

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws        = { source = "hashicorp/aws",        version = "~> 5.0" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.0" }
    helm       = { source = "hashicorp/helm",       version = "~> 2.0" }
  }
  backend "s3" {
    bucket         = "my-tfstate"
    key            = "eks/prod/terraform.tfstate"
    region         = "ap-northeast-1"
    dynamodb_table = "tf-lock"
  }
}

provider "aws" {
  region = "ap-northeast-1"
}

data "aws_availability_zones" "available" { state = "available" }

locals {
  cluster_name = "demo-eks"
  azs          = slice(data.aws_availability_zones.available.names, 0, 3)
}

# VPC
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${local.cluster_name}-vpc"
  cidr = "10.0.0.0/16"

  azs             = local.azs
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway   = true
  single_nat_gateway   = true   # 省錢；prod 建議 false
  enable_dns_hostnames = true

  # EKS 要求 subnet 標記，LB Controller 才知道哪些可以放 LB
  public_subnet_tags = {
    "kubernetes.io/role/elb"                      = 1
    "kubernetes.io/cluster/${local.cluster_name}" = "shared"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"             = 1
    "kubernetes.io/cluster/${local.cluster_name}" = "shared"
  }
}

# EKS
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = local.cluster_name
  cluster_version = "1.30"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access = true   # 想嚴一點設 false + 走 bastion / VPN

  # 啟用常見 addon
  cluster_addons = {
    coredns                = {}
    kube-proxy             = {}
    vpc-cni                = {}
    aws-ebs-csi-driver     = {}
  }

  eks_managed_node_groups = {
    default = {
      instance_types = ["t3.medium"]
      min_size       = 2
      max_size       = 5
      desired_size   = 2
    }
  }

  # IAM principals 能拿到 cluster admin
  enable_cluster_creator_admin_permissions = true
}
```

跑：

```bash
terraform init
terraform plan
terraform apply       # 約 15–20 分鐘
aws eks update-kubeconfig --name demo-eks --region ap-northeast-1
kubectl get nodes
```

**第一次建 EKS 常踩的坑：**

- IAM 沒權：apply 要的 IAM permissions 不少，可以先用 admin 權限做測試
- Subnet tag 沒設：LB Controller 找不到 subnet 放 LB
- NAT Gateway 單一：省錢用 `single_nat_gateway = true`，但任一 AZ 掛 NAT 全部 Pod 出不了網路；prod 改 false
- Cluster endpoint public：開放後要小心 IAM 跟 audit log，內部用建議走 VPN/PrivateLink

## Node 選擇

EKS 上 Pod 跑在 Node 上，Node 有三種選擇：

| 類型 | 誰管 | 適合情境 |
|------|------|---------|
| **Managed Node Group** | AWS 幫你管 ASG、AMI 更新 | 預設選擇 |
| **Self-managed Node** | 自己管 EC2 / ASG | 需要客製 AMI、kernel 參數、bootstrap script |
| **Fargate** | AWS 全託管，Pod 等於 micro-VM | 不想管 Node、突發負載、批次工作 |

**Fargate 限制要注意：**
- 不支援 DaemonSet（log/監控 agent 怎麼跑要另想）
- 不支援 hostPort / hostNetwork
- 沒有 EBS（只能 EFS）
- 啟動慢（每個 Pod 等 micro-VM 起）
- 比 EC2 貴

實務上常見組合：**Managed Node Group 跑主力 workload + Fargate 跑突發 / 批次 Job**。

## VPC CNI 與 Pod IP 規劃

EKS 預設用 **AWS VPC CNI**，每個 Pod 直接拿 VPC subnet 的 IP — 跟其他 K8s CNI（Flannel、Calico 用 overlay）很不一樣。

**優點：**
- Pod 跟 EC2 / RDS 同 VPC，網路通到底，安全群組可以直接套
- 沒有 overlay，效能好，可以用 AWS native 監控

**缺點：**
- **IP 會用很快**。每個 EC2 能配的 ENI/IP 上限決定能跑多少 Pod，IP 也佔 subnet
- subnet 規劃要先想清楚，後期擴 CIDR 麻煩

每種 EC2 規格能跑的 Pod 數可以查官方表，例如 `t3.medium` 預設約 17 個 Pod。可以開 **prefix delegation**（一個 IP slot 變 /28 一段），把上限拉高 10 倍以上。

**Pod IP 規劃建議：**
- VPC CIDR 開大（`/16`），private subnet 至少 `/19`
- 多 AZ subnet 分散
- 留一段 secondary CIDR 給後期擴張

替代方案：用 **Cilium** 取代 VPC CNI，可以用 overlay 省 IP（但失去原生整合）。

## IRSA（IAM Roles for Service Accounts）

Pod 要呼叫 AWS API（讀 S3、寫 DynamoDB）的兩種爛方法：
1. EC2 instance role 給 Pod 用 — 所有 Pod 共用同個權限，最小權限原則沒了
2. Access key 塞進環境變數 / Secret — 不會輪替、容易外洩

**IRSA** 是正解：把 IAM Role 綁到 K8s ServiceAccount，Pod 拿 SA token 跟 STS 換 IAM credentials。

設定步驟：

```hcl
# 1. EKS 啟用 OIDC provider（terraform-aws-modules/eks 預設會建）

# 2. 建 IAM Role with trust policy 接 OIDC
data "aws_iam_policy_document" "s3_reader_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:default:s3-reader"]
    }
  }
}

resource "aws_iam_role" "s3_reader" {
  name               = "eks-s3-reader"
  assume_role_policy = data.aws_iam_policy_document.s3_reader_assume.json
}

resource "aws_iam_role_policy_attachment" "s3_reader" {
  role       = aws_iam_role.s3_reader.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"
}
```

```yaml
# 3. ServiceAccount 註明 Role ARN
apiVersion: v1
kind: ServiceAccount
metadata:
  name: s3-reader
  namespace: default
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/eks-s3-reader

---
# 4. Pod 用這個 SA
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  serviceAccountName: s3-reader
  containers:
    - name: app
      image: amazon/aws-cli
      command: ["aws", "s3", "ls"]
```

Pod 內的 AWS SDK 會自動找 token、call STS、拿 temporary credentials，不用任何程式碼改動。

**IRSA vs Pod Identity（新一代）：**

EKS 2023 推 **EKS Pod Identity**，用 daemonset 代替 OIDC，設定更簡單，新專案建議直接用。

## AWS Load Balancer Controller

K8s `Service type: LoadBalancer` 預設配的是 Classic LB，落後又貴。**AWS Load Balancer Controller** 把它換成 NLB（L4）或 ALB（L7）：

- 寫 `Service type: LoadBalancer` + annotation → 配 NLB
- 寫 `Ingress` → 配 ALB

裝法（Helm）：

```bash
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=demo-eks \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

用 IRSA 給它 IAM 權限。然後寫 Ingress：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:...
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: '443'
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
```

**target-type ip vs instance：**
- `ip`：ALB 直接打到 Pod IP（需要 VPC CNI），少一跳延遲低
- `instance`：ALB 打到 NodePort 再 kube-proxy 轉發，有額外一跳

幾乎都選 `ip`。

## EBS CSI Driver 與 Storage

前一篇講過 StorageClass，EKS 上實際的 provisioner 用 EBS CSI Driver：

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  encrypted: "true"
  fsType: ext4
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

**重點：**
- **`WaitForFirstConsumer`** 一定要設，否則 PV 先建會卡 AZ — Pod 排到別的 AZ 就掛不上
- `allowVolumeExpansion: true` 讓 PVC 之後可以擴容
- `encrypted: true` 預設加密
- 預設 storage class 名稱建議是 `gp3`（gp2 已過時）

**其他選擇：**
- **EFS CSI**：要 `ReadWriteMany`、跨 AZ 共享
- **FSx for Lustre CSI**：HPC、AI 訓練
- **S3 CSI（新）**：直接掛 S3 bucket 當檔案系統

## Karpenter：下一代 Autoscaler

Cluster Autoscaler 透過 ASG 加減 Node，缺點：
- 反應慢（ASG → EC2 → Node ready 要 2–5 分鐘）
- 一個 ASG 只能對應一種 instance type
- 想用多種規格要設多個 ASG，難管

**Karpenter** 是 AWS 推的下一代：直接看 Pending Pod 的需求，**動態挑最便宜合適的 EC2** 開機，不用 ASG。

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  template:
    spec:
      requirements:
        - key: kubernetes.io/arch
          operator: In
          values: [amd64]
        - key: karpenter.k8s.aws/instance-category
          operator: In
          values: [c, m, r]
        - key: karpenter.k8s.aws/instance-generation
          operator: Gt
          values: ["2"]
        - key: karpenter.sh/capacity-type
          operator: In
          values: [spot, on-demand]
      nodeClassRef:
        name: default
  limits:
    cpu: 100
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 30s
```

**特色：**
- 一個 NodePool 涵蓋多種 instance type / 多 AZ / spot+on-demand 混用
- 自動 consolidation：底層用量不滿就 reschedule Pod 到更小機器
- 直接 launch EC2，不經 ASG，啟動快

新 EKS 專案幾乎都用 Karpenter 取代 Cluster Autoscaler。

## EKS 版本升級流程

K8s 約一年三個版本，EKS 每版支援約 14 個月。**過期不升級會被強制升級 + 漲價**。

升級步驟：

1. **先讀 release note**：API 棄用、CNI / CSI 相容性
2. **升 control plane**：`aws eks update-cluster-version` 或 Terraform 改 `cluster_version`
3. **升 addon**：core dns / kube-proxy / vpc-cni / EBS CSI
4. **升 Node Group**：滾動替換新 AMI 的 Node
5. **驗證**：跑 e2e、看 deprecated API 警告

**Pluto** 或 **kubent** 工具可以掃 manifest 看有沒有用到 deprecated API。

**重點**：control plane 一次只能升一個 minor version（1.29 → 1.30），不能跨。Node 落後 control plane 最多 1–2 minor。

## 成本、安全與監控

**省成本：**
- 開發環境 Node 用 Spot（Karpenter 直接支援）
- gp3 取代 gp2（更快又更便宜）
- 沒在用的 LB / EBS 定期清
- 開 CloudWatch Container Insights 看 Cost Allocation

**安全：**
- **Cluster endpoint private**（不對外）+ 走 bastion / VPN
- **encryption at rest**：EKS secret 加密（KMS）、EBS 預設加密
- **IRSA 全面取代 instance role**
- **Pod Security Admission** 限制 privileged
- **ECR Image Scanning** 自動掃 CVE
- **VPC flow log + CloudTrail** 追記錄

**監控：**
- **CloudWatch Container Insights**：原生整合，看 Node / Pod 資源
- **Prometheus + Grafana**：自架或用 AMP（AWS Managed Prometheus）+ AMG（Managed Grafana）
- **AWS X-Ray + ADOT**：trace
- **Fluent Bit → CloudWatch Logs**：應用日誌

## 面試常考重點

**1. EKS 跟自建 K8s 差在哪？什麼時候會選自建？**  
EKS 託管 control plane（apiserver/etcd/scheduler/controller-manager），你只管 Node。自建要自己跑 control plane + 處理 HA + etcd backup + 升級，吃力不討好。會選自建：要 hyper-customize（k8s feature gate、自訂 admission webhook 改 apiserver）、要省 control plane 費用、on-prem 同步、合規要求自管。

**2. EKS 上 Pod 怎麼拿 IP？跟其他 CNI 差在哪？**  
EKS 預設 VPC CNI：每個 Pod 直接從 VPC subnet 拿一個真實 IP（透過 EC2 secondary ENI）。優點：跟 EC2/RDS 同網段、SG 可以直接套；缺點：IP 用量大、subnet 要規劃好、每種 EC2 規格能跑的 Pod 數有上限。其他 CNI（Calico、Flannel）多半用 overlay，Pod IP 是內部虛擬網段，IP 不會吃 VPC。

**3. Pod 怎麼安全呼叫 AWS API？**  
**IRSA** 或新一代 **EKS Pod Identity**。把 IAM Role 綁到 K8s ServiceAccount，Pod 用 SA token 跟 STS 換 temporary credentials。比起塞 access key 或共用 instance role，IRSA 能做到「每個 workload 最小權限」，且 credentials 自動輪替。

**4. EKS 怎麼做 Ingress？跟原生 NGINX Ingress 比？**  
裝 **AWS Load Balancer Controller**，寫 `Ingress` 會建出 ALB。優點：AWS 託管、TLS 用 ACM 證書、WAF 整合、access log 進 S3。缺點：受 ALB 規則限制（rule 數量、複雜路由）。NGINX Ingress Controller 比較有彈性（複雜 rewrite、限流、auth），但你要自己跑 Pod、自己管。實務常見：**外層 ALB + 內層 NGINX Ingress 兩段式**。

**5. Karpenter 比 Cluster Autoscaler 好在哪？**  
- 直接 launch EC2 不經 ASG → 啟動快（30 秒級 vs CA 的 2–5 分鐘）
- 一個 NodePool 支援多種 instance type / 多 AZ / spot+on-demand mix
- 動態 consolidation：底層閒了會 reschedule Pod 到更小機器
- Spot 中斷處理內建
- 設定簡單（CRD 一份）

**6. EKS 升級流程？跨版本可以嗎？**  
不能跨：control plane 一次只能升一個 minor（1.29→1.30→1.31）。流程：讀 release note → 升 control plane → 升 addon → 滾動升 Node → 驗證。升前用 `kubent` / `pluto` 掃 deprecated API。Node 落後 control plane 最多 1–2 minor。

**7. EKS Pod 起不來，常見原因？**  
- **IP 用完**（VPC CNI）：subnet 沒 IP、Node ENI 達上限。看 `kubectl describe pod` Events、CloudWatch 看 ENI 使用率
- **Security Group 沒開**：Pod → AWS 服務不通，檢查 SG
- **IRSA 沒生效**：Pod 還在用 Node IAM role，看 SA annotation、看 OIDC provider 設定
- **Image pull 失敗**：ECR 權限沒給 Node role（`AmazonEC2ContainerRegistryReadOnly`）
- **StorageClass volumeBindingMode 沒設 WaitForFirstConsumer**：跨 AZ 掛不上

**8. EKS 上跑有狀態應用（DB）OK 嗎？**  
技術上 OK，用 StatefulSet + EBS CSI + 多 AZ replication。但實務上 prod 級資料庫**通常還是用 RDS / Aurora 託管**，省維運。EKS 上跑 DB 適合：開發環境、測試、不能用 RDS 的合規場景。

**9. EKS 跟 ECS 怎麼選？**  
- ECS：跟 AWS 整合深、學習曲線低、無控制平面費用、不用學 K8s
- EKS：K8s 生態整套（Helm、Operator、ArgoCD…）、多雲 / on-prem 共用工具、Job market 更廣
- 純 AWS、簡單 web 應用 → ECS；要 K8s 生態 / 未來想多雲 → EKS

**10. EKS 安全怎麼做？**  
最小組合：
- Cluster endpoint private + IAM access entries（取代舊 aws-auth ConfigMap）
- IRSA / Pod Identity 給 workload 用
- secret 用 AWS Secrets Manager + External Secrets Operator
- ECR image scan + 阻擋 critical CVE 的 admission policy
- Pod Security Admission baseline 起跳
- VPC flow log + CloudTrail + GuardDuty for EKS

**11. K3s 跟 EKS 差很多嗎？什麼時候選 K3s？**  
K3s 是輕量 K8s：去掉 etcd（改 SQLite）、整合元件成單一 binary、預設裝 traefik+local-path-provisioner+servicelb，安裝快、資源占用小。適合 edge、IoT、開發測試、單機 demo。Prod 雲端跑 workload 幾乎都選 EKS，因為 HA、生態、社群支援都完整。

**12. EKS 成本怎麼控？**  
- Karpenter + Spot（非 critical workload）
- Cluster Autoscaler / Karpenter 主動 consolidate
- HPA + VPA / Karpenter consolidation 一起，左右擠資源
- 開發 / 測試環境 NodePool 設工作時間外 scale to 0
- gp3 + 適合 IOPS（不是預設最高）
- 監看 unused EBS / LB / Elastic IP

## 小結

EKS 是 AWS 上跑 K8s 的標準選擇，重點：

- **架構**：control plane AWS 託管，Node 你管，VPC CNI 讓 Pod 拿真實 IP
- **建立**：Terraform `terraform-aws-modules/eks` 一鍵起 production-ready cluster
- **整合**：IRSA 接 IAM、AWS Load Balancer Controller 接 ALB/NLB、EBS CSI 接 EBS、Karpenter 自動開 Node
- **升級**：一次一個 minor、先驗 deprecated API
- **安全**：endpoint private、IRSA、image scan、PSA
- **成本**：Karpenter + Spot + consolidation + gp3

跟前兩篇 K8s 文章配套看，從「會 K8s」進階到「會在 AWS 上跑 production K8s」。下一篇講 GitOps：怎麼用 ArgoCD 把 K8s manifest 跟 Git 持續同步，配你目前的 Jenkins CI 經驗剛好。
