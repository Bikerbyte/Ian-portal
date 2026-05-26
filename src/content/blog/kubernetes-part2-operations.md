---
title: "Kubernetes 學習筆記 - 進階運維與面試重點"
excerpt: "Kubernetes 從零到面試不怕被問（下）：Probes、Resource limits、Storage、StatefulSet、Ingress、NetworkPolicy、RBAC、HPA、Troubleshooting 與面試常考題完整整理。"
date: 2026-05-22
category: "學習"
tags:
  - Kubernetes
  - K8s
  - DevOps
series: "Kubernetes"
seriesOrder: 2
featured: true
---

## Agenda

- Probes：Liveness / Readiness / Startup
- Resource Requests / Limits 與 QoS
- Storage：Volume、PV、PVC、StorageClass
- StatefulSet vs Deployment vs DaemonSet vs Job/CronJob
- Service Account 與 RBAC
- Ingress 與 Ingress Controller
- NetworkPolicy
- HPA / VPA / Cluster Autoscaler
- Pod Scheduling：nodeSelector、affinity、taint/toleration
- Helm 與 Kustomize
- Troubleshooting 流程
- 面試常考重點
- 小結

## Probes：Liveness / Readiness / Startup

K8s 不會主動知道你的 app 是不是健康，要透過 **Probe** 告訴它。

| Probe | 失敗結果 | 用途 |
|-------|----------|------|
| **Liveness** | 重啟 container | 偵測「卡死」（deadlock、無限迴圈） |
| **Readiness** | 從 Service endpoint 移除 | 偵測「暫時不能服務」（warm-up、依賴沒準備好） |
| **Startup** | 重啟 container | 啟動慢的 app，延後 liveness 開始檢查 |

```yaml
containers:
  - name: app
    image: myapp:1.0
    startupProbe:
      httpGet:
        path: /healthz
        port: 8080
      failureThreshold: 30      # 30 次都失敗才認定啟動失敗
      periodSeconds: 10         # 即最多 5 分鐘啟動時間
    readinessProbe:
      httpGet:
        path: /ready
        port: 8080
      periodSeconds: 5
      failureThreshold: 3
    livenessProbe:
      httpGet:
        path: /healthz
        port: 8080
      periodSeconds: 10
      failureThreshold: 3
```

**常見錯誤：把 liveness 跟 readiness 寫成同一個 endpoint**。Readiness 失敗只是把流量切走，liveness 失敗會直接砍 Pod。如果你的「健康檢查」會因為下游服務暫時掛掉而失敗，那 liveness 跟著失敗就會無限重啟，反而更糟。**Liveness 該檢查的是「我自己活著」，不是「我能服務」**。

Probe 類型有三種：`httpGet`、`tcpSocket`、`exec`。

## Resource Requests / Limits 與 QoS

每個 container 都該設 `requests` 和 `limits`：

```yaml
resources:
  requests:
    cpu: 100m       # 0.1 CPU
    memory: 128Mi
  limits:
    cpu: 500m       # 0.5 CPU
    memory: 256Mi
```

- **requests**：scheduler 用來決定 Pod 排到哪個 Node（保證資源）
- **limits**：容器最多能用的上限（CPU 超過會被 throttle，memory 超過會被 **OOMKilled**）

**QoS Class** K8s 自動推算，影響 Node 資源不足時誰先被驅逐：

| Class | 條件 | 驅逐順序 |
|-------|------|---------|
| **Guaranteed** | 所有 container `requests == limits` 且都有設 | 最後驅逐 |
| **Burstable** | 至少有設 requests，但跟 limits 不完全相等 | 中間 |
| **BestEffort** | 完全沒設 requests / limits | 最先驅逐 |

正式環境的 Pod 至少要 Burstable，關鍵服務設成 Guaranteed。

**CPU limit 的陷阱**：設了 CPU limit 會啟用 CFS throttling，即使 Node 有 idle CPU 也會被限制，導致延遲尖刺。實務上很多人**只設 CPU requests 不設 limit**。

## Storage：Volume、PV、PVC、StorageClass

容器本身的檔案系統是短暫的（重啟就消失），要持久化必須掛 Volume。

**Volume 類型多種**：
- `emptyDir`：Pod 生命週期內的暫存目錄
- `hostPath`：掛 Node 上的目錄（debug 用，正式環境少用）
- `configMap` / `secret`：掛設定
- `persistentVolumeClaim`：掛持久化儲存

**持久化儲存三層抽象**：

```
StorageClass     ← 描述 storage 的「規格」（SSD、HDD、IOPS）
    ↓ provision
PersistentVolume ← 實際的儲存資源（AWS EBS、NFS、Ceph）
    ↑ bind
PersistentVolumeClaim ← Pod 對 PV 的「請求」
    ↑ mount
Pod
```

**StorageClass**：

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp3
  fsType: ext4
reclaimPolicy: Retain       # PVC 刪掉後 PV 保留（重要資料）
volumeBindingMode: WaitForFirstConsumer  # 等 Pod 排程後才 provision，避免跨 AZ
```

**PVC（用戶視角）**：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 10Gi
```

**Pod 掛 PVC**：

```yaml
spec:
  containers:
    - name: app
      volumeMounts:
        - name: data
          mountPath: /var/data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: data
```

**accessModes：**

| 模式 | 縮寫 | 意義 |
|------|------|------|
| ReadWriteOnce | RWO | 單一 Node 可讀寫（最常見，EBS、GCE Disk） |
| ReadOnlyMany | ROX | 多 Node 唯讀 |
| ReadWriteMany | RWX | 多 Node 可讀寫（NFS、EFS、CephFS） |
| ReadWriteOncePod | RWOP | 單一 Pod 可讀寫（K8s 1.22+） |

## StatefulSet vs Deployment vs DaemonSet vs Job/CronJob

| 控制器 | 用途 | Pod 識別 | Pod 順序 |
|--------|------|---------|---------|
| **Deployment** | 無狀態應用 | 隨機 hash | 無 |
| **StatefulSet** | 有狀態應用（DB、queue） | 固定名稱 `<name>-0`, `-1`, `-2` | 嚴格順序啟動/刪除 |
| **DaemonSet** | 每個 Node 一個 Pod | per Node | 無 |
| **Job** | 一次性任務 | hash | 無 |
| **CronJob** | 定時任務 | hash | 無 |

**StatefulSet 特性**：
- Pod 有固定的 ordinal name，連 DNS 也固定（`mysql-0.mysql.default.svc.cluster.local`）
- 每個 Pod 一個獨立 PVC（`volumeClaimTemplates`）
- 啟動順序 0 → 1 → 2，刪除順序 2 → 1 → 0
- 用於 Kafka、Cassandra、Postgres、ES 這種要穩定身份的服務

**DaemonSet** 典型用途：log shipper（Fluent Bit）、監控 agent（node-exporter）、網路插件（Calico）。

**Job 範例**：

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: myapp:1.0
          command: ["./migrate.sh"]
      restartPolicy: OnFailure
  backoffLimit: 4
```

**CronJob**：

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: backup:latest
          restartPolicy: OnFailure
```

## Service Account 與 RBAC

**Pod 跟 K8s API 通訊**靠 Service Account（SA）。每個 Pod 預設掛 `default` SA。

**RBAC（Role-Based Access Control）** 四個物件：

```
Role / ClusterRole    ← 「能做什麼」（permissions）
       ↓ binding
RoleBinding / ClusterRoleBinding  ← 「誰能做」
       ↓ subject
User / Group / ServiceAccount
```

`Role` 限定在 namespace 內，`ClusterRole` 全叢集。

範例：給某個 SA 唯讀 Pod 權限。

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: pod-reader
  namespace: dev
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: dev
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pod-reader
  namespace: dev
subjects:
  - kind: ServiceAccount
    name: pod-reader
    namespace: dev
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

**最小權限原則**：別給 Pod `cluster-admin`，列清楚需要的 resource 跟 verb。

雲端整合常見模式：**Workload Identity / IRSA**（IAM Roles for ServiceAccounts），把 IAM Role 綁到 K8s SA，Pod 透過 SA token 換取 IAM credentials，不用塞 access key。

## Ingress 與 Ingress Controller

`Service type: LoadBalancer` 每個 Service 都要一顆 LB，貴又難管 TLS、路由。

**Ingress** 是 L7（HTTP/HTTPS）路由抽象，可以一個 LB 入口 + 多個 host/path 規則：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts: [app.example.com]
      secretName: app-tls
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 80
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
```

**重點**：Ingress 物件本身只是規則，要有 **Ingress Controller** 才會被實現。常見選擇：
- **NGINX Ingress Controller**：最普及
- **Traefik**：設定簡單，內建 Let's Encrypt
- **AWS Load Balancer Controller**：直接配 AWS ALB
- **Istio / Linkerd Gateway**：service mesh

新版 K8s 推 **Gateway API** 取代 Ingress，提供更彈性的路由抽象（HTTPRoute、TLSRoute、TCPRoute），新專案可以考慮直接用。

## NetworkPolicy

預設 K8s 內所有 Pod 互通，**NetworkPolicy** 提供 L3/L4 防火牆規則。

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-policy
  namespace: prod
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: web
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: db
      ports:
        - protocol: TCP
          port: 5432
    - to:                            # 允許 DNS
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
```

意義：`app=api` 的 Pod 只接受來自 `app=web` 的 8080，只能對外連到 `app=db` 的 5432 跟 DNS。

**注意**：
- NetworkPolicy 要有支援的 CNI（Calico、Cilium、Weave）才會生效，**Flannel 預設不支援**
- Selector 沒匹配到的 Pod 完全不受規則影響
- 一個 Pod 被任何一條 policy 選到後，預設變成 deny-all + 規則裡 allow 的

## HPA / VPA / Cluster Autoscaler

**Horizontal Pod Autoscaler（HPA）**：根據 metrics 自動調整 Pod 數量。

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

要 HPA 能跑，叢集要裝 **metrics-server**。也可以根據 custom metrics（QPS、queue depth）擴展，需要 Prometheus Adapter 之類的 metrics pipeline。

**Vertical Pod Autoscaler（VPA）**：自動調整單一 Pod 的 requests/limits。少用，因為調整需要重啟 Pod。

**Cluster Autoscaler**：當 Pod 因為資源不足排不上 Node 時，自動加 Node；Node 閒置時自動縮減。需要跟雲端 ASG 整合。

**Karpenter**（AWS 推的下一代）取代 Cluster Autoscaler，更快、更彈性，直接根據 Pod requirements 開合適規格的 EC2。

## Pod Scheduling

scheduler 預設會自動排程，但有時要控制：

**nodeSelector**（最簡單）：

```yaml
spec:
  nodeSelector:
    disktype: ssd
```

**Affinity / Anti-affinity**（更彈性）：

```yaml
spec:
  affinity:
    nodeAffinity:                # 要求 Node 有某 label
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: topology.kubernetes.io/zone
                operator: In
                values: [ap-northeast-1a, ap-northeast-1c]
    podAntiAffinity:             # 同 app 的 Pod 不要排在同一 Node
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            labelSelector:
              matchLabels:
                app: api
            topologyKey: kubernetes.io/hostname
```

**Taint / Toleration**：Node 拒絕一般 Pod，只有 tolerate 該 taint 的 Pod 才能排上。常用於專用 Node Pool（GPU node 只跑 ML 工作負載）。

```bash
kubectl taint nodes node1 dedicated=gpu:NoSchedule
```

```yaml
spec:
  tolerations:
    - key: dedicated
      operator: Equal
      value: gpu
      effect: NoSchedule
```

## Helm 與 Kustomize

YAML 寫多了會發現大量重複，兩個主流解法：

**Helm**：套件管理工具，把 YAML 模板化（Go template），參數抽到 `values.yaml`。

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install my-redis bitnami/redis --set auth.password=s3cret
helm upgrade my-redis bitnami/redis -f values.yaml
helm rollback my-redis 1
```

優點：版本管理、rollback、社群豐富的 charts。缺點：模板語法不直觀，debug 麻煩。

**Kustomize**：用 patch overlay 的方式管理多環境，不用模板。

```
base/
  deployment.yaml
  service.yaml
  kustomization.yaml
overlays/
  prod/
    kustomization.yaml
    replicas-patch.yaml
  dev/
    kustomization.yaml
```

```bash
kubectl apply -k overlays/prod
```

優點：純 YAML、好讀。缺點：複雜邏輯不好做。

**選擇建議**：用社群 chart 就 Helm，自己 app 多環境管理用 Kustomize，兩者並用也很常見。

## Troubleshooting 流程

K8s 出問題的 SOP：

**1. Pod 卡在 Pending**

```bash
kubectl describe pod <pod>
# 看 Events，常見：
# - 沒有 Node 資源 → 加 Node、調 requests
# - PVC 卡 → 看 PVC status、StorageClass
# - nodeSelector / taint 不符 → 看 Node label / taint
```

**2. Pod CrashLoopBackOff**

```bash
kubectl logs <pod>                  # 當前 log
kubectl logs <pod> --previous       # 上次 crash 的 log（關鍵）
kubectl describe pod <pod>          # 看 last state、exit code
```

退出碼速查：
- `137`：SIGKILL（OOMKilled 或被 evict）
- `139`：SIGSEGV（segfault）
- `1` / `2`：app 主動退出

**3. Pod Running 但連不上 / 502**

```bash
kubectl get endpoints <service>     # Service 有沒有對應到 Pod IP
# 沒對應 = selector 不匹配、Pod 沒 Ready
kubectl describe pod <pod>          # 看 readinessProbe 狀態
kubectl exec <pod> -- curl localhost:<port>  # Pod 內測
```

**4. 慢、超時**

```bash
kubectl top pods                    # CPU/Memory 用量
kubectl top nodes
kubectl get hpa                     # 有沒有觸發擴展
kubectl describe node <node>        # 看 Conditions、資源使用
```

**5. ImagePullBackOff**

```bash
kubectl describe pod <pod>
# 常見：image 名稱錯、tag 不存在、私有 repo 沒設 imagePullSecret
```

**6. ConfigMap / Secret 更新 Pod 沒生效**

ConfigMap 掛載為 env var **不會自動更新**，必須 `kubectl rollout restart`。掛載為 file 會自動同步，但 app 通常不會自動 reload — 還是要 SIGHUP 或重啟。

## 面試常考重點

**1. Pod、ReplicaSet、Deployment 三者關係？**  
Pod 是最小調度單位但短暫；ReplicaSet 確保指定數量的 Pod 在跑；Deployment 管理 ReplicaSet 加上版本控制、rolling update、rollback。實務上幾乎都用 Deployment，極少直接寫 Pod 或 ReplicaSet。

**2. Service 怎麼把流量送到 Pod？**  
Service 有 selector，匹配的 Pod IP 會被寫進 Endpoints（K8s 1.21+ 是 EndpointSlice）。kube-proxy 在每個 Node 維護 iptables / IPVS 規則，把連到 Service ClusterIP 的流量 DNAT 到實際 Pod IP，並做負載均衡。

**3. Liveness 跟 Readiness 差在哪？什麼時候誤用會出事？**  
Liveness 失敗會重啟 container，readiness 失敗只是從 Service endpoint 移除。如果把 readiness 邏輯（會檢查下游 DB）放進 liveness，下游一掛你的 Pod 就無限重啟，反而更糟。Liveness 該檢查「我自己活著」，readiness 才檢查「我能服務」。

**4. Pod 被 OOMKilled 怎麼處理？**  
看 `kubectl describe pod` 的 last state，會顯示 OOMKilled、exit code 137。對策：拉高 memory limit、確認 app 沒 memory leak、考慮 JVM 等程式的 heap 設定要跟 container limit 對齊（用 `MaxRAMPercentage`）。

**5. 為什麼 CPU limit 要小心？**  
CPU limit 啟用 CFS throttling，即使 Node 有空 CPU 也會被限制，造成尖刺延遲。實務常見作法：設 CPU requests 不設 limit（讓 burst），memory 一定要設 limit。

**6. ConfigMap 改了 Pod 沒更新？**  
- 環境變數方式注入：**不會更新**，要 `kubectl rollout restart`
- 檔案掛載：K8s 會更新檔案，但 app 不會自動 reload，仍要重啟或發 reload signal

**7. StatefulSet 跟 Deployment 怎麼選？**  
要固定身份（DNS、PVC 一對一）、要嚴格啟動順序、要每個 Pod 獨立持久化儲存 → StatefulSet（Kafka、MySQL、ES）。其他無狀態服務 → Deployment。

**8. Pod 排不上 Node，怎麼 debug？**  
`kubectl describe pod` 看 Events。常見原因：
- Insufficient cpu/memory：Node 資源不夠 → 加 Node 或調 requests
- 0/N nodes are available: untolerated taint → 加 toleration 或 nodeSelector 對不上
- pod has unbound immediate PersistentVolumeClaims：PVC 還沒 bind
- node(s) didn't match Pod's node affinity：affinity 規則沒符合的 Node

**9. Service 的 ClusterIP / NodePort / LoadBalancer / Ingress 怎麼選？**  
- 內部服務互通 → ClusterIP
- 開發環境快速對外 → NodePort
- 雲端對外、單一服務 → LoadBalancer
- 多服務共用入口、做 path/host 路由、TLS termination → Ingress（+ Ingress Controller）

**10. Namespace 可以做硬性資源隔離嗎？**  
單純 Namespace 只是邏輯隔離。要硬性限制：
- **ResourceQuota**：限制 namespace 內總用量（CPU、memory、Pod 數）
- **LimitRange**：限制單一 Pod / Container 的 min/max
- **NetworkPolicy**：限制跨 namespace 通訊
- 多租戶嚴格隔離考慮 vCluster、不同叢集

**11. K8s 內幾種 controller 在幹嘛？**  
Controller manager 內跑很多 controller，每個都在 reconcile loop：observe 實際狀態 → 比對目標 → 採取行動。例如 Deployment controller 比對 Deployment spec 跟現有 ReplicaSet、Node controller 監控 Node heartbeat 並標記 NotReady。整個 K8s 就是「一堆 controller 各自 reconcile」的設計哲學。

**12. RBAC 給太大權限的危險？**  
給 ServiceAccount 過大權限（如 cluster-admin），Pod 一旦被攻破，攻擊者就能控制整個叢集。最小權限原則：每個 SA 只給需要的 resource + verb；用 PodSecurityAdmission 限制容器能力；定期 audit。

**13. 怎麼做零中斷部署？**  
- Deployment 預設就是 RollingUpdate
- 設好 readiness probe（不 Ready 不接流量）
- `terminationGracePeriodSeconds` 給足夠時間讓 in-flight request 收尾
- preStop hook 做收尾邏輯（從 LB 拔掉、發 SIGTERM 給 app）
- PodDisruptionBudget 限制可同時下線的 Pod 數

**14. Pod 收到 SIGTERM 後發生什麼事？**  
1. K8s 把 Pod 從 Service endpoints 移除（停止接新流量）
2. 同時對主 process 發 SIGTERM
3. 等 `terminationGracePeriodSeconds`（預設 30s）
4. 還沒退出就發 SIGKILL  
App 端要正確處理 SIGTERM：停止接收新請求、處理完現有請求、釋放資源、退出。

**15. etcd 的角色與重要性？**  
etcd 是整個叢集的唯一真相來源，所有資源狀態都存在裡面。etcd 掛了 = 整個 control plane 掛（雖然現有 Pod 還會繼續跑，但無法做任何變更）。生產環境要：
- 至少 3 或 5 個 member（奇數，容忍 1 或 2 個掛）
- 定期 backup（`etcdctl snapshot save`）
- 跟 apiserver 用 mTLS

**16. K8s 跟 Docker Swarm / ECS / Nomad 比較？**  
K8s 最複雜但生態最大；Swarm 簡單但功能少、社群冷；ECS 跟 AWS 整合好但 vendor lock；Nomad 輕量、支援非容器工作負載。**新專案 95% 選 K8s**。

**17. Helm 跟 Kustomize 怎麼選？**  
用社群 chart（Prometheus、Cert-Manager、Ingress-NGINX）→ Helm；自己 app 多環境管理 → Kustomize 更好讀；兩者並用：Helm 裝第三方 + Kustomize 管自己 app 的 overlay，是常見實務搭配。

**18. K8s 怎麼跟 IaC（Terraform、Ansible）搭？**  
- **Terraform** 建叢集本體（EKS/GKE/AKS）、Node Pool、IAM、VPC
- **Ansible / 直接 Helm + ArgoCD** 部署叢集內的 workload
- **ArgoCD / Flux** 做 GitOps，把 K8s manifest 跟 Git 狀態同步

## 小結

這篇把 K8s 面試常深挖的進階主題一次蓋完：

- **健康管理**：probes（liveness/readiness/startup）正確使用、resource requests/limits、QoS class
- **儲存**：emptyDir、ConfigMap、Secret、PV/PVC/StorageClass、StatefulSet
- **網路與安全**：Service Type、Ingress + Ingress Controller、NetworkPolicy、RBAC、Workload Identity
- **彈性**：HPA / VPA / Cluster Autoscaler / Karpenter、affinity / taint / toleration
- **生產化**：Helm / Kustomize、Troubleshooting SOP、零中斷部署、SIGTERM 處理

跟前兩篇串起來，整套面試會問的「IaC + 容器編排」就齊了：

| 階段 | 工具 | 主要任務 |
|------|------|---------|
| 1. 雲端基礎設施 | **Terraform** | VPC、EKS cluster、IAM、RDS |
| 2. 主機設定 / 應用部署 | **Ansible** | 套件安裝、設定管理、app 部署到 VM |
| 3. 容器編排 | **Kubernetes** | Pod 排程、自癒、擴展、滾動更新 |
| 4. GitOps | **ArgoCD / Flux** | K8s manifest 與 Git 同步 |

下一步想做的可以是：實作一套 EKS + Terraform + ArgoCD 的完整 lab，把這三篇學到的東西串起來跑一次。
