# T2 社团按钮 label 收敛

## 1. Where this task sits

- **Phase 6 社团代码健康硬化**，目标：三个交互 hook 共享一台状态机，社团页按钮文案不再超长。
- 本任务把 **R-7 社团按钮 label 收敛** 落地：审计 D-7 点名的帖子全文 label 与组合长标签全部收敛。
- **Starts after**: 无。**Waits on it**: T3 全量回归。

## 2. What the developer needs to know

**Read first**

- `app/src/features/clubs/ClubScreens.tsx:203-209` — 主页活动/帖子行把全文当 Button label（D-7 主体）。
- `ClubScreens.tsx:289-290` — 管理页 `删除活动 · title` / `删除动态 · content` 组合长标签。
- `ClubScreens.tsx:394` 附近 — 报名按钮 `${动作} · ${人数}` 组合标签；`p3a5-club-details.test.tsx` 断言 count 在 accessibilityLabel 里，**该断言随行为更新**（本任务是行为变更任务，红→绿正常）。
- `app/src/components/ui/ListItem.tsx` — 列表行现成组件（WallFeed 在用）：title 截断 + subtitle 正文 + 整行可点。

**Settled**

- 主页活动/帖子行：Button 换 ListItem（导航行语义本就比按钮准），title 截断、帖子正文进 subtitle。
- 管理页删除行：动作词独立成 danger Button（label = 词条 ≤6 汉字），对象名用 Text 展示。
- 报名按钮 label 只留动作词，报名人数移到按钮旁的独立 Text；对应测试断言同步改写（红先）。
- 发现页列表行（club.name · 关注数）审计未点名，不动。

**Edges and seam**

- 只改 ClubScreens 与两处既有屏幕测试；缝：discovery/details/management 既有套件。

**Run**

- `cd app && npm test -- src/__tests__/p3a5-club-discovery.test.tsx src/__tests__/p3a5-club-details.test.tsx src/__tests__/p3a5-club-management.test.tsx`
- `cd app && npx tsc --noEmit`

**Unknowns**

- ListItem 的 props（onPress/testID）以组件签名为准；截断长度以组件内建行为优先，不自造截断工具。

## 3. The workflow

1. 读上述文件，一句话复述任务。
2. 红用例：报名按钮 label 不含人数、人数在独立 Text（改写既有断言先红）；帖子行不再是全文 label 按钮。
3. 跑红、提交红测试。
4. 实现三处收敛；全部相关套件绿后提交。

## 4. The test cases

| Case | Input | Expected | Seam |
|---|---|---|---|
| 1 | 长帖主页行 | 行内不再有全文 label 按钮；正文可见且行可点进详情 | discovery 套件 |
| 2 | 报名按钮 | label 为动作词（≤6 汉字），人数在其外展示 | details 套件 |
| 3 | 管理页删除行 | 删除按钮 label 仅动作词，对象名在行文本 | management 套件 |
| 4 | 触控目标 | 行高不低于 48dp 等效（组件既有触控达标） | 组件既有测试 |
