---
title: "Linux 常見問題集：系統資源、服務、網路與排障筆記"
excerpt: "整理 Linux 日常維運常見問題，包含 CPU、Memory、Disk、Load Average、systemd、網路、DNS、權限、Docker、監控與 RCA 的排查方向。"
date: 2026-05-14
category: "學習"
tags:
  - Linux
  - SRE
  - Infra
  - Troubleshooting
  - Monitoring
featured: false
---

## Agenda

- 使用方式
- 系統資源：CPU、Memory、Disk、Load Average
- 服務與流程：systemd、process、log、cron
- 網路與權限：port、routing、DNS、permission
- 維運延伸：Docker、監控、hardening、RCA
- 快速排查框架

## 使用方式

這篇整理 Linux 主機維運時常見的問題與排查方向。重點不是背指令，而是建立一套穩定的判斷順序：

- 先確認影響範圍。
- 再看 resource、process、service、network、config、dependency。
- 不要看到錯誤就直接重開或刪檔。
- 能恢復服務，也要能留下原因與預防方式。

下面每一題都可以當成 runbook 的起點。

## Q1. Linux Server CPU 很高，怎麼查？

CPU 高不一定代表 CPU 真的不夠，可能是單一 process 異常、I/O wait、swap、batch job、流量突增，甚至是 kernel 或 interrupt 問題。

### 排查思路

1. 確認是短暫 spike 還是持續發生。
2. 用 `top` / `htop` 看整體 CPU、load average、user、system、iowait。
3. 找出使用 CPU 最高的 process。
4. 如果是單一 process，查 service log、近期變更、cron job、流量變化。
5. 如果 `wa` 高，往 disk I/O 查。
6. 如果 `sy` 高，留意 system call、network、kernel、interrupt。
7. 最後整理 root cause 和 prevention。

### 常用指令

```bash
top
htop
uptime
ps aux --sort=-%cpu | head -20
pidstat -u 1
vmstat 1
mpstat -P ALL 1
journalctl -xe
systemctl status <service>
```

### 重點提醒

```text
%Cpu(s): 80.0 us, 10.0 sy, 0.0 ni, 5.0 id, 5.0 wa
```

- `us`：user space CPU，通常是 application 在消耗 CPU。
- `sy`：kernel space CPU，可能和 system call、network、I/O、driver 有關。
- `id`：idle，空閒比例。
- `wa`：iowait，CPU 正在等 disk I/O。
- `load average`：正在執行或等待 CPU / I/O 的 task 平均數。

## Q2. Linux Disk 滿了，怎麼查？

Disk full 的重點是不要亂刪。正式資料、資料庫檔案、application data 都要先確認用途和風險。

### 排查思路

1. 用 `df -h` 確認哪個 filesystem 滿了。
2. 用 `df -i` 確認是不是 inode 滿。
3. 用 `du -sh` 往下找出最大的目錄。
4. 判斷來源是 log、cache、backup、Docker image、DB 還是 application data。
5. 選擇清理、壓縮、歸檔、擴容或搬移。
6. 補上 logrotate、容量告警和容量規劃。

### 常用指令

```bash
df -h
df -i
du -sh /* 2>/dev/null
du -sh /var/* 2>/dev/null
du -sh /var/log/* 2>/dev/null
find /var/log -type f -size +100M
journalctl --disk-usage
docker system df
```

### `df -h` vs `du -sh`

`df -h` 看 filesystem 使用量：

```bash
df -h
```

`du -sh` 看目錄實際佔用：

```bash
du -sh /var/*
```

如果刪了檔案但 `df` 還是沒有釋放空間，常見原因是檔案已被刪除，但 process 仍然開著該檔案。

```bash
lsof | grep deleted
systemctl restart <service>
```

## Q3. Memory 使用率很高，怎麼查？

Linux 會用 memory 做 cache，所以不能只看 `used` 很高就判斷有問題。更重要的是 `available` 和 swap 變化。

### 常用指令

```bash
free -h
top
htop
ps aux --sort=-%mem | head -20
vmstat 1
sar -r 1
dmesg | grep -i oom
journalctl -k | grep -i oom
```

### 重點提醒

```text
              total   used   free   shared  buff/cache  available
Mem:           16G     12G    1G      500M      3G          4G
Swap:          2G      1G     1G
```

- `available`：目前大約還有多少記憶體可用。
- `buff/cache`：Linux 用來做 cache，不一定是壞事。
- `swap used`：如果持續上升，可能代表 memory pressure。
- OOM killer 紀錄通常可以從 kernel log 找。

## Q4. Load Average 是什麼？

Load average 不是 CPU 使用率。它代表一段時間內正在執行或等待執行的 task 數量，也包含等待 I/O 的 task。

```bash
uptime
nproc
```

如果是 4 core server：

- load 4：大約接近滿載。
- load 8：可能已經有明顯排隊。
- load 1：通常還算輕鬆。

如果 CPU 不高但 load 很高，常見方向是 disk I/O、NFS、storage、database I/O，或大量 process 卡在 `D state`。

```bash
top
vmstat 1
iostat -x 1
ps aux | awk '$8 ~ /D/ {print}'
```

## Q5. Linux service 掛了，怎麼查？

### 排查順序

1. 看 service 狀態、exit code、錯誤訊息。
2. 看 service log。
3. 確認 port 是否 listen。
4. 檢查 config、permission、dependency。
5. 檢查近期變更。
6. 必要時重啟或 rollback，但仍要追 root cause。

### 常用指令

```bash
systemctl status <service>
journalctl -u <service>
journalctl -u <service> -f
journalctl -u <service> --since "1 hour ago"
systemctl restart <service>
systemctl enable <service>
systemctl is-enabled <service>
systemctl list-units --failed
ss -lntp
```

重啟能恢復服務不代表問題解決。至少要知道是 config、dependency、resource、permission，還是程式本身異常。

## Q6. 某個服務 Port 不通，怎麼查？

以 HTTPS 443 不通為例，可以從本機到遠端分層確認。

### 常用指令

```bash
ss -lntp | grep 443
curl -v https://localhost
curl -vk https://localhost
curl -v https://server-ip
nc -vz server-ip 443
telnet server-ip 443
ufw status
firewall-cmd --list-all
iptables -L -n -v
ip route
traceroute server-ip
nslookup service.domain.com
dig service.domain.com
```

### 排查方向

- 本機 port 沒 listen：查 service、config、log。
- 本機可通但遠端不通：查 firewall、routing、ACL、security policy。
- DNS 指到錯 IP：查 DNS record、cache、TTL。
- TLS 錯誤：查 certificate、SNI、reverse proxy 設定。

## Q7. Linux 網路不通，怎麼查？

### 基本順序

```bash
ip addr
ip route
ping <gateway>
ping 8.8.8.8
nslookup google.com
curl -v https://target
traceroute <target>
ss -tulnp
```

可以依序確認：

1. NIC 有沒有 IP。
2. default gateway 是否正確。
3. gateway 是否可達。
4. 外部 IP 是否可達。
5. DNS 是否能解析。
6. 目標 port 是否可連。
7. firewall 是否阻擋。
8. 封包是否有出去與回來。

### tcpdump 基本用法

```bash
sudo tcpdump -i eth0 host 10.0.0.5
sudo tcpdump -i eth0 port 443
sudo tcpdump -i eth0 tcp port 443
sudo tcpdump -i eth0 -nn host 10.0.0.5 and port 443
```

正常 TCP 三向交握：

```text
SYN ->
<- SYN, ACK
ACK ->
```

如果只有 SYN 沒有 SYN-ACK，可能是服務沒開、firewall、routing 或 ACL 問題。若收到 RST，代表對方主機有回應，但 port 可能沒有服務 listen 或主動拒絕。

## Q8. DNS 問題怎麼查？

### 常用指令

```bash
cat /etc/resolv.conf
nslookup example.com
dig example.com
dig @8.8.8.8 example.com
dig +trace example.com
resolvectl status
```

### 排查方向

- Client 實際使用哪台 DNS resolver。
- DNS server 是否有回應。
- 內外網解析結果是否不同。
- A / AAAA / CNAME 是否正確。
- TTL 是否造成 cache 延遲。
- 問題是否其實在 HTTP / TLS，而不是 DNS。

如果是 systemd-resolved 環境，`resolvectl status` 會比只看 `/etc/resolv.conf` 更清楚。

## Q9. `Permission denied` 怎麼查？

### 檢查項目

1. user / group。
2. file permission。
3. directory execute permission。
4. ownership。
5. ACL。
6. SELinux / AppArmor。
7. service user 權限。

### 常用指令

```bash
ls -l
ls -ld /path
id <user>
groups <user>
getfacl /path
namei -l /path/to/file
```

目錄的 `x` 很容易漏掉。對目錄來說：

- `r`：可以列目錄內容。
- `w`：可以新增或刪除檔案。
- `x`：可以進入目錄。

`namei -l` 很適合檢查每一層 parent directory 的權限。

## Q10. 怎麼找出一個 process？

### 常用指令

```bash
ps aux | grep nginx
pgrep nginx
pidof nginx
top
htop
lsof -p <PID>
ss -lntp | grep <PID>
```

### `kill` vs `kill -9`

- `kill <PID>`：預設送 `SIGTERM`，讓 process 有機會正常 cleanup。
- `kill -9 <PID>`：送 `SIGKILL`，強制中止，process 無法 cleanup。

一般會先用 `SIGTERM`，只有在 process 無法正常結束時，才使用 `SIGKILL`。

## Q11. systemd 常用操作有哪些？

### 常用指令

```bash
systemctl enable nginx
systemctl start nginx
systemctl restart nginx
systemctl reload nginx
systemctl status nginx
journalctl -u nginx
journalctl -u nginx -f
journalctl -u nginx --since "today"
```

如果修改了 systemd unit file，要先讓 systemd 重新讀取設定：

```bash
systemctl daemon-reload
systemctl restart nginx
```

`reload` 和 `restart` 不一樣。`reload` 通常是重新載入設定、不完整中斷 process；`restart` 則是重啟服務。實際支援情況要看 service 本身。

## Q12. Log 怎麼查？

### 常見位置

```bash
/var/log/syslog      # Ubuntu / Debian
/var/log/messages    # RHEL / CentOS
/var/log/auth.log     # Ubuntu auth log
/var/log/secure       # RHEL auth log
/var/log/nginx/
```

### 常用指令

```bash
journalctl -xe
journalctl -u <service>
journalctl --since "1 hour ago"
journalctl -f
journalctl -k
grep -i error /var/log/syslog
grep -i failed /var/log/auth.log
tail -f /var/log/syslog
```

排查事件時，時間線很重要。只用關鍵字撈 log 很容易漏掉因果關係，建議搭配明確時間範圍。

## Q13. Shell Script 可以怎麼做輕量自動化？

### 檢查 disk usage 是否超過 80%

```bash
#!/bin/bash

THRESHOLD=80
USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')

if [ "$USAGE" -ge "$THRESHOLD" ]; then
  echo "Warning: disk usage is ${USAGE}%"
  exit 1
else
  echo "OK: disk usage is ${USAGE}%"
  exit 0
fi
```

### 檢查 service 是否 running

```bash
#!/bin/bash

SERVICE="nginx"

if systemctl is-active --quiet "$SERVICE"; then
  echo "$SERVICE is running"
  exit 0
else
  echo "$SERVICE is not running"
  exit 1
fi
```

Shell script 適合輕量 health check、狀態檢查、簡單報表。若邏輯開始需要 API integration、複雜例外處理或資料結構，就該考慮 Python。

## Q14. Cron 排程怎麼查？

### 常用指令

```bash
crontab -l
crontab -e
ls -l /etc/cron.d/
ls -l /etc/cron.daily/
cat /etc/crontab
```

cron 格式：

```text
* * * * * command
分 時 日 月 星期
```

每天凌晨 2 點：

```bash
0 2 * * * /opt/scripts/backup.sh
```

如果 cron 沒跑，常見檢查方向：

- cron service 是否啟動。
- script 是否有執行權限。
- 是否使用 absolute path。
- environment variable 是否缺少。
- cron log 是否有錯誤。

```bash
systemctl status cron
journalctl -u cron
grep CRON /var/log/syslog
systemctl status crond
grep CRON /var/log/cron
```

## Q15. Linux 開機流程可以怎麼理解？

簡化流程：

1. BIOS / UEFI 初始化硬體。
2. Bootloader 載入，例如 GRUB。
3. Kernel 載入並初始化硬體。
4. initramfs 協助掛載 root filesystem。
5. 啟動 PID 1，現代 Linux 通常是 systemd。
6. systemd 依照 target 啟動 services。

若主機卡在開機流程，要先判斷卡在 bootloader、kernel、filesystem、systemd，還是某個 service。

## Q16. Linux 安全強化可以做哪些事？

### SSH

```bash
/etc/ssh/sshd_config
```

常見設定：

```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

重啟 SSH：

```bash
systemctl restart sshd
systemctl restart ssh
```

### 防火牆

```bash
ufw status
ufw allow 22/tcp
ufw enable
firewall-cmd --list-all
firewall-cmd --add-service=http --permanent
firewall-cmd --reload
```

### 其他方向

- 最小權限原則。
- sudo 權限控管。
- 不共用帳號。
- 關閉不必要服務。
- 定期 patch。
- 監控 authentication log。
- 保留必要的 access log 和 audit record。

## Q17. Linux 檔案系統與 mount 怎麼查？

### 常用指令

```bash
mount
findmnt
lsblk
blkid
cat /etc/fstab
```

手動 mount：

```bash
mount /dev/sdb1 /mnt/data
```

開機自動 mount 通常寫進 `/etc/fstab`：

```text
UUID=xxxx /data ext4 defaults 0 2
```

修改 `/etc/fstab` 前建議先備份，修改後用 `mount -a` 測試，不要直接 reboot 賭運氣。

```bash
cp /etc/fstab /etc/fstab.bak
mount -a
```

## Q18. Docker on Linux 常見問題怎麼查？

### 常用指令

```bash
docker ps
docker ps -a
docker logs <container>
docker exec -it <container> bash
docker inspect <container>
docker stats
docker system df
docker system prune
```

Container 啟不起來時，可以檢查：

- exit code。
- environment variable。
- volume mount。
- port mapping。
- image 是否正確。
- permission。
- network。
- host resource。

如果是 host 層級問題，還要回頭看 disk、memory、CPU 和 Docker image/container 佔用空間。

## Q19. Linux 監控通常會看哪些 metrics？

常見 metrics：

- CPU usage。
- Load average。
- Memory available。
- Swap usage。
- Disk usage。
- Disk I/O。
- Network throughput。
- Packet errors / drops。
- Service up/down。
- Process count。
- File descriptor usage。

常見告警：

- Disk usage > 85%。
- Memory available < 10%。
- CPU usage sustained > 80%。
- Load average 長時間高於 core 數太多。
- Service down。
- SSL certificate expiring soon。
- Node unreachable。

告警不應該只看瞬間 spike，否則容易造成 alert fatigue。比較實用的方式是 sustained condition 加上清楚的 runbook。

## Q20. Linux server 故障後，RCA 可以怎麼整理？

### RCA 模板

```text
1. Incident Summary
2. Impact
3. Detection
4. Timeline
5. Root Cause
6. Resolution
7. Prevention
```

處理順序通常是先恢復服務，再回頭整理 metrics、logs、recent changes、deployment record、network status 和 dependency 狀態。

RCA 時要區分 symptom 和 root cause。像「服務掛掉」通常是現象，不是根因。最後要補上 prevention，例如監控、告警、runbook、自動化或部署流程改善。

## 補充：`top` 和 `ps aux` 差異

```text
top    = 即時監控，像動態儀表板
ps aux = 某一瞬間的 process 快照
```

`top` 適合看即時 CPU、memory、load average 和 process 狀態變化。

```text
P 依 CPU 排序
M 依 Memory 排序
k kill process
1 顯示每顆 CPU core
```

`ps aux` 適合查 PID、owner、command line，或搭配 `grep`、`awk`、排序寫 script。

```bash
ps aux --sort=-%cpu | head
ps aux --sort=-%mem | head
ps aux | grep nginx
pgrep -a nginx
```

## 補充：`top` 裡的 `hi`、`si`、`st`

```text
%Cpu(s):  3.0 us,  1.0 sy,  0.0 ni, 95.0 id,  1.0 wa,  0.0 hi,  0.0 si,  0.0 st
```

- `hi`：hardware interrupt，CPU 花在處理硬體中斷的時間。
- `si`：software interrupt，常見於 network packet、TCP connection、softirq、firewall packet processing。
- `st`：steal time，在 VM 上很重要，代表 VM 想用 CPU，但 hypervisor 沒有把 CPU 分給它。

可搭配：

```bash
top
sar -n DEV 1
cat /proc/softirqs
watch -n1 cat /proc/softirqs
```

如果 `st` 很高，問題可能不在 guest OS 裡的 process，而是在底層主機資源競爭。

## 快速排查框架

遇到 Linux 問題時，可以先照這個順序走：

```text
1. Resource: CPU / Memory / Disk / I/O
2. Process: process 是否存在、是否 crash
3. Service: systemd 狀態與 logs
4. Network: IP / route / DNS / port / firewall
5. Config: config file、permission、environment variable
6. Change: 近期 deployment、patch、設定異動
7. Dependency: DB、LDAP、AD、storage、external API
```

這套順序的目的不是限制排查方式，而是避免一開始就亂猜。先把問題分層，通常會比直接重開服務或隨機改設定穩定很多。
