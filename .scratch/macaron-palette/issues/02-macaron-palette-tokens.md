# 02: 马卡龙色板契约值（expand）

**What to build:** 打开应用，纸面、文字、强调色、四态状态点、头像与阴影的取值全部换成马卡龙方向；每个色相族同时具备**填充档**（马卡龙亮档，只做填充，深墨文字压其上）、**淡底档**、**文字档**（同色相压深，≥4.5:1）与**图形档**（≥3:1，供焦点环与状态点）。本票**只换契约值、只新增档位名**，一行调用点都不改——旧名照旧可用，所以应用正常渲染，只是颜色变了。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `worksplice-design-system/colors_and_type.css` 的色值全量替换为 `.scratch/macaron-palette/spec.md` 的「角色族 × 档位」矩阵（纸张族 / 墨族 / 八族的 fill·deep·graphic / `--av-*` / 阴影与 scrim ink）
- [ ] `app/globals.css` 扩展层只**新增** `--on-accent` 与 `--selected*` / `--unread*` / `--warn*` 三个角色族；不删任何旧名、不改任何调用点
- [ ] 同名 token 在上游与扩展层的值逐字一致（既有 `app/globals.test.mjs` 的 T-A 断言仍绿）
- [ ] 值改在上游 `colors_and_type.css`，**不在** `app/globals.css` 覆盖同名 token（T-A 断言要求的唯一形态）
- [ ] 本票与票 03 **必须同批交付**（同一 PR、各一个 commit）——否则会出现焦点环对比度窗口，见 spec 的「中间态窗口」知情项
- [ ] 推分支 + `gh pr create`（与票 03 同 PR），PR 号回填 Answer
