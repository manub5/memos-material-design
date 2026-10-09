import { MemoColor } from "@/types/proto/api/memo_service_pb";

/** The palette offered in the UI, paired with its translation key. */
export const MEMO_COLOR_CHOICES = [
  { color: MemoColor.LAVENDER, name: "lavender", label: "memo.colors.lavender" },
  { color: MemoColor.SAGE, name: "sage", label: "memo.colors.sage" },
  { color: MemoColor.SKY, name: "sky", label: "memo.colors.sky" },
  { color: MemoColor.AMBER, name: "amber", label: "memo.colors.amber" },
  { color: MemoColor.ROSE, name: "rose", label: "memo.colors.rose" },
  { color: MemoColor.PEACH, name: "peach", label: "memo.colors.peach" },
] as const;

/** Return a supported memo surface name, or the neutral fallback. */
export const memoColorName = (color: MemoColor): string | undefined => MEMO_COLOR_CHOICES.find((choice) => choice.color === color)?.name;
