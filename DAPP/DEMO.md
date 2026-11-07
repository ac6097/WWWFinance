# 课程演示步骤

本演示全部在 Anvil Chain ID `31337` 上进行，只使用本地测试 ETH。

## 1. 启动环境

在 Windows PowerShell 执行：

```powershell
Set-Location D:\WWWFinance\DAPP
docker compose up -d --build
docker compose ps
```

等待 `chain`、`web` 显示 `healthy`，`deployer` 显示 `Exited (0)`。打开 <http://localhost:8080>。大厅首次显示三个链上示例：筹款中、投票中和筹款失败。

## 2. 账号 A 创建项目

顶部账号下拉框选择“模拟账号 A”。在项目大厅点“发起一个项目”，填写名称、描述、目标金额和持续时间。建议本流程设置：目标 `1 ETH`、筹款 `72 小时`、投票 `24 小时`。提交后等待确认，项目会出现在大厅和“链上记录”。

## 3. 账号 B、C 投资并查看记录

依次切换“模拟账号 B”和“模拟账号 C”，打开刚创建的项目，各投资 `0.6 ETH`。两笔交易确认后，页面累计金额为 `1.2 ETH`，超过 `1 ETH` 目标。

点“链上记录”，检查项目创建和两笔投资事件的地址、金额、交易哈希及区块高度。记录由合约事件读取。

## 4. 推进筹款时间并投票

当前项目筹款期为 72 小时。推进 72 小时并刷新页面：

```powershell
.\scripts\advance-time.ps1 259200
```

项目进入投票期。切换账号 B 和 C，在项目详情分别投赞成票。页面会展示赞成/反对权重、当前账号投票状态和截止时间。

## 5. 投票通过，账号 A 提款

推进 24 小时并刷新：

```powershell
.\scripts\advance-time.ps1 86400
```

两位支持者赞成权重之和大于总筹款额的一半，状态变为“待放款”。切换回账号 A，打开项目详情并点“提取筹款”。确认后状态为“已放款”，链上记录出现提款事件。

## 6. 创建失败项目并退款

账号 A 再创建一个项目，目标设为 `5 ETH`，筹款时长设为 `2 小时`，投票时长设为 `1 小时`。账号 B 投入 `0.1 ETH`。推进 2 小时并刷新：

```powershell
.\scripts\advance-time.ps1 7201
```

项目状态变为“筹款失败”。切换账号 B，点“申请退款”，确认退款金额返回账号 B。再次操作会被合约拒绝。

## 7. 展示非法操作被合约拒绝

前端会根据合约状态隐藏当前不允许的操作；即使绕过界面直接发交易，合约仍会拒绝。可在失败项目退款后再次点退款验证重复退款保护。也可以尝试：

- 筹款截止后投资：合约返回 `FundingClosed`。
- 未投资账号投票：合约返回 `NotContributor`。
- 同一支持者第二次投票：合约返回 `AlreadyVoted`。
- 投票未通过后由发起人提款：合约返回 `ReleaseNotApproved`。

在“链上记录”中可检查成功交易。失败交易会由 RPC 返回 revert，不会产生成功的合约事件。

## 可选：连接 MetaMask

点“连接 MetaMask”，确认添加或切换到本地 Anvil 网络。若希望使用预充值 Anvil 账号，在本地执行 `docker compose logs chain`，按日志中的开发账号资料导入 MetaMask。所有 Anvil 密钥是公开测试密钥，只能用于此模拟链。

## 停止与重置

```powershell
# 停止服务，保留链上项目和交易
docker compose down

# 删除链状态、合约运行时配置和演示数据，再次部署
docker compose down -v
docker compose up -d --build
```
