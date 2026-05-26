---
title: "Kubernetes 學習筆記 - Observability 完整實戰"
excerpt: "K8s 上的監控、日誌、追蹤：kube-prometheus-stack、PromQL、Grafana Dashboard、kube-state-metrics、Loki、OpenTelemetry、USE/RED 方法論、面試重點。"
date: 2026-06-12
category: "學習"
tags:
  - Kubernetes
  - Observability
  - Prometheus
  - Grafana
  - SRE
series: "Kubernetes"
seriesOrder: 5
featured: true
---

## Agenda

- Observability 三支柱：Metrics / Logs / Traces
- Metrics：Prometheus 在 K8s 上的標準裝法
- kube-prometheus-stack 完整介紹
- 該監看哪些指標：USE / RED / Golden Signals
- PromQL 實戰
- ServiceMonitor / PodMonitor
- Alerting：規則、Alertmanager、抑制與分組
- Recording rules 與長期儲存（Thanos / Mimir）
- Logs：Loki / EFK 方案比較
- Traces：OpenTelemetry + Tempo / Jaeger
- 監控自己（meta-monitoring）
- 面試常考重點
- 小結

## Observability 三支柱

監控 ≠ 觀測。傳統監控只關心「服務是不是活著」，**Observability** 是「系統內部發生什麼事，能不能從外部問出來」。

| 支柱 | 答什麼問題 | 典型工具 |
|------|-----------|---------|
| **Metrics** | 「多少？」聚合的數值 | Prometheus、CloudWatch、Datadog |
| **Logs** | 「發生了什麼？」事件文字 | Loki、ELK、CloudWatch Logs |
| **Traces** | 「在哪卡住？」單一請求跨服務的路徑 | Jaeger、Tempo、X-Ray |

**Continuous Profiling** 算第四支柱（pprof、Pyroscope），但較新。

## Metrics：Prometheus 在 K8s 上的標準裝法

Prometheus 是 K8s 監控的事實標準，**pull-based**：定期 HTTP GET 應用的 `/metrics` 拉資料。

K8s 上裝 Prometheus 推薦走 **kube-prometheus-stack** 這個 Helm chart，一鍵裝齊：

- Prometheus Operator（CRD 管理 Prometheus 設定）
- Prometheus（time-series DB）
- Alertmanager（告警路由）
- Grafana（儀表板）
- node-exporter（每個 Node 暴露 CPU/mem/disk/net）
- kube-state-metrics（K8s 物件狀態指標）
- 預設一堆 ServiceMonitor + Dashboard + Alert

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install kube-prom prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f values.yaml
```

`values.yaml` 重點：

```yaml
prometheus:
  prometheusSpec:
    retention: 30d
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          resources:
            requests:
              storage: 100Gi
    resources:
      requests:
        cpu: 500m
        memory: 2Gi
      limits:
        memory: 4Gi

alertmanager:
  alertmanagerSpec:
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          resources:
            requests:
              storage: 10Gi

grafana:
  adminPassword: "set-me"
  persistence:
    enabled: true
    storageClassName: gp3
  ingress:
    enabled: true
    hosts: [grafana.example.com]
```

## kube-state-metrics vs node-exporter vs cAdvisor

容易搞混的三個：

| Exporter | 來源 | 暴露什麼 |
|----------|------|---------|
| **node-exporter** | 跑在每個 Node（DaemonSet） | Node 層級：CPU、memory、disk、network、filesystem |
| **cAdvisor** | 內建在 kubelet | 容器層級：每個 container 的 CPU/memory/network 使用量 |
| **kube-state-metrics** | 單一 Deployment | K8s 物件狀態：Pod phase、Deployment replicas、Job 狀態 |

簡單記：**node** = 機器資源，**cAdvisor** = 容器資源，**kube-state-metrics** = K8s 物件狀態。三個都裝才完整。

## 該監看哪些指標：USE / RED / Golden Signals

別亂裝一堆 dashboard，先決定要監什麼。三個經典方法論：

### USE（資源導向，Brendan Gregg 提出）
適合監看 **資源**（CPU、memory、disk、network）：
- **U**tilization：使用率
- **S**aturation：壓力（queue 長度、wait time）
- **E**rrors：錯誤計數

### RED（服務導向，Tom Wilkie 提出）
適合監看 **request-driven service**：
- **R**ate：每秒請求數
- **E**rrors：錯誤率
- **D**uration：延遲分佈

### Google SRE Four Golden Signals
RED 加上 saturation：**Latency、Traffic、Errors、Saturation**。

**實務上：**
- 每個 service 必看 RED
- 每個 Node 必看 USE
- 把這些做成 dashboard 模板，所有服務套用

## PromQL 實戰

PromQL 是 Prometheus 查詢語言，**面試常考**。基本範例：

```promql
# 1. Pod 重啟次數（過去 1 小時）
sum(rate(kube_pod_container_status_restarts_total[1h])) by (pod, namespace)

# 2. 各 Pod 記憶體用量
sum(container_memory_working_set_bytes{container!="POD",container!=""}) by (pod)

# 3. Node CPU 使用率
100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 4. 各 Service 5 分鐘 P99 延遲
histogram_quantile(0.99,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
)

# 5. 5xx 錯誤率
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
/
sum(rate(http_requests_total[5m])) by (service)

# 6. Disk 預計幾天會滿
predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[6h], 7 * 86400) < 0

# 7. 找出 OOMKilled 的容器
sum by (pod, namespace) (kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1)

# 8. HPA 距離 max 還剩多少
kube_horizontalpodautoscaler_status_current_replicas
/
kube_horizontalpodautoscaler_spec_max_replicas
```

**PromQL 核心觀念：**

- **Counter**（累加）：永遠遞增，要用 `rate()` 或 `increase()` 才有意義
- **Gauge**（瞬時值）：可上下，直接用
- **Histogram**：暴露 `_bucket`、`_sum`、`_count`，搭 `histogram_quantile()` 算分位
- **Summary**：client 端算好分位，比 histogram 省，但無法跨 instance 聚合

**rate vs irate vs increase：**
- `rate(metric[5m])`：5 分鐘窗口的平均每秒增量（圖表用）
- `irate(metric[5m])`：最後兩個 sample 的瞬時 rate（敏感，alerting 少用）
- `increase(metric[1h])`：1 小時的總增量

**面試陷阱**：`rate()` 計算前會自動 reset detection，counter 歸零不會算成負值；但要小心 `sum(rate(...))` 跟 `rate(sum(...))` 結果不同 — 前者是正確做法。

## ServiceMonitor / PodMonitor

Prometheus Operator 引入 CRD 來宣告「要監誰」，**不用改 Prometheus config**：

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: web
  namespace: monitoring
  labels:
    release: kube-prom        # 必須對到 Prometheus 的 serviceMonitorSelector
spec:
  namespaceSelector:
    matchNames: [default, prod]
  selector:
    matchLabels:
      app: web                # 配對 Service 的 label
  endpoints:
    - port: metrics           # Service 內 port name
      interval: 30s
      path: /metrics
```

對應的 Service 要有 `metrics` 這個 port name。

`PodMonitor` 跟 ServiceMonitor 類似但直接配 Pod（不需要 Service）。

**常見坑：**
- ServiceMonitor 的 label 沒對到 Prometheus 的 `serviceMonitorSelector` → 不會被選到
- Endpoint port name 寫錯 → 找不到 target
- NetworkPolicy 把 Prometheus 擋掉 → target down

## Alerting：規則、Alertmanager、抑制與分組

**PrometheusRule**：寫告警規則。

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: web-alerts
  namespace: monitoring
spec:
  groups:
    - name: web.rules
      interval: 30s
      rules:
        - alert: HighErrorRate
          expr: |
            sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
            /
            sum(rate(http_requests_total[5m])) by (service)
            > 0.05
          for: 10m
          labels:
            severity: critical
            team: web
          annotations:
            summary: "Service {{ $labels.service }} 5xx rate above 5%"
            description: "5xx error rate is {{ $value | humanizePercentage }}"
            runbook: "https://wiki.example.com/runbooks/web-high-error"
```

**重點欄位：**
- `for: 10m`：條件持續 10 分鐘才觸發（避免一閃即逝的雜訊）
- `labels.severity`：給 Alertmanager 分流用
- `annotations.runbook`：值班 SOP 連結（**面試亮點**：成熟團隊每個告警都有 runbook）

**Alertmanager 設定**：

```yaml
route:
  receiver: default
  group_by: [alertname, cluster, severity]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers:
        - severity = "critical"
      receiver: pagerduty
    - matchers:
        - severity = "warning"
      receiver: slack-warnings

receivers:
  - name: pagerduty
    pagerduty_configs:
      - service_key: $PD_KEY
  - name: slack-warnings
    slack_configs:
      - api_url: $SLACK_URL
        channel: "#alerts"

inhibit_rules:
  - source_matchers: [severity = "critical"]
    target_matchers: [severity = "warning"]
    equal: [alertname, cluster]
```

**重要觀念：**
- **分組（group）**：同一波告警合併成一條通知
- **抑制（inhibit）**：高優先告警觸發時自動壓低相關告警（避免 critical 跟 warning 同時噴）
- **靜音（silence）**：維護期間手動暫停某些告警
- **重複（repeat_interval）**：未解決的告警隔多久再發一次

## Recording rules 與長期儲存

**Recording rules**：把常用 / 昂貴的查詢預先算好存成新 metric。

```yaml
- record: service:http_request_errors:ratio_5m
  expr: |
    sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
    /
    sum(rate(http_requests_total[5m])) by (service)
```

之後 dashboard / alert 直接查 `service:http_request_errors:ratio_5m`，快很多。

**長期儲存**：Prometheus 本機 storage 適合幾天～幾週，要存月 / 年要用：

| 方案 | 特色 |
|------|------|
| **Thanos** | sidecar 模式，把 block 上 S3，querier 跨多 Prometheus 查詢 |
| **Cortex / Mimir** | Grafana 推，水平擴展、multi-tenant |
| **VictoriaMetrics** | 寫入快、CPU/storage 省、PromQL 相容 |
| **AWS Managed Prometheus (AMP)** | 完全託管，按用量收費 |

**選擇建議：**
- 想完全 hand-off → AMP / Grafana Cloud
- 自架想簡單 → VictoriaMetrics
- 已經有 S3 跟營運能力 → Thanos
- 大規模 multi-tenant → Mimir

## Logs：Loki / EFK 方案比較

K8s log 處理基本流程：

```
container stdout → Node /var/log/pods/ → log shipper → 中央 log store → query UI
```

主流方案：

| Stack | 元件 | 特色 |
|-------|------|------|
| **PLG (Loki)** | Promtail / Fluent Bit + Loki + Grafana | **只索引 label，內容不索引**，便宜，跟 Prometheus 同生態 |
| **EFK** | Fluent Bit + Elasticsearch + Kibana | 全文索引強大，但貴、運維重 |
| **CloudWatch Logs** | Fluent Bit → CW | AWS 原生，整合好，量大會貴 |

**Loki 範例設定（Helm）：**

```bash
helm install loki grafana/loki-stack \
  -n monitoring \
  --set loki.persistence.enabled=true \
  --set grafana.enabled=false \
  --set promtail.enabled=true
```

Loki 查詢用 **LogQL**（語法跟 PromQL 像）：

```logql
# 看某個 app 的所有 log
{app="web"}

# 過濾包含 error
{app="web"} |= "error"

# 拒絕含 healthz
{app="web"} != "healthz"

# 過去 5 分鐘錯誤率
sum(rate({app="web"} |= "error" [5m])) by (pod)
```

**為什麼大量採用 Loki：**
- 跟 Prometheus 同邏輯（label-based selector）、同 UI（Grafana）
- 不索引內文，cost 比 ES 低一個量級
- 寫入快，可以接 K8s 上每秒幾 MB 的 log

**Loki 缺點：**
- 全文搜尋慢（要 scan）
- 不適合非常結構化的查詢

## Traces：OpenTelemetry + Tempo / Jaeger

trace 解決「一個請求進來打了 N 個服務，到底卡在哪」。

```
[user] → [api-gateway] → [auth] → [order] → [payment] → [db]
   trace_id: abc123 貫穿整條 chain
   每段是一個 span，記錄起訖時間、metadata
```

**OpenTelemetry (OTel)** 是 CNCF 標準，取代過去的 OpenTracing + OpenCensus。架構：

```
App (有 instrumentation library)
      ↓ OTLP protocol
OTel Collector (DaemonSet 或 Deployment)
      ↓
[Tempo / Jaeger / X-Ray / Datadog]
```

**程式碼端 instrumentation：**
- 自動 instrumentation：很多語言有 agent 自動注入（Java javaagent、Python opentelemetry-instrument）
- 手動：用 SDK 加 span、attribute

**Tempo（Grafana）**：trace 後端，特色：
- 只索引 trace_id（依靠 Loki 找 trace_id）
- 後端用 S3，便宜
- 跟 Grafana 整合

**從 logs 跳到 trace 跳到 metrics**（**面試亮點**）：
- Grafana 同一個 UI 可以從 metric → 找對應時間段的 log → 從 log 抓 trace_id 看 trace
- 這就是 observability stack 整合的價值

## 監控自己（meta-monitoring）

Prometheus 自己掛了你會不知道。**meta-monitoring** 用另一個系統監控你的監控系統：

- Prometheus 用 `up{job="prometheus"}` 自監（但這個查詢本身要靠它自己…）
- 部署一個獨立的 Blackbox Exporter / 第三方 SaaS 從外面 probe
- Alertmanager 用 `Watchdog` alert：永遠觸發，下游收不到表示鏈路掛
- Alertmanager 部署 2+ replica + clustering，避免單點

## 面試常考重點

**1. Prometheus 為什麼是 pull-based？跟 push 比有什麼優缺點？**  
Pull：Prometheus 主動 HTTP GET 目標的 `/metrics`。優點：service discovery 簡單（K8s 內就有 endpoint API）、target 故障 Prometheus 自己會發現（`up=0`）、防止 push 端被攻陷塞假資料。缺點：短命 Job 還沒被 scrape 就消失（解法：Pushgateway）、防火牆要 Prometheus 能進去（解法：reverse pull、agent mode）。

**2. Counter 跟 Gauge 差在哪？為什麼 counter 要配 `rate()`？**  
Counter 只升不降（重啟會歸零），直接看數值沒意義（過去多少跟現在多少差異才是訊號）。`rate(counter[5m])` 算過去 5 分鐘的平均每秒增量。Gauge 是瞬時值（CPU usage、queue size），可上可下，直接看。

**3. histogram 跟 summary 差在哪？**  
Histogram 在 server 端算分位，可跨 instance 聚合（`histogram_quantile + sum by (le)`），缺點是 bucket 要事先定好。Summary 在 client 端算分位（quantile），準但**不能跨 instance 聚合**（無法把 p99 加起來）。實務上推薦 histogram。

**4. `sum(rate(x))` vs `rate(sum(x))` 差在哪？**  
正確的是 `sum(rate(x[5m])) by (label)`。`rate(sum(x[5m]))` 會先把 counter 加起來再算 rate，counter reset 會被混在一起無法偵測，導致瞬間出現負值或大尖刺。**面試常考陷阱**。

**5. ServiceMonitor 沒生效，怎麼 debug？**  
按順序檢查：
- ServiceMonitor label 有沒有對到 Prometheus 的 `serviceMonitorSelector`
- ServiceMonitor 指定的 namespace selector 有沒有涵蓋目標 namespace
- 目標 Service 的 port name 跟 ServiceMonitor 設定一致嗎
- Pod 是否 expose `/metrics`，curl 進去看
- NetworkPolicy 有沒有擋
- Prometheus UI 的 Targets 頁面看 status

**6. K8s 上要監看哪些指標？**  
最少必看：
- **Node**：CPU / memory / disk / network（USE）、node_exporter
- **Pod**：CPU/memory throttling、restart count、phase、container_memory_working_set_bytes
- **K8s 物件**：Deployment replicas（current vs desired）、Pod pending、Job 失敗、PVC bound
- **應用層**：RED（rate / errors / duration）
- **基礎設施**：etcd、apiserver request rate、scheduler latency

**7. Loki 為什麼便宜？什麼時候不該用？**  
便宜是因為**只索引 label，不索引內文**。儲存用物件存儲（S3），查詢時 scan 對應 chunk。不適合：需要全文搜尋很多次、log 量極大且查詢複雜、查詢延遲非常敏感（ES 還是比較快）。

**8. RED 跟 USE 跟 Golden Signals 怎麼用？**  
- **USE**：監看資源（CPU、磁碟、網路），看 Utilization / Saturation / Errors
- **RED**：監看 service，看 Rate / Errors / Duration
- **Golden Signals**：Google SRE 出的，RED + Saturation

實務：服務用 RED、機器/底層資源用 USE，組合起來就涵蓋大部分情境。

**9. Alert 設計常見問題？**  
- **太敏感**：條件設太低、`for` 不夠長 → 噪音多，工程師會 mute
- **沒 actionable**：alert 響但不知道要做什麼 → 一定要有 runbook
- **沒分級**：critical 跟 warning 混在一起 → 真正出事被淹沒
- **症狀 vs 原因**：alert 該打症狀（5xx 飆高）不該打原因（DB 連線多）— 原因可能很多種，症狀才是用戶感受
- **alert fatigue**：太多 alert 響到沒人理，要定期 review 並刪掉沒用的

**10. SRE 怎麼用 SLO 做監控？**  
定義 SLI（如「99.9% 請求 latency < 200ms」）→ 設 SLO（一段時間內要達到的比例，如 30 天 99.9%）→ 算 Error Budget（0.1% = 43 分鐘）→ 用 PromQL 持續計算「燒掉多少 budget」。當 budget 燒太快觸發 alert（multi-burn-rate alert），同時當 budget 還很多時可以接受發佈/實驗。

**11. Prometheus 撐不下要怎麼擴展？**  
- 先確認瓶頸：CPU（query 慢）、記憶體（high cardinality）、磁碟（量大）
- **降 cardinality**：拿掉高基數 label（user_id、request_id）
- 用 **recording rule** 預先算高頻 dashboard 查詢
- 多個 Prometheus 各管一塊（按 namespace / team 切）
- 上長期儲存（Thanos / Mimir）做跨 Prometheus 查詢
- 換 **VictoriaMetrics** 通常省 50%+ 資源

**12. 三大支柱怎麼整合？**  
- Metric 發現異常（5xx 飆高）
- 跳到那段時間的 log（Grafana 同視窗）
- log 內找 trace_id
- 開 trace 看是哪一段服務慢

這個流程是 modern observability 的標準操作，Grafana 全套（Prometheus + Loki + Tempo）或 Datadog / New Relic 都支援。

## 小結

K8s observability 的完整 stack：

| 支柱 | 工具 | 收什麼 |
|------|------|--------|
| Metrics | Prometheus + kube-state-metrics + node-exporter + Grafana | RED + USE |
| Logs | Loki + Promtail / Fluent Bit | 應用 / 系統日誌 |
| Traces | OpenTelemetry + Tempo / Jaeger | 跨服務請求路徑 |
| Alert | Alertmanager + PagerDuty / Slack | 自動化通知與 runbook |

實務原則：

- **裝 kube-prometheus-stack** 一鍵搞定 metrics
- 服務必看 RED、機器必看 USE
- Alert 永遠搭 `for` + runbook，**症狀導向不是原因導向**
- 高基數 label 是 Prometheus 殺手，提前 review
- 長期儲存上 Thanos / VictoriaMetrics / 託管服務
- Logs 偏好 Loki（cost）、trace 用 OTel
- SRE 進階用 SLO + error budget 做 alert

下一篇進入 K8s Security：Pod Security Admission、OPA Gatekeeper、image scanning、Secret encryption、Supply Chain 整套。
