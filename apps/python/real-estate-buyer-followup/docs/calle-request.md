# Agent Planning 如何传给 CALL-E

当前使用官方 Python 包 `calle-ai==1.0.1` 的独立 Call 接口，不走 MCP，也没有让豆包直接自主拨号。自动完成的是资料筛选、规划和Task编译；经纪人批准后，还需要在通话页显式执行。

## 真实代码路径

1. 豆包生成 Assessment 和 Plan；规划页展示整理后的通话任务。经纪人直接批准，或用一句自然语言反馈重新规划。
2. 页面与 `compile_task` 共用 `task_sections`：按同一顺序展示和编译通话内容。批准时，`Workflow.approve` 将这份内容冻结为一个字符串。
3. 同时生成 `result_schema`，固定号码、语言、计划版本和幂等键，保存在 `run.request`；此时不调用电话接口。
4. 点击执行后，`Workflow.execute` 核查授权、资料版本和请求摘要。Mock走本地回放；Live才由 `LiveProvider` 调用官方SDK。接受后由页面定时调用advance_call，只GET已有Call；result_status最终就绪后停止查询。转写发送豆包另需明确授权，否则先展示CALL-E原始结果。

对应源码：[批准与执行](../src/real_estate_buyer_followup/services/workflow.py)、[Task与Schema编译](../src/real_estate_buyer_followup/agent/planning.py)、[SDK适配](../src/real_estate_buyer_followup/integrations/calle.py)。

## 完整输入文件

- [完整SDK调用参数JSON](../examples/calle-request-preview.json)：六个实际传入参数，包含完整 `task` 与14字段 `result_schema`，没有省略号。
- [task原文](../examples/calle-task-preview.txt)：与JSON中的task完全一致，方便单独阅读。
- [result_schema原文](../examples/calle-result-schema.json)：与完整请求中的Schema完全一致。

示例使用虚构客户、两份默认知识文件和真实豆包生成、按本次用户要求校订三个沟通方向的计划，批准后仅导出，没有拨号或写CRM。电话为 `<SYNTHETIC_NO_CALL>`，locale为模拟的 `zh-CN`；这不代表真实账号支持该地区或语言。真实请求应由重新审核后的授权号码、账号支持的语言生成，不能直接把示例当成可执行的真实拨号参数。

API Key不属于task或业务JSON；仅用于SDK客户端鉴权，文件不包含真实Key或电话号码。

## SDK的所有参数与项目当前取值

已直接核对当前安装SDK的 `calls.create` 方法签名：

| 参数 | SDK是否必传 | 项目当前怎么传 |
| --- | --- | --- |
| task | 是，字符串 | compile_task编译出的最终任务全文 |
| phone | 是，字符串 | Mock用无拨号占位符；Live用准备页输入并随本次审核冻结的E.164号码 |
| idempotency_key | 是，字符串 | `estate-` + 本地任务ID，同一任务重试保持不变 |
| result_schema | 是，对象 | 按本次已选带看动态生成的扁平JSON Schema |
| locale | 否 | Live在准备页选择并冻结；Mock用zh-CN，不代表真实中文线路可用 |
| metadata | 否 | 本地run_id与回放案例replay_case，用来关联执行记录 |
| region | 否 | 当前未传，不按客户所在地猜测线路地区 |
| webhook_url | 否 | 当前未传，页面定时GET查询同一Call，不接Webhook |

对应的实际调用语句：

```python
client = CalleClient(
    api_key=settings.calle_key,
    base_url="https://api.heycall-e.com",
)
result = client.calls.create(
    task=run["request"]["task"],
    phone=run["request"]["phone"],
    locale=run["request"]["locale"],
    result_schema=run["request"]["result_schema"],
    metadata=run["request"]["metadata"],
    idempotency_key=run["idempotency_key"],
)
```

SDK内部发送 `POST https://api.heycall-e.com/v2/calls`。`task/phone/locale/result_schema/metadata`进入HTTP JSON body；`idempotency_key`由SDK转成 `Idempotency-Key`请求头。没有传入的region和webhook_url不会出现在body中。

## task里有什么

`task`是分节自然语言文本，不再附带内部分析JSON。CALL-E不会访问本地页面或知识文件。页面的「① Agent 生成的通话任务」与发送文本使用同一份投影：

1. **身份与目标**：保留「你是经纪人委托的AI回访助手。联系张女士，分别了解两套房的看房反馈、需求变化和下一步意愿。」
2. **任务目标**：经纪人目标和Agent整理的业务目标。
3. **通话上下文**：从冻结的CRM快照按日期整理客户、历史与已看房源事实；不采用模型推断的偏好结论。房源数值来自带看资料，不是客户评价或实时查询。
4. **规划沟通内容**：三个陈述式沟通方向：独立反馈、需求取舍、后续意愿。不列具体问句；业务指导用于形成条件策略。
5. **执行策略与边界**：自然沟通、跳过已回答信息、条件分支、不擅自承诺、尊重拒绝联系。不展示逐项待核实清单。
6. **预期输出**：分房源反馈、偏好变化、后续意愿、待澄清项与真人接管信号；用自然语言说明Schema的p1/p2对应哪套房。

`excluded/insights/confidence/source_ids/action`等审计字段、来源URL、文档摘要哈希、选择理由和整份Assessment留在本地，不直接序列化进Task。通话前事实摘要来自冻结快照；模型生成的沟通方向仍需经纪人审核，引用有效不保证语义判断全部正确。

「② 经纪人确认」只提供直接批准或一句话反馈重规划，不再逐题勾选编辑。重规划成功撤销旧批准。旧案例或逐题计划须按新版案例重新生成并批准；已经提交的原请求保持冻结，用原身份恢复，不能悄悄替换。

业务指导用于追问策略，不能说成“客户已经这样表态”；政策FAQ是带日期与适用前提的参考，不是资格或贷款承诺。沟通方向用于引导自然对话，不是逐题话术。

业务指导在规划时提供给豆包，融入沟通方向和条件策略，不整篇复述进Task；仅实际选中的政策参考段落及其适用限制可进入上下文。默认看房回访不要求政策解释，不额外添加贷款、资格咨询目标。旧版字符数比较仅是历史记录，当前附件已按新版时序重新生成。

## result_schema怎么定义

对本项目使用的SDK独立Call接口，必须传 `result_schema`。不要把其他接入方式（例如MCP可代为准备任务）的参数要求混为一谈。

当前Schema由程序生成，不是每次让模型任意设计。根是object，`additionalProperties=false`；所有业务字段都是string且列入required。没有提及用 `unknown`，房源指代不清用 `unclear`；它们是字符串，避免捏造数值或归属。

两套房共有 **6 + 4×2 = 14个字段**：

| 字段 | 收集内容 |
| --- | --- |
| summary | 本次通话总结 |
| contact_preference | 是否允许后续联系，明确拒绝时do_not_contact |
| budget_statement | 预算原话，是否有明确的新上限 |
| priority_statement | 空间、价格、交通的偏好与取舍 |
| next_step_statement | 下一步意愿、时间、条件与真人联系诉求 |
| unresolved_questions | 未回答、资料缺失、需经纪人核实的问题 |
| p1_feedback | A整体反馈与是否继续考虑 |
| p1_positive | A满意点 |
| p1_negative | A顾虑和不满意点 |
| p1_next_step | 针对A的复看/谈价/联系诉求及条件 |
| p2_feedback | B整体反馈与是否继续考虑 |
| p2_positive | B满意点 |
| p2_negative | B顾虑和不满意点 |
| p2_next_step | 针对B的复看/谈价/联系诉求及条件 |

每个p字段的description还写明具体房源名称及内部ID，防止混写。选择一套或三套时，程序相应生成10或18个字段；当前演示限制1至3套，代码还有不超过32字段的保护。

## 返回的三层数据要区分

1. **电话执行外壳**：资源ID、执行状态、call_outcome、result_status、错误等，由CALL-E接口定义，不由result_schema定义。
2. **CALL-E的业务result**：期望按照上面的14字段返回；仍需根据result_status判断可用、待生成或不可用，不等于电话接通就有完整结果。
3. **本地豆包Analysis**：通话结束后，应用把可用转写与CALL-E结果交给豆包，生成嵌套的changes/feedback/signals/evidence。它是另一套本地Pydantic结构，不是发给CALL-E的result_schema。证据必须匹配具体用户原话，最后只展示拟更新，当前不写CRM。

**验证边界**：当前Mock供应商只返回预置转写和summary，没有真实执行14字段提取。页面的详细分析由本地豆包完成。因此完整请求预览能证明“准备怎样调用”，不能证明真实CALL-E账号已经拨号或已经按该Schema返回数据；真实电话验收仍需另行授权。

## 已提交电话的页面跟踪

提交返回queued/pending只是接受快照，不是实时更新流。现在使用Streamlit fragment每3秒读取保存的Call ID，查询不会走execute或submit。completed/pending继续等；available/unavailable/not_applicable停止。完整转写展示在结果页，与本地豆包分析分开。连续三次读失败暂停，可恢复同一电话；模型分析失败不自动重复调用模型。

已恢复一通用户提交的真实电话，GET返回completed/available、14字段与9条转写。用户明确同意后仅对该通进行豆包分析，6条候选进入待确认，CRM不写入。真实号码、转写、原始业务结果均只保留在本地忽略的SQLite记录，没有放入examples。

## 当前项目授权与简化界面

所有者已明确授权流程使用豆包提取反馈、需求变化和CRM建议，本机以ESTATE_DOUBAO_ANALYSIS_AUTHORIZED=true记录。新批准任务保存provider=doubao、source=project_setting的授权依据；当前待分析任务同样可继续，无需逐通确认。真实拨号的联系授权、计划审核和执行按钮仍保留。无项目授权的新部署默认保留逐通发送控制。当前界面不再显示演示管理或历史选择器，刷新恢复当前任务，旧记录不删除。
