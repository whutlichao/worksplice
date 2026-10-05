# 01 — landscape 调研：渠道与入场券的外部事实

**Type:** research
**Blocked by:** —
**Status:** resolved

## Question

在看不见外部事实的情况下无法做任何渠道决策：pi 社区的人到底在哪、同类项目是怎么起量的、每个候选渠道的真实门槛与期望收益、以及一个同类项目在发布前必须补齐什么。只认一手来源（平台官方规则、GitHub/HN API 实测、真实仓库 README 与 CONTRIBUTING），不接受二手转述与猜测。

## Answer

已由 research 子代理完成，全文落在 [research/landscape.md](../research/landscape.md)（454 行、96 个来源 URL、2026-10-02 实测）。要点：

1. **pi 没有展示位，人流在 Discord**：`earendil-works/pi` 111,651 stars / 14,167 forks，但 Discussions 只启用了 `General` 一个类目，321 条讨论里同类 "Show & tell" 帖历史最佳 **1 条评论**；而 pi README 的 Discord 邀请实测 **17,638 成员 / 3,465 在线**。
2. **入场券是一行安装，不是发帖**：12 个同类高星项目 **10/12 有「一行安装」、0/12 有在线 demo**；HN 官方规则要求「别人能试的东西」，「从源码跑」正面违规；实测当天最近 30 条 Show HN 分数**中位数 = 1**，且 HN 分数与长期 star 几乎不相关（claude-squad 首发 5 分 → 今 8,561 stars；agentapi 163 分 → 1,500 stars）。
3. **可立刻够格的收录位只有两个**：`slavakurilyak/awesome-ai-agents`（2,289 stars，明确无 star 门槛）与 `Agent-Analytics/awesome-multi-agent-orchestrators`（149 stars，范围逐词吻合）；`kaushikb11/awesome-llm-agents` 卡 **25 stars** 硬门槛 → 里程碑。
4. **中文渠道只有两条有一手依据**：HelloGitHub（179,701 stars 月刊、每月 28 号、欢迎自荐、无 star 门槛，模板要求标题约 20 字 + 描述 32–256 字符）与 V2EX `/go/create`（官方欢迎独立开发者拿第一批用户，但**新账号 30 天冷却**、实测真实回复量 0~6 条）；掘金只允许技术文章形态（官方罚则把「以推广曝光为目的」定义为垃圾广告）。
5. **一条冷静的反证**：pi 官方自家同类协作层 `earendil-works/pi-chat` 停在 **404 stars、停滞 4 个月**——品类需求真实，采纳很难。
6. **数据缺口已诚实标注**：Reddit 官方 JSON 403（订阅数与规则只能标 [二手]）、少数派投稿页 404、微信外链规范页不可读、小红书/即刻无官方规则页 → 这四个渠道不基于猜测投入。
