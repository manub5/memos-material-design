import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import MemoView from "@/components/MemoView";
import type { MemoViewHandle } from "@/components/MemoView/types";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";
import { User_Role } from "@/types/proto/api/user_service_pb";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userTagsSetting: { tags: [] } }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/owner", role: User_Role.ADMIN }) }));
vi.mock("@/components/MemoContent/MentionResolutionContext", () => ({ useResolvedUser: () => undefined }));
vi.mock("@/components/MemoView/components", () => ({
  MemoHeader: () => <div>header</div>,
  MemoBody: () => <p>content</p>,
  MemoCommentListView: () => null,
}));
vi.mock("@/components/MemoView/hooks", () => ({
  useImagePreview: () => ({ previewState: { items: [], open: false }, openPreview: vi.fn(), setPreviewOpen: vi.fn() }),
}));
vi.mock("@/components/MemoEditor/loader", () => ({
  loadMemoEditor: async () => ({
    default: ({ onCancel }: { onCancel: () => void }) => (
      <div>
        <input aria-label="inline draft" />
        <button type="button" onClick={onCancel}>
          close
        </button>
      </div>
    ),
  }),
}));

describe("MemoView reorder handle", () => {
  it("shows the supplied handle only while the owner's card is not editing", async () => {
    const ref = createRef<MemoViewHandle>();
    render(
      <MemoryRouter>
        <MemoView
          ref={ref}
          memo={create(MemoSchema, { name: "memos/a", creator: "users/owner" })}
          dragHandle={<button type="button">reorder</button>}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "reorder" })).toBeInTheDocument();
    ref.current?.openEditor();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "inline draft" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "reorder" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.getByRole("button", { name: "reorder" })).toBeInTheDocument();
  });

  it("hides the handle on another author's card even for an administrator", () => {
    render(
      <MemoryRouter>
        <MemoView
          memo={create(MemoSchema, { name: "memos/a", creator: "users/other" })}
          dragHandle={<button type="button">reorder</button>}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "reorder" })).not.toBeInTheDocument();
  });
});
