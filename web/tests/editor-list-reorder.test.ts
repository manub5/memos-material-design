import { describe, expect, it } from "vitest";
import { identifyListItems, reorderListItem } from "@/components/MemoEditor/Editor/listReorder";

function move(source: string, from = 0, target = 1, side: "before" | "after" = "after") {
  const items = identifyListItems(source);
  const change = reorderListItem(source, items[from].from, items[target].from, side);
  return change ? source.slice(0, change.from) + change.insert + source.slice(change.to) : source;
}

describe("structural list reorder", () => {
  it.each([
    ["- a\n- b", "- b\n- a"],
    ["1. a\n2. b\n", "2. b\n1. a\n"],
    ["- [x] a  \r\n- [ ] b\r\n\r\n", "- [ ] b\r\n- [x] a  \r\n\r\n"],
    ["- a\n\n  continuation\n\n  - child\n- b", "- b\n- a\n\n  continuation\n\n  - child"],
    ["- a\n  ```\n  - code\n  ```\n- b\n", "- b\n- a\n  ```\n  - code\n  ```\n"],
  ])("preserves structural blocks and separators in %j", (source, expected) => {
    const siblings = identifyListItems(source).filter((item) => item.listFrom === 0);
    const change = reorderListItem(source, siblings[0].from, siblings[1].from, "after");
    expect(change && source.slice(0, change.from) + change.insert + source.slice(change.to)).toBe(expected);
  });

  it("moves backward and reorders nested siblings only", () => {
    expect(move("- a\n- b\n- c", 2, 0, "before")).toBe("- c\n- a\n- b");
    const source = "- parent\n  - one\n  - two\n- other";
    const items = identifyListItems(source);
    const children = items.filter((item) => item.listFrom !== 0);
    const change = reorderListItem(source, children[1].from, children[0].from, "before");
    expect(change && source.slice(0, change.from) + change.insert + source.slice(change.to)).toBe("- parent\n  - two\n  - one\n- other");
    expect(reorderListItem(source, items[0].from, children[0].from, "after")).toBeNull();
    expect(reorderListItem(source, items[0].from, items[0].from, "before")).toBeNull();
  });

  it("moves parents with differently sized nested groups and preserves external prose", () => {
    const source = "intro\n\n- parent\n  - one\n  - two\n- other\n  - three\n  - four\n  - five\n\nend\n";
    const siblings = identifyListItems(source).filter((item) => item.listFrom === 7);
    const change = reorderListItem(source, siblings[0].from, siblings[1].from, "after");
    expect(change && source.slice(0, change.from) + change.insert + source.slice(change.to)).toBe(
      "intro\n\n- other\n  - three\n  - four\n  - five\n- parent\n  - one\n  - two\n\nend\n",
    );
  });

  it.each([
    "```\n- a\n- b\n```",
    "> - a\n> - b",
    "    - a\n    - b",
    "ordinary text\nnot a list",
    "-\n- b",
    "- a\n  ```\n  broken\n- b",
  ])("excludes unsupported or malformed input %j", (source) => {
    expect(identifyListItems(source)).toEqual([]);
  });

  it("rejects cross-list, invalid offsets, and adjacent no-op", () => {
    const source = "- a\n- b\n\nparagraph\n\n- c\n- d";
    const items = identifyListItems(source);
    expect(reorderListItem(source, items[0].from, items[2].from, "after")).toBeNull();
    expect(reorderListItem(source, 1, items[1].from, "after")).toBeNull();
    expect(reorderListItem(source, items[0].from, items[1].from, "before")).toBeNull();
  });
});
