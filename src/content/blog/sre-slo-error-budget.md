---
title: "SRE 核心 - SLI / SLO / SLA / Error Budget 完整解析"
excerpt: "面試 SRE 必考主題：SLI vs SLO vs SLA 觀念釐清、怎麼定 SLO、Error Budget 怎麼算與怎麼用、Multi-burn-rate alerting、實戰範例與面試常考題。"
date: 2026-07-17
category: "學習"
tags:
  - SRE
  - DevOps
  - Observability
  - Reliability
series: "SRE 核心"
seriesOrder: 1
featured: true
---

## Agenda

- 為什麼需要 SLI / SLO？
- 三個容易搞混的詞：SLI / SLO / SLA
- 怎麼定 SLI：好的 SLI 長什麼樣
- 怎麼定 SLO：100% 不是目標
- Error Budget：可靠性的「預算」
- Multi-burn-rate alerting
- 實戰範例：API service 的完整 SLO 設定
- SLO 文件範本
- SLO 怎麼跟組織融合（推 SLO 文化）
- 反模式：SLO 常見錯誤
- 面試常考重點
- 小結

## 為什麼需要 SLI / SLO？

工程師跟產品經理的經典對話：

> PM：「你們的服務穩定嗎？」  
> 工程師：「應該還好啦」  
> PM：「那是 99.9% 還是 99.99%？」  
> 工程師：「……不知道」

這就是沒有 SLI / SLO 的世界：**沒有共同語言，沒有客觀證據，沒有「夠好」的定義**。

**SRE 哲學的起點**：可靠性是產品功能的一部分，要可量化、可追蹤、可協商。

## 三個容易搞混的詞

| 詞 | 全名 | 角色 | 對象 |
|----|------|------|------|
| **SLI** | Service Level Indicator | 「測量值」 | 工程內部 |
| **SLO** | Service Level Objective | 「內部目標」 | 工程內部 |
| **SLA** | Service Level Agreement | 「合約承諾」 | 跟客戶 |

關係：

```
SLI < SLO < SLA
```

- **SLI** = 你實際測到多少（昨天 5xx 率 0.05%）
- **SLO** = 你想達到多少（內部目標 99.9%）
- **SLA** = 你跟客戶簽多少（合約承諾 99.5%，達不到要賠錢）

**SLO 一定比 SLA 嚴格**，這樣即使 SLO 偶爾沒達到，還有空間不違反 SLA。

實際例子：

| 服務 | SLI | SLO | SLA |
|------|-----|-----|-----|
| API | 過去 30 天 P99 latency | < 200ms (99% 月內達標) | < 500ms (95% 月內達標) |
| Web | 過去 30 天 2xx/3xx 比率 | ≥ 99.95% | ≥ 99.5% |

## 怎麼定 SLI：好的 SLI 長什麼樣

**SLI 一定是「成功比率」（ratio），不是絕對數值**：

```
SLI = good_events / total_events
```

四個常見類型（Google SRE Book 的分類）：

| 類型 | 用途 | 範例 |
|------|------|------|
| **Availability** | 服務有沒有回應 | HTTP 2xx+3xx / 所有請求 |
| **Latency** | 服務多快回應 | latency < 200ms 的請求 / 所有請求 |
| **Throughput** | 處理量 | 每秒成功事件數 |
| **Correctness** | 結果是否正確 | 通過 checksum / 總處理數 |

**好的 SLI 標準（CUJ — Critical User Journey）：**

1. **從用戶視角測量**，不是從機器視角
   - 壞：CPU 使用率
   - 好：使用者實際看到的回應時間

2. **可以聚合成比率**
   - 壞：「latency 是 230ms」
   - 好：「99% 的請求 latency < 200ms」

3. **跟「壞」清楚對應**
   - SLI 變差時，用戶真的會感受到痛

4. **不要太多 SLI**
   - 一個服務 3–5 個就夠
   - SLO 多了反而沒人看

**範例：用戶結帳服務的 SLI**

- Availability：`/checkout` 回 2xx/3xx 的比率
- Latency：`/checkout` P99 < 1s 的比率
- Correctness：訂單 ID 在 DB 內可查到的比率

## 怎麼定 SLO：100% 不是目標

**SLO 的本質：可靠性的「投資量」**。

每多一個 9，成本指數增長：

| SLO | 月停機可容忍 | 工程投入 |
|-----|-------------|---------|
| 99% | 7.3 小時 | 簡單 |
| 99.9% | 43.8 分鐘 | 中等 |
| 99.95% | 21.9 分鐘 | 重 |
| 99.99% | 4.4 分鐘 | 非常重 |
| 99.999% | 26 秒 | 極端，幾乎不可能 |

**100% 是反模式**：

- 沒有任何系統真的 100%
- 追求 100% 等於犧牲所有發佈速度
- 用戶感受不出 99.99% 跟 100% 的差別（網路本身就有 0.1% 失敗）

**怎麼選 SLO 數字：**

1. **看用戶實際需求**：用戶用 4G 連你的服務，網路本身就有 0.5% 失敗，你 SLO 訂 99.99% 沒意義
2. **看現狀**：過去 30 天實際做到 99.5%，先訂 99% 慢慢往上
3. **看依賴**：你依賴 RDS（AWS 給 99.95%），你不可能比它穩
4. **看商業**：付費客戶要求 99.9%，免費版可以 99%

**SLO 設定流程：**

```
1. 列出 critical user journeys
2. 每個 CUJ 定 SLI（先用比率）
3. 看現狀 + 用戶期望 → 訂 SLO 數字
4. 訂測量視窗：7 天 / 28 天 / 30 天 rolling
5. 寫成文件，全公司可看
6. 定期 review（季度）
```

## Error Budget：可靠性的「預算」

**Error Budget = 1 - SLO**。

```
SLO 99.9% = Error Budget 0.1%
```

意義：30 天內可以「允許」失敗的請求比例 = 0.1%。

如果你的服務每月 10M 請求：

```
Error Budget = 10M * 0.1% = 10,000 個請求
```

這 10,000 個請求**可以失敗**，超過才是 SLO 沒達標。

**為什麼有 Error Budget 改變很多事：**

| 場景 | 傳統 | 有 Error Budget |
|------|------|----------------|
| 開發者想推新功能 | 「太冒險」直覺否決 | 看 budget 還剩多少 |
| SLO 沒達標 | 互相究責 | 自動暫停發佈、做穩定性工作 |
| 維運該不該擴容 | 主觀判斷 | 看 SLI 是否快超標 |

**Error Budget Policy（明文政策）：**

```
- Budget > 50%：可以正常發佈 + 做風險實驗（chaos engineering）
- Budget 20–50%：可以發佈，但 high-risk 變更需 review
- Budget 0–20%：只能 bug fix，不發新功能
- Budget < 0（已用完）：完全凍結發佈，全力穩定性
```

這個 policy **不是工程師決定，是組織共識**（產品、工程、SRE 一起訂）。

## Multi-burn-rate alerting

傳統告警：「過去 5 分鐘錯誤率 > 1% → page」。

問題：
- 太敏感 → 短暫尖刺也吵
- 不夠敏感 → 慢慢燒的問題察覺不到

**Multi-burn-rate alerting**（Google 推的方法）：根據「燒掉 budget 的速度」分多檔。

```
SLO = 99.9% over 30 days
30 天的總 budget = 0.1% × 30 天 = 43.2 分鐘 downtime

Burn rate = 燒掉 budget 的速度倍率
  Burn rate 1 = 30 天用完
  Burn rate 14.4 = 2 天用完
  Burn rate 36 = 1 天用完
```

兩窗口、兩次嚴重程度範例：

| 告警 | 短窗口 | 長窗口 | Burn rate | 嚴重度 |
|------|--------|--------|-----------|--------|
| **Critical** | 5 分鐘錯誤率高 + 1 小時也高 | 14.4× | Page |
| **Warning** | 30 分鐘錯誤率高 + 6 小時也高 | 6× | Ticket |

兩個視窗都要 burn 才告警，避免短暫尖刺。

**PromQL 範例：**

```promql
# 過去 5 分鐘錯誤率
sum(rate(http_requests_total{status=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))

# 對比 budget burn rate
# 1 - 0.999 = 0.001 (allowed error rate)
# burn rate 14.4 = 14.4 * 0.001 = 1.44%

# Critical alert 條件
( error_rate_5m > 0.0144 ) and ( error_rate_1h > 0.0144 )
```

**PrometheusRule 範例：**

```yaml
groups:
  - name: slo.api
    rules:
      - alert: APIErrorBudgetBurnFast
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
            /
            sum(rate(http_requests_total[5m])) by (service)
          ) > (14.4 * 0.001)
          and
          (
            sum(rate(http_requests_total{status=~"5.."}[1h])) by (service)
            /
            sum(rate(http_requests_total[1h])) by (service)
          ) > (14.4 * 0.001)
        for: 2m
        labels:
          severity: critical
          slo: api-availability
        annotations:
          summary: "API burning error budget too fast (14.4x)"
          runbook: "https://wiki/runbooks/api-slo-burn"
```

## 實戰範例：API service 的完整 SLO 設定

**服務：** `payment-api`，處理付款請求

### Step 1：定 SLI

| SLI | 定義 | 算法 |
|-----|------|------|
| Availability | HTTP 2xx+3xx 比率 | `sum(rate(http_requests_total{status=~"2..|3.."}[5m])) / sum(rate(http_requests_total[5m]))` |
| Latency | P99 < 500ms 比率 | `sum(rate(http_request_duration_seconds_bucket{le="0.5"}[5m])) / sum(rate(http_request_duration_seconds_count[5m]))` |

### Step 2：訂 SLO（內部目標）

| SLO | 目標 | 視窗 |
|-----|------|------|
| Availability | 99.9% | 30 天 rolling |
| Latency | 99% | 30 天 rolling |

### Step 3：SLA（對外承諾）

公司商務上承諾：99.5% availability，違反退費 5%。

### Step 4：Error Budget

```
SLO 99.9% → budget = 0.1%
30 天 budget = 0.1% × 30 day = 43.2 分鐘 downtime
              = 0.1% × 月請求總數 = 10,000 / 月（假設 10M）
```

### Step 5：Error Budget Policy

```
Budget > 50%：正常 release，可做 chaos test
Budget 25–50%：release 要 staging soak 24h
Budget 0–25%：只 bug fix，feature 暫停
Budget < 0：所有 deploy 凍結，跑 postmortem，做 reliability work
```

### Step 6：Multi-burn-rate alerts

| Severity | Window short | Window long | Burn rate | Action |
|----------|-------------|-------------|-----------|--------|
| Critical | 5m | 1h | 14.4× | PagerDuty page |
| High | 30m | 6h | 6× | Slack #oncall |
| Medium | 2h | 24h | 3× | Ticket |
| Low | 6h | 3d | 1× | Email digest |

### Step 7：Dashboard

Grafana 上做：
- 當前 SLI 數值 + SLO 線
- Budget 剩餘 % + 剩餘秒數
- 30 天 burn rate 趨勢
- 最近 7 天事件對 budget 的影響

## SLO 文件範本

每個 SLO 應該有對應文件：

```markdown
# Payment API SLO

## Service
- Name: payment-api
- Critical user journey: 使用者點付款 → 收到結果

## SLIs
| Type | Definition | Promql |
|------|------------|--------|
| Availability | 2xx+3xx ratio | sum(rate(...)) / sum(rate(...)) |
| Latency | P99 < 500ms | sum(rate(bucket{le=0.5})) / sum(rate(count)) |

## SLOs
| SLI | Target | Window |
|-----|--------|--------|
| Availability | 99.9% | 30d rolling |
| Latency | 99% | 30d rolling |

## SLA (external)
- 99.5% availability, refund 5% if breached

## Error Budget
- 0.1% × 30d × 10M req/mo = 10,000 failed req

## Policy
- > 50%: normal release
- 25–50%: staged release with 24h soak
- 0–25%: bug fix only
- < 0%: full freeze, reliability work

## Alerts
- Critical: burn rate 14.4× (page)
- High: burn rate 6× (slack)

## Review
- Quarterly review by SRE + Product + Eng lead
- Last reviewed: 2026-Q2
- Next review: 2026-Q3
```

## SLO 怎麼跟組織融合（推 SLO 文化）

技術只是一半，**組織接受才是真挑戰**。

**典型反對聲音與回應：**

> 「我們追不上 99.99%，幹嘛訂 SLO？」  
→ SLO 不是越高越好，先訂個你達得到的（99% 也好），慢慢往上。

> 「SLO 沒達到要怎樣？罰錢嗎？」  
→ 不罰人，是觸發 reliability work。Budget 燒光的團隊**獲得時間**修穩定性問題。

> 「PM 老是想推新功能，怎麼說服他停？」  
→ Error budget policy 由 PM、Eng、SRE **一起簽字**。違反不是 SRE 反對 PM，是違反三方共識。

> 「我們服務太多，定 SLO 太累」  
→ 只挑 critical service，其他先別管。SLO 是有成本的投資。

**推進策略：**

1. **從一個服務開始** — 找最關鍵也最痛的 service
2. **先觀察不告警** — SLO 訂出來先看 dashboard 兩個月
3. **再開告警** — 確認 noise 可控
4. **再寫 policy** — 跟 PM 談 budget policy
5. **擴展到其他服務**

## 反模式：SLO 常見錯誤

**1. SLO 訂太高**  
跟現狀差太遠，永遠 burn budget，policy 變成永遠 freeze。

**2. SLO 訂太低**  
做到 99% 但用戶不滿意，SLO 失去意義。

**3. SLI 是機器視角不是用戶視角**  
監控 CPU、memory，但 SLO 該看用戶看得到的東西（latency、error rate）。

**4. 同時看 7 天和 30 天 SLO 但用同一個 budget**  
不同視窗應該各自獨立追蹤。

**5. SLO 不 review**  
產品功能變了、用戶量變了、依賴變了 — SLO 也該變。每季 review。

**6. 把 SLA 數字當 SLO**  
SLA 是法律承諾、SLO 是內部更嚴格的目標。兩者寫一樣等於沒有緩衝。

**7. Error budget 從不 freeze**  
budget 燒光繼續 deploy，這個機制就是空殼，下次也沒人會理。

**8. 不公開**  
SLO 只有 SRE 看，PM、Eng 不知道，policy 推不動。

## 面試常考重點

**1. SLI、SLO、SLA 差在哪？**  
SLI 是指標（過去 30 天實測 5xx 率）；SLO 是內部目標（要 < 0.1%）；SLA 是對客戶的承諾（要 < 0.5%，否則退費）。三者關係 SLI < SLO < SLA：實測通常該比 SLO 好、SLO 一定比 SLA 嚴格。

**2. 為什麼 SLO 不該訂 100%？**  
- 沒有系統真的 100%
- 用戶網路本身就有不可靠（4G 0.5% 失敗、Wi-Fi 1%+）
- 追 100% 等於犧牲所有 feature velocity
- 99.99% 跟 100% 用戶感受不出差異
- 訂得高一點點（99.99%）成本爆炸（每多一個 9 工程成本指數成長）

**3. Error Budget 怎麼用？**  
budget = 1 - SLO。把它當「允許失敗的預算」。budget 充足時可以正常發佈、做實驗；budget 燒光要停止發新功能、全力做 reliability。具體規則由 **Error Budget Policy** 寫死，三方（PM/Eng/SRE）簽字。

**4. 為什麼要 Multi-burn-rate alerting？**  
單一視窗的 alert 要嘛太敏感（短暫尖刺就吵）要嘛太遲鈍（慢燒看不到）。Multi-burn-rate：短窗口（5m）跟長窗口（1h）都要超過 threshold 才 page，且 burn rate 越高越快 page。能同時偵測「爆炸性故障」跟「慢慢燒」兩種模式。

**5. 怎麼定一個好的 SLI？**  
- 從用戶視角測（latency、error rate），不是機器視角（CPU、memory）
- 一定是比率（good / total），不是絕對值
- 跟「壞」清楚對應（SLI 變差用戶會痛）
- 一個服務 3–5 個就夠，多了沒人看

**6. SLO 沒達到怎麼辦？**  
**不是究責**，是觸發 Error Budget Policy 規定的動作：通常是凍結 feature deploy、跑 postmortem、做 reliability work（補測試、改架構、加備援）。SLO 是團隊行為的「煞車」。

**7. SLO 跟監控系統怎麼整合？**  
PromQL 算當前 SLI、recording rule 預算每分鐘 burn rate、Alertmanager 設 multi-burn-rate alerts、Grafana 做 SLO dashboard。社群工具：Sloth、Pyrra、OpenSLO（CRD 化）。

**8. 你的依賴比你不穩，怎麼訂 SLO？**  
- 你的 SLO 不可能比依賴的「可用性乘積」高
- 例：你依賴 RDS（99.95%）+ S3（99.99%）+ ALB（99.99%），總 = 99.93%
- 想超過依賴：加冗餘（multi-region active-active）、降低依賴關鍵性（cache、graceful degradation）

**9. 怎麼處理 SLO burn 但無感的情況？**  
SLI 燒了但用戶沒投訴 = SLI 沒抓對。重新 review：是 SLI 太敏感（誤報），還是用戶其實感受不到（SLI 跟 CUJ 沒對應）。SLI 跟用戶痛感校準是長期工作。

**10. 一個團隊管多個服務，SLO 怎麼分？**  
- Tier 1（核心）：SLO 嚴 + budget policy 完整
- Tier 2（重要）：SLO 中等 + 基本告警
- Tier 3（其他）：只看 availability，無 budget policy

不是每個服務都需要全套 SLO，按重要性分級。

**11. SLO 該包含哪些事件，哪些排除？**  
- 包含：所有用戶看得到的失敗（5xx、超時、wrong result）
- **排除**：bot traffic、scheduled maintenance（提前公告的）、用戶端錯誤（4xx 除非是你的 bug）
- 提前在 SLO 文件寫清楚排除條件，避免事後爭議

**12. SLO 跟 oncall 怎麼結合？**  
- Critical SLO alert → 立刻 page oncall
- Warning SLO alert → Slack 通知，下班可以理
- Oncall 該優先看 SLO dashboard，而不是個別 metric
- Post-incident 該看「這次燒了多少 budget」而不只是「修好了沒」

## 小結

SLO 是 SRE 的核心：

| 元件 | 角色 |
|------|------|
| **SLI** | 怎麼測 |
| **SLO** | 目標多少 |
| **SLA** | 對外承諾 |
| **Error Budget** | 允許失敗預算 |
| **Burn rate alert** | 失敗速度告警 |
| **Budget Policy** | 失敗後怎麼辦 |

**SLO 不只是技術問題**：

- 它定義「夠好」的標準
- 它把可靠性變成可協商的功能
- 它把工程跟產品的 priority 衝突數據化
- 它把 oncall 從「滅火」變成「按優先序處理」

下一篇講 SRE 另一個核心：**Incident Response 與 Postmortem 文化** — 當 SLO 真的被打破時，team 怎麼正確反應、怎麼學習、怎麼預防再次發生。
