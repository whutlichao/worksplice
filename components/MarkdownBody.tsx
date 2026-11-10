"use client";

import { useMemo, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  /** @mention 的点击回调（`MentionText` 注入）。href 形如 `#mention:<memberId>`，
   *  文本是被命中的原 token（`@name` / `@"name"`）。缺省时 mention 链接按普通文本渲染。 */
  onOpenMention?: (memberId: string, text: string) => void;
  /** mention 按钮的悬停提示（由 `MentionText` 用 i18n 生成；本组件不引入 i18n 依赖，
   *  `MarkdownBody` 在若干测试与纯展示路径上都是独立渲染的）。 */
  mentionTitle?: (text: string) => string;
}

/** `#mention:<memberId>` 的协议判定。为什么不用自定义 scheme（如 `mention://`）：
 *  `rehype-sanitize` 的默认 allowlist 会把未知协议的 `href` 清成空串（实测 `href=""`），
 *  渲染就退化成普通链接；`#` 片段标识符本就在 allowlist 内，且不进 `resolveLocalFileHref`
 *  的文件路径分支（它先按 `#` 切掉 fragment），两条既有链路都不需要改。 */
const MENTION_HREF_PREFIX = "#mention:";

function parseMentionHref(href: string | undefined): string | null {
  if (!href || !href.startsWith(MENTION_HREF_PREFIX)) return null;
  const id = href.slice(MENTION_HREF_PREFIX.length);
  return id.length > 0 ? id : null;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, onOpenMention, mentionTitle }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
      }
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const mentionId = parseMentionHref(href);
      if (mentionId) {
        const text = typeof children === "string" ? children : "";
        if (!onOpenMention) return <>{children}</>;
        return (
          <button
            type="button"
            className="mention"
            title={mentionTitle?.(text)}
            // 形态沿用改造前的内联值（界面评审 B6 要求「inline style 不变」）：
            // 走 `.mention` class 会与 `.msg-text .mention` 的 padding/背景逐字重合，
            // 但其它容器（线程面）没有那条后代规则，内联值保证两处一致。
            style={{
              display: "inline",
              padding: "0 2px",
              border: "1px solid transparent",
              borderRadius: "var(--r-sm)",
              background: "var(--accent-soft)",
              color: "var(--accent-deep)",
              font: "inherit",
              fontSize: "inherit",
              fontWeight: 700,
              lineHeight: "inherit",
              cursor: "pointer",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = "var(--border-strong)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = "transparent";
            }}
            onFocus={(event) => {
              event.currentTarget.style.borderColor = "var(--border-strong)";
            }}
            onBlur={(event) => {
              event.currentTarget.style.borderColor = "transparent";
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenMention(mentionId, text);
            }}
          >
            {children}
          </button>
        );
      }
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <a href={href} {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a href={href} {...props} onClick={handleClick}>
          {children}
        </a>
      );
    },
    img({ src, alt, ...props }) {
      delete props.node;
      const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
      const imageSrc = filePath
        ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
        : src;
      // Dynamic local paths are served directly by the file API.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [cwd, isStreaming, onOpenFile, onOpenMention, mentionTitle]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
