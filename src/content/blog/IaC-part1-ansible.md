---
title: "IaC 學習筆記 & 實作紀錄 - Ansible"
excerpt: "Ansible、Terraform"
date: 2026-04-30
category: "學習"
tags:
  - IaC
  - Ansible
featured: false
---

## Agenda

- Ansible 介紹
- 安裝方式
- 實作

## Ansible 介紹

*[Ansible](https://github.com/ansible/ansible)* 是一個開源的 DevOps 工具，可用來實現基礎架構即程式碼（Infrastructure as code, IaC）的目標。

Ansible 架構其實非常簡單，分有以下兩種角色：
- 控制節點 (Management Node)：有安裝 Ansible ，存有 Inventory file 和 Playbooks，為整個 Ansible 架構的核心中控。
- 管理節點 (Control Node)：不需要安裝 Ansible，是欲管理的目標（可以是伺服器、網路設備或任何電腦裝置）。

如上所示，Ansible 屬於無代理程式 (Agentless) 的 IaC 工具，控制節點會透過 SSH 連線，將設定好的配置與規格 (Playbooks)，套用到管理節點上。

## 安裝方式 (##以 Ubuntu 為例)
