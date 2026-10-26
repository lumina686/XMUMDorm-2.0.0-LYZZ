# Phase 5 批次小结：后端与共享层收拢（2026-10-25）

- 窗口：2026-10-25 单日批次，`fb68ed6c…aa60fccc` 共 5 笔提交
- 基线：[三模块审计](../../evaluation/三模块审计-食堂社团万能墙-2026-10-25.md) 的 D-8 可选 JWT 三处手写、D-10 点评缺省评分（对应改进计划 R-8 后端可选鉴权收拢一处、R-10 移除点评缺省评分）

## 1. Headline

**本批次：3 项变更，3 项完成。点评不再可能编造评分；审计点名的三条路由可选鉴权只剩一份实现。**

| # | 变更 | 位置 | 类型 | 状态 | 对读者意味着什么 |
|---|---|---|---|---|---|
| C-1 | `postProductComment` 删「人上人」缺省，漏传即抛 | `shared/api/canteen.js` | Fixed | Done | 评分只能来自用户的选择，不存在静默档位 |
| C-2 | Web 回复显式携带被回复点评的档位 | `frontend/src/pages/FoodDetail.jsx` | Fixed | Done | 修复了一个真实的既有问题：此前每条 Web 回复都被缺省值写入「人上人」 |
| C-3 | posts/clubs 本地 `parseOptionalUser` 删除、canteen 中间件改为调共享解析器 | `routes/{posts,clubs,canteen}.js` | Changed | Done | 三条路由的密钥与解析规则改一处即生效 |

Routine：契约测试补「漏 rating 拒发」断言（含 transport 隔离）；clubs.js 顺带清掉换用后失效的 `jsonwebtoken` 死引用。

## 2. What it means

审计的 D-8 与 D-10 关闭，改进计划六阶段中的第五阶段落地。D-10 的执行读出了审计没写的事实：
缺省值不是未来风险，**Web 回复当时就在被编造**——好在后端计分只算一级点评（`parent_id IS NULL`），
回复档位从不进综合分，因此修复以「回复引用被回复档位」收口，不产生新的评分语义。
D-8 按审计范围收拢三条路由；共享工具文件的注释自曝全库另有约 7 处局部副本，
那是比本批更大的收敛面。批次证明：路由 + shared 184 测试、App 食堂 32 测试全绿，tsc/lint 零新增。

## 3. Still open

- 全库其余约 7 处局部 `parseOptionalUser` 副本（square/handbook/marketplace/users 等）：共享文件注释已声明独立立项。
- 后端对**回复**也强制枚举 rating 的语义问题：回复无评分概念，约束却要求非空档位；改后端超出本批。
- Web 端无自动化测试，C-2 的回归依据是代码审读 + 后端路由测试不变绿。
- 改进计划 Phase 6 未动：社团状态机收敛与按钮字数。
