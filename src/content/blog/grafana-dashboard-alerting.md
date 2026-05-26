---
title: "Grafana Dashboard 設計與 Alerting 進階"
excerpt: "Dashboard 不是 panel 一堆貼上去：設計原則、RED/USE template、variable 動態切換、Grafana Alerting、Provisioning as Code、面試常考題。"
date: 2026-08-21
category: "學習"
tags:
  - Grafana
  - Observability
  - SRE
  - Monitoring
series: "Observability 深入"
seriesOrder: 2
featured: false
---

## Agenda

- Dashboard 為什麼大部分人做得糟
- 三層 Dashboard 模型：Overview / Service / Deep dive
- 設計原則：閱讀順序、密度、單位
- Panel 類型怎麼選
- Variable：動態切換 service / cluster / env
- Annotation：標記 deploy / incident
- Grafana Alerting（新版 Unified Alerting）
- Provisioning：Dashboard / Alert / Datasource as Code
- 整合 Loki / Tempo（從 metric 跳 log / trace）
- 多 tenant 與權限管理
- 反模式
- 面試常考重點
- 小結

## Dashboard 為什麼大部分人做得糟

常見問題：

- 一頁塞 30 個 panel，沒人看得完
- panel 之間沒邏輯關聯，順序亂排
- 沒 unit / 軸線標示
- 數字大但沒參考線（多少算高？）
- 沒 SLO 對應，看不出健康度
- 太多顏色 / 太多 legend
- 一個 dashboard 想服務所有受眾

**目的不明**是根本問題。Dashboard 該回答**一個明確問題**：「這個服務健康嗎？」、「DB 壓力來自哪？」、「為什麼 latency 飆高？」

## 三層 Dashboard 模型

借用 Google SRE 的「**Hierarchy of dashboards**」：

```
Level 1: Overview
  ├─ 所有 critical service 健康度
  ├─ SLO 燒掉多少 budget
  └─ 適合：值班、PM、Eng lead

Level 2: Service-level
  ├─ 一個 service 的 RED 跟 USE
  ├─ Deploy / Restart events
  └─ 適合：oncall debug、service owner

Level 3: Deep dive
  ├─ 單一元件（DB、cache、queue）詳細
  ├─ Trace、log 跳轉
  └─ 適合：深度排查特定問題
```

**設計原則：每層 dashboard 是入口，下層是深入**。Level 1 panel 點下去能跳到 Level 2，Level 2 panel 點下去跳 Level 3 或 trace / log。

### Level 1 Overview 範例

放 4–8 個 panel，**單頁不滾動**：

| Panel | 內容 |
|-------|------|
| Service Status | 各 critical service 的 SLO 狀態（綠/黃/紅） |
| Request Rate | 全公司總 QPS 趨勢 |
| Error Rate | 全公司 5xx ratio |
| Latency P99 | 主要 service 的 P99 |
| Error Budget | 各 SLO 剩餘 budget |
| Active Incidents | 進行中的事件 |

### Level 2 Service Dashboard 範例（RED + USE）

**Section 1: RED**（用戶視角）
- Request Rate by endpoint
- Error Rate by endpoint (overlay SLO line)
- Latency p50/p95/p99 by endpoint

**Section 2: Saturation**（資源視角）
- CPU usage
- Memory usage
- Network IO
- DB connection pool

**Section 3: Deploy / Events**
- Annotation：deploy timing
- Recent rollouts

**Section 4: Top-level dependencies**
- Downstream service error rate
- DB query latency

## 設計原則：閱讀順序、密度、單位

### 閱讀順序：**最重要的在左上**

人眼掃描 dashboard 是 Z 字形（左上 → 右上 → 左下 → 右下）。重要 metric 放左上。

```
[Service Status] [Error Rate]
[Latency P99]    [Throughput]
[CPU]            [Memory]
[DB Connections] [Cache hit rate]
```

### 密度：**每個 panel 該有訊息含量**

- 一個 panel 一個問題
- 不要為了「填版面」加 panel
- 看 dashboard 30 秒能說出狀態 = 設計成功

### 單位永遠標清楚

- CPU：cores / percentage
- Memory：bytes（用 Grafana 自動 humanize）
- Network：bytes/sec / packets/sec
- Latency：seconds（不要 ms 跟 s 混用）

**Y 軸記得設 unit**，否則「12000000」沒人知道是 byte 還是 ms。

### 參考線：什麼算高？

```
Latency P99 [target: 200ms (SLO line)]
Error rate [SLO line: 0.1%]
```

加 **threshold line**（紅線）給觀者「這條紅線以下叫安全」的判斷依據。

### 顏色：少用、有意義

- 綠：好
- 黃：警告
- 紅：壞
- **不要超過 5 種顏色在同一 panel**（眼花）

### Legend 簡化

- legend 太多 → 把 by label 改 by service / top 5
- 用 `legendFormat: "{{ service }}"` 而不是預設冗長 series name

## Panel 類型怎麼選

| 類型 | 適合 |
|------|------|
| **Time series** | 趨勢圖（90% 情況） |
| **Stat** | 單一數字 + sparkline（KPI 大字） |
| **Gauge** | 接近 threshold（如 disk 使用率） |
| **Bar gauge** | 多個 series 排名 |
| **Table** | 結構化資料（top N、status list） |
| **Heatmap** | 分布（latency histogram、queue depth） |
| **Pie / Donut** | 比例（少用，難讀） |
| **State timeline** | 狀態時間軸（service status 綠/黃/紅） |

**避免：** 3D pie chart、過多 gauge、bar chart 當趨勢用。

## Variable：動態切換 service / cluster / env

`$service` variable 讓同一個 dashboard 切多個 service：

```
Variable: service
Type: Query
Datasource: Prometheus
Query: label_values(http_requests_total, service)
Multi-value: yes
Include All: yes
```

Dashboard 內每個 query 都用 `{service="$service"}`，切 dropdown 就換 service。

**Variable 串聯**：

```
Variable 1: cluster      = label_values(up, cluster)
Variable 2: namespace   = label_values(up{cluster="$cluster"}, namespace)
Variable 3: pod          = label_values(up{cluster="$cluster", namespace="$namespace"}, pod)
```

選 cluster → namespace 自動更新 → pod 自動更新。**這就是「一個 dashboard 服務所有環境」的關鍵**。

## Annotation：標記 deploy / incident

`/etc/grafana/annotations` 上覆蓋 deploy / incident，讓 dashboard 圖表上自動標：

```
[2026-08-15 14:23]
   ↓
deploy v2.34
↓
[panel 顯示一條垂直線 + 標籤]
```

從 Prometheus 抓 deploy event：

```yaml
- name: Deploy events
  datasource: Prometheus
  expr: changes(kube_deployment_status_observed_generation[1m]) > 0
  textFormat: "Deploy: {{deployment}}"
  iconColor: blue
```

從 K8s event 抓 incident：

```yaml
- name: Incidents
  datasource: Loki
  expr: '{namespace="incident-mgmt"} |= "incident-start"'
```

**作用**：圖表異常時一眼看出「跟那次 deploy 重合」。

## Grafana Alerting（Unified Alerting）

Grafana 9+ 推 Unified Alerting，**取代舊的 dashboard-based alert**。新的特色：

- Alert rules 是獨立物件（不是綁在某 panel）
- 多 datasource 混合（從 Prom + Loki 一起算）
- Alert routing 跟 Prometheus Alertmanager 一致（也可以直接用 AM）

### Alert Rule 範例

```yaml
- name: API Latency
  rules:
    - alert: APILatencyHigh
      expr: |
        histogram_quantile(0.99,
          sum by (le, service) (rate(http_request_duration_seconds_bucket{service="api"}[5m]))
        ) > 0.5
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "API latency P99 > 500ms"
        runbook: "https://wiki/runbooks/api-latency"
```

### Notification Policy

```
路徑：
  severity=critical → PagerDuty
  severity=warning  → Slack #alerts-warning
  severity=info     → Email digest
```

### 跟 Prometheus Alertmanager 比

| 面向 | Grafana Alerting | Prometheus Alertmanager |
|------|------------------|------------------------|
| 規則寫法 | UI / Provisioning YAML | PrometheusRule CRD |
| 多 datasource | 支援 | 不支援 |
| UI | 強 | 弱（Karma 第三方） |
| 跟 dashboard 整合 | 緊 | 鬆 |

**團隊用 Prometheus 為主、有 PrometheusRule 工作流的**：alert 還是放 Prometheus 慣性比較好。
**用 Grafana 為主、多 datasource 混查的**：Grafana Alerting 較方便。

兩者可以**並存**：Prometheus 處理基礎設施告警，Grafana 處理跨資料源的複雜告警。

## Provisioning：Dashboard / Alert / Datasource as Code

Production Grafana 千萬別讓人在 UI 改 dashboard，會出包就找不回。**全部 Provisioning as Code**。

### Datasource

`/etc/grafana/provisioning/datasources/prometheus.yaml`：

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus.monitoring:9090
    isDefault: true
  - name: Loki
    type: loki
    access: proxy
    url: http://loki.monitoring:3100
```

### Dashboard

`/etc/grafana/provisioning/dashboards/dashboards.yaml`：

```yaml
apiVersion: 1
providers:
  - name: default
    folder: ''
    type: file
    options:
      path: /var/lib/grafana/dashboards
```

把 `.json` dashboard 放 `/var/lib/grafana/dashboards/`，Grafana 自動載入。

### Alert Rules

`/etc/grafana/provisioning/alerting/rules.yaml`：

```yaml
apiVersion: 1
groups:
  - orgId: 1
    name: api-slo
    folder: SRE
    interval: 60s
    rules:
      - uid: api-error-rate
        title: API Error Rate High
        condition: B
        ...
```

### 工具：Grafonnet / Grizzly

寫 dashboard YAML 太囉嗦，社群工具：

- **[Grafonnet](https://grafana.github.io/grafonnet/)**：Jsonnet library 寫 dashboard，可重用 panel function
- **[Grizzly](https://grafana.github.io/grizzly/)**：CLI 工具管 dashboard / alert as code，支援 diff / apply

範例 Grafonnet：

```jsonnet
local g = import 'g.libsonnet';

g.dashboard.new('API Service')
+ g.dashboard.withPanels([
  g.panel.timeSeries.new('Request Rate')
  + g.panel.timeSeries.queryOptions.withTargets([
      g.query.prometheus.new('prometheus', 'sum(rate(http_requests_total[5m]))')
  ]),
])
```

跑 `jsonnet -J vendor dashboard.jsonnet` 產出標準 JSON。

### Kubernetes 環境

ConfigMap 掛載 dashboard JSON：

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-dashboard
  labels:
    grafana_dashboard: "1"      # kube-prometheus-stack 慣例
data:
  api.json: |
    { ... }
```

kube-prometheus-stack 自動偵測標 `grafana_dashboard: "1"` 的 ConfigMap 載入。

## 整合 Loki / Tempo（從 metric 跳 log / trace）

Grafana 的殺手鐧：**三大支柱整合**。從 metric panel 點下去，直接帶 service / time range 跳 Loki log 或 Tempo trace。

### Datasource links

在 Prometheus datasource 設定加 **Derived fields**：

```
field: trace_id
url: /explore?datasource=Tempo&query=${__value.raw}
```

log 內出現 trace_id → 自動加超連結跳 Tempo。

### Panel link

每個 panel 加 link：

```
title: View logs
url: /explore?orgId=1&datasource=Loki&query={service="${service}"}&time=${__from}-${__to}
```

點 panel 標題 → 跳 Loki 過濾相同 time range / service 的 log。

**這就是 modern observability 的價值**：metric 發現異常 → 跳 log 看細節 → log 內找 trace_id → 看 trace 確認哪段卡。

## 多 tenant 與權限管理

大公司 Grafana 多 team 共用，要隔離：

- **Folder**：Dashboard 按 folder 分（team-a / team-b）
- **Permissions**：folder level 給 team admin / editor / viewer 權限
- **Organization**：完全隔離的多租戶（少用，management 麻煩）
- **RBAC**：細到 dashboard 個別權限（Enterprise 版才有，OSS 限制較多）

**SSO 整合**：Grafana 接 OIDC / SAML，user / group 自動 sync。

## 反模式

**1. 一頁 50 個 panel**
沒人看完。拆 dashboard，三層模型。

**2. 沒有 SLO 線**
看到 latency 200ms 不知道是不是壞了。加 threshold line。

**3. 顏色亂用**
紅色當「正常」、綠色當「警告」。**遵循直覺：紅壞綠好**。

**4. Legend 30 條**
擠在一起看不到值。用 top 5、aggregate by service / cluster。

**5. UI 改完不存 source code**
某天 dashboard 不見了 / 被改壞，找不回。**Provisioning as code 是 production 必備**。

**6. Alert 放 dashboard 內**
舊版做法，新版用獨立 Alert rule + Notification policy。

**7. 沒 annotation**
不知道 latency 飆高跟 deploy 重合。加 deploy / incident annotation。

**8. 沒 unit**
數字顯示 12345678 沒 unit，不知道是 byte / ms / count。

## 面試常考重點

**1. 設計一個 dashboard 該怎麼開始？**  
先問「這 dashboard 給誰看、回答什麼問題」。Overview 給 oncall / PM 看全局；Service dashboard 給 owner debug 用 RED + USE；Deep dive 給 SRE 排查特定問題。三層 hierarchy，上層 panel 點下去能 drill 到下層。

**2. RED / USE 怎麼分配進 dashboard？**  
RED（Rate / Errors / Duration）放 service dashboard 的「用戶視角」section。USE（Utilization / Saturation / Errors）放「資源視角」section。RED panel 排在 USE 上面（先看用戶痛不痛，再看為什麼）。

**3. Grafana variable 怎麼用？**  
動態切 dashboard 內容。用 `label_values()` 從 Prometheus 抓可選值。串聯：cluster → namespace → pod，選上層自動更新下層。讓「一個 dashboard 服務所有 service / env」變可能。

**4. Annotation 解決什麼問題？**  
標記重要事件（deploy / incident / config change）在圖表上。看到 metric 異常時可以一眼看出「跟某次 deploy 重合」。從 Prometheus / Loki / API 抓事件。

**5. Grafana Alerting 跟 Prometheus Alertmanager 怎麼選？**  
Prometheus + AM：規則用 PrometheusRule CRD 管，跟 K8s 工作流相容。Grafana Alerting：UI 友善，可跨 datasource 算（Prom + Loki 混合）。兩者可並存。**有 Prometheus 工作流的維持 AM 比較主流**。

**6. 為什麼 Dashboard 要 Provisioning as Code？**  
- UI 改容易出包找不回
- 沒有 audit trail
- Multi-env 同步難
- Code 化 + git 版本管理 + PR review，跟 Terraform 一樣的工程紀律。

**7. 三大支柱整合在 Grafana 怎麼做？**  
Datasource derived fields（log 內 trace_id 變超連結）、Panel link（panel 標題點下去跳 Loki 同 time range）。完整流程：metric panel 看到異常 → 點 panel 跳 Loki log → log 內 trace_id 跳 Tempo trace。

**8. Dashboard 維護負擔大怎麼解？**  
- 用模板（Grafonnet）寫 dashboard，所有 service 共用 panel function
- 三層模型減少冗餘
- 定期清掉沒人看的 dashboard
- Folder + RBAC 讓每個 team 管自己的

**9. 多 tenant Grafana 怎麼隔離？**  
Folder + folder permissions（OSS 限制較大）；Enterprise 有完整 RBAC；要完全隔離用 multi-org 或多個 Grafana instance。SSO + group 自動 sync 是基本配備。

**10. Histogram 在 Grafana 怎麼視覺化？**  
- 用 heatmap panel 看分布變化
- 用 stat panel 顯示 P50 / P95 / P99 大字
- 不要把 histogram bucket 直接畫 time series（圖很亂）

**11. Dashboard 為什麼 query 很慢？**  
- PromQL 複雜（沒用 recording rule）
- time range 太長
- variable cardinality 高
- 太多 series 同時查
- Datasource 端慢（Prometheus 自己壓力大）

對策：用 recording rule、限縮 time range、用 `step` 控制取樣密度、查 Prometheus tsdb status。

**12. 怎麼證明一個 Dashboard 設計好？**  
新人 30 秒能說出「現在系統健康嗎」、oncall 看完知道「下一步該看哪」、PM 看完知道「業務影響多少」。設計差的 dashboard 是看完還是要問人。

## 小結

Dashboard 不只是 panel 拼貼：

| 原則 | 內容 |
|------|------|
| **目的明確** | 一個 dashboard 答一個問題 |
| **三層架構** | Overview / Service / Deep dive |
| **重要在左上** | Z 字掃描順序 |
| **單位/threshold** | 不用猜這數字是不是壞 |
| **Variable** | 一個 dashboard 服務所有 service |
| **Annotation** | metric 異常自動對應 deploy / event |
| **As Code** | provisioning + Grafonnet + git |
| **整合三大支柱** | metric → log → trace 串成一線 |

**面試心法：**
- 講出 RED + USE 怎麼放 dashboard
- 知道 variable / annotation / derived field 三大工具
- 強調 Dashboard as Code（不在 UI 改）
- 提到三層 hierarchy 與 SRE 文化
- 知道 Grafana Alerting vs Prometheus AM 取捨

跟你旺宏的 OA 監控系統對照：你已經做了 Prometheus + Grafana，這篇可以把「Dashboard 設計工程化」這塊補齊，履歷講得更深。
