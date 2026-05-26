---
title: "PromQL 與 Alerting 深入 - 從查詢語法到告警工程"
excerpt: "PromQL 完整解析：data model、四種 metric type、aggregation、histogram_quantile、rate 陷阱、Alert 設計原則、Recording rules、SLO-based multi-burn-rate alert 實戰。"
date: 2026-08-07
category: "學習"
tags:
  - Prometheus
  - PromQL
  - Observability
  - SRE
series: "Observability 深入"
seriesOrder: 1
featured: false
---

## Agenda

- Prometheus 資料模型
- 四種 metric type：Counter / Gauge / Histogram / Summary
- PromQL 基礎：選擇器、運算子
- 時間範圍 vector vs instant vector
- rate / irate / increase 差異
- 聚合：sum / avg / max / by / without
- histogram_quantile 算分位
- 函式速查
- Label cardinality 與效能
- Recording rules 預先聚合
- Alert 設計：5 大原則
- 多視窗多 burn rate alert
- 常見陷阱
- 面試常考重點
- 小結

## Prometheus 資料模型

每筆資料是一個 **time series**：

```
<metric_name>{<label1>=<value1>, <label2>=<value2>, ...} <value> <timestamp>
```

範例：

```
http_requests_total{method="GET", status="200", path="/api"} 12345 1717603200
```

意思：到 timestamp 1717603200 為止，符合 `method=GET, status=200, path=/api` 的請求數累計 12345。

**重點：** 每個 label 組合是**獨立的 time series**。`{method="POST"}` 跟 `{method="GET"}` 是兩條完全不同的 series，各自有自己的時間序列數值。

## 四種 metric type

### 1. Counter（計數器）

只升不降。重啟時會歸零。

**例：** `http_requests_total`, `process_cpu_seconds_total`

```promql
# 看 raw counter 沒意義（永遠在漲）
http_requests_total

# 要用 rate 算每秒速率
rate(http_requests_total[5m])
```

**命名慣例：** counter 名稱要 `_total` 結尾。

### 2. Gauge（量計）

可上可下，瞬時值。

**例：** `node_memory_MemAvailable_bytes`, `kube_pod_status_phase`, `queue_size`

```promql
# 直接用
node_memory_MemAvailable_bytes / 1024 / 1024 / 1024     # GB
```

### 3. Histogram

把觀測值（latency、size）放進預先定義的 bucket。客戶端暴露三個 metric：

```
http_request_duration_seconds_bucket{le="0.1"} 100
http_request_duration_seconds_bucket{le="0.5"} 250
http_request_duration_seconds_bucket{le="1"}   280
http_request_duration_seconds_bucket{le="+Inf"} 300
http_request_duration_seconds_sum   125.3
http_request_duration_seconds_count 300
```

`le` 是「less than or equal」。**bucket 是累積的**（≤ 0.5 包含 ≤ 0.1 的部分）。

用途：
- `_count`：總觀測數
- `_sum`：總和（算平均：`sum / count`）
- `_bucket`：搭 `histogram_quantile` 算分位

**Histogram 的優點：可以跨 instance 聚合**（PromQL 端算 quantile）。

### 4. Summary

跟 histogram 像，但 quantile 是**客戶端算**好直接 expose：

```
http_request_duration_seconds{quantile="0.5"}  0.2
http_request_duration_seconds{quantile="0.9"}  0.8
http_request_duration_seconds{quantile="0.99"} 1.5
http_request_duration_seconds_sum   125.3
http_request_duration_seconds_count 300
```

**Summary 的缺點：不能跨 instance 聚合**（無法把 p99 加起來）。

**選擇建議：** 多數情境用 **Histogram**，因為能跨 instance 聚合。Summary 只在「客戶端要精確 quantile、且不需要跨 instance」時用。

## PromQL 基礎

### Instant Vector vs Range Vector

**Instant vector**：當下時刻的數值。

```promql
http_requests_total                   # 所有 series 在當下的值
http_requests_total{status="200"}     # 過濾
```

**Range vector**：過去一段時間的數值集合。

```promql
http_requests_total[5m]               # 過去 5 分鐘的數據點
```

**重點**：很多函式（`rate`, `increase`, `delta`）**只能吃 range vector**。

### 選擇器（Selectors）

```promql
# 精確
http_requests_total{method="GET"}

# 不等於
http_requests_total{method!="POST"}

# Regex
http_requests_total{status=~"5.."}    # 5xx
http_requests_total{path=~"/api/.*"}

# Regex 排除
http_requests_total{status!~"5.."}
```

### 運算子

```promql
# 加減乘除
node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes

# 跨 series 對應 (label match)
node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes

# 比較
node_filesystem_avail_bytes < 1000000000      # < 1 GB
node_load1 > 4
```

### 聚合運算子

`sum`, `avg`, `min`, `max`, `count`, `stddev`, `topk`, `bottomk`, `quantile`

```promql
# 全部加起來
sum(rate(http_requests_total[5m]))

# 按 label 分組
sum by (service) (rate(http_requests_total[5m]))

# 排除某 label 後分組（剩下的 label 都保留）
sum without (instance, pod) (rate(http_requests_total[5m]))

# 找 top 5
topk(5, sum by (pod) (rate(container_cpu_usage_seconds_total[5m])))
```

**`by` vs `without`：**
- `by (label)`：**只保留**這些 label
- `without (label)`：**排除**這些 label，其他保留

實務上 `by` 比較常用。

## rate / irate / increase 差異

| 函式 | 語意 | 用途 |
|------|------|------|
| `rate(counter[5m])` | 5 分鐘平均每秒增量 | 大部分情境（dashboard / alert） |
| `irate(counter[5m])` | 最後兩個 sample 的瞬時 rate | 高解析度圖、變動敏感 |
| `increase(counter[5m])` | 5 分鐘總增量 | 看「過去某時段累計多少」 |

**全部都會自動偵測 counter reset**（重啟時歸零）並處理。

```promql
# 每秒請求數
rate(http_requests_total[5m])

# 過去 1 小時請求總數
increase(http_requests_total[1h])

# 瞬時尖刺
irate(http_requests_total[5m])
```

**`irate` 為什麼少用：**
- 只看最後兩個 sample
- 短暫尖刺會顯示，導致 alert noise
- alert 用 `rate` 比較穩

## sum(rate) vs rate(sum) — 經典面試題

正確：

```promql
sum by (service) (rate(http_requests_total[5m]))
```

錯誤：

```promql
rate(sum by (service) (http_requests_total)[5m:])
```

**為什麼錯**：`sum` 先把多個 counter 加起來，當其中一個 counter 歸零（pod 重啟）但別人沒歸零時，sum 會出現**負值或大尖刺**（PromQL 對「sum 後的新 series」無法偵測 reset）。

**規則：永遠先 rate 再 sum**。

## histogram_quantile 算分位

```promql
# P99 latency by service
histogram_quantile(0.99,
  sum by (le, service) (rate(http_request_duration_seconds_bucket[5m]))
)

# P50 / P95 / P99 在同一 service
histogram_quantile(0.50, sum by (le) (rate(http_request_duration_seconds_bucket{service="api"}[5m])))
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{service="api"}[5m])))
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{service="api"}[5m])))
```

**重點：聚合時一定要保留 `le` label**（`sum by (le, ...)`），否則 histogram_quantile 算不出分位。

**Bucket 設計：** 預設 bucket 上限可能不夠（最大到 10s），實際 latency 在 100s 級別會誤判。應用層暴露 metric 時要根據實際分布設 bucket。

## 函式速查

常用函式分類：

**Counter:**
- `rate(c[5m])` 每秒平均
- `irate(c[5m])` 瞬時
- `increase(c[5m])` 總增量

**Gauge:**
- `delta(g[5m])` 5 分鐘前到現在差值
- `idelta(g[5m])` 瞬時差值
- `deriv(g[5m])` 線性回歸斜率
- `predict_linear(g[1h], 4*3600)` 預測 4 小時後值

**Histogram:**
- `histogram_quantile(0.99, sum by (le) (rate(h_bucket[5m])))`

**邏輯/過濾:**
- `absent(metric{label="x"})` — metric 不存在時回 1
- `absent_over_time(metric[5m])` — 過去 5 分鐘都沒值才回 1
- `changes(g[5m])` — 5 分鐘內變化次數
- `resets(c[5m])` — 5 分鐘內 counter reset 次數

**標籤操作:**
- `label_replace(metric, "new", "$1", "old", "regex(.*)")` — 新增 label
- `label_join` — 多 label 串接

**時間:**
- `time()` — 當下 unix timestamp
- `timestamp(metric)` — series 最後 sample 的時間
- `time() - timestamp(metric) > 300` — 超過 5 分鐘沒更新

## Label cardinality 與效能

**Cardinality = 不同 label value 組合的數量**。

```promql
http_requests_total{user_id="1234"}   # 每個 user_id 一條 series
```

如果有 1M user → 1M time series 在記憶體 → Prometheus 爆炸。

**Cardinality 殺手 label：**
- `user_id`, `request_id`, `trace_id`
- `email`, `customer_id`
- 任何高基數欄位

**規則：別把高基數欄位塞進 label**。要查詢個別 user 行為應該放 log / trace，不是 metric。

**檢查 cardinality：**

```promql
# Top 10 metric by series count
topk(10, count by (__name__) ({__name__=~".+"}))
```

或用 `/api/v1/label/<name>/values` 看 label 的所有 value 數量。

**減 cardinality 的手段：**

- 在 client 端就過濾掉高基數 label
- relabel rule 把 label drop / aggregate
- 用 ServiceMonitor 的 `metricRelabelings`

```yaml
metricRelabelings:
  - sourceLabels: [request_path]
    targetLabel: request_path
    regex: '/api/v1/users/(.+)/orders'
    replacement: '/api/v1/users/:id/orders'   # 把 ID 替換成模板
```

## Recording Rules 預先聚合

常用 / 昂貴的查詢預先算成新 metric。

```yaml
groups:
  - name: api.rules
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: sum by (job) (rate(http_requests_total[5m]))

      - record: job:http_errors:rate5m
        expr: sum by (job) (rate(http_requests_total{status=~"5.."}[5m]))

      - record: job:http_error_ratio:5m
        expr: job:http_errors:rate5m / job:http_requests:rate5m

      - record: job:http_p99_latency:5m
        expr: |
          histogram_quantile(0.99,
            sum by (le, job) (rate(http_request_duration_seconds_bucket[5m]))
          )
```

**命名慣例：** `<level>:<metric>:<operation>_<window>` 例如 `job:http_requests:rate5m`。

**好處：**
- Dashboard 查詢從複雜 PromQL → 簡單 metric 名稱
- 查詢速度快 100×（已預先算好）
- Alerting 算 burn rate 用 recording rule 才不會爆 Prometheus

## Alert 設計 5 大原則

### 1. Symptom-based not Cause-based

**症狀導向**：用戶感受得到的事。
**原因導向**：機器上的事。

| 症狀（好） | 原因（壞） |
|-----------|----------|
| 5xx error rate > 5% | CPU > 90% |
| Latency P99 > 2s | Memory > 80% |
| Order failure rate > 1% | DB connection pool 滿 |

CPU 高不一定 = 用戶有問題（可能正在跑批次）。**Alert 該打用戶痛**。

原因導向放 dashboard、debug 用，不是 alert。

### 2. Actionable

每個 alert 該對應一個明確動作。**「值班看了不知道要幹嘛」= alert 設計失敗**。

每個 alert 要：
- 有 runbook link
- 第一步 troubleshoot 寫清楚
- 知道何時 escalate

### 3. Avoid alert fatigue

太多 alert → 大家麻木 → 真出事漏接。

對策：
- 月度 review alerts，刪沒用的
- noisy alert 改 warning（不 page）
- 同類型合併（group_by + inhibit）

### 4. `for` 加長一點

防止短暫尖刺誤觸：

```yaml
- alert: HighErrorRate
  expr: rate(errors[5m]) > 0.05
  for: 5m                # 條件持續 5 分鐘才 fire
```

`for` 太短：短暫尖刺也響。`for` 太長：真出事察覺晚。**通常 2–10 分鐘**。

### 5. Severity 分級

- **Critical**：page on-call、立刻處理
- **Warning**：Slack 通知、工時內看
- **Info**：日誌只，不通知

每個 alert 明確標 severity，Alertmanager 用 severity 分流。

## 多視窗多 burn rate alert

承接 SLO 系列，SLO-based alert 是現代做法。

完整版：4 個 alert 對應不同 burn rate：

```yaml
groups:
  - name: slo.api
    rules:
      # 1h consume 2% of monthly budget (very fast)
      - alert: APISLOFastBurn
        expr: |
          (
            job:http_error_ratio:5m{job="api"} > (14.4 * 0.001)
            and
            job:http_error_ratio:1h{job="api"} > (14.4 * 0.001)
          )
        for: 2m
        labels:
          severity: critical
          slo: api-availability

      # 6h consume 5% of monthly budget (fast)
      - alert: APISLOMediumBurn
        expr: |
          (
            job:http_error_ratio:30m{job="api"} > (6 * 0.001)
            and
            job:http_error_ratio:6h{job="api"} > (6 * 0.001)
          )
        for: 15m
        labels:
          severity: warning
          slo: api-availability

      # 24h consume 10% of monthly budget (slow)
      - alert: APISLOSlowBurn
        expr: |
          (
            job:http_error_ratio:2h{job="api"} > (3 * 0.001)
            and
            job:http_error_ratio:24h{job="api"} > (3 * 0.001)
          )
        for: 1h
        labels:
          severity: warning
          slo: api-availability
```

**搭配 recording rules：**

```yaml
- record: job:http_error_ratio:5m
  expr: |
    sum by (job) (rate(http_requests_total{status=~"5.."}[5m]))
    /
    sum by (job) (rate(http_requests_total[5m]))

- record: job:http_error_ratio:30m
  expr: |
    sum by (job) (rate(http_requests_total{status=~"5.."}[30m]))
    /
    sum by (job) (rate(http_requests_total[30m]))

# ... 1h, 2h, 6h, 24h
```

**好處：**
- 突發大故障（fast burn）立即 page
- 慢慢燒（slow burn）累積到一定程度才 ticket
- 同時看短窗口跟長窗口避免噪音

## 常見陷阱

### 1. counter 沒 `_total` 後綴

不影響功能，但破壞 convention，工具（如 PromLens）會誤判。

### 2. Range vector 用在錯地方

```promql
http_requests_total[5m]     # range vector
http_requests_total[5m] / 2 # 錯！range vector 不能直接算術
```

正確：

```promql
rate(http_requests_total[5m]) / 2
```

### 3. Histogram bucket 沒涵蓋到實際分布

```promql
# 預設 bucket 到 10s，但你的 service 有些請求 30s
histogram_quantile(0.99, ...)     # 算出來永遠 <= 10s（誤判）
```

解：應用層暴露 metric 時設合理 bucket。

### 4. Alert 用 `irate` 而不是 `rate`

`irate` 對短暫尖刺敏感，alert 容易誤觸。Alert 用 `rate`，dashboard 高解析才用 `irate`。

### 5. 沒用 recording rule，每次 Grafana 都重算

複雜 query 在 dashboard 直接寫，每次重整就重算一次。複雜 query 一定用 recording rule 預先算。

### 6. label drop 後 metric 名衝突

```promql
# 把 instance label drop 後可能多條 series 變相同 → 衝突
sum without (instance) (http_requests_total)
```

通常會自動處理，但複雜運算前後 label 不對稱會出怪事。

### 7. `up == 0` 沒處理

target 掛了 `up == 0`，但 `rate(...)` 對掛的 target 回空，alert 不會觸發。要另外設 `up == 0` alert。

## 面試常考重點

**1. Counter / Gauge / Histogram / Summary 差在哪？**  
Counter 只升不降（要 rate）；Gauge 可上可下（直接看）；Histogram 在 client 用 bucket 收集，PromQL 端算 quantile，可跨 instance；Summary 在 client 算 quantile，不可跨 instance 聚合。實務首選 Histogram。

**2. `rate` vs `irate` 怎麼選？**  
`rate` 算範圍內平均，穩定；`irate` 算最後兩 sample 瞬時，敏感。**Alert 用 rate，dashboard 高解析才用 irate**。

**3. `sum(rate)` vs `rate(sum)` 哪個對？**  
`sum(rate(x[5m]))` 對。`rate(sum(...))` 會把多個 counter 加成單一 series，counter reset 時 PromQL 無法偵測，出現負值或大尖刺。**規則：先 rate 再 sum**。

**4. 怎麼算 P99 latency？**  
```
histogram_quantile(0.99,
  sum by (le, service) (rate(http_request_duration_seconds_bucket[5m])))
```
聚合時要保留 `le` label 才能算 quantile。bucket 設計要涵蓋實際延遲分布。

**5. Label cardinality 為什麼重要？**  
每個 label 組合 = 一條 time series，全部在記憶體。把 user_id / request_id 塞進 label → 百萬 series → Prometheus OOM。高基數欄位放 log / trace，不放 metric。

**6. Recording rule 解決什麼問題？**  
複雜 / 高頻 query 預先算好成新 metric。Dashboard 查詢從複雜 PromQL → 簡單名稱、速度快 100×；Alert 算 burn rate 必須用，否則 Prometheus 不堪 alert evaluation 負擔。

**7. Alert 該打症狀還是原因？**  
打症狀（5xx error、latency 飆高、訂單失敗率）。原因（CPU 高、memory 滿）放 dashboard 跟 debug 用，不適合 alert。理由：原因可能多種，只有症狀對應用戶痛。

**8. `for` 設多少？**  
通常 2–10 分鐘。太短：短暫尖刺誤觸。太長：真出事察覺晚。配合 multi-burn-rate alert：短窗口短 for，長窗口長 for。

**9. 監控自己（meta-monitoring）怎麼做？**  
Prometheus 自己掛了不會自己告警。對策：另一個 Prometheus 監它、Watchdog alert（永遠觸發，下游收不到就知道鏈路掛）、外部 SaaS（Pingdom、UptimeRobot）獨立 probe。

**10. Prometheus 撐不下怎麼擴展？**  
- 降 cardinality（drop 高基數 label）
- recording rule 預先算高頻 query
- 多 Prometheus 分割（按 namespace / team）
- 長期儲存（Thanos / Mimir / VictoriaMetrics）
- 換 VictoriaMetrics 通常省 50%+ 資源

**11. histogram bucket 怎麼設計？**  
看實際延遲分布：常用 0.005、0.01、0.025、0.05、0.1、0.25、0.5、1、2.5、5、10 秒。應用如果有 long-tail（30s+）要加大 bucket，否則 quantile 算出來都封頂。

**12. alert 太吵怎麼辦？**  
- 月度 review：每個 alert 看是不是真的觸發 → 採取行動。沒人理的刪掉
- 把 noisy alert 降 severity（critical → warning）
- 多個相關 alert group / inhibit
- 用 `for` 加長
- 改成 multi-burn-rate（兩窗口都中才 fire）

## 小結

PromQL 是 SRE 必備技能：

| 主題 | 重點 |
|------|------|
| **資料模型** | metric + labels = unique time series，cardinality 是殺手 |
| **四種 type** | Counter rate, Gauge 直用, Histogram + quantile, Summary 少用 |
| **聚合** | `sum by` 比 `sum without` 常用，先 rate 再 sum |
| **函式** | rate / irate / increase / histogram_quantile / predict_linear / absent |
| **Recording rule** | 預先算昂貴查詢，必備 |
| **Alert** | symptom > cause、actionable、有 runbook、`for` 加長、多 burn rate |

**面試心法：**
- 能講出 `sum(rate)` vs `rate(sum)` 的差異
- 能解釋 histogram 為什麼比 summary 好（跨 instance 聚合）
- 知道 cardinality 是 Prometheus 殺手
- 會設計 multi-burn-rate alert
- 強調 symptom-based alerting

下一篇講 **Grafana Dashboard 設計與 Alerting 進階**：怎麼把 PromQL 變成 SRE / Eng team 真的會用的儀表板。
