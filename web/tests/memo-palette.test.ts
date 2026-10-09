import { describe, expect, it } from "vitest";
import { memoColorName } from "@/components/MemoView/memoPalette";
import { MemoColor } from "@/types/proto/api/memo_service_pb";

describe("memo palette", () => {
  it("uses neutral for old or unknown memo colors", () => {
    expect(memoColorName(MemoColor.UNSPECIFIED)).toBeUndefined();
    expect(memoColorName(999 as MemoColor)).toBeUndefined();
  });

  it("maps a selected palette entry to a fixed surface name", () => {
    expect(memoColorName(MemoColor.SAGE)).toBe("sage");
  });
});
