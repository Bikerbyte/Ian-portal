---
title: "Kubernetes 學習筆記 - Security 深入"
excerpt: "K8s 安全完整地圖：Pod Security Admission、SecurityContext、OPA/Gatekeeper、Kyverno、Image scanning、Secret encryption、Network 隔離、Supply Chain、面試重點。"
date: 2026-06-19
category: "學習"
tags:
  - Kubernetes
  - Security
  - DevSecOps
series: "Kubernetes"
seriesOrder: 6
featured: false
---

## Agenda

- K8s 攻擊面總覽
- 4C Cloud Native Security 模型
- 認證與授權：Auth / RBAC
- Pod Security Admission（PSP 的繼任者）
- SecurityContext：container 跑成 non-root
- NetworkPolicy 微切分
- Secret 加密與外部化
- Image Security：scan、sign、policy
- Admission Control：OPA Gatekeeper vs Kyverno
- Runtime Security：Falco
- Supply Chain：SLSA、SBOM、Cosign
- Audit Log
- 面試常考重點
- 小結

## K8s 攻擊面總覽

容易被忽略的攻擊路徑：

| 入口 | 攻擊方式 | 後果 |
|------|---------|------|
| **暴露的 apiserver** | 未認證 / 弱密碼 / 對外暴露 | 取得 cluster admin |
| **etcd 直連** | etcd port (2379) 對外、無 TLS | 直接讀寫所有 Secret 跟 ConfigMap |
| **kubelet API** | 10250 port 沒鎖、anonymous auth | 在 Node 上跑任意 container |
| **過大的 RBAC** | SA 給 cluster-admin | Pod 被攻破即 cluster 被攻破 |
| **特權 container** | `privileged: true` / hostPath | 容器逃逸到 Node |
| **惡意 image** | base image 帶後門、CVE | 跑起來就被 backdoor |
| **Secret 外洩** | env var dump、log、Git | 認證資料外洩 |
| **過鬆 NetworkPolicy** | 沒設或全 allow | 一個 pod 被攻破能掃整個叢集 |

## 4C Cloud Native Security 模型

K8s 官方提的分層防禦觀念：

```
┌───────────────────────────────┐
│ Code                          │ ← 應用層：依賴掃描、靜態分析、TLS
├───────────────────────────────┤
│ Container                     │ ← 鏡像層：base image、non-root、最小特權
├───────────────────────────────┤
│ Cluster                       │ ← K8s 層：RBAC、PSA、NetworkPolicy、admission
├───────────────────────────────┤
│ Cloud / Co-Lo / Data Center   │ ← 基礎層：VPC、IAM、KMS、節點 hardening
└───────────────────────────────┘
```

每層都要顧，**整套防禦最弱的環節決定整體強度**。

## 認證與授權

**Authentication（你是誰）：**
- 客戶端證書（kubectl 預設）
- Bearer Token（ServiceAccount token）
- OIDC（接 Okta / Google / Keycloak）
- AWS IAM Authenticator（EKS）
- Webhook Token

**Authorization（你能做什麼）：**
- RBAC（標準作法）
- ABAC（舊，棄用）
- Webhook（外部系統決定）
- Node（kubelet 專用）

實務上：人用 OIDC + RBAC、Pod 用 ServiceAccount + RBAC（搭 IRSA / Pod Identity 接雲端權限）。

**RBAC 最小權限範例：**

```yaml
# 開發者只能讀自己 namespace 的 Pod 跟 log，能 exec
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: developer
  namespace: team-a
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["create"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
```

**常見錯誤：給 `cluster-admin` 給太多人**。應該定義角色（developer、operator、auditor、admin），每個 group / SA 給對應角色。

定期審計：

```bash
# 看誰有 cluster-admin
kubectl get clusterrolebinding -o yaml | grep -A2 'cluster-admin'

# 用 rakkess 工具看每個 subject 的權限
rakkess --as <user>
```

## Pod Security Admission（PSP 的繼任者）

K8s 1.25 移除 PodSecurityPolicy（PSP），改用 **Pod Security Admission（PSA）**。

PSA 是內建的 admission controller，按 namespace 套用三種等級之一：

| Profile | 限制程度 | 用途 |
|---------|---------|------|
| **privileged** | 完全不限 | 系統 namespace（kube-system） |
| **baseline** | 阻擋已知特權升級向量 | 一般應用 |
| **restricted** | 嚴格遵循 hardening 最佳實踐 | 高安全應用 |

套用方式（namespace label）：

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

三種模式：
- **enforce**：違反規則直接拒絕
- **audit**：違反規則紀錄到 audit log，不拒絕
- **warn**：違反規則回 warning 給 user，不拒絕

**漸進採用策略：先設 warn + audit 觀察，沒問題再改 enforce。**

**restricted profile 大致內容：**
- 不可 privileged
- 不可 hostPath / hostNetwork / hostPID / hostIPC
- 必須 runAsNonRoot
- 必須 readOnlyRootFilesystem
- 必須 drop ALL capabilities（只能 add 白名單內的）
- 必須 seccomp profile

## SecurityContext：container 跑成 non-root

`securityContext` 是 Pod 跟 container 的安全設定。**最佳實踐模板**：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10000
    runAsGroup: 10000
    fsGroup: 10000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: myapp:1.0
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: [ALL]
          add: [NET_BIND_SERVICE]      # 只在真的需要 < 1024 port 才加
      volumeMounts:
        - name: tmp
          mountPath: /tmp              # 需要寫入的目錄單獨掛 volume
        - name: cache
          mountPath: /var/cache
  volumes:
    - name: tmp
      emptyDir: {}
    - name: cache
      emptyDir: {}
```

**重點：**
- `runAsNonRoot: true`：強制不能用 root
- `readOnlyRootFilesystem: true`：rootfs 唯讀，惡意 process 無法落地檔案
- `drop: [ALL]`：拿掉所有 Linux capabilities
- `seccompProfile: RuntimeDefault`：限制 syscall

**常見坑：runAsNonRoot 設了但 image 內 USER 是 root** → Pod 起不來。解法是 build image 時加 `USER 10000`，或在 Dockerfile / image build 階段就處理。

## NetworkPolicy 微切分

預設 K8s 內所有 Pod 互通。**生產環境第一件事：default deny + 白名單**。

```yaml
# 整個 namespace 預設拒絕所有 ingress + egress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: prod
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
# 允許 web 接收 ingress controller 的流量
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-ingress
  namespace: prod
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - port: 8080
---
# 允許 web egress 到 db 跟 DNS
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-egress
  namespace: prod
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: db
      ports: [{port: 5432}]
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - {protocol: UDP, port: 53}
```

**重點：**
- NetworkPolicy 要 CNI 支援才生效（Calico、Cilium、Weave；**Flannel 預設不支援**）
- 一旦有任一條 policy 選到 Pod，這個 Pod 變成「白名單」模式（明示 allow 的才通）
- **別忘記 DNS egress**，否則 Pod 連 service name 都解析不了
- **Cilium 進階**：支援 L7 policy（限制 HTTP path、Kafka topic），不只 L3/L4

## Secret 加密與外部化

K8s Secret 是 base64 不是加密，存在 etcd 內。三道防線：

**1. Encryption at Rest**：etcd 加密

EKS 設定：

```hcl
module "eks" {
  # ...
  cluster_encryption_config = {
    provider_key_arn = aws_kms_key.eks.arn
    resources        = ["secrets"]
  }
}
```

自建 K8s 改 apiserver 的 `--encryption-provider-config`，用 KMS。

**2. RBAC 限制讀取 Secret**

別讓所有 SA 都能 list Secret。Role 內**避免** `verbs: ["get"]` 對 secret 開太大。

**3. 外部化：External Secrets Operator**

不要 commit Secret 到 Git，連 Sealed Secrets 都不上 — 把實際值放 AWS Secrets Manager / Vault，叢集內 ESO 同步成 K8s Secret：

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-sm
  namespace: prod
spec:
  provider:
    aws:
      service: SecretsManager
      region: ap-northeast-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets    # 用 IRSA 接 AWS
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db
  namespace: prod
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-sm
    kind: SecretStore
  target:
    name: db-secret
  data:
    - secretKey: password
      remoteRef:
        key: prod/db/password
```

**重點：**
- Git 內**沒有任何 secret 值**
- AWS Secrets Manager 做 audit、rotation
- 叢集內 SA 透過 IRSA 拿臨時 credentials 連 SM

## Image Security

供應鏈安全的第一道：**鏡像本身要乾淨**。

**1. Image scanning：**
- **Trivy**（最普及，開源）
- ECR / GCR / Harbor 內建 scan
- Snyk / Aqua / Prisma（商業）

CI 階段必跑：

```yaml
# GitHub Actions
- name: Trivy scan
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'myapp:${{ github.sha }}'
    severity: 'CRITICAL,HIGH'
    exit-code: '1'
```

CVE critical / high 就阻擋 merge。

**2. Image hardening：**
- 用 distroless / Alpine base
- 多階段 build：build 階段裝 dev 工具，final stage 只複製 binary
- 不要裝 shell（如果 base 有 shell，建議 distroless `gcr.io/distroless/static`）
- 明確指定 image tag 或 digest（**禁用 `:latest`**）
- 跑 non-root

**3. Image signing：Cosign**

簽名與驗證鏡像來源：

```bash
# 簽
cosign sign --key cosign.key myapp:1.0

# 驗
cosign verify --key cosign.pub myapp:1.0
```

K8s 端用 **Sigstore Policy Controller** 或 **Kyverno** 強制：只跑被簽過的 image。

**4. Registry policy：**
- private registry only（禁 dockerhub 上的隨機 image）
- 鏡像保留政策（舊 image 自動清）
- 拉取限速

## Admission Control：OPA Gatekeeper vs Kyverno

PSA 內建但只管 Pod security。要更廣的政策（強制 label、限制 image source、限制 LoadBalancer），用 **admission controller**。

兩大選擇：

| 面向 | OPA Gatekeeper | Kyverno |
|------|---------------|---------|
| 政策語言 | **Rego**（OPA 通用） | **YAML / Kubernetes-native** |
| 學習曲線 | 陡（Rego 是新語言） | 平（K8s admin 直覺） |
| 政策能力 | 強大、靈活 | 簡單常見需求容易、複雜需要 plugin |
| Mutation | 支援 | 支援、更直覺 |
| 社群 | OPA / CNCF | Nirmata / CNCF |

**Kyverno 範例：禁止用 `:latest` tag**

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-latest-tag
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-image-tag
      match:
        any:
          - resources:
              kinds: [Pod]
      validate:
        message: "Image must specify a tag, :latest is forbidden"
        pattern:
          spec:
            containers:
              - image: "!*:latest"
```

**OPA Gatekeeper 範例：要求 Deployment 必須有 owner label**

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-owner
spec:
  match:
    kinds:
      - apiGroups: ["apps"]
        kinds: ["Deployment"]
  parameters:
    labels: ["owner"]
```

（背後對應的 ConstraintTemplate 用 Rego 寫）

**選擇建議：**
- 不熟 Rego、需求是常見 K8s 政策 → **Kyverno**
- 已用 OPA / 政策需要超複雜邏輯 / 多平台統一（K8s + Terraform + Envoy） → **Gatekeeper**

## Runtime Security：Falco

前面都是「不讓壞東西進來」，**Falco** 是「進來了能不能偵測」。

Falco 用 eBPF 在 Node 監控 syscall，偵測異常行為：
- 容器內出現 shell（`/bin/sh` exec）
- 寫敏感目錄（`/etc/passwd`）
- 監聽未授權的 port
- 修改 kubelet config

範例規則：

```yaml
- rule: Terminal shell in container
  desc: A shell was used as the entrypoint/exec point into a container
  condition: >
    container.id != host and
    proc.name in (shell_binaries) and
    proc.tty != 0
  output: "Shell spawned in container (user=%user.name container=%container.id)"
  priority: WARNING
```

整合 Slack / PagerDuty 通知。

## Supply Chain：SLSA、SBOM、Cosign

供應鏈安全是近年熱門題目（SolarWinds、Log4Shell 之後）：

**SLSA（Supply-chain Levels for Software Artifacts）** — Google 主導，分 0–4 級成熟度：
- L1：build 流程有文檔
- L2：版本控管 + 自動 build
- L3：來源不可篡改、可驗證
- L4：完全可重現的 build

**SBOM（Software Bill of Materials）** — 列出 image 內所有依賴的清單：

```bash
syft myapp:1.0 -o spdx-json > sbom.json
```

存在 registry 或交給 SBOM 平台（Dependency-Track）。CVE 出現時可以查「我用了 log4j 嗎？」。

**Cosign**：sign artifact、verify、attest。SLSA L3 的關鍵工具。

整套供應鏈 hardening：

```
1. Build：固定 base image digest、多階段 build
2. Scan：Trivy 阻擋 critical CVE
3. SBOM：生成 + 存證
4. Sign：Cosign 簽名 image
5. Push：到內部 registry
6. Verify：admission webhook 驗簽才允許 deploy
7. Runtime：Falco 監控異常
```

## Audit Log

K8s apiserver 記錄所有 API 請求。**生產環境必開**。

apiserver flag：

```
--audit-policy-file=/etc/kubernetes/audit-policy.yaml
--audit-log-path=/var/log/audit.log
```

`audit-policy.yaml` 範例：

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: None
    resources:
      - group: ""
        resources: ["events"]      # event 太多，不記
  - level: Metadata
    verbs: ["get", "list", "watch"]
  - level: RequestResponse
    verbs: ["create", "update", "patch", "delete"]
    resources:
      - group: ""
        resources: ["secrets"]      # secret 操作完整記
      - group: "rbac.authorization.k8s.io"
```

audit log 應該送到 SIEM（Splunk、Datadog、CloudWatch）長期保存。

**EKS 直接：** `cluster_enabled_log_types = ["audit", "api", "authenticator"]` Terraform 一行開。

## 面試常考重點

**1. K8s Secret 算加密嗎？怎麼真的安全？**  
**不算**，只是 base64。三層防護：(a) etcd encryption at rest（K8s 內建，EKS 用 KMS 一鍵開）、(b) RBAC 嚴格限制 get/list Secret 的權限、(c) 真正敏感的資料**根本別放 K8s Secret**，用 External Secrets Operator + AWS Secrets Manager / Vault。

**2. 容器要怎麼跑才安全？**  
最小組合：`runAsNonRoot: true`、`readOnlyRootFilesystem: true`、`allowPrivilegeEscalation: false`、`capabilities: drop: [ALL]`、`seccompProfile: RuntimeDefault`、resource limits 設好、image 不用 `:latest`、定期 scan CVE。

**3. PSP 跟 PSA 差在哪？**  
PSP（PodSecurityPolicy）在 1.25 被移除。PSA（Pod Security Admission）是繼任，三個 profile（privileged / baseline / restricted）+ 三種模式（enforce / audit / warn）。比 PSP 簡單但彈性少，複雜需求要搭 Kyverno / Gatekeeper。

**4. RBAC 設計原則？**  
- 最小權限：每個 role 只給絕對需要的 resource + verb
- 別給 `*` verb / `*` resource
- 別用 cluster-admin（除少數真的需要的 SA）
- 用 group 管理（透過 OIDC），不要 per-user binding
- 定期 audit（`kubectl auth can-i --list --as=<user>`）

**5. NetworkPolicy 怎麼正確設？**  
從 default-deny 開始，再用白名單 allow。三件事容易漏：(a) DNS egress（Pod 連不到 service name）、(b) 跨 namespace 通訊要設 namespaceSelector、(c) ingress controller 流量要明示 allow。沒 Calico / Cilium 等支援 NetworkPolicy 的 CNI 就不生效。

**6. Pod 容器逃逸有哪些路徑？**  
- `privileged: true` 容器
- `hostPath` 掛 `/`
- `hostPID / hostNetwork / hostIPC`
- `capabilities: SYS_ADMIN` / `SYS_PTRACE`
- 漏洞 CVE（kernel、runc、containerd）

防禦：PSA restricted profile + 拒絕特權容器的 admission policy + Falco runtime 監控。

**7. OPA Gatekeeper 跟 Kyverno 怎麼選？**  
- 政策需求是常見 K8s 場景（強制 label、禁 latest、要 resource limits）→ Kyverno，YAML 直觀
- 需要跨平台 policy（K8s + Terraform + API Gateway 統一）、或政策超複雜 → Gatekeeper + Rego
- 團隊不熟 Rego 用 Kyverno 入手快

**8. Supply chain attack 怎麼防？**  
全流程 hardening：
- base image fixed digest + 從 internal registry 拉
- CI scan（Trivy / Snyk）阻 critical CVE
- 簽名（Cosign）+ K8s 端 verify webhook 拒絕未簽 image
- 生成 SBOM 並存證
- 開發者 PR review、protected branch
- secret 走 secret manager 不入 git
- audit log 全程記錄

**9. EKS 上特別的安全議題？**  
- IRSA / Pod Identity 取代 instance role
- cluster endpoint 預設 private + IAM access entries
- VPC CNI 讓 Pod IP 跟 EC2 在同 VPC，可以套 SG
- encryption at rest（EKS 用 KMS）
- ECR image scanning 阻 push 有 CVE 的 image
- GuardDuty for EKS 偵測異常 API call

**10. 多 tenant K8s 怎麼隔離？**  
單純 namespace 不夠（共用 control plane、kernel、Node）。加強：
- ResourceQuota + LimitRange（資源隔離）
- NetworkPolicy（網路隔離）
- PSA restricted（Pod 安全）
- RBAC 嚴格分權
- 不同 tenant 跑在不同 Node（taint + toleration、Node 親和性）
- 高隔離需求：每個 tenant 一個 cluster、或用 vCluster / Capsule

**11. Audit log 該記什麼？**  
- Secret 的所有 CRUD（含 verb）
- RBAC 變更（Role / Binding 新增刪改）
- ConfigMap 變更
- exec、portforward 進入 Pod
- Node 操作
- privileged container 建立  
不要記：event、get/list/watch（量太大）

**12. K8s 安全工具該裝哪些？**  
基本盤（任何 prod 都該裝）：
- Trivy（CI image scan）
- Kyverno 或 Gatekeeper（admission policy）
- External Secrets Operator
- kube-bench（CIS Benchmark 掃描）
- Falco（runtime 偵測）

進階：
- Cosign + policy controller（image signing）
- Tetragon / Cilium Hubble（eBPF 觀測）
- Trivy Operator（持續 scan 叢集內所有 image）

## 小結

K8s 安全是分層防禦的代表：

| 層級 | 重點 |
|------|------|
| Image / Code | base image digest、scan CVE、Cosign sign、SBOM |
| Build / Supply Chain | CI 阻 CVE、protected branch、secret 不入 git |
| Cluster admission | PSA restricted、Kyverno/Gatekeeper policy、verify signature |
| Pod runtime | securityContext non-root + readOnly + drop caps + seccomp |
| Network | default deny + NetworkPolicy 白名單 |
| RBAC | 最小權限、按 group、定期 audit |
| Secret | Encryption at rest + External Secrets + IRSA |
| Runtime detection | Falco eBPF 監控異常 |
| Auditing | audit log 送 SIEM、保留 90+ 天 |

**面試心法**：被問 K8s 安全時不要只答 RBAC + NetworkPolicy，要展現有 4C 分層觀念、有 supply chain 意識、會用 admission control + runtime detection 完整 stack。

下一篇進入 K8s Networking 進階：CNI 原理、kube-proxy iptables/IPVS、Service Mesh 概念與選型。
