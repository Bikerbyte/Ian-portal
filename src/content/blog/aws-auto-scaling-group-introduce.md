---
title: "AWS Auto Scaling Group 入門：Scale Out、Scale In 與 Launch Template"
excerpt: "整理 Amazon EC2 Auto Scaling Group 的核心觀念：min、desired、max capacity、ELB health check、Launch Template，以及 CloudWatch alarm 如何觸發 scaling policy。"
date: 2026-05-10
category: "學習"
tags:
  - AWS
  - EC2
  - Auto Scaling
  - CloudWatch
  - SAA-C03
series: "AWS SAA 學習筆記"
seriesOrder: 2
featured: false
---

## Agenda

- 學習目標
- Auto Scaling Group 是什麼
- Scale Out 與 Scale In
- Min、Desired、Max Capacity
- ASG 搭配 Load Balancer
- Launch Template
- CloudWatch Alarm 與 Scaling Policy
- 考試判斷重點
- 易混淆觀念
- 小結
- 參考資料

## 學習目標

這篇整理 AWS SAA-C03 課程中提到的 **Auto Scaling Group (ASG)**。

先用一句話記：

> Auto Scaling Group 會依照容量設定與 scaling policy，自動新增或移除 EC2 instances，讓服務跟著負載變化調整。

如果題目出現「流量會變動」、「需要自動增加/減少 EC2」、「instance unhealthy 要自動替換」、「搭配 Load Balancer 分散流量」，通常就要想到 ASG。

## Auto Scaling Group 是什麼

Auto Scaling Group 是一組 EC2 instances 的邏輯集合。你不需要一台一台手動新增或刪除 instance，而是定義 ASG 的規則，讓它自己維持需要的 instance 數量。

它主要解決幾個問題：

- 流量增加時，自動增加 EC2 instances。
- 流量下降時，自動減少 EC2 instances。
- Instance 不健康時，自動 terminate 並補新的。
- 搭配 Load Balancer，把流量分散到 ASG 裡的 instances。

ASG 本身不另外收費，真正會收費的是底下建立出來的資源，例如 EC2、EBS、Load Balancer、CloudWatch 等。

## Scale Out 與 Scale In

這兩個詞在考試裡一定要很熟：

| 名稱 | 意思 | 例子 |
|---|---|---|
| Scale Out | 增加 EC2 instances | 流量變高，從 2 台加到 4 台 |
| Scale In | 減少 EC2 instances | 流量變低，從 4 台降到 2 台 |

用白話記：

- Out：往外擴，機器變多。
- In：往內縮，機器變少。

如果題目問「如何自動處理流量高峰」，通常是 scale out。  
如果題目問「如何在低流量時節省成本」，通常是 scale in。

## Min、Desired、Max Capacity

ASG 最基本的三個容量參數：

| 參數 | 意思 |
|---|---|
| Minimum capacity | 最少要保留幾台 EC2 |
| Desired capacity | 目前希望維持幾台 EC2 |
| Maximum capacity | 最多可以擴到幾台 EC2 |

例如：

```text
Minimum = 2
Desired = 4
Maximum = 7
```

這代表：

- 正常情況希望有 4 台。
- 最少不能低於 2 台。
- 流量高時最多可以擴到 7 台。

AWS 官方文件也提到，ASG 的 size 取決於 desired capacity，而且 scaling policy 生效時，ASG 會在 minimum 和 maximum capacity 的範圍內調整 desired capacity，然後新增或移除 instances。

## ASG 搭配 Load Balancer

ASG 很常和 Elastic Load Balancing 一起出現。

典型架構：

```text
Users
  |
  v
Application Load Balancer
  |
  +--> EC2 instance 1
  +--> EC2 instance 2
  +--> EC2 instance 3
```

搭配 Load Balancer 後，ASG 的好處更明顯：

- 新增 EC2 instance 時，可以自動加入 target group。
- 移除 EC2 instance 時，可以搭配 deregistration delay 優雅下線。
- Load Balancer health check 可以用來判斷 instance 是否健康。
- 不健康的 instance 可以被 ASG terminate，並補一台新的。

這也是為什麼考試常把 ASG、ELB、Health Check、Deregistration Delay 放在同一題。

## Launch Template

ASG 要知道「新增 EC2 instance 時，要怎麼開一台新的」，所以需要一份 instance 設定模板。

現在主要使用 **Launch Template**，裡面可以放：

- AMI。
- Instance type。
- Key pair。
- Security groups。
- IAM role。
- User data。
- EBS volumes。
- Network / subnet 設定。

以前有 Launch Configuration，但 AWS 目前建議使用 Launch Template，因為 Launch Template 支援版本管理，也能使用比較新的 EC2 / Auto Scaling 功能。

這個觀念很重要：ASG 不是憑空變出 EC2，而是根據 Launch Template 建立新的 instance。

## CloudWatch Alarm 與 Scaling Policy

ASG 可以手動調 desired capacity，也可以用 scaling policy 自動調整。

常見流程是：

1. CloudWatch 收集 metric，例如 CPU utilization。
2. CloudWatch Alarm 判斷 metric 是否超過門檻。
3. Alarm 觸發 ASG scaling policy。
4. ASG 增加或減少 desired capacity。
5. ASG launch 或 terminate EC2 instances。

例如：

```text
Average CPU > 70%
  -> CloudWatch Alarm 進入 ALARM
  -> 觸發 scale out policy
  -> Desired capacity + 1
  -> ASG 新增一台 EC2
```

反過來，如果 CPU 長時間偏低，也可以觸發 scale in policy 來節省成本。

## 考試判斷重點

SAA-C03 題目常見線索：

- Web application 流量會變動。
- 需要自動新增或移除 EC2。
- 希望維持最少幾台 EC2 來確保可用性。
- Instance unhealthy 時要自動替換。
- 需要搭配 Load Balancer 分散流量。
- 想用 CloudWatch metric 觸發 scaling。

看到這些關鍵字，可以優先想：

- Auto Scaling Group。
- Launch Template。
- ELB target group。
- CloudWatch Alarm。
- Scaling Policy。

## 易混淆觀念

### ASG vs Load Balancer

Load Balancer 負責分流，ASG 負責增減 EC2。

它們常一起用，但不是同一個服務。

### Desired Capacity vs Minimum Capacity

Minimum 是底線，Desired 是目前 ASG 想維持的數量。

如果 desired 設 4、minimum 設 2，ASG 會先維持 4 台；只有 scaling policy 或手動調整 desired 時，才會改變實際容量。

### Launch Template vs EC2 Instance

Launch Template 是開 EC2 的設定藍圖，不是正在跑的機器。

ASG 使用 Launch Template 來建立新的 EC2 instances。

### Auto Scaling Group 本身免費，不代表整個架構免費

ASG service 本身不額外收費，但它建立出來的 EC2、EBS、Load Balancer、CloudWatch 等資源仍會收費。

## 小結

Auto Scaling Group 可以記成：

- **Scale out**：流量增加，加 EC2。
- **Scale in**：流量下降，減 EC2。
- **Min / Desired / Max**：控制容量範圍。
- **Launch Template**：定義新 EC2 怎麼建立。
- **ELB**：負責把流量分散到 ASG 裡的 instances。
- **CloudWatch Alarm + Scaling Policy**：自動觸發擴縮。

考試遇到「自動因應流量變化」、「不健康 instance 自動替換」、「搭配 Load Balancer 做可用性」時，ASG 幾乎一定會進入候選答案。

## 參考資料

- [AWS Docs - Auto Scaling groups](https://docs.aws.amazon.com/autoscaling/ec2/userguide/auto-scaling-groups.html)
- [AWS Docs - Auto Scaling launch templates](https://docs.aws.amazon.com/autoscaling/ec2/userguide/launch-templates.html)
- [AWS Docs - Monitor CloudWatch metrics for Amazon EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-cloudwatch-monitoring.html)
- [AWS Docs - Auto Scaling documentation overview](https://docs.aws.amazon.com/autoscaling/)
