# 校园助手 Web 本地接入

用户已确认先接 Web，之后复用到 App。校园助手使用独立路径 `/agent`，入口位于左侧站点导航首位、在“万能墙”上方；“我的 → 工具”不再放重复入口。旧路径 `/myzone/agent` 自动跳转，已有会话继续恢复。页面沿用现有 Shell、登录状态与 Web 令牌，支持政策与指南问答、个人课表和待办查询、流式回答与历史恢复。

此仓库提供 Dorm 侧 Web、认证代理和业务数据回查接口；Python Agent 与知识索引由独立 Campus Copilot 服务提供，不包含在本次 Dorm 提交中。对端版本需支持本文内部接口、假期工具及会话删除/撤销。未配置时接口返回 503；本次提交不自动部署服务、导入生产数据或执行数据库授权。

## 接口

| Dorm 接口 | Agent 内部接口 | 协议 |
| --- | --- | --- |
| GET /api/agent/conversations | GET /internal/xmumdorm/conversations | JSON |
| POST /api/agent/conversations | POST /internal/xmumdorm/conversations | JSON |
| GET /api/agent/conversations/:id | GET /internal/xmumdorm/conversations/:id | JSON |
| DELETE /api/agent/conversations/:id | DELETE /internal/xmumdorm/conversations/:id | JSON |
| POST /api/agent/conversations/:id/restore | POST /internal/xmumdorm/conversations/:id/restore | JSON |
| POST /api/agent/chat | POST /internal/xmumdorm/chat | POST SSE |

路由先经过现有 authenticateToken，验证 JWT 并复查账号状态。代理用独立密钥签发短期身份断言，不转发客户端自报的身份头或登录 token。Agent 用户标识为 `xmumdorm:<users.id>`。未登录、无效输入、原会话冲突与不可用服务分别返回可识别错误。未配置密钥时返回 503，Dorm 其他模块不受影响。

## 本地启动

Campus Copilot 项目提供 `run_dorm_web.cmd`，同时启动 Agent 8001、Dorm 4040 和 Vite 5173；都仅绑定回环地址，密钥仅在进程环境中共享。打开 <http://127.0.0.1:5173/agent>，使用已有本地账号登录。

依赖沿用两项目既有环境。默认使用已准备好的本地 MySQL；明确加上 `--existing-database` 时使用 Dorm 已有数据库配置，便于真实账号登录，且禁用后台任务。启动器不迁移数据库、不创建账号。需要手工分开启动时，Express 设置 `CAMPUS_AGENT_URL=http://127.0.0.1:8001`，Agent 设置 `XMUMDORM_API_URL=http://127.0.0.1:4040`，双方设置相同的 `CAMPUS_AGENT_SHARED_SECRET`（至少 32 字符）。

## 能力范围

当前支持政策与指南检索，以及个人课表、待办和共享放假日的只读查询；订单和个人成绩尚未接入。新模块使用 shared API 的 token/base URL 约定，流解析器独立，可为 App 复用契约。

放假日通过 `GET /internal/campus-agent/personal/holidays` 查询，沿用内部身份验证及参数白名单。直接读取 `shared/config/holidays.js`，与 Web/App 页面同源，按学校时区和共享学期日历筛选最近假期、学期内节日、年份、名称或日期范围，并计算倒计时和天数；未收录不等于无假期，不包含寒暑假或调课信息。更新共享假期配置后重启 Dorm 即可，无需导入知识库。

个人查询使用 `GET /internal/campus-agent/personal/clock`、`/schedule`、`/todos`。这些服务端接口只接受 Agent 签发的独立用途短期断言，复查账号状态，所有 SQL 按签名账号绑定查询；模型不能提供用户编号或回查地址。禁止缓存，无写入接口。当前工具仅查询，不新增、修改、完成或删除待办。

日期按 `Asia/Kuala_Lumpur` 和共享学期日历计算；课表反映最近导入记录，未绑定独立学期版本。无导入、指定范围无课程、日期超出覆盖范围及服务失败分开处理。待办默认所有日期下的未完成事项，每页 20 条；按截止日期查询今天或明天时不含无日期事项。逾期与既有页面一致，只计截止日期早于今天。

断线和“稍后查看”仅停止接收，后台可能继续执行。恢复时读取会话状态，不自动重发。Gateway 每用户每分钟 20 次聊天请求，最多同时 2 个转发、全局 8 个；不等同后台任务数或费用预算。Agent 保持单进程运行。

## 验证入口

新增 `__tests__/routes/agent.test.js` 覆盖鉴权、停用账号、内部身份、输入校验、SSE、错误与白名单；`__tests__/shared/agentStream.test.js` 覆盖 UTF-8/CRLF、确认中断、异常 EOF 和 AbortSignal。运行 `npm test -- --runInBand` 和 `npm run build:web`。

Campus 端运行 `scripts/test_dorm_integration.py`，使用临时数据库与假模型检查内部凭证、跨账号隔离、历史持久化与 API 范围。执行记录和未验证项在本文件末尾维护。

## 本轮任务

1. 身份与网关：新增受保护路由、短期内部凭证、白名单代理和输入限制。
2. Web 聊天：新增共享协议、React 页面、入口、历史与状态恢复。
3. 本地验证：隔离测试、构建、浏览器检查和启动说明。

本轮不含数据库 schema 变更，不推送或部署。

## 执行记录（2026-10-23）

- `npm test -- --runInBand --silent`：66 个套件、951 项通过，退出码 0。首次并行运行有一项既有商城图片测试超时，单独重跑 99 项通过，再次全量全部通过；商城代码未修改。
- `npm run build:web`：退出码 0，2853 个模块；既有 Shop 混合静态/动态导入警告仍在。
- 新增 Agent 页面 ESLint：退出码 0。
- 新增网关和流解析专项：2 套件、15 项通过。
- Campus 完整离线回归：20 个检查文件通过，包含新内部身份与会话隔离检查。
- 浏览器使用真实 Web 构建、Express 代理与 FastAPI，并以虚构账号/临时数据库/假模型验证：访客提示、中文流、新建切换和刷新恢复、跨账号历史拒绝、确认取消、断线不重发、390px 手机无横向溢出、不可用服务提示均通过；无页面脚本异常。故障注入产生的 HTTP 503 是预期结果。

复验时先构建 Web，再从 Campus 运行 `scripts/run_dorm_web_test.py`，然后用 `playwright-cli` 执行 Campus 的 `scripts/test_dorm_web.js`。Dorm 的 `scripts/run-agent-test-app.js` 只作为该隔离测试入口，不加载真实数据库配置。

首轮未验证真实模型回答质量或真实本地 MySQL 账号登录；未修改现有 App 与设计令牌，未合并两个账号库，没有提交、推送或部署。

## 追加：真实模型与知识检索联调（2026-10-23）

用户选择先不准备 MySQL。本轮使用测试身份，在独立 SQLite 会话库和 Chroma 上完成真实模型联调，未连接 Dorm 数据库。

- 实际对话模型连通；旧 Chroma 缺少来源类型，改以现有 16 份政策快照构建隔离索引，共 106 个片段。三个候选召回样例通过后发布，不改旧索引。
- 真实问答验证通过 8 项：流完成、政策工具调用、相关证据、引用 ID、来源 URL、日期说明、整轮历史保存和运行结束。该样例约 16 秒，不代表开放问题准确率。
- Web 从真实 Agent 恢复已有回答，显示 8 个引用链接；刷新恢复和 390px 手机布局通过，无页面脚本异常；这一步未重复调用模型。
- 历史验收脚本现按同一轮的多条 AI 消息比较，避免把检索前说明加最终回答误判为漏存。对应回归已通过，历史存储实现未改变。

Campus 提供 `run_dorm_live.cmd`：打开 <http://127.0.0.1:18766/__fixture>，选择测试身份进入。此入口只属于独立联调脚本，没有挂载到正式 server.js。模型与 Embedding 为真实服务；身份和账号状态是测试替身。

知识准备/验证命令为 Campus 的 `scripts/prepare_dorm_kb.py`、`scripts/verify_dorm_live.py`。资料仍是日期未核实的人工快照；真实 MySQL 登录和个人业务工具仍未验证。

## 回答方式收敛

Dorm 专用提示词现按“问什么答什么”组织：默认直接短答，只保留所问的判断、流程、金额或时间及必要条件；不输出检索过程、无关后果、功能列表或报告式章节。必要的适用范围澄清只问一句。

按最新要求，答案不再附来源、引用链接、生效日期、快照或时效说明，也不使用“来自……”等出处式开头；用户单独问日期时才回答该日期。页面上的来源和日期提示同步移除。内部仍核对证据，证据不足时不猜测。

Campus 的 `scripts/eval_dorm_answers.py` 使用五种真实问法验证简短度、问题范围、无来源和日期附加说明、实际检索与历史一致性；结果见 Campus `data/local/xmumdorm/answer-style-check.json`。其他 Campus 入口继续使用原有通用提示词。

最新五种真实问法全部通过，考试资格回答为 61、62 字符，无来源或日期附加说明；内部检索和历史一致性通过。旧长回答会话中的真实 Web 追问也通过（58 字符、零来源）。相关集成回归 3 项、Web 构建通过，联调服务已重启加载新规则。旧历史不重写。

按最新页面要求，标题下不显示整行会话工具栏；右上角提供“历史会话”按钮，弹窗按标题和创建时间列出旧聊天，支持选择恢复或新建对话。每次离开后重新进入或刷新时默认空白新对话，发送第一条消息时才创建服务端记录，不自动恢复上次选择；历史记录仍按当前账号保存和隔离。弹窗支持 Escape、点击遮罩关闭及键盘焦点管理。

每条历史会话右侧可删除；当前页面提供“撤销”。Agent 本地会话库以 `web_conversation_deletions` 保存删除标记，不擦除消息或检查点；普通列表、详情、聊天均排除已删除会话，包括旧 `main`。删除当前会话回到空白新对话；正在回答的会话拒绝删除，接口返回 409。撤销、删除均要求有效登录与内部断言，不能操作其他账号的记录。删除与聊天在领取会话执行权后重新校验，避免并发恢复已删会话。

## 指南知识扩展

本地已引入主分支的只读预览网关，并新增 `GET /api/preview/handbook/export`：沿用令牌、Origin 与限流，只查未删除的已发布文章和启用分类，不递增浏览量、不导出账号信息。游标分页绑定完整快照摘要，变动返回 409。上限 1,000 篇、10 MiB，超限返回 413，不静默截断。

部署需维护者为专用预览数据库账号增加 `handbook_articles` 与 `handbook_tabs` 的 SELECT 权限，并部署上述代码；本轮仅本地修改和验证，没有执行生产授权、迁移或部署。现有课程资料功能保持原协议，Vite 预览开关沿用主分支实现。

Campus 侧使用 `sync_dorm_guides.cmd --env-file <已有frontend/.env.local>` 下载并建立独立指南语义索引；也支持 `--from-json <完整离线导出>`。只在整批下载、校验和向量生成成功后替换当前索引，撤稿内容随完整快照清除。外链文章仅使用摘要，不抓取外部全文。指南通过 `search_guides` 检索，不进入 `search_policy` 的官方政策证据库；回复继续不附来源、日期或出处式开场。

详细操作见 Campus 的 `docs/dorm-guide-knowledge.md`；默认索引为 Campus 的 `data/local/xmumdorm/guides.db`。线上接口部署前不会自动导入生产正文；验证用虚构指南与默认索引隔离。

本轮本地验证：Node 网关与原代理相关 21 项、指南最终回归 12 项、Dorm 集成 3 项、历史回归 7 项通过；Campus 完整离线检查 21 个文件通过。实际 Embedding/模型导出检索问答、原五种问法及真实 Web 的未导入指南提示和刷新恢复通过。部署维护者可使用 Campus 的 `data/local/xmumdorm/guide-export.patch`，该补丁基于主分支 `6a8b8d1b`，不包含本地 UI/App 改动或凭据。
