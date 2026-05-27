---
title: "Kubernetes 學習筆記 - Networking 進階與 Service Mesh"
excerpt: "K8s 網路深入：CNI 原理、kube-proxy iptables/IPVS/eBPF、DNS 解析鏈、跨叢集網路、Service Mesh（Istio/Linkerd/Cilium）選型、面試重點。"
date: 2026-06-26
category: "學習"
tags:
  - Kubernetes
  - Networking
  - CNI
  - Service Mesh
  - Istio
series: "Kubernetes"
seriesOrder: 7
featured: false
---

## Agenda

- K8s 網路四種通訊路徑
- CNI 是什麼？常見 CNI 比較
- Pod IP 怎麼分配？跨 Node 怎麼通？
- kube-proxy：iptables vs IPVS vs eBPF
- DNS 解析鏈：CoreDNS、ndots、ExternalName
- Service 的 ClusterIP 流量到底怎麼走
- Headless Service 與 endpoint discovery
- EndpointSlice 取代 Endpoints
- Ingress / Gateway API 進化
- 多叢集網路：Submariner、Cilium Cluster Mesh
- Service Mesh：為什麼、Istio vs Linkerd vs Cilium
- 排查網路問題的 SOP
- 面試常考重點
- 小結

## K8s 網路四種通訊路徑

K8s 規定四件事必須通：

1. **Container ↔ Container in same Pod**：共用 network namespace，用 `localhost` 通
2. **Pod ↔ Pod (same Node)**：透過 Node 上的 bridge / veth
3. **Pod ↔ Pod (cross Node)**：由 CNI 負責（overlay 或 routing）
4. **External ↔ Service**：透過 NodePort / LoadBalancer / Ingress

**K8s 不強制怎麼實作**，CNI plugin 各自有不同方法達成。

## CNI 是什麼？常見 CNI 比較

**CNI（Container Network Interface）** 是個簡單的規範：當 Pod 起來時，kubelet 呼叫 CNI plugin 來配 network namespace、分配 IP、設路由。

主流 CNI：

| CNI | 資料平面 | 特色 |
|-----|---------|------|
| **Calico** | BGP / VXLAN / IPIP | 路由式、效能好、NetworkPolicy 原生強 |
| **Cilium** | **eBPF** | 取代 kube-proxy、L7 政策、ClusterMesh |
| **Flannel** | VXLAN | 最簡單、預設不支援 NetworkPolicy |
| **Weave** | overlay 自家協議 | 簡單、預設加密 |
| **AWS VPC CNI** | AWS ENI / secondary IP | Pod 直接拿 VPC IP（EKS 預設） |
| **Azure CNI** | Azure VNet | 類似 VPC CNI 但用 Azure |
| **Cilium on EKS** | eBPF | 比 VPC CNI 省 IP，但失去 native SG 整合 |

**主流選擇：**
- AWS EKS → VPC CNI（預設）或 Cilium
- GCP GKE → GKE native（dataplane v2 用 Cilium）
- 自架 / 多雲 → Calico 或 Cilium
- 新專案首選 → **Cilium**（eBPF 是未來方向）

## Pod IP 怎麼分配？跨 Node 怎麼通？

**單 Node 內：**
- Node 啟動時 CNI 預留一段 CIDR（例如 `10.244.1.0/24`）給這個 Node
- 每個 Pod 起來時從這段拿一個 IP
- Node 上有個 bridge（`cni0`）連接所有 Pod 的 veth
- 同 Node Pod 通訊：經 bridge

**跨 Node 兩種主流方法：**

### 1. Overlay（VXLAN / Geneve）— Flannel 預設

```
Pod A (10.244.1.5)  →  封裝成 UDP 4789 (VXLAN)
   ↓                        ↑
Node 1 (192.168.1.1)  → 192.168.1.2 (Node 2)
                                ↓ 解封裝
                            Pod B (10.244.2.7)
```

- Pod 流量被包進 UDP 封包跨 Node 傳送
- 優點：底層 underlay 隨便用，不用設路由
- 缺點：多一層封裝開銷（CPU + MTU）

### 2. Routing（BGP）— Calico 預設

```
Pod A (10.244.1.5)  → 直接 IP route
   ↓                        
Node 1 路由表：10.244.2.0/24 via Node 2
   ↓
Node 2 收到、依路由送 Pod B (10.244.2.7)
```

- 每個 Node 透過 BGP 互相交換「我這邊有哪些 Pod CIDR」
- 不用封裝，效能更好
- 缺點：underlay 要支援 BGP 或同 L2

### 3. Cloud CNI（VPC CNI / Azure CNI）

- Pod 直接從 VPC 拿 IP，VPC 路由原生通到底
- 沒有 overlay、沒有 BGP
- 缺點：吃 VPC IP

## kube-proxy：iptables vs IPVS vs eBPF

Service 是個虛擬抽象（ClusterIP 沒實體），kube-proxy 在每個 Node 上維護規則，把連 ClusterIP 的流量改寫成連實際 Pod IP。

### iptables 模式（預設）

```
[Pod 連 10.96.10.10:80 (ClusterIP)]
       ↓ Node iptables rule
       ↓ DNAT 隨機選一個 Pod IP（10.244.1.5 / 10.244.2.7 / ...）
       ↓ 送出
```

- 工作機制：每個 Service 在 iptables 加規則，每個 endpoint 一條 rule
- **問題**：規則是 linear scan，service / endpoint 多時 CPU 暴增、新建連線變慢

### IPVS 模式

- 用 Linux 內建的 IPVS（kernel L4 LB）
- 支援多種演算法（rr、wrr、lc、wlc、sh）
- 效能比 iptables 好很多（hash table 而非 linear），萬個 service 也順
- 啟用：kube-proxy 加 `--proxy-mode=ipvs`

### eBPF（Cilium）

- 用 eBPF 完全**取代 kube-proxy**
- 在 socket / TC layer 做負載均衡
- 效能最好，支援 L7 policy
- 啟用：Cilium with `kubeProxyReplacement: true`

**選擇建議：**
- 小叢集：iptables 沒問題
- 中大叢集（>1000 service）：IPVS
- 想要 L7 政策 / 最佳效能：Cilium eBPF（**新專案首選**）

## DNS 解析鏈：CoreDNS、ndots、ExternalName

K8s 內建 DNS 服務（**CoreDNS**），每個 Pod 的 `/etc/resolv.conf` 預設指向 CoreDNS 的 ClusterIP。

```
nameserver 10.96.0.10              # CoreDNS ClusterIP
search default.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

**重要觀念：ndots:5**

當你 query `redis`（沒包含 `.`），系統會先嘗試 search list：
1. `redis.default.svc.cluster.local`
2. `redis.svc.cluster.local`
3. `redis.cluster.local`
4. 都沒有才嘗試 `redis`

**ndots:5 表示**：如果 query 內 `.` 數量 < 5，才走 search list；否則直接當 FQDN 查。

**常見問題：**
- 連外網 `www.google.com`（3 個 `.`，< 5）→ 也會先 search 內部 → 多 4 次 DNS query → 延遲
- 解法：FQDN 加結尾點 `www.google.com.`，或 Pod 內改 ndots

**ExternalName Service**：把 K8s service 變成 CNAME 別名。

```yaml
apiVersion: v1
kind: Service
metadata:
  name: db
spec:
  type: ExternalName
  externalName: prod-db.example.com
```

Pod 連 `db.default.svc.cluster.local` → DNS 回 `prod-db.example.com` CNAME → 解析到外部 IP。常用於把 K8s 內部服務名稱對外部資源做透明 mapping。

**CoreDNS 調校：**
- 加 cache（預設已開）
- replicas 多開幾個 + HPA（防止單點）
- 大量 lookup 啟用 **NodeLocal DNSCache**（每個 Node 一個 DaemonSet cache，減少網路跳）

## Service ClusterIP 流量到底怎麼走

完整流程（iptables 模式）：

```
[App in Pod] 連 redis.default.svc.cluster.local:6379
       ↓ DNS resolve → 10.96.10.10 (ClusterIP)
       ↓
[Pod 內 socket connect 10.96.10.10:6379]
       ↓
[Node netfilter PREROUTING / OUTPUT chain]
       ↓ iptables KUBE-SERVICES chain
       ↓ 匹配 Service IP → 跳到 KUBE-SVC-XXX chain
       ↓ 隨機選一個 endpoint（probability rule）
       ↓ KUBE-SEP-YYY chain → DNAT 到實際 Pod IP (10.244.1.5:6379)
       ↓
[流量送出，可能跨 Node]
       ↓ 如果跨 Node → 走 CNI 機制（overlay/route）
       ↓
[到達 target Pod]
```

每個環節都可能出問題：
- DNS 解析錯（service 不存在、namespace 寫錯）
- iptables 規則沒更新（kube-proxy 掛了）
- Endpoint 是空的（selector 不匹配、Pod 沒 Ready）
- CNI 跨 Node 不通（網路設定錯）
- NetworkPolicy 擋掉

## Headless Service 與 endpoint discovery

一般 Service 有 ClusterIP，DNS query 回單一 VIP。**Headless Service** `clusterIP: None`，DNS query 回所有 Pod IP：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql
spec:
  clusterIP: None
  selector:
    app: mysql
  ports: [{port: 3306}]
```

`nslookup mysql.default.svc.cluster.local`：

```
mysql.default.svc.cluster.local has address 10.244.1.5
mysql.default.svc.cluster.local has address 10.244.2.7
mysql.default.svc.cluster.local has address 10.244.3.10
```

用途：
- StatefulSet（每個 Pod 一個固定 DNS `mysql-0.mysql.default.svc.cluster.local`）
- 客戶端自己做 LB / sticky session
- service discovery 給叢集型應用（ES、Kafka）

## EndpointSlice 取代 Endpoints

舊版 `Endpoints` 物件把一個 Service 的所有 endpoint 塞進**單一物件**。問題：
- 1000 個 endpoint 的 Service → 一個 Endpoints 物件超大
- 任何一個 Pod 變動 → 整個物件重寫 → 全 Node kube-proxy 收到更新（風暴）

**EndpointSlice**（K8s 1.21 GA）：把 endpoint 切成多個 slice（每個最多 100），變動只影響一片，效率好很多。

新版 K8s 都該用 EndpointSlice，自己寫 controller 也該 watch `discovery.k8s.io/v1` 而不是 `v1.Endpoints`。

## Ingress / Gateway API 進化

**Ingress API（v1）** 的問題：
- 只支援 HTTP/HTTPS
- 複雜路由要靠 annotation（每個 controller 不一樣，不通用）
- 沒有 traffic splitting 標準
- 跟 Service Mesh 整合差

**Gateway API**（K8s SIG-Network 推的下一代）：

```
GatewayClass    ← controller 實作（如 nginx-gateway、istio-gateway）
    ↓
Gateway         ← 一個 listener 入口（IP + port + TLS）
    ↓
HTTPRoute       ← HTTP 路由規則（路徑、權重、header）
TLSRoute / TCPRoute / GRPCRoute ← 其他協議
```

優點：
- 角色分離：infra team 管 Gateway，app team 管 Route
- 跨協議統一抽象
- 內建 traffic splitting（canary / blue-green）
- ReferenceGrant 控制跨 namespace 引用

新專案推薦直接用 Gateway API（NGINX、Envoy、Cilium 都有實作）。

## 多叢集網路

當 K8s 規模做大，會需要跨叢集網路：

| 方案 | 機制 |
|------|------|
| **Submariner** | tunnel-based，跨 cluster 通 Pod / Service |
| **Cilium Cluster Mesh** | 基於 Cilium，service 自動跨 cluster 發現 |
| **Istio Multi-cluster** | Service Mesh 串多 cluster |
| **Linkerd Multi-cluster** | mirror service 模式 |
| **Skupper** | application-level L7 router，不需要 L3 連通 |

**典型場景：**
- 跨地理區域 failover
- 分區資料（dev/staging/prod 各 cluster）
- 多租戶 + 共享服務

## Service Mesh：為什麼要、怎麼選

**沒有 Mesh 時，每個微服務要自己處理：**
- mTLS（服務間加密）
- retry / timeout / circuit breaker
- traffic splitting（canary）
- observability（metric / trace 注入）
- authn / authz

**Service Mesh** 把這些功能下沉到網路層：**sidecar proxy**（通常是 Envoy）代理所有進出 Pod 的流量，業務 code 不用改。

```
┌──── Pod ──────────┐
│ ┌─── App ───┐     │
│ │           │     │
│ │  business │     │
│ │   code    │     │
│ └─────↑─────┘     │
│       │ localhost │
│       ↓           │
│ ┌── Envoy ──┐     │← sidecar proxy
│ │  mTLS     │     │
│ │  retry    │     │
│ │  metrics  │     │
│ └──────↑────┘     │
└────────│──────────┘
         │
   inbound/outbound
```

**主流選擇：**

| Mesh | 資料平面 | 特色 |
|------|---------|------|
| **Istio** | Envoy sidecar 或 ambient mode | 功能最強、學習曲線陡、社群最大 |
| **Linkerd** | 自研 Rust proxy（linkerd2-proxy） | 輕量、簡單、效能好、功能比 Istio 少 |
| **Cilium Service Mesh** | eBPF + Envoy（L7 時才用） | 沒 sidecar、效能最好、要 Cilium CNI |
| **Consul Connect** | Envoy | 適合已有 Consul 的環境 |

**Istio Ambient Mode**（2023+）：不再每個 Pod 一個 sidecar，改用 per-Node ztunnel + 按需 L7 proxy。解決傳統 Istio 「太重、太貴、太複雜」的批評。

**選擇建議：**
- 想入門、追求簡單 → **Linkerd**
- 功能要 full（複雜 traffic 規則、多協議、安全嚴格） → **Istio**
- 新建 cluster、可選 CNI → **Cilium Service Mesh**（一套搞定 CNI + Mesh）

**Mesh 是必要的嗎？** 不是。如果你只有 5–10 個微服務，App 直接做 retry / mTLS（用 mTLS library 或 SPIRE）也行。Mesh 是 50+ 服務、跨團隊、要統一觀測 / 安全策略時才划算。

## 排查網路問題的 SOP

K8s 網路出問題的 debug 順序：

**1. 從 Pod 內測連通性**

```bash
# 進入 Pod
kubectl exec -it <pod> -- sh

# 測 DNS
nslookup redis
nslookup redis.default.svc.cluster.local
nslookup google.com

# 測 service
curl -v http://redis:6379

# 測 Pod IP 直連
curl -v http://10.244.1.5:6379

# 測外網
curl -v https://google.com
```

**2. 看 Service / Endpoints**

```bash
kubectl get svc redis
kubectl get endpoints redis
kubectl get endpointslices -l kubernetes.io/service-name=redis

# 沒 endpoint = selector 沒對、或 Pod 沒 Ready
kubectl describe svc redis
kubectl get pods -l app=redis -o wide
```

**3. 看 NetworkPolicy**

```bash
kubectl get networkpolicy -A
# 用 Cilium：cilium policy trace 看哪條規則擋住
```

**4. 看 kube-proxy / CNI**

```bash
# kube-proxy 是否健康
kubectl get pods -n kube-system -l k8s-app=kube-proxy
kubectl logs -n kube-system <kube-proxy-pod>

# Node 上看 iptables
iptables -t nat -L KUBE-SERVICES | grep redis
```

**5. 跨 Node 跑 netshoot**

```bash
kubectl run netshoot --rm -it --image=nicolaka/netshoot -- bash
# 內建一堆網路工具：ping、curl、dig、tcpdump、mtr、ss、iperf
```

**6. EKS 額外查**

```bash
# Pod 是否被分到 ENI 上
kubectl describe pod <pod> | grep -A5 "Events"

# VPC CNI 是否健康
kubectl get pods -n kube-system -l k8s-app=aws-node
```

## 面試常考重點

**1. K8s Pod 跨 Node 通訊有哪些實作方式？**  
三種主流：(a) **Overlay**（VXLAN/Geneve）把 Pod 流量封包跨 Node，例如 Flannel、Cilium overlay 模式；(b) **Routing/BGP** 不封包，每個 Node 學習其他 Node 的 Pod CIDR 路由，例如 Calico BGP；(c) **Cloud-native**（AWS VPC CNI、Azure CNI）Pod 直接拿 VPC IP，underlay 原生路由。

**2. kube-proxy 三種模式怎麼選？**  
- iptables（預設）：簡單，但 service 多時 linear scan 慢
- IPVS：kernel L4 LB，hash 查找，萬個 service 也快
- **eBPF**（Cilium 取代 kube-proxy）：效能最好、支援 L7、無 conntrack 表壓力

新專案 / 大 cluster 選 IPVS 或 eBPF。

**3. Service 為什麼有時連不上？**  
按順序查：
- DNS 解析錯（service name / namespace）
- Service 的 endpoints 是空的（selector 不匹配、Pod 沒 Ready、readiness probe 失敗）
- kube-proxy 沒同步規則
- NetworkPolicy 擋
- 跨 Node CNI 不通
- App 沒監聽 0.0.0.0（只聽 127.0.0.1）

**4. Headless Service 跟一般 Service 差在哪？什麼時候用？**  
一般 Service 有 ClusterIP（VIP），DNS 回單一 IP，kube-proxy 做負載均衡。Headless `clusterIP: None`，DNS 回所有 Pod IP，由 client 自己選。用途：StatefulSet（每 Pod 固定 DNS）、客戶端自己 LB、ES/Kafka 等需要直接知道每個 instance。

**5. ndots:5 是什麼？為什麼會讓外網查詢變慢？**  
`/etc/resolv.conf` 預設 ndots:5：query 字串內 `.` 少於 5 個時先走 search list（5 次內部查詢）才當 FQDN。連外網 `api.example.com`（2 個 `.`）會先嘗試 `api.example.com.default.svc.cluster.local` 等 5 次失敗才查實際域名。解法：FQDN 結尾加 `.` 變絕對域名，或自訂 Pod 的 dnsConfig 降 ndots。

**6. NetworkPolicy 為什麼有時不生效？**  
- CNI 不支援（Flannel 預設不支援）
- 沒有任何 policy 選到該 Pod → Pod 不受限制（不是 default-deny）
- 漏了 DNS egress（Pod 連不到 service name）
- 跨 namespace 沒設 namespaceSelector
- Cilium L7 policy 需要 Cilium 開 sidecar 或 host firewall

**7. EndpointSlice 為什麼比 Endpoints 好？**  
舊 Endpoints 一個 Service 的所有 endpoint 塞在單一物件，大 Service（萬個 endpoint）的物件超大，任何變動都會觸發全 kube-proxy 更新風暴。EndpointSlice 切成多個（預設 100/slice），變動範圍小，效能好。

**8. Ingress 跟 Gateway API 差在哪？**  
Ingress 只支援 HTTP/HTTPS、複雜路由靠 annotation（每個 controller 語法不同）、沒 traffic splitting 標準。Gateway API 提供 GatewayClass / Gateway / HTTPRoute 三層抽象、跨協議統一（HTTPRoute、TLSRoute、TCPRoute、GRPCRoute）、內建 traffic splitting、跨 namespace 控制（ReferenceGrant）。新專案推薦直接用 Gateway API。

**9. Service Mesh 解決什麼問題？什麼時候不該用？**  
解決：mTLS、retry/timeout/circuit breaker、canary、observability、authz 都下沉到網路層。**什麼時候不該用：** 微服務少（< 10）、團隊小、額外複雜度不值得；Mesh 自身的 CPU / memory / 延遲開銷會吃資源（sidecar 模式特別明顯）。

**10. Istio 跟 Linkerd 怎麼選？**  
- 功能要 full、複雜流量策略、多協議 → Istio
- 入門、追求簡單、Rust proxy 效能與小資源占用 → Linkerd
- 已用 Cilium → 直接 Cilium Service Mesh（無 sidecar、最省）

**11. Cilium 為什麼受歡迎？**  
基於 eBPF：
- 取代 kube-proxy（效能 + L7 政策）
- 取代 NetworkPolicy（支援 L7 HTTP / Kafka / DNS）
- Service Mesh 無 sidecar
- ClusterMesh 跨 cluster
- Hubble 提供原生 observability
- 一套 CNI 涵蓋 networking + security + observability + mesh

**12. EKS 上換掉 VPC CNI 用 Cilium 的取捨？**  
- 換 Cilium overlay：省 VPC IP（不再吃 subnet）
- 失去：跟 EC2 SG 原生整合、雲端 LB 直連 Pod
- 適合：VPC IP 不夠用、想要 L7 政策、想用 Cilium 全套
- 不適合：重度依賴 SG 隔離、跟 RDS / 其他 AWS 服務同 VPC 通訊頻繁

## 小結

K8s 網路的完整地圖：

| 層級 | 元件 |
|------|------|
| Pod IP / 跨 Node | CNI（Calico / Cilium / VPC CNI / Flannel） |
| Service 抽象 | kube-proxy（iptables / IPVS / eBPF） |
| DNS | CoreDNS + NodeLocal DNSCache |
| Endpoint discovery | EndpointSlice |
| L7 routing | Ingress Controller / Gateway API |
| 跨叢集 | Submariner / Cilium ClusterMesh |
| 服務間進階控制 | Service Mesh（Istio / Linkerd / Cilium） |

**面試心法：**
- 被問「Pod 怎麼通」答 CNI、overlay vs routing 比較
- 被問「Service 怎麼運作」答 kube-proxy iptables 流程 + 演進到 IPVS/eBPF
- 被問「Service Mesh 必要嗎」答「看規模，10 個服務以下不一定，50+ 開始划算」
- 能講出 Cilium / eBPF 就大加分（現代 K8s 網路的方向）

下一篇是 K8s 系列最後一篇：**CKA 考點實戰整理**，把這 7 篇的內容對應到 CKA 考試題型，想拿證照的朋友可以照著練。
