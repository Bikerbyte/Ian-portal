---
title: "SRE 核心 - Incident Response 與 Postmortem 文化"
excerpt: "事件來了怎麼正確反應：On-call 角色分工、嚴重度分級、Incident Commander、IC/OC 模型、Blameless Postmortem 寫法、Action Item 追蹤、面試常考題。"
date: 2026-07-31
category: "學習"
tags:
  - SRE
  - Incident
  - Postmortem
  - On-Call
series: "SRE 核心"
seriesOrder: 2
featured: false
---

## Agenda

- Incident 是什麼？跟 Bug 差在哪
- 嚴重度分級（Severity）
- On-call 文化：輪班、補休、Runbook
- 事件回應流程：Detect → Respond → Mitigate → Resolve
- 角色分工：Incident Commander、Communications Lead、Operations Lead
- Mitigation vs Fix：先停血再治病
- Blameless Postmortem 寫法
- Action Items 怎麼追蹤
- Five Whys vs Causal Analysis
- 反模式：Postmortem 常見錯誤
- 面試常考重點
- 小結

## Incident 是什麼？跟 Bug 差在哪

**Bug**：軟體做錯事，可能影響少數用戶或不影響服務。

**Incident**：對用戶 / 業務造成「現在式」影響的事件，需要立即回應。

例：
- 一個按鈕點下去 404 → Bug
- 所有用戶都連不到首頁 → Incident
- DB 慢但還能用 → 看是不是嚴重影響：是的話也是 Incident

**判斷標準：「現在要不要 page on-call？」** 要的話就是 Incident。

## 嚴重度分級（Severity）

每家公司定義不同，但通用結構：

| Severity | 影響 | 範例 | 反應 |
|----------|------|------|------|
| **SEV-1** | 全服務 down、資料損毀風險、收入嚴重影響 | 整個 site 503、付款全 fail、安全事件 | 立刻 page、所有人停下手邊事、開 war room |
| **SEV-2** | 部分服務不可用、嚴重降級 | 登入失敗率 > 5%、某 region 掛 | Page on-call、可以等正常工時 review |
| **SEV-3** | 局部影響、有 workaround | 某個非關鍵 feature 壞、單一客戶問題 | 開 ticket，下個工作天處理 |
| **SEV-4** | 沒立即影響但要追 | 監控異常但 SLI 正常、報表錯誤 | 不用 page，正常排程 |

**SEV-1 是稀有事件**。一年發生不該超過幾次，否則表示 reliability 結構性有問題。

**判斷不要靠主觀感受**：用 SLO burn rate、用戶 impact metric、業務 KPI 客觀判斷。

## On-call 文化

**On-call 不是懲罰，是責任 + 補償**：

- 輪班制（一週 / 兩週一輪，看人力）
- on-call 有 oncall pay（額外金錢補償）或補休（被 page 的時數 → 補休）
- on-call 期間禁酒、隨身帶筆電、保持手機通
- 主要 + 備援雙 on-call（primary fail to respond，secondary 接手）

**Page 制度：**

- 用 PagerDuty / Opsgenie / Splunk On-Call 等專業工具
- Critical alert → 真的響鈴（不是 email、不是 Slack）
- 5 分鐘沒 ack → 自動升給 secondary
- 15 分鐘 secondary 沒 ack → 升給 manager

**Runbook（值班 SOP）：**

每個 alert 都該有對應 runbook：

```markdown
# Runbook: PaymentAPIHighErrorRate

## Symptom
- alert "PaymentAPIHighErrorRate" fires
- 5xx error rate > 5% over 5 min

## First steps (5 min)
1. Check Grafana dashboard: <link>
2. Check upstream deps health: <link>
3. Check recent deploys (last 1h): <link>

## Common causes
- DB connection pool exhausted → 看 <metric link>
- Upstream service down → 看 <status page>
- Bad deploy → rollback: kubectl rollout undo deployment/payment-api

## Escalation
- 10 min no progress → page Payment team lead
- DB-related → page DBA
- Security-related → page Security oncall

## Communication
- Status page update at: <link>
- Slack channel: #incidents
```

**Runbook 必備：** 第一步要做什麼、常見原因、何時 escalate、聯絡誰、怎麼通知用戶。

## 事件回應流程

### Step 1: Detect（偵測）

來源：
- 告警系統 trigger（最常見）
- 用戶投訴（已晚）
- 主動巡查（regular health check）

**偵測時間（MTTD）** 是 SRE 重要指標：alert 越早觸發越好，但別太敏感（noise 多會麻木）。

### Step 2: Respond（回應）

被 page 後第一個 5 分鐘：

1. **Ack alert** — 告訴系統「我看到了」，避免 escalate
2. **打開 runbook** — 不要憑記憶
3. **驗證 alert 是不是 false positive** — 先看 metric / dashboard 真的有問題嗎
4. **如果是真的問題：宣告 incident** — 開 Slack channel、通知值班
5. **如果 SEV-1**：所有 stakeholder 上線（IC、Comms、Eng leads）

### Step 3: Mitigate（緩解）

**這是最重要的階段**：先讓用戶不痛。

**緩解 ≠ 修好**：
- 修 root cause 可能要幾小時
- 但 mitigate 可能只要幾分鐘

常見緩解手段：

- **Rollback deploy**（最快，最有效）
- **Restart service**（暫時）
- **Failover 到備用 region**
- **Scale up**（資源不足時）
- **Disable feature flag**（最近上的功能有問題）
- **Throttle / rate limit**（保護下游）
- **Drain bad node**（單點問題）

**先想 mitigate，再想 fix**。新人常見錯誤是急著 debug 找 root cause，導致用戶痛時間延長。

### Step 4: Resolve（解決）

確認指標恢復、用戶不痛 → resolve alert、關 incident channel。

**但這不是結束，Postmortem 才是**。

### MTTD / MTTR 指標

| 指標 | 意義 | 目標 |
|------|------|------|
| **MTTD** Mean Time To Detect | 從問題發生到告警 | 越短越好（< 5 min） |
| **MTTR** Mean Time To Restore | 從問題發生到恢復 | 越短越好（看 SLO） |
| **MTBF** Mean Time Between Failures | 兩次故障間隔 | 越長越好 |

**SRE 看 MTTR 比看 MTBF 重要**：100% 不掛不可能，掛了能多快恢復才是關鍵。

## 角色分工（Incident Roles）

SEV-1 / SEV-2 等級的事件，**人多反而亂**。Google SRE 引入明確角色：

### Incident Commander (IC)
- 統籌總指揮，**不寫 code**
- 決定 escalation、誰 do what、什麼時候宣布結束
- 維持 incident channel 秩序
- 通常是 senior engineer / SRE / TL，**不一定是 manager**

### Operations Lead (OL)
- 主要動手的人
- 跑 query、看 log、跑 mitigation 指令
- 一個 incident 通常一個 OL，避免 conflict

### Communications Lead (CL)
- 對外溝通：status page 更新、客戶 email、internal Slack 公告
- 對 stakeholder 同步進度
- 讓 IC / OL 專心 incident

### Subject Matter Experts (SME)
- 領域專家，被 IC pull in 處理特定問題
- 不需要待整場，問完問題就可以走

**為什麼要分？**
- 一個人不可能同時思考、操作、溝通三件事
- 多人混亂時需要單點決策（IC）
- 對外溝通跟修問題完全是不同技能

**小團隊也可以一人多角**，但要明確說「我現在是 IC 也是 OL」。

## Mitigation vs Fix：先停血再治病

兩個常見錯誤思路：

**錯誤 1：「找到 root cause 才能停血」**

```
[用戶痛] → [debug 1 小時] → 找到原因 → [修 30 分鐘] → 恢復
   ↑________________________________________________↑
                90 分鐘 downtime
```

**正確：先 mitigate**

```
[用戶痛] → [rollback 5 分鐘] → 恢復 → [事後慢慢 debug]
   ↑___________↑
   5 分鐘 downtime
```

**錯誤 2：「rollback 是丟臉的事」**

文化問題：團隊把 rollback 當失敗。
**修正**：rollback 是 mitigation 的合法選擇，越早越好。

### Mitigation 的優先級

1. **Rollback**（如果是最近 deploy 造成）
2. **Restart / 重啟有問題的服務**
3. **Failover / 切到備援**
4. **限流 / Circuit Breaker / Feature Flag**
5. **Scale up / 加資源**
6. **手動修補**（最後手段）

Runbook 應該按這個順序列。

## Blameless Postmortem

**Postmortem 是 SRE 文化的核心**。

> 「Postmortem 的目的不是找誰錯，是學到怎麼避免再發生。」 — Google SRE Book

**Blameless** 不是「不究責任」，是**把焦點從「誰」轉到「為什麼系統允許這個錯發生」**。

**例：** 工程師 alice 推了一個壞 deploy，導致 5xx。

| Blame culture | Blameless culture |
|---------------|-------------------|
| 「Alice 沒測就推 deploy」 | 「為什麼系統允許未測試的 code 進 prod？」 |
| Alice 被罵 | Action: CI 加 staging soak、加自動測試、加 progressive rollout |
| Alice 下次更小心 | 任何工程師重蹈覆轍機率都降低 |
| 大家害怕報告錯誤 | 大家願意揭露問題 |

### Postmortem 模板

```markdown
# Postmortem: Payment API Outage 2026-07-15

**Status:** Resolved
**Severity:** SEV-2
**Duration:** 2026-07-15 14:23 – 14:58 UTC (35 min)
**Authors:** @ian, @alice
**Incident Channel:** #inc-2026-07-15-payment

## Summary
從 14:23 到 14:58，付款 API 的 5xx 率達 12%，影響約 8% 用戶。
原因是 DB 連線池配置錯，在流量尖峰時耗盡。Rollback deploy 後恢復。

## Impact
- 用戶：~ 50,000 個請求失敗（占當天總量 8%）
- 收入：估計影響 NT$120,000 訂單流失
- SLO budget：燒掉 30 天 budget 的 65%

## Timeline (UTC)
- 14:20 — Deploy payment-api v2.34 完成
- 14:23 — Alert "PaymentAPIHighErrorRate" 觸發 → page on-call @ian
- 14:24 — @ian ack alert
- 14:26 — @ian 確認 5xx 飆高，宣告 SEV-2，開 incident channel
- 14:28 — @alice 加入 (Eng lead)
- 14:30 — 確認跟最近 deploy 相關
- 14:32 — 決定 rollback
- 14:34 — `kubectl rollout undo deployment/payment-api` 執行
- 14:38 — 新 Pod ready，5xx 開始下降
- 14:45 — 5xx 回到 baseline (0.05%)
- 14:58 — IC 宣告 resolved

## Root Cause
v2.34 把 DB connection pool max size 從 50 改為 30，準備節省 RDS 連線數。
但 staging 沒模擬 prod 流量，沒抓到 saturation 問題。
prod 流量峰值打進來時，連線池耗盡，新請求等不到 connection 而 timeout。

## Trigger
- Deploy v2.34 + 14:00 流量自然尖峰重合

## Detection
- 自動：3 分鐘內 alert 觸發 ✅
- 沒問題

## Resolution
- Rollback 部署到 v2.33 → 連線池恢復 50 → 服務恢復

## What went well
- Alert 快速觸發（MTTD 3 分鐘）
- Rollback 流程順暢（從決定到完成 6 分鐘）
- Runbook 第一條就寫 rollback，照做就好

## What went wrong
- Staging 流量不夠真實，沒抓到 saturation
- 改 connection pool 這種高風險變更沒做漸進 rollout
- Dashboard 沒有「DB connection saturation」這個 panel

## Where we got lucky
- 不是半夜，工程師都在線
- 改的不是 schema migration（可逆）

## Action Items
| # | Item | Owner | Severity | Due |
|---|------|-------|----------|-----|
| 1 | Staging 加上 production-like load 壓測 | @alice | P1 | 2026-08-15 |
| 2 | DB connection saturation alert + dashboard | @ian | P0 | 2026-08-05 |
| 3 | Connection pool config 變更需 Canary deploy | @bob | P1 | 2026-08-30 |
| 4 | Runbook 加 "DB connection pool" troubleshooting | @ian | P2 | 2026-08-10 |
| 5 | Post-mortem share 給整 team | @alice | P0 | 2026-07-20 |
```

### 關鍵欄位拆解

**Timeline** 是骨幹：用客觀時間記錄發生什麼，**不放主觀解讀**。

**Root Cause** 寫**機制**而不是**人**：
- 壞：「Alice 沒檢查 connection pool」
- 好：「Connection pool max 改為 30 不足以負荷 prod 峰值，staging 流量也不夠真實沒抓到」

**What went well / wrong** 都要寫：純檢討負面會打擊士氣，認可正面行為強化好習慣。

**Where we got lucky** 揭露隱藏風險：「這次運氣好，下次不見得」。

**Action Items** 必須：
- 有明確 owner
- 有 due date
- 有 priority（P0/P1/P2）
- 進 ticket 系統追蹤
- 月度 review

### Five Whys（連續追問）

簡單但有效的工具：

```
Why 1: 為什麼 5xx 飆高？
       → DB 連線池耗盡

Why 2: 為什麼耗盡？
       → max 從 50 改成 30，prod 流量峰值需要 > 30

Why 3: 為什麼改成 30 而沒被擋下來？
       → Staging 流量太小，沒測出 saturation

Why 4: 為什麼 staging 流量太小？
       → Staging 沒模擬 prod 流量，沒有真實 load test

Why 5: 為什麼沒有 load test？
       → 之前小團隊沒設這條工程實踐，沒人推動
```

→ Action: 建立 staging load test 流程、加 production-like traffic replay。

**五個 why 通常會 lead 到組織 / 流程問題**，這才是真正的「結構性原因」。

## Action Items 怎麼追蹤

很多公司寫漂亮 postmortem 但 action items 沒人做。

**對策：**

- 進入 ticket 系統（JIRA、GitHub Issues），跟 sprint 綁
- Manager 月度 review 所有 open action items
- P0 / P1 不准 close（沒做完）超過 30 天
- 每季統計：完成率 / 平均 close time
- 把 postmortem action item 進度當 SRE team 績效一部分

**反模式：寫完 postmortem 就丟著，半年後一樣的問題再發生** — 行為強化了「postmortem 沒用」的認知。

## Five Whys vs Causal Analysis

Five Whys 簡單但有限制：

- 假設「一個單一 root cause」
- 跳過某些 cause 容易斷層
- 偏向找個體錯誤而非系統問題

**Causal Analysis** 是進階版：

- 一個 incident 通常**多個 contributing factor**
- 畫 cause-effect chain（不是線性）
- 找 leverage points（哪個改了影響最大）

例：付款 API 出事可能同時有：

- (A) connection pool 改錯
- (B) staging 流量不真實
- (C) deploy 沒漸進 rollout
- (D) DB connection saturation 沒監控
- (E) 流量比預期高

修 (B)(C)(D) 比修 (A) 更有 leverage（避免類似問題再發生）。

## 反模式：Postmortem 常見錯誤

**1. 找代罪羔羊**
「都是 Alice 的錯」→ 整 team 學不到、未來事故繼續發生。

**2. 沒人寫 postmortem**
SEV-1/SEV-2 一定要寫，否則經驗無法傳承。

**3. 寫了沒人看**
Postmortem 該在 weekly meeting share、entire eng team 可讀。

**4. Action items 永遠不關**
追蹤機制壞了 → 大家不認真寫 → 惡性循環。

**5. Postmortem 太晚寫**
事發 3 個月後寫，記憶模糊、細節丟失。**規則：72 小時內寫完 draft，1 週內 review 完發布**。

**6. 把 mitigation 當 root cause**
「rollback 就好了」不是 root cause，是 mitigation。Root cause 是「為什麼壞 deploy 進 prod」。

**7. 假 blameless**
口頭說 blameless，會議裡還是針對人。文化是行為決定，不是口號。

**8. 缺資料**
Timeline 沒有客觀依據（log、metric link），靠記憶寫，可信度低。

## 面試常考重點

**1. SRE 面試常問：「你怎麼處理一個 prod incident？」**  
講流程：Detect（alert 觸發）→ Respond（ack、開 channel、宣告 severity）→ Mitigate（先 rollback / restart / failover 停血）→ Resolve（指標恢復）→ Postmortem。強調「先 mitigate 再 fix」、「blameless 文化」。

**2. SEV-1 跟 SEV-2 怎麼分？**  
SEV-1：全服務 down、資料損毀、安全事件、嚴重收入影響、要立刻所有人停手。SEV-2：部分服務、嚴重降級、但 workaround 存在。判斷不靠主觀，看 SLO burn / 用戶影響 / 業務 KPI 客觀指標。

**3. Incident Commander 角色是什麼？為什麼需要？**  
IC 統籌整個 incident response，不寫 code。SEV-1 多人混亂時需要單點決策。IC 決定 escalation、誰 do what、什麼時候 resolve。明確分工避免「人多反而亂」。

**4. 為什麼 mitigation 比 fix 重要？**  
mitigation 是停血，fix 是治病。先停血再治病、不要 debug 1 小時讓用戶痛 1 小時。常見 mitigation：rollback、restart、failover、disable feature flag、scale up。**Rollback 不是失敗**，是合法的 mitigation 工具。

**5. Blameless Postmortem 怎麼寫？**  
焦點放在「系統為什麼允許這錯發生」而不是「誰錯」。模板：Summary / Impact / Timeline / Root Cause / What went well / What went wrong / Where we got lucky / Action Items。Timeline 寫客觀事件、Root Cause 寫機制（不是人）。

**6. Five Whys 是什麼？有什麼限制？**  
連續追問 5 次「為什麼」，從表層原因挖到結構原因。限制：假設單一 root cause、容易斷層、偏向個體錯誤而非系統問題。進階用 Causal Analysis 處理多個 contributing factors。

**7. Action items 怎麼確保有人做？**  
- 進 ticket 系統，跟 sprint 綁
- 有 owner / due date / priority
- Manager 月度 review
- P0/P1 不准超過 30 天
- 公司層級 KPI 看完成率

沒追蹤機制的 postmortem 就是廢紙。

**8. 半夜 on-call 被 page，第一個 5 分鐘該做什麼？**  
1. Ack alert（5 分鐘不 ack 會 escalate）
2. 打開對應 runbook，**不要憑記憶**
3. 先看 dashboard 確認 alert 真的 fire（不是 false positive）
4. 真有問題 → 宣告 incident、開 Slack channel、看是不是 SEV-2+ 要 page 別人
5. 跟著 runbook 第一步 troubleshoot（多半是 rollback / restart）

**9. SLO 跟 incident 怎麼關聯？**  
SLO burn rate 是 alert source。Burn rate 高 → page on-call。一次 incident 燒了多少 budget 是 postmortem 必看數字（影響後續發佈節奏）。重複觸發同類型 incident → 表示 SLO 設太鬆或 reliability work 不夠。

**10. On-call 制度怎麼設計才健康？**  
- 主+備援雙 on-call
- 輪班週期不要太短（< 1 週累、> 2 週生疏）
- 補償：oncall pay 或補休
- Runbook 完整：每個 alert 對應一份
- Alert noise 控制：每月 review、刪沒用的
- New hire 不應該獨自 on-call 前 3 個月

**11. Runbook 該寫什麼？**  
最低限度：
- Alert 名稱跟對應症狀
- First 5 min 該看什麼（dashboard / log link）
- Common cause 跟對應 quick fix
- Mitigation 步驟（按優先序）
- 何時 escalate、聯絡誰
- 對外溝通模板

不要寫成小說，要 actionable、5 分鐘看完。

**12. 一個 incident 規模太大、需要好幾個人，怎麼協調？**  
- 明確 IC、OL、CL 角色分工
- 開專屬 Slack channel（不是在通用頻道吵）
- 定期（10–15 min）IC 做 sync update：「現在我們知道 X、正在 try Y、blocker 是 Z」
- 用 Google Doc 即時記 timeline，事後直接變 postmortem 骨架
- 大事件設定 「screen sharing」共同看 dashboard

## 小結

Incident response 跟 postmortem 是 SRE 工程文化的核心：

| 階段 | 重點 |
|------|------|
| **Detect** | 監控 + alert，MTTD 越短越好 |
| **Respond** | Ack、Runbook、宣告 severity |
| **Mitigate** | Rollback / Restart / Failover 先停血 |
| **Resolve** | 確認用戶不痛 |
| **Postmortem** | Blameless、追 root cause、Action items 落實 |

**面試心法：**
- 被問「prod 出事怎麼辦」答整套流程
- 強調 mitigation > fix
- 強調 blameless 文化
- 講得出 IC / OL / CL 角色分工
- 知道 Five Whys 跟 Causal Analysis 差異
- 能寫一份結構完整的 postmortem

跟 SRE 上一篇 SLO / Error Budget 串起來：**SLO 告訴你「該不該擔心」、Incident response 告訴你「擔心時怎麼辦」、Postmortem 告訴你「之後怎麼避免」**。三者組成 SRE 工程文化的鐵三角。
