---
title: "Kubernetes 學習筆記 - GitOps 與 ArgoCD 實戰"
excerpt: "GitOps 是什麼、跟傳統 CI/CD 的差異、ArgoCD 安裝與運作機制、App of Apps、Sync 策略、Secrets、Flux 比較、面試重點。"
date: 2026-06-05
category: "學習"
tags:
  - Kubernetes
  - GitOps
  - ArgoCD
  - DevOps
  - CI/CD
series: "Kubernetes"
seriesOrder: 4
featured: false
---

## Agenda

- GitOps 是什麼？解決什麼問題
- GitOps 跟傳統 CI/CD 的差異
- Pull-based vs Push-based
- ArgoCD 架構與安裝
- Application 物件與 Sync 機制
- App of Apps 模式
- Sync Strategy：Auto vs Manual、Sync Wave、Hook
- Image Updater 怎麼處理 image tag
- Secrets：sops、Sealed Secrets、External Secrets
- ArgoCD vs Flux
- 多叢集管理
- 面試常考重點
- 小結

## GitOps 是什麼？解決什麼問題

傳統的 K8s 部署流程：

```
Developer push code → CI build image → CI 跑 kubectl apply / helm upgrade → K8s 變更
```

問題：
- **狀態漂移**：有人手動 `kubectl edit`，叢集實際狀態跟 Git 不一致，沒人發現
- **CI 需要叢集寫權限**：CI 拿到 cluster admin token，外洩就完蛋
- **回滾靠記憶**：壞了要找上一次 deploy 的 commit、重跑 pipeline，慢
- **多環境同步**：dev 跟 prod 用同一段 pipeline，邏輯交錯難維護

**GitOps** 的核心原則（CNCF 定義）：

1. **Declarative**：系統狀態用宣告式描述（K8s manifest 天然符合）
2. **Versioned and Immutable**：所有目標狀態存在 Git，有完整歷史
3. **Pulled Automatically**：軟體 agent 自動 pull 變更（不是 push）
4. **Continuously Reconciled**：agent 持續比對 Git 跟實際狀態，有差異就修

簡單講就是：**Git repo 是 single source of truth，叢集裡跑一個 agent 持續把實際狀態調整成 Git 描述的樣子**。

## GitOps 跟傳統 CI/CD 的差異

```
傳統 CI/CD（Push）：
  Git → CI Server → kubectl apply → K8s
        (CI 需要叢集寫權限，主動推)

GitOps（Pull）：
  Git ← ArgoCD agent ← (在叢集內，輪詢 Git)
  ArgoCD → 對比實際狀態 → 修正
```

| 面向 | 傳統 CI/CD | GitOps |
|------|-----------|--------|
| 變更方向 | Push（CI → cluster） | Pull（cluster agent → git） |
| 權限模型 | CI 需要 cluster admin | Agent 在叢集內，外面沒人有寫權限 |
| 漂移處理 | 沒處理 | 持續 reconcile，自動修正 |
| 回滾 | 重跑 pipeline | `git revert` |
| Audit | CI log | Git history |
| 多叢集 | 每個叢集一條 pipeline | 一個 ArgoCD 管多個叢集 |

**重點觀念：CI 跟 CD 切開。** CI（build image、跑測試）還是用 Jenkins / GitHub Actions，但 **CD（部署到 K8s）改成「更新 Git 的 manifest」**，剩下 ArgoCD 處理。

## Pull-based 為什麼比較好

- **零外部寫權限**：叢集 firewall 可以完全封鎖 inbound，agent 只 outbound 連 Git
- **跨網路友善**：agent 在叢集內就行，不需要 CI 能連到叢集（on-prem、多 VPC、隔離環境特別有用）
- **狀態同步**：agent 持續看 Git，手動改的會被改回去
- **失敗隔離**：CI 壞了不影響已部署狀態

## ArgoCD 架構與安裝

```
┌────── ArgoCD 在 K8s 叢集內 ──────┐
│                                  │
│  argocd-server (UI / API / CLI)  │
│         ↑                        │
│  argocd-repo-server              │
│  └─ git clone, render manifest   │
│                                  │
│  argocd-application-controller   │
│  └─ 對比 desired vs live state   │
│  └─ kubectl apply 變更           │
│                                  │
│  argocd-redis (cache)            │
│  argocd-dex-server (SSO)         │
└──────────────────────────────────┘
         ↑
         │ pull
         │
┌───── Git Repo ──────┐
│ manifests/          │
│   prod/             │
│     deployment.yaml │
│     service.yaml    │
│   dev/              │
│ helm-charts/        │
└─────────────────────┘
```

安裝（最簡）：

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# 取初始 admin 密碼
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d

# 開 UI（port-forward 或配 Ingress）
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

正式環境用 Helm 裝、配 Ingress + SSO + HA：

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd -n argocd -f values.yaml
```

`values.yaml` 重點：

```yaml
configs:
  cm:
    url: https://argocd.example.com
    admin.enabled: "false"             # 關掉 admin，全部用 SSO
    oidc.config: |
      name: Okta
      issuer: https://example.okta.com
      clientID: xxx
      clientSecret: $oidc.clientSecret

server:
  ingress:
    enabled: true
    hosts: [argocd.example.com]

controller:
  replicas: 2                          # HA
repoServer:
  replicas: 2
```

## Application 物件與 Sync 機制

ArgoCD 的核心 CRD 是 **Application**，描述「Git 的某個目錄 → K8s 的某個 namespace」：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: web
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io  # 刪 Application 時連 K8s 資源一起刪
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/k8s-manifests
    targetRevision: main
    path: apps/web/overlays/prod
  destination:
    server: https://kubernetes.default.svc
    namespace: web-prod
  syncPolicy:
    automated:
      prune: true                       # 刪掉 Git 移除的資源
      selfHeal: true                    # 偵測手動改動會自動修回
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
    retry:
      limit: 5
      backoff:
        duration: 5s
        maxDuration: 3m
        factor: 2
```

**Sync 機制：**

1. **比對 desired vs live**
   - 從 Git 取目前 commit 的 manifest（用 Helm/Kustomize/raw YAML 都行）
   - 跟叢集內目前狀態比較
   - 算出 `OutOfSync` / `Synced`

2. **Sync 動作**
   - `Synced`：什麼都不做
   - `OutOfSync` + auto：自動 `kubectl apply`
   - `OutOfSync` + manual：等人按 Sync

3. **健康狀態**
   - 自動推算 Deployment / Pod / Service 等的 Healthy / Progressing / Degraded
   - 自訂資源可以寫 Lua script 算

4. **自我修復（Self-heal）**
   - 偵測到叢集狀態跟 Git 不一致就改回去
   - 例：有人 `kubectl edit deployment` 改 replica，30 秒內被改回去

## App of Apps 模式

當應用變多，一個一個寫 Application 很痛苦。**App of Apps** 模式：用一個 Application 管很多個 Application。

```
root-app (Application)
   └─ Git: apps/
        ├─ web.yaml      (Application)
        ├─ api.yaml      (Application)
        ├─ worker.yaml   (Application)
        └─ ...
```

`root-app.yaml`：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/myorg/k8s-manifests
    path: apps/                          # 這個資料夾下都是 Application yaml
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

把 `apps/` 下面每個 yaml 都做成 Application，新增應用只要丟一個 yaml 到 Git，root-app 自動部署。

**進階：ApplicationSet**

如果應用都長一個樣（只是 name / namespace 不同），用 **ApplicationSet** 模板化：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: tenants
spec:
  generators:
    - list:
        elements:
          - name: tenant-a
          - name: tenant-b
          - name: tenant-c
  template:
    metadata:
      name: "{{name}}-app"
    spec:
      source:
        repoURL: https://github.com/myorg/tenant-template
        path: base
        helm:
          values: |
            tenantName: {{name}}
      destination:
        namespace: "{{name}}"
        server: https://kubernetes.default.svc
```

支援多種 generator：list / git directory / git file / cluster / pull request 等。

## Sync Strategy：Auto vs Manual、Sync Wave、Hook

**Auto sync：**
- `prune: true`：Git 刪掉的資源在叢集也刪
- `selfHeal: true`：手動改的會被改回去
- 適合：dev、staging
- prod 環境一些團隊會關 auto，要人為按 sync

**Sync Wave**：控制資源套用順序。CRD → Operator → CR 這種有依賴的場景必備。

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "1"
```

數字小的先套，同 wave 內並行。

**Resource Hook**：sync 過程中跑特定 Job。

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
  annotations:
    argocd.argoproj.io/hook: PreSync         # 在 sync 前跑
    argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: myapp:1.0
          command: ["./migrate.sh"]
      restartPolicy: Never
```

常見 hook 種類：
- `PreSync`：sync 前（DB migration）
- `Sync`：sync 中
- `PostSync`：sync 後（smoke test）
- `SyncFail`：失敗時（通知、清理）

## Image Updater 怎麼處理 image tag

GitOps 的一個經典問題：**CI build 出新 image tag，怎麼讓 Git 知道？**

兩個主流方案：

**方案 A：CI 直接改 Git**

CI 跑完 build，cd 到 manifest repo，改 image tag、commit、push。簡單直接。

```yaml
# .github/workflows/deploy.yml
- uses: actions/checkout@v4
  with:
    repository: myorg/k8s-manifests
    token: ${{ secrets.MANIFEST_REPO_TOKEN }}
    path: manifests
- run: |
    cd manifests
    sed -i "s|image: myapp:.*|image: myapp:${{ github.sha }}|" apps/web/deployment.yaml
    git config user.name "ci"
    git config user.email "ci@example.com"
    git commit -am "update web image to ${{ github.sha }}"
    git push
```

**方案 B：ArgoCD Image Updater**

裝 [argocd-image-updater](https://argocd-image-updater.readthedocs.io/)，它定期 poll ECR / Docker Hub，看到新 tag 自動改 Git。

```yaml
# Application annotations
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: web=myorg/web
    argocd-image-updater.argoproj.io/web.update-strategy: semver
    argocd-image-updater.argoproj.io/write-back-method: git
```

各有優缺：A 簡單但 CI 要有 manifest repo 寫權限；B 解耦但多個元件要管。

## Secrets：sops、Sealed Secrets、External Secrets

K8s Secret 是 base64 不是加密，直接 commit 到 Git 等於洩漏。三個主流解法：

**1. Sealed Secrets（Bitnami）**

把 Secret 用 cluster 公鑰加密成 `SealedSecret`，可以安全 commit。叢集內 controller 解密還原成普通 Secret。

```bash
# 加密
echo -n s3cret | kubectl create secret generic db-pass \
  --dry-run=client --from-file=password=/dev/stdin -o yaml \
  | kubeseal -o yaml > sealed-db-pass.yaml

# sealed-db-pass.yaml 可以 commit
```

**2. SOPS（Mozilla）+ ksops / helm-secrets**

用 PGP / KMS / age 加密 YAML 內容，搭配 ArgoCD plugin 在 render 階段解密。

**3. External Secrets Operator（推薦）**

不存 Secret 在 Git，把實際 Secret 放 AWS Secrets Manager / Vault / GCP Secret Manager，叢集內 ESO 同步成 K8s Secret。

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-secret
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: db-secret
  data:
    - secretKey: password
      remoteRef:
        key: prod/db/password
```

**推薦選擇：**
- AWS / GCP / Azure 為主 → External Secrets Operator
- 不想多裝服務、小團隊 → Sealed Secrets
- 多種類型 secret 要 templating → SOPS

## ArgoCD vs Flux

| 面向 | ArgoCD | Flux |
|------|--------|------|
| 出身 | Intuit → CNCF Graduated | Weaveworks → CNCF Graduated |
| 介面 | 強大 Web UI | 主要 CLI，UI 是社群第三方 |
| 結構 | 單體（CRD + controller） | 模組化（多個 controller） |
| 應用宣告 | Application / ApplicationSet | Kustomization / HelmRelease |
| Helm 支援 | 內建 | HelmController |
| 多叢集 | 中央 ArgoCD 管多叢集 | 每叢集一個 Flux |
| Image automation | 外掛 image-updater | 內建 ImageRepository + ImageUpdateAutomation |
| 學習曲線 | 中（UI 友善） | 較陡（更 CLI-first） |

**選擇建議：**
- 要 UI、新手友善、多叢集中央管理 → **ArgoCD**
- 喜歡模組化、純 GitOps 哲學、CLI 操作 → **Flux**
- Job market 上 ArgoCD 比 Flux 常見

## 多叢集管理

ArgoCD 一個 instance 可以管多個叢集：

```bash
# 把另一個叢集註冊進 ArgoCD
argocd cluster add prod-cluster-context
```

Application 的 `destination.server` 改成那個 cluster 的 API URL。

**hub-and-spoke 模式：**

```
            ┌────── Management Cluster ──────┐
            │  ArgoCD                        │
            └──────┬──────┬──────┬───────────┘
                   │      │      │
              ┌────▼──┐ ┌─▼───┐ ┌▼────┐
              │ dev   │ │stg  │ │prod │
              │cluster│ │cluster│cluster│
              └───────┘ └─────┘ └─────┘
```

優點：一個地方看全部狀態、權限管控集中。缺點：management cluster 掛了所有 cluster 沒法部署（但 workload 還是會跑）。

**進階：用 ApplicationSet `cluster generator`** 自動把同一份 manifest 部署到所有註冊的 cluster。

## 面試常考重點

**1. GitOps 跟傳統 CI/CD 差在哪？為什麼 Pull-based 比較好？**  
傳統 CI/CD 是 CI server 主動 push 變更到叢集（CI 需要 cluster admin 權限）。GitOps 是叢集內 agent pull Git 持續同步（叢集對外只 outbound）。Pull-based 優點：零外部寫權限、跨網路友善（on-prem / 多 VPC）、自動偵測漂移、回滾就 git revert。

**2. GitOps 一定要用 ArgoCD 嗎？**  
不一定。GitOps 是一種**模式**，工具有 ArgoCD、Flux、Jenkins X、Rancher Fleet。甚至自己寫 cron + kubectl 也算（但維護痛苦）。CNCF 有定義 GitOps Principles，符合就算。

**3. ArgoCD 怎麼處理 Image tag 自動更新？**  
兩個主流：CI build 完直接改 manifest repo（簡單但 CI 要有寫權限）、或裝 argocd-image-updater 由 ArgoCD 主動 poll registry。**只用 `:latest`** 是反模式，雖然能跑但 Git 看不出實際部署版本、無法 rollback。

**4. Secret 怎麼進 Git？**  
不能直接放原始 Secret。三種選擇：
- **Sealed Secrets**：cluster 公鑰加密，可安全 commit
- **SOPS**：用 KMS/age 加密 YAML 內容
- **External Secrets Operator**：Git 只放 ExternalSecret CRD，實際值在 AWS Secrets Manager / Vault

雲端為主推 ESO，自架推 Sealed Secrets。

**5. ArgoCD `selfHeal` 開了會有什麼後果？**  
任何手動 `kubectl edit / patch / scale` 都會被改回 Git 描述的狀態。好處：保證 Git 是真相、防止配置漂移。壞處：緊急情況想手動調整會被打回去。實務做法：dev/staging 開 selfHeal、prod 看團隊文化。改任何東西都走 PR 是 GitOps 文化的一部分。

**6. App of Apps 跟 ApplicationSet 怎麼選？**  
- **App of Apps**：每個應用是獨立的 Application yaml 在 Git 內，root Application 指向那個資料夾。適合應用結構各異
- **ApplicationSet**：用 generator + template 模板化產生 Application，適合一堆長很像的應用（多 tenant、多 cluster 同樣 app）

兩個可以混用：ApplicationSet 處理批量，App of Apps 處理少數獨特應用。

**7. ArgoCD 多叢集怎麼管？**  
hub-and-spoke：一個 management cluster 跑 ArgoCD，註冊其他 cluster 進來。Application 的 destination.server 指到不同 cluster。優點：集中視角；缺點：管理 cluster 掛了無法部署。也可以 federation 模式：每個 cluster 自己跑 ArgoCD，避免單點。

**8. Sync Wave 是什麼？什麼時候用？**  
控制資源套用順序的 annotation。預設並行套所有資源，但 CRD → Operator → CR 這種有依賴的會失敗。Sync wave 用整數排序，數字小的先套。常見：`-2` Namespace、`-1` CRD、`0` Operator、`1` ConfigMap/Secret、`2` Deployment。

**9. ArgoCD 怎麼做 progressive delivery（canary / blue-green）？**  
ArgoCD 本身只做 sync，不做 traffic splitting。要 progressive delivery 配 **Argo Rollouts**：把 Deployment 換成 Rollout CR，定義 canary / blue-green 策略，整合 Service Mesh（Istio / Linkerd）或 ingress controller 做 traffic 控制。

**10. ArgoCD 跟 Helm 衝突嗎？**  
不衝突。ArgoCD 把 Helm chart 當「manifest source」，render 出 manifest 再 apply。差別是 `helm install / upgrade` 由 ArgoCD 做（不是 helm CLI），所以 `helm list` 看不到，但 ArgoCD UI 看得到。也可以選擇用 Helm Hook（但建議用 ArgoCD Sync Hook 取代）。

**11. GitOps repo 怎麼組織？mono vs poly？**  
常見三種：
- **單 repo 放 app code + manifest**：簡單但 CI / CD trigger 容易混
- **Code repo + 中央 manifest repo**：CI build 後 push 到 manifest repo，ArgoCD 只看 manifest repo（推薦）
- **每個 app 自己的 code + manifest repo**：解耦但 repo 變很多

實務上 **中央 manifest repo** 最常見：環境 / 叢集分資料夾，所有應用 manifest 集中管。

**12. 緊急狀況：prod 部署壞了怎麼辦？**  
- ArgoCD UI 找上一次健康版本，點 Rollback（會回到上一個 git commit 的狀態）
- 或在 Git `git revert` 那個 commit，ArgoCD 自動 sync 回去
- 嚴重情況 disable auto-sync、手動 `kubectl rollout undo`
- 事後一定要把手動改動同步回 Git，否則 selfHeal 開了會再改回壞的狀態

## 小結

GitOps 是現代 K8s 部署的標準模式：

- **觀念**：Git 是真相，agent pull 同步，持續 reconcile
- **ArgoCD 核心**：Application CRD，Auto/Manual sync，Self-heal，Prune
- **進階**：App of Apps、ApplicationSet、Sync Wave、Hook
- **Image tag**：CI 改 Git 或 Image Updater
- **Secret**：External Secrets Operator（雲端）或 Sealed Secrets（自架）
- **多叢集**：hub-and-spoke 或聯邦

跟你目前的 Jenkins 經驗對照：**Jenkins 留著做 CI（build image + 跑測試）**，**ArgoCD 取代 CI 內的 `kubectl apply` 段**。整個流程：

```
Code push → Jenkins build → push image to ECR
                            → update manifest repo with new tag
                                ↓
                            ArgoCD detect change → sync → K8s 更新
```

下一篇進入 K8s Observability：把你會的 Prometheus / Grafana 在 K8s 上完整跑一遍。
