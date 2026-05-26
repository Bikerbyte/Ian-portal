---
title: "Kubernetes 學習筆記 - 核心觀念與基礎物件"
excerpt: "Kubernetes 從零到面試不怕被問（上）：架構、Pod、Deployment、Service、ConfigMap、Secret、Namespace、Label/Selector 與 kubectl 實作。"
date: 2026-05-15
category: "學習"
tags:
  - Kubernetes
  - K8s
  - Container
series: "Kubernetes"
seriesOrder: 1
featured: false
---

## Agenda

- Kubernetes 是什麼？解決什麼問題？
- 整體架構：Control Plane 與 Node
- 基本物件：Pod、ReplicaSet、Deployment
- Service 與 Service Type
- Namespace、Label、Selector
- ConfigMap 與 Secret
- kubectl 常用指令
- 第一個 Deployment 實作
- 小結

## Kubernetes 是什麼？解決什麼問題？

**Kubernetes（K8s）** 是 Google 開源的容器編排（Container Orchestration）平台。

直接用 Docker 跑容器當然可以，但實務上會碰到：

- 一台主機掛了，容器全部消失
- 流量大了要手動擴展實例
- 上線更新時怎麼做零中斷
- 容器要怎麼互相找到對方（service discovery）
- 設定檔、密碼要怎麼動態注入

K8s 用「**宣告式 + 自我修復**」模型解決這些問題：你寫 YAML 描述「我要 3 個 nginx 副本」，K8s 持續努力讓實際狀態符合你描述的目標 — 容器死了會重新拉起、Node 掛了會搬到別台、deployment 更新會做 rolling update。

**核心心態**：你告訴 K8s「目標長什麼樣」，不是「該做哪些步驟」。

## 整體架構

K8s 分成兩種節點角色：

```
┌─────────────────── Control Plane (Master) ─────────────────┐
│                                                            │
│   ┌─────────────┐  ┌──────────────────┐  ┌─────────────┐   │
│   │ kube-       │  │ etcd             │  │ kube-       │   │
│   │ apiserver   │←→│ (key-value DB)   │  │ scheduler   │   │
│   └─────────────┘  └──────────────────┘  └─────────────┘   │
│         ↑                                       │          │
│         │          ┌──────────────────┐         │          │
│         └──────────┤ kube-controller- │←────────┘          │
│                    │ manager          │                    │
│                    └──────────────────┘                    │
└────────────────────────────┬───────────────────────────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
│  Node 1     │       │  Node 2     │       │  Node N     │
│ ┌─────────┐ │       │ ┌─────────┐ │       │             │
│ │ kubelet │ │       │ │ kubelet │ │       │   ...       │
│ │ kube-   │ │       │ │ kube-   │ │       │             │
│ │ proxy   │ │       │ │ proxy   │ │       │             │
│ │ runtime │ │       │ │ runtime │ │       │             │
│ └─────────┘ │       │ └─────────┘ │       │             │
│  Pod  Pod   │       │   Pod       │       │   Pod  Pod  │
└─────────────┘       └─────────────┘       └─────────────┘
```

**Control Plane 元件：**

| 元件 | 角色 |
|------|------|
| **kube-apiserver** | 所有操作的唯一入口，REST API |
| **etcd** | 整個叢集狀態的 key-value 儲存（單一真相來源） |
| **kube-scheduler** | 決定 Pod 應該排到哪個 Node |
| **kube-controller-manager** | 跑各種 controller（ReplicaSet、Node、Endpoint…），把實際狀態調成目標狀態 |
| **cloud-controller-manager** | 跟雲端整合（LB、Volume、Node lifecycle） |

**Node 元件：**

| 元件 | 角色 |
|------|------|
| **kubelet** | 跟 apiserver 通訊，管理本機 Pod 生命週期 |
| **kube-proxy** | 維護 Node 上的網路規則（iptables / IPVS），實作 Service 抽象 |
| **container runtime** | 真正跑容器，常見：containerd、CRI-O（Docker 已被 deprecated 為 runtime） |

整個系統運作的關鍵：**所有元件都只跟 apiserver 通訊**，etcd 只有 apiserver 能直接動。

## Pod：K8s 的最小調度單位

**Pod 是 K8s 排程的最小單位**，不是 container。

一個 Pod 可以有一個或多個 container，這些 container：
- 共用 network namespace（同一個 IP、互相用 `localhost` 通訊）
- 共用 storage volume
- 一起被排程、一起生命週期

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
  labels:
    app: nginx
spec:
  containers:
    - name: nginx
      image: nginx:1.27
      ports:
        - containerPort: 80
```

**重點觀念：Pod 是短暫的（ephemeral）**。Pod 掛了不會自動重生（除非有 controller 管理它），重生後 IP 也會變，所以實務上幾乎不直接寫單一 Pod，而是用 **Deployment** 或 **StatefulSet** 管理。

**多容器 Pod 的常見 pattern：**

- **Sidecar**：附加功能容器（log shipper、proxy）
- **Init container**：主容器啟動前先跑（資料庫 migration、等服務上線）
- **Ambassador**：對外通訊代理

## ReplicaSet 與 Deployment

**ReplicaSet** 確保「指定數量的相同 Pod 在跑」，Pod 死了就重新拉起。但實務上不會直接寫 ReplicaSet。

**Deployment** 是 ReplicaSet 的更高層抽象，多了：
- 版本控制
- Rolling update（滾動更新）
- Rollback（回滾）

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - containerPort: 80
```

更新 image 時 K8s 預設用 **RollingUpdate** 策略，逐批替換 Pod，達到零中斷：

```bash
kubectl set image deployment/nginx nginx=nginx:1.28
kubectl rollout status deployment/nginx
kubectl rollout history deployment/nginx
kubectl rollout undo deployment/nginx        # 回滾到上一版
kubectl rollout undo deployment/nginx --to-revision=2
```

Rolling update 行為由 `strategy` 控制：

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1          # 過程中最多可以多出幾個 Pod
    maxUnavailable: 0    # 過程中最多容許幾個 Pod 不可用
```

## Service 與 Service Type

Pod IP 會變，所以不能直接拿 Pod IP 通訊。**Service** 提供一個穩定的虛擬 IP（ClusterIP）和 DNS 名稱，把流量轉發到符合 selector 的 Pod。

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx
spec:
  selector:
    app: nginx          # 對應 Pod 的 label
  ports:
    - port: 80          # Service 對外的 port
      targetPort: 80    # Pod 內的 port
  type: ClusterIP       # 預設
```

**Service Type 四種：**

| Type | 用途 | 對外暴露? |
|------|------|----------|
| **ClusterIP** | 叢集內部通訊（預設） | ❌ |
| **NodePort** | 每個 Node 開一個 port (30000-32767) | ✅ Node IP:Port |
| **LoadBalancer** | 跟雲端整合，配 LB | ✅ LB DNS/IP |
| **ExternalName** | DNS CNAME 別名 | N/A |

**ClusterIP DNS 名稱規則**：`<service-name>.<namespace>.svc.cluster.local`，同 namespace 內可以直接用 `<service-name>` 連線。

**Headless Service**：把 `clusterIP: None`，讓 DNS 回傳所有 Pod IP 而不是單一 VIP，搭配 StatefulSet 使用。

## Namespace、Label、Selector

**Namespace** 是邏輯隔離單位，常見用法：dev、staging、prod 各一個，或按團隊分。

```bash
kubectl create namespace dev
kubectl get pods -n dev
kubectl config set-context --current --namespace=dev
```

預設四個 namespace：
- `default`：沒指定就放這
- `kube-system`：K8s 系統元件
- `kube-public`：所有人（含 unauthenticated）可讀
- `kube-node-lease`：node heartbeat

**Label** 是 key-value tag，貼在物件上：

```yaml
metadata:
  labels:
    app: nginx
    env: prod
    tier: frontend
```

**Selector** 是查詢 label 的條件，是 K8s 內部物件互相連結的方式：

- Service 用 selector 找對應的 Pod
- Deployment 用 selector 找自己管理的 ReplicaSet
- NetworkPolicy 用 selector 決定規則套用範圍

```bash
# 列出所有 label app=nginx 的 Pod
kubectl get pods -l app=nginx

# 多條件
kubectl get pods -l 'env in (prod,staging),tier=frontend'
```

**Annotation** 跟 Label 像但用途不同：Annotation 不能拿來 selector，只是附加 metadata（部署時間、git commit、文件連結）。

## ConfigMap 與 Secret

設定不應該寫死在 image 內。K8s 用 **ConfigMap** 存非機敏設定、**Secret** 存敏感資料。

**ConfigMap：**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  LOG_LEVEL: "info"
  DB_HOST: "postgres.default.svc.cluster.local"
  app.conf: |
    server {
      listen 80;
    }
```

**Secret**（base64 編碼，**不是加密**）：

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
data:
  username: YWRtaW4=        # base64 of "admin"
  password: czNjcjN0
```

或從檔案建：

```bash
kubectl create secret generic db-secret \
  --from-literal=username=admin \
  --from-literal=password=s3cr3t
```

**注入到 Pod 的兩種方式：**

1. **環境變數**

```yaml
spec:
  containers:
    - name: app
      image: myapp
      envFrom:
        - configMapRef:
            name: app-config
      env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: password
```

2. **掛載為檔案**

```yaml
spec:
  containers:
    - name: app
      image: myapp
      volumeMounts:
        - name: config
          mountPath: /etc/app
  volumes:
    - name: config
      configMap:
        name: app-config
```

掛載為檔案的好處是 K8s 會自動更新（檔案內容變了 Pod 內也會變），環境變數方式則需要重啟 Pod 才會生效。

**Secret 不是加密**這點很重要：預設只是 base64，etcd 上仍是明文存。生產環境要：
- 開 etcd encryption at rest
- 用 External Secrets Operator + Vault / AWS Secrets Manager
- RBAC 嚴格控制 Secret 讀取權限

## kubectl 常用指令

```bash
# Context / Namespace
kubectl config get-contexts
kubectl config use-context my-cluster
kubectl config set-context --current --namespace=dev

# 查資源
kubectl get pods                          # 當前 ns 的 Pod
kubectl get pods -A                       # 所有 ns
kubectl get pods -o wide                  # 含 IP / Node
kubectl get pods -o yaml                  # 完整 YAML
kubectl get deploy,svc,cm                 # 多種一起查

# 詳細資訊與事件
kubectl describe pod <name>
kubectl get events --sort-by='.lastTimestamp'

# 套用 / 刪除
kubectl apply -f deployment.yaml          # 宣告式（推薦）
kubectl delete -f deployment.yaml
kubectl create -f deployment.yaml         # 命令式（不會更新已存在的）

# Log / Exec
kubectl logs <pod>                        # 主容器
kubectl logs <pod> -c <container>         # 指定容器
kubectl logs <pod> -f --tail=100          # follow
kubectl logs <pod> --previous             # 上一次崩潰的 log
kubectl exec -it <pod> -- bash            # 進入容器

# Port-forward / debug
kubectl port-forward svc/nginx 8080:80    # 本機 8080 → svc 80
kubectl debug <pod> -it --image=busybox   # debug container

# 編輯 / 重啟
kubectl edit deployment/nginx
kubectl rollout restart deployment/nginx  # 強制重新拉 Pod（常用於更新 ConfigMap）

# Scale
kubectl scale deployment/nginx --replicas=5

# Dry run（拿來生 YAML 模板）
kubectl create deployment nginx --image=nginx --dry-run=client -o yaml
```

## 第一個 Deployment 實作

完整跑一遍：建 Deployment + Service + ConfigMap，然後驗證。

`app.yaml`：

```yaml
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-config
data:
  default.conf: |
    server {
      listen 80;
      location / {
        return 200 "Hello from $hostname\n";
        add_header Content-Type text/plain;
      }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - containerPort: 80
          volumeMounts:
            - name: config
              mountPath: /etc/nginx/conf.d
      volumes:
        - name: config
          configMap:
            name: nginx-config
---
apiVersion: v1
kind: Service
metadata:
  name: nginx
spec:
  selector:
    app: nginx
  ports:
    - port: 80
      targetPort: 80
  type: ClusterIP
```

套用 + 驗證：

```bash
kubectl apply -f app.yaml
kubectl get pods -l app=nginx
kubectl port-forward svc/nginx 8080:80

# 另一個 terminal
curl http://localhost:8080
# Hello from nginx-xxxxxxxxxx-yyyyy

# 多打幾次會看到不同 hostname → load balancing
```

更新 ConfigMap 後要重啟 Pod 才會載入新設定（掛載為檔案 ≠ Nginx reload）：

```bash
kubectl edit cm nginx-config
kubectl rollout restart deployment/nginx
```

## 小結

這篇蓋了 K8s 最常用、面試最常問的基礎物件：

- **架構**：apiserver / etcd / scheduler / controller-manager 構成 control plane；kubelet / kube-proxy / runtime 跑在每個 Node
- **Pod**：最小調度單位，幾乎都用 Deployment 管理
- **Deployment**：ReplicaSet 之上的版本控制 + rolling update
- **Service**：穩定的 VIP + DNS，用 selector 串到 Pod
- **ConfigMap / Secret**：設定外部化，環境變數或檔案掛載
- **Namespace / Label / Selector**：邏輯隔離 + 物件之間的連結方式

下一篇進入：Probes、Resource limits、RBAC、Storage（PV/PVC、StatefulSet）、網路（Ingress、NetworkPolicy）、自動擴展（HPA）、Troubleshooting，以及面試會被深挖的進階重點。
