---
title: "AWS ELB Connection Draining / Deregistration Delay 學習筆記"
excerpt: "整理 Elastic Load Balancing 的 Connection Draining 與 Deregistration Delay：它如何保護既有連線、何時會進入 draining 狀態，以及 SAA-C03 題目常見判斷方式。"
date: 2026-05-10
category: "學習"
tags:
  - AWS
  - ELB
  - EC2
  - SAA-C03
  - Load Balancer
series: "AWS SAA 學習筆記"
seriesOrder: 1
featured: false
---

## Agenda

- 學習目標
- Connection Draining 是什麼
- CLB、ALB、NLB 名稱差異
- Deregistration Delay 的運作流程
- Timeout 要怎麼抓
- 考試判斷重點
- 易混淆觀念
- 小結
- 參考資料

## 學習目標

這篇是整理 AWS SAA-C03 課程筆記中提到的 **Connection Draining**。這個功能常出現在 Load Balancer、Auto Scaling Group、instance unhealthy 或 deployment replacement 的情境題裡。

我想先把它記成一句話：

> Connection Draining / Deregistration Delay 是讓舊連線有時間完成，新流量則不要再送到準備移除的 target。

如果題目在問「避免中斷使用者既有 request」、「讓 instance 在被移除前完成 in-flight requests」，通常就要想到這個設定。

## Connection Draining 是什麼

當一台 EC2 instance 要從 Load Balancer 後面移除時，可能會發生兩種狀況：

- 這台 instance 已經被標記 unhealthy。
- Auto Scaling Group 正在 scale in，要 terminate 某台 instance。
- 部署或維護時，要把某台 instance deregister。

如果直接切掉，原本已經連到這台 instance 的使用者 request 可能會被中斷。Connection Draining 的目的，就是給這些既有連線一段緩衝時間。

在 draining 期間：

- Load Balancer 不會再把新的 request 送到正在 deregister 的 target。
- 已經連到該 target 的 active / in-flight request 可以繼續完成。
- 等 timeout 到了，或沒有 active connection 時，target 才會進入 unused / removed 的狀態。

## CLB、ALB、NLB 名稱差異

這裡最容易混淆的是名稱。

| Load Balancer 類型 | 功能名稱 |
|---|---|
| Classic Load Balancer | Connection Draining |
| Application Load Balancer | Deregistration Delay |
| Network Load Balancer | Deregistration Delay |

概念上它們在考試裡可以一起理解：都是避免 target 被移除時，既有 request 直接被切斷。

現在比較常看到的是 ALB / NLB 的 **Deregistration Delay**。AWS 文件中提到，Elastic Load Balancing 會停止把 request 送到正在 deregister 的 target，預設等待 300 秒讓 in-flight request 完成。

## Deregistration Delay 的運作流程

可以用一個簡單流程記：

1. Target 被 deregister，或被標記準備移除。
2. Target 狀態進入 `draining`。
3. Load Balancer 停止把新 request 送到這個 target。
4. 既有連線繼續處理。
5. Timeout 到，或 active connection 清空。
6. Target 進入 `unused`，後續可以被移除或 terminate。

文字圖大概像這樣：

```text
User A ---- existing request ----> EC2-1 (draining)
User B ---- new request ---------> EC2-2
User C ---- new request ---------> EC2-3

EC2-1 不接新流量，但會完成既有 request。
```

如果這個 EC2 instance 是 Auto Scaling Group 的一部分，deregistration delay 結束後，ASG 就可以把它 terminate，並視情況補新的 instance。

## Timeout 要怎麼抓

官方文件與 AWS CLI 參考中提到，`deregistration_delay.timeout_seconds` 預設是 300 秒。對 ALB / NLB target group，常見可設定範圍是 0 到 3600 秒。

實務上可以這樣想：

| Request 型態 | 建議方向 |
|---|---|
| 很短的 HTTP request | 可以設短一點，例如 30 秒，讓 instance 快速下線 |
| 一般 Web request | 預設 300 秒通常是合理起點 |
| Upload、下載、長時間處理 | 設長一點，避免使用者 request 被切掉 |
| 不需要等待既有連線 | 設 0 等於不做 draining，但要小心中斷 request |

這裡沒有一個永遠正確的秒數，重點是看 application request 的特性。

如果 request 都是小於 1 秒的短流量，deregistration delay 設太長，instance 會多停留很久才被移除。反過來，如果是大檔案上傳或 long-lived request，設太短就可能造成使用者端錯誤。

## 考試判斷重點

SAA-C03 題目常見線索如下：

- 題目提到 instance 要被 deregister / terminate / marked unhealthy。
- 題目希望 existing request 不要被中斷。
- 題目提到 Auto Scaling Group scale in，但使用者連線要 graceful shutdown。
- 題目問 Load Balancer 如何停止送新流量，同時讓舊流量完成。

看到這些線索時，可以優先想：

- CLB：Connection Draining。
- ALB / NLB：Deregistration Delay。
- 如果題目講的是新 request 怎麼分配，那比較像 routing algorithm。
- 如果題目講的是健康檢查通過/失敗，那是 health check。
- 如果題目講的是新 target 暖機，可能是 slow start。

## 易混淆觀念

### Deregistration Delay vs Health Check

Health check 是判斷 target 健不健康；deregistration delay 是 target 要離開時，如何處理既有連線。

健康檢查失敗可能讓 target 進入移除流程，但它不是 draining 本身。

### Deregistration Delay vs Slow Start

Slow start 是新的 target 加入後，逐步增加流量，避免一開始就被打滿。

Deregistration delay 則是 target 離開前，讓舊連線完成。

一個是進場，一個是退場。

### Deregistration Delay vs Sticky Sessions

Sticky sessions 是讓同一個 client 盡量打到同一個 target。

Deregistration delay 不負責黏住使用者，而是在 target 要移除時，處理既有連線。

## 小結

Connection Draining / Deregistration Delay 可以記成：

- **不再接新流量**。
- **既有 request 有時間完成**。
- **預設 300 秒**。
- **短 request 可以設短，長 request 要設長**。
- **CLB 叫 Connection Draining，ALB / NLB 叫 Deregistration Delay**。

考試看到「graceful shutdown」、「in-flight requests」、「instance deregistration」、「ASG scale in 不要中斷連線」時，就要把這個功能放進候選答案。

## 參考資料

- [AWS Docs - Edit target group attributes for your Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html#modify-target-group-health-settings)
- [AWS CLI - modify-target-group-attributes](https://docs.aws.amazon.com/cli/latest/reference/elbv2/modify-target-group-attributes.html)
- [AWS Docs - Target groups for your Network Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-target-groups.html)
