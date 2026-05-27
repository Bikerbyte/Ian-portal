---
title: "Kubernetes 學習筆記 - CKA 考點實戰整理"
excerpt: "CKA 認證完整準備：考試結構、必背指令、五大主題實戰題型、考場技巧、kubectl alias 與時間管理、常見陷阱與解法。"
date: 2026-07-03
category: "學習"
tags:
  - Kubernetes
  - CKA
  - Certification
series: "Kubernetes"
seriesOrder: 8
featured: false
---

## Agenda

- CKA 考試結構與評分
- 環境設定：alias、自動補全、tab title
- 五大主題與題型分析
  1. Cluster Architecture, Installation & Configuration (25%)
  2. Workloads & Scheduling (15%)
  3. Services & Networking (20%)
  4. Storage (10%)
  5. Troubleshooting (30%)
- kubectl 速查與必背指令
- 必考實戰題型 + 解法
- 時間管理與考場技巧
- 考前一週準備清單
- 面試 vs 考試：CKA 對求職的價值
- 小結

## CKA 考試結構與評分

| 項目 | 內容 |
|------|------|
| 主辦 | CNCF + Linux Foundation |
| 形式 | 線上監考、純實作（沒有選擇題） |
| 時間 | 2 小時 |
| 題數 | 15–20 題 |
| 通過分數 | 66% |
| 環境 | 多個 K8s 叢集，題目會註明在哪個 context |
| 工具 | 瀏覽器 + 終端機（PSI Bridge） |
| 可查 | kubernetes.io 全站、kubernetes.io/blog、helm.sh、cilium.io |
| 不可查 | 其他網站、AI 工具、筆記 |
| 重考 | 一次費用包一次免費重考 |
| 有效期 | 2 年 |

**最新版本（2024+）涵蓋 K8s v1.30**，每年會跟進新版。

## 環境設定（考前 5 分鐘做）

每題開始前必跑：

```bash
# 1. alias
alias k=kubectl
complete -F __start_kubectl k

# 2. dry-run 快速生模板
export do='--dry-run=client -o yaml'
export now='--force --grace-period 0'

# 3. vim 縮排 (避免 YAML 縮排錯)
echo 'set tabstop=2 shiftwidth=2 expandtab' >> ~/.vimrc

# 4. 切到題目要求的 context
kubectl config use-context <context-name>
```

之後可以這樣寫：

```bash
k create deploy nginx --image=nginx $do > deploy.yaml
vim deploy.yaml      # 改完
k apply -f deploy.yaml

# 強制刪除卡住的 Pod
k delete pod broken $now
```

`$do` / `$now` 是考場常用的時間救星。

## 主題一：Cluster Architecture, Installation & Configuration (25%)

### 必考：RBAC

題型範例：「建立 Role 讓 ServiceAccount `app-sa` 在 `dev` namespace 內可以讀取 Pod 與 list Service。」

```bash
# 建 namespace 跟 SA
k create ns dev
k create sa app-sa -n dev

# 建 Role
k create role pod-reader \
  --verb=get,list,watch \
  --resource=pods,services \
  -n dev

# 綁
k create rolebinding app-sa-binding \
  --role=pod-reader \
  --serviceaccount=dev:app-sa \
  -n dev

# 驗證
k auth can-i list pods --as=system:serviceaccount:dev:app-sa -n dev
# 應該回 yes
```

**陷阱**：
- 別把 Role 跟 ClusterRole 搞混
- 別把 RoleBinding 綁到 ClusterRole（除非題目要求）
- `--as=system:serviceaccount:<ns>:<name>` 格式不能錯

### 必考：升級 Cluster

題型範例：「升級 control plane 從 1.29.x 到 1.30.x，再升 worker node。」

```bash
# === Control Plane ===
# 1. drain master
k drain <master> --ignore-daemonsets

# 2. upgrade kubeadm
apt-mark unhold kubeadm
apt-get update && apt-get install -y kubeadm=1.30.0-1.1
apt-mark hold kubeadm

# 3. plan + apply
kubeadm upgrade plan
kubeadm upgrade apply v1.30.0

# 4. upgrade kubelet + kubectl
apt-mark unhold kubelet kubectl
apt-get install -y kubelet=1.30.0-1.1 kubectl=1.30.0-1.1
apt-mark hold kubelet kubectl
systemctl daemon-reload && systemctl restart kubelet

# 5. uncordon
k uncordon <master>

# === Worker Node ===
# 1. drain
k drain <worker> --ignore-daemonsets

# 2. upgrade kubeadm
ssh <worker>
apt-mark unhold kubeadm && apt-get install -y kubeadm=1.30.0-1.1 && apt-mark hold kubeadm
kubeadm upgrade node

# 3. upgrade kubelet + kubectl，重啟
apt-mark unhold kubelet kubectl
apt-get install -y kubelet=1.30.0-1.1 kubectl=1.30.0-1.1
apt-mark hold kubelet kubectl
systemctl daemon-reload && systemctl restart kubelet

# 4. uncordon
k uncordon <worker>
```

**陷阱**：
- 一次只能升一個 minor（1.29 → 1.30，不能 1.29 → 1.31）
- 不要忘記 `apt-mark unhold` 才能裝新版
- drain 一定要加 `--ignore-daemonsets`

### 必考：etcd Backup / Restore

```bash
# Backup
ETCDCTL_API=3 etcdctl snapshot save /tmp/etcd-backup.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 驗證 snapshot
ETCDCTL_API=3 etcdctl snapshot status /tmp/etcd-backup.db --write-out=table

# Restore
ETCDCTL_API=3 etcdctl snapshot restore /tmp/etcd-backup.db \
  --data-dir=/var/lib/etcd-restored

# 改 etcd manifest 用新 data-dir
vim /etc/kubernetes/manifests/etcd.yaml
# 把 hostPath /var/lib/etcd 改成 /var/lib/etcd-restored

# kubelet 自動重啟 static pod
```

**陷阱**：證書路徑可能跟標準不同，題目通常給，要小心讀。

## 主題二：Workloads & Scheduling (15%)

### 必考：Deployment / Rolling Update / Rollback

```bash
# 建
k create deploy web --image=nginx:1.27 --replicas=3

# 改 image（滾動更新）
k set image deploy/web nginx=nginx:1.28

# 看 rollout 進度
k rollout status deploy/web

# 看歷史
k rollout history deploy/web

# 回滾上一版
k rollout undo deploy/web

# 指定 revision
k rollout undo deploy/web --to-revision=2

# 暫停 / 恢復
k rollout pause deploy/web
k rollout resume deploy/web
```

### 必考：Scheduling — nodeSelector、Affinity、Taint、Toleration

題型：「把 Node `worker1` 設成只接受帶 `dedicated=db` toleration 的 Pod，再建一個 Pod 跑在上面。」

```bash
# Taint
k taint nodes worker1 dedicated=db:NoSchedule

# Pod YAML
cat <<EOF | k apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: db
spec:
  tolerations:
    - key: dedicated
      operator: Equal
      value: db
      effect: NoSchedule
  nodeSelector:
    kubernetes.io/hostname: worker1
  containers:
    - name: db
      image: postgres:16
EOF
```

**Taint effect 三種：**
- `NoSchedule`：新 Pod 不來，現有 Pod 留
- `PreferNoSchedule`：盡量別來，不強制
- `NoExecute`：現有不容忍的 Pod 也被驅逐

### 必考：Static Pod

```bash
# 在 Node 上的 /etc/kubernetes/manifests/ 放 yaml，kubelet 自動跑
ssh <node>
cat <<EOF > /etc/kubernetes/manifests/static-web.yaml
apiVersion: v1
kind: Pod
metadata:
  name: static-web
spec:
  containers:
    - name: web
      image: nginx
EOF

# 在 master 上會看到名稱 static-web-<nodename>
k get pods
```

### 必考：DaemonSet

```bash
# 沒有 k create ds 指令，從 deployment 改
k create deploy fluent --image=fluent/fluent-bit $do > ds.yaml
vim ds.yaml
# 把 kind: Deployment 改成 DaemonSet，刪掉 replicas 跟 strategy
k apply -f ds.yaml
```

## 主題三：Services & Networking (20%)

### 必考：Service ClusterIP / NodePort

```bash
# expose 一個 Deployment
k expose deploy web --port=80 --target-port=8080

# 改成 NodePort
k expose deploy web --port=80 --target-port=8080 --type=NodePort

# 看 NodePort
k get svc web -o jsonpath='{.spec.ports[0].nodePort}'
```

### 必考：Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: web.example.com
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

### 必考：NetworkPolicy

題型：「限制 `prod` namespace 的 `db` Pod 只接受同 namespace 內 `app=web` Pod 的 5432 ingress。」

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-allow-web
  namespace: prod
spec:
  podSelector:
    matchLabels:
      app: db
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: web
      ports:
        - protocol: TCP
          port: 5432
```

**驗證**：用 `kubectl exec` 進別的 Pod 試 `nc -zv db 5432`。

### 必考：CoreDNS 故障排查

題型：「CoreDNS 沒回應，從這個 Pod 查 DNS 失敗，找出原因。」

```bash
# 1. CoreDNS Pod 健康嗎
k get pods -n kube-system -l k8s-app=kube-dns

# 2. ConfigMap 設定
k get cm coredns -n kube-system -o yaml

# 3. Service 在嗎
k get svc -n kube-system kube-dns

# 4. Pod 內 resolv.conf
k exec <pod> -- cat /etc/resolv.conf

# 5. 直接從 Pod 內 query
k exec <pod> -- nslookup kubernetes.default.svc.cluster.local

# 6. CoreDNS log
k logs -n kube-system <coredns-pod>
```

## 主題四：Storage (10%)

### 必考：PV / PVC / Pod 三件套

```yaml
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: pv-1
spec:
  capacity:
    storage: 1Gi
  accessModes: [ReadWriteOnce]
  hostPath:
    path: /mnt/data
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pvc-1
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 500Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: nginx
      volumeMounts:
        - name: data
          mountPath: /usr/share/nginx/html
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: pvc-1
```

**驗證 binding：**

```bash
k get pvc pvc-1
# STATUS 是 Bound 才對
```

### 必考：reclaimPolicy

- **Retain**：PVC 刪了 PV 保留（重要資料）
- **Delete**：PVC 刪了 PV 跟底層儲存一起刪（雲端 default）
- **Recycle**：deprecated

### 必考：StorageClass

題型常見：寫一個指定 `provisioner` 的 StorageClass，並讓某 PVC 使用它。

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast
provisioner: kubernetes.io/no-provisioner  # 考場常用 local-path 或假 provisioner
volumeBindingMode: WaitForFirstConsumer
```

## 主題五：Troubleshooting (30%) — 分數最重的！

### 必背：基本排查指令

```bash
# Pod
k describe pod <pod>
k logs <pod> --previous
k logs <pod> -c <container>
k get events --sort-by='.lastTimestamp'

# Node
k describe node <node>
k top nodes
k top pods

# Cluster components（static pod）
crictl ps -a   # 看所有 container 包含 control plane
crictl logs <id>

# 看 kubelet 日誌
journalctl -u kubelet -f
```

### 題型 A：Pod 一直 Pending

```bash
k describe pod <pod>
# 看 Events 區段
```

可能原因：
- `Insufficient cpu/memory` → 加 Node、降 requests
- `pod has unbound immediate PersistentVolumeClaims` → PVC / PV / SC 沒對上
- `node(s) had untolerated taint` → 加 toleration
- `node affinity/selector` → label 沒對

### 題型 B：Pod CrashLoopBackOff

```bash
k logs <pod>                # 當前 log
k logs <pod> --previous     # 前一次 crash log（關鍵）
k describe pod <pod>        # 看 Last State、exit code

# 退出碼
# 137 = OOMKilled or SIGKILL
# 139 = segfault
# 1, 2 = app 主動退出
```

### 題型 C：Service 連不到

```bash
# 1. Service 跟 Endpoints
k get svc <svc>
k get endpoints <svc>
# Endpoints 空 = selector 不匹配 / Pod 沒 Ready

# 2. Pod 是否 Ready
k get pods -l <selector>
k describe pod <pod>     # 看 readinessProbe

# 3. 從 Pod 內測
k run debug --rm -it --image=nicolaka/netshoot -- bash
curl http://<svc>
```

### 題型 D：Node NotReady

```bash
k get nodes
k describe node <node>
# 看 Conditions：MemoryPressure / DiskPressure / NetworkUnavailable

# SSH 到 Node 看 kubelet
ssh <node>
systemctl status kubelet
journalctl -u kubelet --since "10 minutes ago"

# 常見原因
# - kubelet 沒啟動
# - container runtime 掛了
# - /var disk 滿
# - 證書過期（kubeadm renew）
```

### 題型 E：Control Plane 元件異常

control plane 跑成 static pod，在 master 上：

```bash
ls /etc/kubernetes/manifests/
# etcd.yaml  kube-apiserver.yaml  kube-controller-manager.yaml  kube-scheduler.yaml

# 看 static pod
crictl ps -a | grep kube-apiserver
crictl logs <id>

# 改 manifest 後 kubelet 自動重起 static pod
vim /etc/kubernetes/manifests/kube-apiserver.yaml
```

**陷阱**：改錯 manifest 整個 master 掛。先 `cp` 備份再改。

## kubectl 速查與必背指令

考場手速決定通過。以下背到自然反應：

```bash
# === 建立資源 ===
k create deploy <name> --image=<img>
k create svc clusterip <name> --tcp=80:8080
k create cm <name> --from-literal=key=value
k create cm <name> --from-file=./file.conf
k create secret generic <name> --from-literal=password=s3cret
k create sa <name>
k create role <name> --verb=get,list --resource=pods
k create rolebinding <name> --role=<r> --serviceaccount=<ns>:<sa>
k create job <name> --image=<img> -- /bin/sh -c "echo hi"
k create cronjob <name> --image=<img> --schedule="*/5 * * * *" -- date

# === 改資源 ===
k set image deploy/<name> <container>=<image>
k set env deploy/<name> KEY=value
k set resources deploy/<name> --requests=cpu=100m,memory=128Mi --limits=cpu=500m
k scale deploy/<name> --replicas=5
k label pod <name> env=prod
k annotate pod <name> note="hi"
k taint nodes <node> key=value:NoSchedule
k cordon <node>          # 標記不接新 Pod
k uncordon <node>
k drain <node> --ignore-daemonsets

# === 查資源 ===
k get pods -o wide                    # 含 IP / Node
k get pods --show-labels
k get pods -l app=web                 # 過濾 label
k get pods --field-selector status.phase=Running
k get pods -A                         # 所有 namespace
k get pods -o yaml                    # 完整 YAML
k get pods -o jsonpath='{.items[*].metadata.name}'
k explain pod.spec.containers         # 看欄位說明（考場救星）
k api-resources                       # 看所有資源類型

# === 互動 ===
k exec -it <pod> -- bash
k port-forward svc/<svc> 8080:80
k logs <pod> -f --tail=100
k cp <pod>:/path/in/pod ./local

# === debug ===
k describe <res> <name>
k get events --sort-by='.lastTimestamp'
k auth can-i <verb> <resource> --as=<user>
k top pods / nodes

# === 強制刪 ===
k delete pod <name> --force --grace-period=0
```

## 時間管理與考場技巧

**2 小時 / 15–20 題 = 平均 6–8 分鐘/題**。但題目分數不一樣，按權重分配時間。

### 策略

1. **第一輪快掃所有題目**（10 分鐘）
   - 把分數最高、最有把握的標起來先做
   - 卡住的題目先 flag、之後回頭

2. **善用 `kubectl explain`**
   - 忘記 YAML 欄位時 `k explain pod.spec.containers.resources` 即時查

3. **善用官方文件**
   - 考場可開 kubernetes.io
   - 預先熟悉常用頁面 URL：
     - `/docs/concepts/workloads/`
     - `/docs/concepts/services-networking/network-policies/`
     - `/docs/tasks/administer-cluster/`

4. **`--dry-run=client -o yaml` 生模板**
   - 從零寫 YAML 慢，先用指令生模板再改

5. **每題確認 context**
   - 題目開頭都會說 `kubectl config use-context xxx`，**一定要切**，否則改錯 cluster

6. **驗證再交**
   - 寫完跑 `k get` 確認資源建好
   - RBAC 題用 `k auth can-i` 驗證
   - Service 題用 `k get endpoints` 確認

### 常見失分點

- 沒切對 context，整題在錯的 cluster 操作
- YAML 縮排錯（vim 沒設 expandtab）
- 沒驗證直接交
- 卡在難題不放，時間燒光簡單題沒做
- 忘記題目要求的 namespace
- RBAC 用 ClusterRole 而非題目要求的 Role

## 考前一週準備清單

### 一週前
- [ ] 確認自己這 8 篇 K8s 筆記都讀過
- [ ] 在 [killercoda.com](https://killercoda.com) 跑 K8s scenarios
- [ ] 跑一遍 [kubernetes/examples](https://github.com/kubernetes/examples)

### 三天前
- [ ] [killer.sh](https://killer.sh) 模擬考（買 CKA 時送 2 次，跟正式考一樣難或更難）
- [ ] 把官方文件常用頁面 bookmark
- [ ] 練習 kubeadm upgrade、etcd backup 兩個必考題

### 一天前
- [ ] 早睡（考試很燒腦）
- [ ] 把 alias、`$do`、`$now`、vim 設定背到無腦敲

### 考試當天
- [ ] 確認網路、攝影機、麥克風
- [ ] 桌面清空（監考會檢查）
- [ ] 護照 / 身分證準備好
- [ ] 提早 15 分鐘上線 check-in

## 面試 vs 考試：CKA 對求職的價值

**CKA 在台灣就業市場：**
- 大公司 / 外商有加分（履歷篩選會被注意）
- 中小公司 / 新創不一定看，**會做事更重要**
- 半導體 / IC / 銀行業比較吃證照
- 證照證明會「動手」，但**面試還是會深問原理**

**CKA 對學習的價值（比求職更大）：**
- 強迫你練純 kubectl 不靠 GUI
- 學會 troubleshooting SOP
- 涵蓋 cluster 管理、不只是 app 開發
- 為 CKAD / CKS 鋪路

**進階路線：**
1. **CKA** — 管理員視角（你這篇）
2. **CKAD** — 開發者視角，偏 app 部署
3. **CKS** — Security 專家，CKA 是 prerequisite

## 小結

CKA 不難，但需要：

- **8 篇 K8s 筆記涵蓋的觀念**（這個系列）
- **kubectl 手感**（每天敲到自然反應）
- **時間管理**（先做有把握的）
- **官方文件熟悉度**（考場唯一資源）
- **模擬考訓練**（killer.sh 是黃金標準）

通過 CKA 後你會具備：
- 看到 K8s 問題能 SOP debug
- 純 kubectl 操作不依賴 UI
- 對 RBAC、network、storage 三大領域有實戰經驗

**這就是 K8s 系列 8 篇文章的終點。** 從第 1 篇核心觀念到這篇 CKA 實戰，整個學習地圖完整：

| Part | 主題 |
|------|------|
| 1 | 核心觀念與基礎物件 |
| 2 | 進階運維與面試重點 |
| 3 | EKS on AWS 實戰 |
| 4 | GitOps with ArgoCD |
| 5 | Observability 完整實戰 |
| 6 | Security 深入 |
| 7 | Networking 進階與 Service Mesh |
| 8 | CKA 考點實戰整理 |

跟前面 IaC 系列（Ansible + Terraform）串起來，已經涵蓋 **SRE / DevOps 工程師面試** 99% 會被問到的核心議題。接下來如果想再加深：

- Terraform 進階：Terragrunt、CI/CD、Module 開發實戰
- Ansible 進階：Role 開發、AWX、跟 Terraform 整合
- SRE 理論：SLI/SLO/Error Budget、Postmortem、On-call
- Observability 深入：Prometheus federation、Grafana dashboard 設計、tracing 進階

— 都可以再開新系列補完。
