/**
 * 模态焦点陷阱的判定层（界面评审残留 R1）。
 *
 * 两层分开：**规则**是纯函数（`isTabbable` / `focusableWithin` / `nextTabTarget`），
 * 由 `lib/modal-focus.test.mjs` 在 node 里钉住；**DOM 读取**（`collectTabbables`）只在
 * 浏览器里跑，由 `BrutalModal` 在挂载时调用。规则不依赖 `window`，所以测试不需要 DOM。
 *
 * 选「焦点陷阱」而不是给兄弟内容打 `inert`：`BrutalModal` 的子树里有 `createPortal` 到
 * body 的选择器（`DirectoryPicker`），`inert` 按 DOM 兄弟关系生效，会连 portal 内容一起禁掉；
 * 而 Tab 序本来只由焦点决定，把边界拦在模态内即可，不必知道背景里有什么。
 */

/** 元素的可聚焦性快照：只留判定需要的字段，读快照的代码是纯函数。 */
export interface FocusableSnapshot {
  /** 小写标签名。 */
  tag: string;
  /** 显式 tabindex；缺省表示没有声明。 */
  tabIndex?: number;
  /** `a` 的 href（无 href 的锚点不可聚焦）。 */
  href?: string;
  /** `input` 的 type（`hidden` 不可聚焦）。 */
  type?: string;
  disabled?: boolean;
  /** 自身或祖先带 `inert`。 */
  inert?: boolean;
  /** 计算样式 `display` 不是 `none`。 */
  rendered?: boolean;
  /** 计算样式 `visibility` 不是 `hidden` / `collapse`。 */
  visible?: boolean;
  /** `getClientRects().length > 0`：有布局盒。 */
  hasBox?: boolean;
  /** `audio` / `video` 带 controls。 */
  controls?: boolean;
}

/** 原生可聚焦的标签（不含 `a` 与 `input` 这类还要看属性的）。 */
const NATIVELY_FOCUSABLE = new Set([
  "button",
  "select",
  "textarea",
  "iframe",
  "summary",
]);

/**
 * 一个快照是否进 Tab 序。判据顺序 = 浏览器自己的顺序：先被 CSS 驱逐，再被语义约束
 * （disabled / inert / tabindex=-1），最后才是「天生可聚焦」。
 */
export function isTabbable(snapshot: FocusableSnapshot): boolean {
  if (snapshot.rendered === false) return false;
  if (snapshot.visible === false) return false;
  if (snapshot.hasBox === false) return false;
  if (snapshot.inert) return false;
  if (snapshot.disabled) return false;
  if (typeof snapshot.tabIndex === "number") return snapshot.tabIndex >= 0;
  if (snapshot.tag === "a") return Boolean(snapshot.href);
  if (snapshot.tag === "input") return snapshot.type !== "hidden";
  if (snapshot.tag === "audio" || snapshot.tag === "video") {
    return Boolean(snapshot.controls);
  }
  return NATIVELY_FOCUSABLE.has(snapshot.tag);
}

/** 快照里进 Tab 序的下标（保持 DOM 顺序）。 */
export function focusableWithin(
  snapshots: readonly FocusableSnapshot[],
): number[] {
  const indexes: number[] = [];
  snapshots.forEach((snapshot, index) => {
    if (isTabbable(snapshot)) indexes.push(index);
  });
  return indexes;
}

/**
 * `Tab` / `Shift+Tab` 在边界上的回绕目标；返回 `null` 表示「交给浏览器原生顺序」。
 *
 * - `active === null`（焦点还没进模态，或落在 `document.body`）：按方向拉进边界。
 *   这是「打开模态后焦点仍在 BODY」的兜底——首个 Tab 不会把用户又带回页面主体。
 * - `active` 是不在 `items` 里的具体元素（例如挂在 body 的 portal 选择器）：返回 `null`，
 *   父模态不抢子浮层的焦点。
 */
export function nextTabTarget<T>(
  items: readonly T[],
  active: T | null,
  backwards: boolean,
): T | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  if (active === null) return backwards ? items[items.length - 1] : items[0];
  const index = items.indexOf(active);
  if (index === -1) return null;
  if (backwards) return index === 0 ? items[items.length - 1] : null;
  return index === items.length - 1 ? items[0] : null;
}

// ─── DOM 侧读取（只在浏览器里调用） ──────────────────────────────────────────

/** 候选选择器由 `NATIVELY_FOCUSABLE` 派生：加标签只改上面那一处。 */
const CANDIDATE_SELECTOR = [
  ...[...NATIVELY_FOCUSABLE].map((tag) => tag),
  "a[href]",
  "input",
  "audio[controls]",
  "video[controls]",
  "[tabindex]",
].join(",");

/** 把一个真实元素折成判定快照。`inert` 沿祖先链判定（与浏览器一致）。 */
function snapshotOf(element: Element): FocusableSnapshot {
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  const tabIndexAttr = element.getAttribute("tabindex");
  const input = element as HTMLInputElement;
  return {
    tag: element.tagName.toLowerCase(),
    tabIndex:
      tabIndexAttr === null
        ? undefined
        : Number.isFinite(Number(tabIndexAttr))
          ? Number(tabIndexAttr)
          : 0,
    href: element.getAttribute("href") ?? undefined,
    type: input.type,
    disabled: (element as HTMLButtonElement).disabled === true,
    inert: element.closest("[inert]") !== null,
    rendered: style ? style.display !== "none" : true,
    visible: style ? style.visibility !== "hidden" && style.visibility !== "collapse" : true,
    hasBox: typeof element.getClientRects === "function" ? element.getClientRects().length > 0 : true,
    controls: (element as HTMLMediaElement).controls === true,
  };
}

/** `root` 内按 DOM 顺序进 Tab 序的元素。规则全部来自 `focusableWithin`。 */
export function collectTabbables(root: HTMLElement): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR));
  const keep = new Set(focusableWithin(candidates.map(snapshotOf)));
  return candidates.filter((_, index) => keep.has(index));
}
