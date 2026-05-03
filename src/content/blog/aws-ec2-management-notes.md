---
title: "AWS EC2 管理入門：建立、連線、基本 Setup 與清理"
excerpt: "重新熟悉 AWS EC2 的操作流程，從預算警示、建立 instance、Security Group、SSH 連線、Linux 基本設定，到 stop、terminate 與避免額外費用的清理檢查。"
date: 2026-05-03
category: "學習"
tags:
  - AWS
  - EC2
  - Cloud
  - Linux
featured: true
---

## Agenda

- 學習目標
- 開始前先控費
- EC2 基本概念
- 建立第一台 EC2
- Security Group 設定
- SSH 與 EC2 Instance Connect
- Instance 基本 Setup
- EC2 日常管理
- Stop、Start、Terminate 的差異
- 清理資源 Checklist
- 下一步練習

## 學習目標

我以前寫過一篇 Medium 文章：[手把手教你如何在 AWS 上建立屬於自己的 VPN](https://medium.com/@wa60832/%E6%89%8B%E6%8A%8A%E6%89%8B%E6%95%99%E4%BD%A0%E5%A6%82%E4%BD%95%E5%9C%A8aws%E4%B8%8A%E5%BB%BA%E7%AB%8B%E5%B1%AC%E6%96%BC%E8%87%AA%E5%B7%B1%E7%9A%84vpn-1c6b61de9875)。那時候比較像照著流程把服務架起來，但現在已經有點把 AWS 操作忘掉了，所以這篇先從最基本的 EC2 管理重新開始。

這次目標不是一次做很複雜的架構，而是先重新熟悉：

- AWS Console 的 Region、EC2、VPC、Security Group 位置。
- 建立一台低成本的 Linux EC2 instance。
- 使用 key pair 或 EC2 Instance Connect 登入。
- 做基本 Linux setup。
- 理解 stop、start、reboot、terminate。
- 知道哪些東西可能繼續收費。
- 每次練習完可以乾淨清理。

> [!WARNING]
> 我現在有 AWS credits 可以練習，但 credits 不是無限保護。EC2、EBS、Public IPv4、Elastic IP、Snapshot、NAT Gateway、Load Balancer 都可能產生費用。開始前先設定 Budget，比較安心。

## 開始前先控費

在建立任何 EC2 前，先做成本防護。

### 1. 確認目前 Credits 和 Free Tier

建議先到 Billing 頁面確認：

- Credits 剩餘金額。
- Credits 到期日。
- Free Tier 使用狀況。
- 目前已產生的 month-to-date cost。

截圖預留：

```text
[截圖 TODO：Billing 首頁，標出 credits 和 month-to-date cost]
```

### 2. 建立 AWS Budget

AWS Budgets 可以追蹤成本並發送通知。我的練習帳號可以先建立幾個簡單門檻：

| Budget | 用途 |
|--------|------|
| `aws-lab-monthly-5-usd` | 練習初期提醒 |
| `aws-lab-monthly-20-usd` | 超過預期時提醒 |
| `aws-lab-credit-watch` | 每週檢查 credits 消耗 |

建立位置：

```text
Billing and Cost Management -> Budgets -> Create budget
```

截圖預留：

```text
[截圖 TODO：Create budget 頁面]
[截圖 TODO：Budget alert 設定 Email]
```

### 3. 練習用 Region 固定一個

一開始建議固定一個 Region，例如：

```text
Asia Pacific (Tokyo) ap-northeast-1
```

或：

```text
US East (N. Virginia) us-east-1
```

固定 Region 的好處是比較不容易忘記資源散在哪裡。之後每次收尾也只要先檢查這個 Region。

> [!NOTE]
> AWS Console 右上角的 Region 很重要。EC2、Key Pair、Security Group、EBS volume 都是 Region-based。切錯 Region 時，常會以為資源不見了。

## EC2 基本概念

EC2 可以先理解成 AWS 上的 virtual machine。建立一台 EC2 時，通常會碰到這些元件：

| 元件 | 說明 |
|------|------|
| AMI | 作業系統映像，例如 Amazon Linux、Ubuntu |
| Instance type | VM 規格，例如 `t3.micro`、`t4g.micro` |
| Key pair | SSH 登入用的金鑰 |
| VPC / Subnet | instance 所在的網路 |
| Security Group | instance 的防火牆規則 |
| EBS Volume | 磁碟，root volume 通常是 EBS |
| Public IPv4 / DNS | 從網際網路連進 instance 的位址 |
| IAM Role | 給 instance 呼叫 AWS API 的權限 |

這篇先以 Linux EC2 為主，Windows RDP 先不碰。

## 建立第一台 EC2

進入：

```text
AWS Console -> EC2 -> Instances -> Launch instances
```

截圖預留：

```text
[截圖 TODO：EC2 Dashboard]
[截圖 TODO：Launch instances 按鈕]
```

### Step 1. Name and tags

先幫 instance 取一個清楚的名字：

```text
Name = aws-lab-ec2-01
Project = aws-learning
Owner = Ian
Purpose = ec2-basic-practice
```

Tag 很重要，之後查成本、找資源、清理環境都會用到。

### Step 2. Application and OS Image

初學可以選：

```text
Amazon Linux 2023
```

或：

```text
Ubuntu Server LTS
```

如果目標是練 AWS 原生服務，Amazon Linux 會比較順；如果目標是一般 Linux server 操作，Ubuntu 也很熟悉。

截圖預留：

```text
[截圖 TODO：AMI 選擇 Amazon Linux 或 Ubuntu]
```

### Step 3. Instance type

練習用請選低規格，例如：

```text
t3.micro
```

或依當前帳號/Region Free Tier 顯示的可用選項選擇。

> [!WARNING]
> 不要一開始就選大規格 instance。EC2 在 `running` 狀態即使閒置也可能計費。正式選擇前要看 Summary 和預估費用。

### Step 4. Key pair

可以建立新的 key pair：

```text
Key pair name: aws-lab-key
Key pair type: ED25519 或 RSA
Private key file format: .pem
```

下載後要保存好：

```text
~/.ssh/aws-lab-key.pem
```

Linux/macOS/WSL 通常要調整權限：

```bash
chmod 400 ~/.ssh/aws-lab-key.pem
```

Windows PowerShell 如果使用 OpenSSH，也可以把 key 放在：

```powershell
$HOME\.ssh\aws-lab-key.pem
```

截圖預留：

```text
[截圖 TODO：Create key pair 畫面]
```

> [!WARNING]
> Private key 只會下載一次。弄丟後無法從 AWS 再下載同一把 private key。練習環境可以重建 instance，但正式環境要好好管理 key。

### Step 5. Network settings

初學可以先使用 default VPC，但 Security Group 要保守設定。

建議：

```text
Auto-assign public IP: Enable
Allow SSH traffic from: My IP
```

不要選：

```text
0.0.0.0/0
```

除非只是非常短暫測試，而且測完立刻收回。

截圖預留：

```text
[截圖 TODO：Network settings / Security Group]
```

### Step 6. Configure storage

練習用 root volume 不要開太大。可以先用預設值，或設定：

```text
Root volume: 8 GiB gp3
Delete on termination: Yes
```

> [!NOTE]
> Stop instance 不會刪掉 EBS root volume。Terminate 時如果 root volume 設定 `Delete on termination = Yes`，才會跟著刪掉。額外掛載的 EBS volume 要另外確認。

### Step 7. Launch instance

Launch 前先看 Summary：

- Region 是否正確。
- Instance type 是否是練習用小規格。
- Key pair 是否選對。
- Security Group 是否只開必要 port。
- Storage 是否合理。

截圖預留：

```text
[截圖 TODO：Launch Summary]
[截圖 TODO：Instance running 狀態]
```

## Security Group 設定

Security Group 可以理解成 EC2 的 stateful firewall。

練習初期建議只開：

| Type | Port | Source | 用途 |
|------|------|--------|------|
| SSH | 22 | My IP `/32` | SSH 登入 |
| HTTP | 80 | My IP 或短暫 `0.0.0.0/0` | 測試網頁 |
| HTTPS | 443 | My IP 或短暫 `0.0.0.0/0` | 測試 HTTPS |

如果只是練 SSH 和基本 setup，先只開 22 就好。

> [!WARNING]
> SSH `0.0.0.0/0` 代表全世界都可以嘗試連你的 22 port。即使有 key pair，也不建議長期這樣開。

常見錯誤：

- 忘記把 SSH source 改成目前自己的 IP。
- 家裡網路 IP 變了，導致原本的 `/32` 連不上。
- Nginx 已經啟動，但 Security Group 沒開 80。
- Instance 沒有 public IP，卻想從外網 SSH。

## SSH 與 EC2 Instance Connect

Linux EC2 常見連線方式有兩種：

### 方法 1. EC2 Instance Connect

在 Console 裡：

```text
EC2 -> Instances -> Select instance -> Connect -> EC2 Instance Connect -> Connect
```

這會開一個瀏覽器 terminal，很適合剛開始練習。

截圖預留：

```text
[截圖 TODO：EC2 Instance Connect 頁面]
[截圖 TODO：Browser terminal]
```

### 方法 2. SSH client

Amazon Linux 常見 username：

```text
ec2-user
```

Ubuntu 常見 username：

```text
ubuntu
```

SSH 範例：

```bash
ssh -i ~/.ssh/aws-lab-key.pem ec2-user@<public-ip-or-dns>
```

Ubuntu：

```bash
ssh -i ~/.ssh/aws-lab-key.pem ubuntu@<public-ip-or-dns>
```

如果遇到 `Permission denied`，先檢查：

- username 是否符合 AMI。
- key pair 是否是 launch instance 時選的那把。
- private key 權限是否太開。
- Security Group 是否允許你的 IP 連 22。
- Instance status check 是否通過。

## Instance 基本 Setup

登入後，先做幾個基本檢查。

### 查看系統資訊

```bash
whoami
hostname
cat /etc/os-release
uname -a
df -h
free -h
ip addr
```

### 更新套件

Amazon Linux 2023：

```bash
sudo dnf update -y
```

Ubuntu：

```bash
sudo apt update
sudo apt upgrade -y
```

### 設定時區

```bash
timedatectl
sudo timedatectl set-timezone Asia/Taipei
timedatectl
```

### 安裝基本工具

Amazon Linux：

```bash
sudo dnf install -y git vim htop tree curl wget
```

Ubuntu：

```bash
sudo apt install -y git vim htop tree curl wget
```

### 建立練習用使用者

```bash
sudo useradd -m deploy
sudo passwd deploy
sudo usermod -aG wheel deploy
```

Ubuntu sudo group 通常是：

```bash
sudo usermod -aG sudo deploy
```

> [!NOTE]
> 正式環境不建議只靠密碼登入。這裡建立 user 是為了練習 Linux 管理概念，SSH key 和 IAM/SSM 會是後續更適合深入的方向。

### 安裝 Nginx 做 HTTP 測試

Amazon Linux：

```bash
sudo dnf install -y nginx
sudo systemctl enable --now nginx
systemctl status nginx
```

Ubuntu：

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
systemctl status nginx
```

在 instance 裡測：

```bash
curl localhost
```

從自己電腦測：

```bash
curl http://<public-ip>
```

如果 instance 裡 `curl localhost` 成功，但外部連不到，通常是 Security Group 沒開 80，或 OS firewall 擋住。

截圖預留：

```text
[截圖 TODO：Nginx systemctl status]
[截圖 TODO：瀏覽器開 public IP]
```

## EC2 日常管理

### 查看 instance 狀態

Console：

```text
EC2 -> Instances
```

常看欄位：

- Instance ID
- Name
- Instance state
- Instance type
- Status checks
- Public IPv4 address
- Private IPv4 address
- Availability Zone
- Security groups

AWS CLI：

```bash
aws ec2 describe-instances \
  --query "Reservations[].Instances[].{ID:InstanceId,State:State.Name,Type:InstanceType,PublicIP:PublicIpAddress,Name:Tags[?Key=='Name']|[0].Value}" \
  --output table
```

### Reboot

Reboot 是重開機，instance 還是同一台。

```text
Instance state -> Reboot instance
```

適合：

- OS 更新後需要重開。
- 服務卡住想重啟整台。

### Stop / Start

Stop 會關機，Start 會再啟動。

適合：

- 暫時不用，想停止 compute 費用。
- 調整某些只能在 stopped 狀態改的設定。

> [!WARNING]
> Stop 後 public IPv4 通常會變。EBS volume 還在，仍可能產生 EBS 儲存費。Elastic IP 和 Public IPv4 的計費也要另外注意。

CLI：

```bash
aws ec2 stop-instances --instance-ids i-xxxxxxxxxxxxxxxxx
aws ec2 start-instances --instance-ids i-xxxxxxxxxxxxxxxxx
```

### Terminate

Terminate 是刪除 instance。

適合：

- 練習結束。
- 不再需要這台 VM。
- 想確定不會繼續累積 EC2 running 費用。

> [!WARNING]
> Terminate 前要確認資料是否已備份。root EBS 如果沒有設定 delete on termination，或有額外 EBS volume、snapshot、Elastic IP，仍可能留在帳號裡繼續計費。

## Stop、Start、Terminate 的差異

| 操作 | Instance 還在嗎 | EBS root volume | Public IP | 常見用途 |
|------|-----------------|-----------------|-----------|----------|
| Reboot | 在 | 保留 | 通常保留 | OS 重開 |
| Stop | 在 | 保留 | 通常會變 | 暫停使用 |
| Start | 在 | 使用原 EBS 開機 | 通常重新分配 | 恢復使用 |
| Terminate | 刪除 | 視 delete on termination 設定 | 釋放 | 結束練習 |

練習時我的規則：

- 今天還會繼續用：Stop。
- 這個 lab 做完了：Terminate。
- 建錯規格、建錯 Region、開錯 port：Terminate 重做。

## 清理資源 Checklist

每次練習結束，都跑一次這份 checklist。

### EC2

- [ ] Instance 是否還有 `running`？
- [ ] 不需要的 instance 是否已 terminate？
- [ ] 停止中的 instance 是否真的還需要保留？

### EBS

- [ ] Volumes 裡是否有 `available` 狀態的孤兒 volume？
- [ ] Snapshots 是否有不需要的備份？
- [ ] Root volume 是否有設定 terminate 時刪除？

### Elastic IP / Public IPv4

- [ ] Elastic IP 是否還 allocated？
- [ ] 不用的 Elastic IP 是否 release？
- [ ] 是否有不必要的 public IPv4 資源？

### Security Group

- [ ] 是否留下 SSH `0.0.0.0/0`？
- [ ] 是否有測試用 HTTP/HTTPS 規則忘記收？
- [ ] 不再使用的 Security Group 是否刪除？

### Billing

- [ ] Billing Dashboard 是否有異常增加？
- [ ] Budget alert 是否正常？
- [ ] Credits 是否有被扣到預期以外的服務？

截圖預留：

```text
[截圖 TODO：EC2 instances 清空或只剩 stopped]
[截圖 TODO：EBS volumes]
[截圖 TODO：Elastic IP addresses]
[截圖 TODO：Billing month-to-date cost]
```

## 下一步練習

這篇先重新建立 EC2 基本操作手感。接下來可以分幾個小 lab 練：

1. EC2 + Nginx：建立 web server，理解 Security Group 80/443。
2. EC2 + EBS：新增資料磁碟、format、mount、fstab。
3. EC2 + IAM Role：讓 instance 用 role 存取 S3，不把 access key 放在機器裡。
4. EC2 + CloudWatch：看 CPU、Network、Disk agent。
5. EC2 + AMI：把設定好的 instance 做成 AMI，再 launch 新 instance。
6. EC2 + Elastic IP：理解固定 IP 的用途與成本。
7. EC2 + VPN：回頭整理以前 Medium 那篇 VPN 實作，改成新版 AWS Console 筆記。

## 參考資料

- [AWS：Launch an EC2 instance using the launch instance wizard](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-launch-instance-wizard.html)
- [AWS：Connect to your EC2 instance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connect.html)
- [AWS：Connect to a Linux instance using EC2 Instance Connect](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-methods.html)
- [AWS：Create a key pair for your Amazon EC2 instance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/create-key-pairs.html)
- [AWS：Stop and start Amazon EC2 instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html)
- [AWS：Root volumes for your Amazon EC2 instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/RootDeviceStorage.html)
- [AWS：Elastic IP addresses](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html)
- [AWS：Creating a budget](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-create.html)
