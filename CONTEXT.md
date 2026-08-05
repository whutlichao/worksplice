# Worksplice

多 agent 协作消息系统：人类（owner）与若干 agent 通过频道协作，agent 由 agent-loop 驱动消费消息并回复。

## Language

**成员 (Member)**:
持久身份行，类型为 agent 或 owner（人类，恒为 `owner`）。删除 = soft-delete：行保留以承载不可变消息的作者渲染，但移出全部频道。
_Avoid_: 会话、session（那是 pi session，临时运行状态）

**Agent**:
拥有家目录、可绑定项目目录的成员。可被唤醒、进入频道、认领任务。
_Avoid_: 机器人、bot

**家目录 (Home)**:
每个 agent 创建时自动获得的专属目录，唯一且私有；删除身份时一并删除。
_Avoid_: 默认工作区、个人目录

**项目目录 (Project Directory)**:
可被多个 agent 绑定共享的目录（协作代码库）；不随任一身份删除，也不被全量重置清理。
_Avoid_: 仓库、共享目录

**工作区 (Workspace)**:
成员当前绑定的目录——未绑定项目目录时为家目录，绑定后为项目目录；更换工作区即更换会话。
_Avoid_: 目录、文件夹

**频道 (Channel)**:
消息的聚合容器。加入 = 订阅该频道的全部普通消息。
_Avoid_: 群组、room

**频道成员 (Channel Member)**:
已加入某频道的成员。`#all` 自动加入且不可离开；thread 回复继承频道规则。

**提及 (Mention / @mention)**:
消息正文里的 `@名字` token（含空格的名字用 `@"带空格名字"` 引号形式）解析为成员 id。个人提及是注意力信号：被提及的 agent 被唤醒，且穿透 mute 与未加入限制。渲染侧命中成员名的 token 高亮显示，点击可查看成员（agent → 详情面板，人类 → 简介弹窗）。
_Avoid_: @ 关联、艾特

**穿透 (Penetration)**:
未加入频道的 agent 被个人提及时仍被唤醒送达（但回复需自行加入频道）。mute 的静音只挡普通消息，个人提及仍穿透。

**静音 (Mute)**:
频道级通知开关：静音后普通消息不进该成员 inbox，个人提及仍穿透；取消后不补投静音期间被压制的消息。

**任务 (Task)**:
锚定于一条频道消息的协作单元，带状态机（todo→in_progress→in_review→done/closed→reopen）。互审：构建者不验证自己。
_Avoid_: ticket、工单

**成员面板 (Member Panel)**:
频道头部 `Users` 图标展开区，列出该频道的 agent 成员及状态点，点击打开成员详情。

**补全 (Mention Completion)**:
Composer 输入 `@` 弹出的成员菜单，列出全部 agent（非频道成员标注"未加入"），插入 `@名字` 或引号形式。
_Avoid_: 提及菜单
