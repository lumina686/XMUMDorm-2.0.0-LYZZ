# T1 posts 与 clubs 换用共享可选鉴权（Phase 5 示踪弹道）

## 1. Where this task sits

- **Phase 5 后端与共享层收拢**，目标：可选鉴权在审计点名的三条路由只剩一份实现，点评不再可能编造评分。
- 本任务把 **R-8 后端可选鉴权收拢一处** 的前两条路由接上：`posts.js` 与 `clubs.js` 删本地 `parseOptionalUser`，改用 `utils/parseOptionalUser.js`。
- **Starts after**: 无。**Waits on it**: T2 canteen 中间件收敛。

## 2. What the developer needs to know

**Read first**

- `utils/parseOptionalUser.js` — 共享实现已存在（从 posts.js 提取，行为一致），文件注释自曝全库另有 7 处局部副本。
- `routes/posts.js:42-52`、`routes/clubs.js:35-43` — 两份本地实现，与共享版逐行为等价（同样的 split/verify/catch-null）。
- `__tests__/routes/posts.test.js`、`__tests__/routes/clubs.test.js` — 本任务缝，预期改后直接绿。

**Settled**

- 只换引用，不改任何行为；两文件其余的 `jwt` 直接用法（签发等）不动。
- 全库其余 7 处局部副本是更大的收敛面，本批不碰（工具文件注释已声明独立立项），记入批次 open。

**Edges and seam**

- 只改两条路由的函数定义与引用；缝：两份既有路由测试。

**Run**

- 根目录：`npm test -- __tests__/routes/posts.test.js __tests__/routes/clubs.test.js`

**Unknowns**

- 无预期分叉；若路由测试红，说明两份本地实现与共享版有未察觉的差异，停下比对。

## 3. The workflow

1. 读上述文件，一句话复述任务。
2. `posts.js` 删本地函数、顶部 require 共享版；`clubs.js` 同样。
3. 两份路由测试跑绿。
4. 提交。

## 4. The test cases

| Case | Input | Expected | Seam |
|---|---|---|---|
| 1 | 两份路由测试 | 原样全绿（无行为变化） | jest |
| 2 | grep 两文件 | 本地 `function parseOptionalUser` 定义为 0 处 | grep 门 |
