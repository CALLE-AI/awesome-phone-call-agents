# Real Estate Buyer Follow-up Agent

基于 CALL-E 的房产客户跟进 Agent。经纪人输入一句回访目标，Agent 整理客户背景、带看记录与业务知识，主动生成通话任务；经审核后执行模拟或真实电话，再提供有证据的 CRM 更新建议与人工跟进建议。

**当前版本：Streamlit 本地 Demo + 豆包理解、规划与分析 + 默认 Mock 电话 + 模拟 CRM。CRM 变更仅预览，不实际回填。**

## 已实现的四项能力

| 能力 | 当前实现 |
| --- | --- |
| Context-aware | 整合客户画像、历史沟通、带看事实、房源信息与选中的知识文件，识别变化线索、冲突和信息缺口，校验来源并筛选本次相关内容。 |
| Proactive Planning | 根据经纪人的一句目标生成任务目标、通话上下文、沟通方向、执行边界和预期输出；允许一句自然语言反馈后重新规划。 |
| Business Action | 分房源整理反馈、需求变化与后续意愿，生成字段旧值/新值、证据和待确认项。当前展示可追溯建议，不修改客户与带看数据。 |
| Human-AI Collaboration | 电话前审核与批准；电话后提供意向判断理由、关键证据和经纪人接管建议，不替经纪人承诺议价或预约。 |

## 演示流程

1. **任务准备**：查看模拟 CRM 的客户、历史沟通、带看及房源，选择知识文件，输入回访目标。默认使用 Mock；真实模式需输入授权测试号码与通话语言。
2. **Agent Planning**：豆包自动生成通话任务。页面只保留任务内容与经纪人确认，可直接批准或提出一句修改意见。批准本身不拨号。
3. **通话执行**：另行点击执行。Mock 使用固定虚构对话；真实模式通过 CALL-E 官方 Python SDK 提交电话，页面每 3 秒查询同一 Call。
4. **结果与更新**：依次展示任务总结与信息概述、有值的 CRM 更新建议、后续行动建议、原始录音（若服务提供）与完整转写。空值不显示，不确定信息保留待确认状态。

新打开或刷新网页默认进入任务准备页。当前任务身份与执行记录可保留，切换步骤可继续查看。没有历史任务选择或演示管理面板。客户和带看数据始终取固定初始快照，刷新、重复分析不会把反馈写回该快照。

### 固定案例与时序

张女士计划在上海浦东购买三房，预算约 500 万元：

- **10/12**：重视地铁距离，希望步行约 10 分钟内。
- **10/20**：提出客厅空间也很重要，尚未明确空间与交通的取舍。
- **10/30**：看过 A 浦东花园（480 万、92㎡、客厅 18㎡、地铁步行约 8 分钟）及 B 滨江公馆（530 万、108㎡、客厅 30㎡、地铁步行约 18 分钟），尚未收集反馈。
- **本次 Mock 回访**：才得知更看重空间、可以接受地铁远一点，预算仍为 500 万元；不得据此编造新的精确通勤上限。

详见[演示场景](docs/demo-scenario.md)。初始数据不预填本次通话才获得的反馈。

## 安装与运行

需要 Python 3.11+，以下命令在本应用目录执行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[test]"
```

首次配置时，参考 [.env.example](.env.example) 新建本地 `.env`；已有 `.env` 时保留自己的配置。Web 至少需要：

```dotenv
DOUBAO_API_KEY=<your-key>
DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_MODEL=<your-enabled-model>
ESTATE_ANALYSIS_MODE=doubao
ESTATE_ENABLE_LIVE=false
ESTATE_DOUBAO_ANALYSIS_AUTHORIZED=false
```

启动网页：

```bash
.venv/bin/python -m streamlit run src/real_estate_buyer_followup/demo/streamlit_app.py --server.address 127.0.0.1 --server.port 8501 --browser.gatherUsageStats false
```

打开 `http://127.0.0.1:8501`。网页固定使用豆包，不提供规则/AI 模式切换。**Mock 仅模拟电话，网页的理解、规划和分析仍调用豆包，可能产生模型费用。** 缺少凭证或模型请求失败时显示错误，不静默替换成预置分析。

### 无网络验证

以下测试和 CLI 回放不需要密钥，也不拨电话：

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m real_estate_buyer_followup --db var/demo-preview.sqlite3 --case preferences
```

CLI 使用规则规划与预置提取，输出更新建议，不写 CRM；不能将它描述为豆包实测结果。项目测试当前 63 项通过，覆盖规划、证据、预览、执行恢复及界面等行为。未进行真实电话 A/B 效果实验，不宣称提升比例。

## 业务知识库

任务准备页按文件展示，默认选中两份资料，不展开全部内容：

- [看房反馈分析与回访指导.md](src/real_estate_buyer_followup/knowledge/看房反馈分析与回访指导.md)：价格顾虑、预算约束与交通取舍的业务指导。
- [购房政策 FAQ.md](<src/real_estate_buyer_followup/knowledge/购房政策 FAQ.md>)：上海购房资格、新房积分、商贷、公积金及置换相关参考，保留官方来源、日期和适用条件。

经纪人可维护本地 Markdown，需保留条目 ID 与元数据格式。Agent 从选中文件中筛选相关段落，程序校验引用并冻结本次资料快照，不把全部文件直接塞进电话任务。修改资料后应重新生成并审核计划。

当前没有向量检索、联网搜索或 PDF/TXT 上传解析。政策资料核对日期为 2026-11-02，是静态参考，不代表实时政策或个人资格、贷款额度的核定；实际使用前需重新核实适用性。

## CALL-E 接入与真实电话

安装可选 SDK：

```bash
.venv/bin/python -m pip install -e ".[live]"
```

在 `.env` 配置 `CALLE_API_KEY`，使用 [CALL-E Dashboard](https://dashboard.heycall-e.com) 的项目 API Key。MCP OAuth 登录不能替代 SDK 凭证。任务准备页选择真实电话，输入 E.164 格式的授权号码，核对联系授权，审核计划后在执行页单独点击拨号。

- 号码、语言和审核任务随执行记录冻结，界面遮罩号码；状态查询不会重新拨号。
- Task 与页面中的任务内容对应；结果 Schema 由本项目代码定义，CALL-E 按该 Schema 返回结构化结果。完整示例见 [CALL-E 请求说明](docs/calle-request.md) 和 [examples](examples/README.md)。
- 完整转写通常在电话结束后可用，页面查询不是实时 ASR 字幕。录音地址取决于服务实际返回，缺失时明确显示未提供。
- 电话结束但业务结果仍 pending 时继续查询；最终不可用时停止。连续三次读取失败会暂停，可恢复查询同一电话。
- 分析失败仅重试分析；提交状态未知时保留原请求和幂等身份，不盲目创建新电话。
- 关闭页面会暂停页面轮询，**不会挂断已提交电话**。当前没有后台常驻推送，也没有保证可取消电话的功能。停止本地服务可在终端按 Ctrl+C，但不等于取消云端电话。
- 拒绝联系信号保留在执行记录中，用于阻止后续电话；不依赖修改演示客户快照。

Web 的真实模式选项是显式启用入口，不受 `ESTATE_ENABLE_LIVE=false` 禁用；该环境开关及 `ESTATE_LIVE_PHONE/LOCALE` 供程序调用使用。线路、语言、余额与账号权限以 CALL-E 服务实际支持为准，Mock 中文对话不代表真实线路支持中文。

### 数据、授权与密钥

真实电话结果交给豆包前需要授权。环境模板默认 `ESTATE_DOUBAO_ANALYSIS_AUTHORIZED=false`；可针对任务确认，或在项目所有者已授权发送真实转写与结果用于反馈、需求变化及 CRM 建议分析后设置为 `true`。新部署不能沿用其他人的授权。

任务、计划、电话结果、转写与建议保存在本地 SQLite，默认位置见 `.env.example`。当前版本不提供完整权限管理，请仅在可信本机环境使用。`.env`、虚拟环境、`var/`、数据库及日志均被忽略；不要将真实号码、密钥、客户资料或录音放入源码、知识库和示例。

## 实现边界与文档

- 没有真实 CRM 集成、房源匹配引擎、长期调度或 CRM 事件自动化。
- 没有通话中动态工具查询、实时转人工、自动议价或自动预约。
- SQLite 事务回填原型仅在内部测试显式启用；Web 与默认工作流为只预览模式，不能描述成实际 CRM 回填。
- 规划使用 JSON 模式及本地校验；通话分析使用 Responses 原生 JSON Schema 严格输出。格式与证据校验不能保证所有业务判断正确。
- 中文内容按项目所有者要求保留。社区验证目前在英文规范检查处失败，未修改或绕过校验脚本。

设计与实施记录：[purpose.md](docs/purpose.md)、[purpose-alignment.md](docs/purpose-alignment.md)、[验证记录](docs/phase-1-verification.md)。旧设计中的未来能力不代表当前已实现，当前范围以本 README 和代码为准。

[PR Description 草稿](docs/pr-description.md) 用于后续填写 PR 正文，不是全仓库 PR 模板。原稿中的实际 CRM 回填等表述仍需在创建 PR 前与当前预览模式对齐。
