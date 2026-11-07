# 共识：以太坊去中心化众筹 DApp

一个仅连接本地 Anvil 的课程演示项目。项目数据、投资、投票、提款和退款均由 Solidity 合约管理；浏览器不连接主网，也不需要真实资金。

## 快速启动（Windows PowerShell）

前置条件：安装并启动 Docker Desktop，确认 Docker Desktop 使用 Linux 容器。宿主机不需要安装 Node.js、Foundry 或 Solidity 编译器。

```powershell
Set-Location D:\WWWFinance\DAPP
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
```

首次启动会拉取固定版本镜像、启动 Anvil、编译合约、部署合约、创建三个演示项目，并启动 Nginx 前端。等待 `web` 与 `chain` 健康检查通过后打开：

- 前端：<http://localhost:8080>
- 本地 RPC：<http://localhost:8545>
- 部署配置（地址、Chain ID、浏览器 RPC）：<http://localhost:8080/runtime/config.json>

查看部署输出或排查启动失败：

```powershell
docker compose logs --tail 100 chain deployer web
```

## 测试与构建

Foundry 测试运行在 `foundry-tools` 容器内：

```powershell
docker compose exec foundry-tools forge build
docker compose exec foundry-tools forge test
```

前端容器构建已经执行 `npm ci` 和 `npm run build`。如需单独查看应用镜像：

```powershell
docker image ls crowdfunding-web crowdfunding-deployer
```

更新源码后重新构建并启动：

```powershell
docker compose up -d --build
```

停止服务但保留本地链数据：

```powershell
docker compose down
```

彻底重置 Anvil 状态、合约地址和演示项目：

```powershell
docker compose down -v
docker compose up -d --build
```

Anvil 使用命名卷保存状态；正常 `down`、重启容器或重启 Docker Desktop 后，链上数据会保留。部署器会核对配置中的合约地址是否仍存在于当前链上。执行 `down -v` 会删除链和运行时配置，下一次启动将重新部署。

## 本地时间推进

时间推进命令会先检查 RPC Chain ID 是否为 `31337`，且仅通过 Docker 内部网络调用 Anvil，不会开放为网页 API：

```powershell
.\scripts\advance-time.ps1 3600
```

参数单位为秒，范围 1 秒至 1 年。推进后点击页面顶部的刷新按钮以读取最新链上时间和项目状态。`scripts/advance-time.sh` 可在 Linux/macOS 终端使用。

## 钱包与演示账号

页面默认进入“演示模式”，直接从本地 Anvil RPC 读取解锁账号并使用 `eth_sendTransaction` 交易。下拉菜单可切换 Anvil 的 10 个预充值账号，无须安装 MetaMask，前端不包含任何私钥。

切换到 MetaMask 时，页面会请求添加/切换到本地 Anvil 网络：Chain ID `31337`，RPC `http://localhost:8545`，货币符号 `ETH`。如需导入测试账号，可从 `docker compose logs chain` 查看 Anvil 输出的本地开发账号。该助记词和账号仅供 Anvil 模拟使用，绝不能用于任何公网网络。

Docker 仅将 RPC 和网页端口绑定在宿主机 `127.0.0.1`。合约部署器访问 `http://chain:8545`（Compose 内部地址）；浏览器读取运行时配置中的 `http://localhost:8545`（宿主机地址）。

## 工程结构

```text
DAPP/
├── contracts/
│   ├── src/Crowdfunding.sol       # 众筹状态机、资金操作、事件
│   ├── test/Crowdfunding.t.sol    # 12 个 Foundry 单元测试
│   ├── test/TestBase.sol          # 轻量 Foundry cheatcode 测试基类
│   ├── script/Deploy.s.sol        # 部署和本地示例项目
│   └── foundry.toml
├── frontend/
│   ├── src/                       # React + TypeScript + ethers v6
│   ├── public/runtime/            # 本地开发配置占位；Docker 运行时由部署器写入
│   ├── package.json / package-lock.json
│   ├── Dockerfile                 # Vite 构建 + Nginx 运行镜像
│   └── nginx.conf
├── docker/deployer.Dockerfile     # Foundry 编译/部署镜像
├── scripts/advance-time.ps1       # 本地模拟链时间推进
├── compose.yaml
├── DEMO.md
├── screenshots/demo-home.png     # 浏览器开发模式检查截图（RPC 经 Vite 本地代理）
└── README.md
```

## 合约规则

- 投资只允许发生在 `block.timestamp < fundingDeadline`；截止时间本身已关闭。
- 目标未达成的项目在筹款截止后可由各支持者分别退款。
- 达标项目在筹款截止后进入投票期；每位实际投资者只能投一次，权重等于累计投资额。
- 投票截止后，赞成权重必须严格大于总筹款额的 50%，发起人才能提款。否则支持者可以分别退款。
- 提款和退款先更新状态再执行外部转账，并使用重入保护。合约不遍历支持者名单。

## 已知边界

- 这是本地课程演示，不含真实 ETH、生产 RPC、后端服务或用户账户数据库。
- 页面状态刷新读取当前本地区块链；脚本推进时间后需要手动刷新。
- 投票和交易记录由合约事件提供。事件页从当前部署区块的链上日志读取交易哈希和区块高度。
- 每次彻底重置（`docker compose down -v`）都会生成全新的本地链、合约地址和示例交易记录。
