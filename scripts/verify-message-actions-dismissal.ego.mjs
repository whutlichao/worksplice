import assert from "node:assert/strict";

// Run only against the isolated test instance described in the Answer (WORKSPLICE_DATA_DIR under /tmp).
const baseUrl = "http://127.0.0.1:30143";
const taskName = "message action toolbar dismissal regression";
const existingSpace = (await listTaskSpaces()).find(
  (space) => space.name === taskName && space.ownership === "agent",
);
const task = existingSpace ? await taskSpace(existingSpace.id) : await taskSpace(taskName);
if (task.ownership !== "agent") throw new Error("Refusing to use a user-owned TaskSpace");
const page = task.page("p1");

const messageContent = "Pacing for this week";
const rowXPath = `xpath=//div[contains(@class,"ws-message-row")][.//p[contains(.,"${messageContent}")]]`;

function rowState() {
  return page.evaluate((content) => {
    const row = [...document.querySelectorAll(".ws-message-row")].find((item) =>
      item.textContent?.includes(content) ?? false,
    );
    const toolbar = row?.querySelector(".ws-message-actions");
    return {
      hovered: row?.matches(":hover") ?? false,
      focusWithin: row?.matches(":focus-within") ?? false,
      toolbarDisplay: toolbar ? getComputedStyle(toolbar).display : null,
    };
  }, messageContent);
}

function mineHasReaction(emoji) {
  return page.evaluate(
    ({ content, selectedEmoji }) => {
      const row = [...document.querySelectorAll(".ws-message-row")].find((item) =>
        item.textContent?.includes(content) ?? false,
      );
      return [...(row?.querySelectorAll(".reactions button") ?? [])].some(
        (button) =>
          !button.title &&
          button.classList.contains("mine") &&
          button.querySelector("span")?.textContent?.trim() === selectedEmoji,
      );
    },
    { content: messageContent, selectedEmoji: emoji },
  );
}

function assertDismissedAfterClick(state, action, { requireHover = true } = {}) {
  console.log(`${action} result:`, state);
  if (requireHover) {
    assert.equal(state.hovered, true, "pointer must remain over the acted-on message row");
  }
  assert.equal(
    state.toolbarDisplay,
    "none",
    `action toolbar must dismiss immediately after ${action}`,
  );
}

await page.goto(baseUrl);
await page.waitForLoadState();
await page.selectOption('select[aria-label="语言"]', { label: "简体中文" });
await page.waitForFunction(
  () => [...document.querySelectorAll("button")].some((button) => button.textContent?.includes("#all")),
  undefined,
  { timeout: 15_000 },
);
await page.snapshot();
await page.click('loc=role:button[name*="#all"]', { label: "open seeded channel" });
await page.waitForFunction(
  (content) => document.body.textContent?.includes(content) ?? false,
  messageContent,
  { timeout: 15_000 },
);
const messageText = `xpath=//p[contains(.,"${messageContent}")]`;
const row = rowXPath;

// A completed Quote action must hide the toolbar without moving the pointer off this row.
await page.hover(messageText, { label: "hover test message" });
await page.click(`${rowXPath}//div[contains(@class,"msg-tools")]//button[@title="引用"]`, {
  label: "quote test message",
});
await page.waitForSelector('button[aria-label="清除引用"]', {
  state: "visible",
  timeout: 5_000,
});
assertDismissedAfterClick(await rowState(), "Quote");

// Opening the secondary reaction choices is not completion: keep them available until selection.
await page.hover("css=textarea", { label: "move pointer to composer" });
await page.hover(messageText, { label: "return to test message" });
await page.click(`${rowXPath}//div[contains(@class,"msg-tools")]//button[@title="添加回应"]`, {
  label: "open quick reactions",
});
await page.waitForFunction(
  (content) => {
    const row = [...document.querySelectorAll(".ws-message-row")].find((item) =>
      item.textContent?.includes(content) ?? false,
    );
    return Boolean(row?.querySelector('.reactions button[title="回应"]'));
  },
  messageContent,
  { timeout: 5_000 },
);
const openState = await rowState();
assert.equal(openState.hovered, true, "pointer must remain over the message while choosing a reaction");
assert.notEqual(openState.toolbarDisplay, "none", "opening reaction choices must not dismiss them");
await page.click(`${rowXPath}//div[contains(@class,"msg-tools")]//button[@title="添加回应"]`, {
  label: "close quick reactions",
});
const closedState = await rowState();
assert.equal(closedState.hovered, true, "closing choices must keep the pointer over the row");
assert.notEqual(closedState.toolbarDisplay, "none", "closing choices is not a completed reaction");
await page.click(`${rowXPath}//div[contains(@class,"msg-tools")]//button[@title="添加回应"]`, {
  label: "reopen quick reactions",
});
await page.waitForFunction(
  (content) => {
    const row = [...document.querySelectorAll(".ws-message-row")].find((item) =>
      item.textContent?.includes(content) ?? false,
    );
    return Boolean(row?.querySelector('.reactions button[title="回应"]'));
  },
  messageContent,
  { timeout: 5_000 },
);
const hadThumbsUp = await mineHasReaction("👍");
await page.click(
  `${rowXPath}//div[contains(@class,"reactions")]//button[@title="回应" and .//span[normalize-space(.)="👍"]]`,
  { label: "choose thumbs-up reaction" },
);
await page.waitForFunction(
  ({ content, expected }) => {
    const row = [...document.querySelectorAll(".ws-message-row")].find((item) =>
      item.textContent?.includes(content) ?? false,
    );
    if (!row) return false;
    const reaction = [...row.querySelectorAll(".reactions button")].find(
      (button) =>
        !button.title &&
        button.querySelector("span")?.textContent?.trim() === "👍",
    );
    return Boolean(reaction?.classList.contains("mine")) === expected;
  },
  { content: messageContent, expected: !hadThumbsUp },
  { timeout: 10_000 },
);
assertDismissedAfterClick(await rowState(), "quick reaction selection", { requireHover: false });

// The emoji picker is also a completion path: opening it stays open; choosing an emoji dismisses.
await page.hover("css=textarea", { label: "move pointer to composer" });
await page.hover(messageText, { label: "return to test message" });
await page.click(`${rowXPath}//div[contains(@class,"msg-tools")]//button[@title="添加回应"]`, {
  label: "open quick reactions",
});
await page.waitForFunction(
  (content) => {
    const row = [...document.querySelectorAll(".ws-message-row")].find((item) =>
      item.textContent?.includes(content) ?? false,
    );
    return Boolean(row?.querySelector('.reactions button[title="回应"]'));
  },
  messageContent,
  { timeout: 5_000 },
);
await page.click(
  `${rowXPath}//div[contains(@class,"reactions")]//button[@title="添加回应"]`,
  { label: "open emoji picker" },
);
await page.waitForSelector(`${row}//button[@title="🔧"]`, {
  state: "visible",
  timeout: 5_000,
});
const pickerOpenState = await rowState();
assert.notEqual(
  pickerOpenState.toolbarDisplay,
  "none",
  "opening the emoji picker must not dismiss reaction choices",
);
const hadWrench = await mineHasReaction("🔧");
await page.click(`${row}//button[@title="🔧"]`, { label: "choose wrench emoji" });
await page.waitForFunction(
  ({ content, expected }) => {
    const row = [...document.querySelectorAll(".ws-message-row")].find((item) =>
      item.textContent?.includes(content) ?? false,
    );
    if (!row) return false;
    const reaction = [...row.querySelectorAll(".reactions button")].find(
      (button) =>
        !button.title &&
        button.querySelector("span")?.textContent?.trim() === "🔧",
    );
    return Boolean(reaction?.classList.contains("mine")) === expected;
  },
  { content: messageContent, expected: !hadWrench },
  { timeout: 10_000 },
);
assertDismissedAfterClick(await rowState(), "emoji picker selection", { requireHover: false });

console.log("PASS: Quote, quick reaction, and emoji-picker selection dismiss the toolbar; reaction choices remain available until selection.");
await task.finish({ keep: [] });
