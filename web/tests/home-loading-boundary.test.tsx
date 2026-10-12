import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemoSorting } from "@/hooks/useMemoSorting";
import Home from "@/pages/Home";

vi.mock("@/hooks/useMemoSuggestions", () => ({
  useMemoSuggestions: () => [{ id: "tag:work" }],
}));

const state = vi.hoisted(() => ({
  signedIn: true,
  filters: [] as { factor: string; value: string }[],
  memoView: undefined as { name: string } | undefined,
  selectedSpaceName: undefined as string | undefined,
  creatorUsername: undefined as string | undefined,
  editorProps: undefined as Record<string, unknown> | undefined,
  listProps: undefined as Record<string, unknown> | undefined,
  memoViewProps: undefined as Record<string, unknown> | undefined,
  filterOptions: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@/components/MemoEditor", () => ({
  default: (props: Record<string, unknown>) => {
    state.editorProps = props;
    return <div data-testid="memo-editor" />;
  },
}));

vi.mock("@/components/MemoView", () => ({
  default: (props: Record<string, unknown>) => {
    state.memoViewProps = props;
    return <div data-testid="memo-view" />;
  },
}));

vi.mock("@/components/PagedMemoList", () => ({
  default: ({
    renderer,
    renderLeading,
    ...props
  }: {
    renderer: (memo: { name: string }, options: { compact: boolean; dragHandle?: React.ReactNode }) => React.ReactNode;
    renderLeading: (options: { useGrid: boolean }) => React.ReactNode;
  } & Record<string, unknown>) => {
    state.listProps = props;
    return (
      <>
        {renderLeading({ useGrid: false })}
        {renderer({ name: "memos/1" }, { compact: false, dragHandle: <button type="button">reorder</button> })}
      </>
    );
  },
  getMemoKey: (memo: { name: string }) => memo.name,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isUserSettingsInitialized: true }),
}));

vi.mock("@/contexts/GlobalMemoEditorContext", () => ({
  useGlobalMemoEditor: () => ({ claimHomeAutoFocus: () => true }),
}));

vi.mock("@/contexts/MemoFilterContext", () => ({
  useMemoFilterContext: () => ({ filters: state.filters, memoView: state.memoView }),
}));

vi.mock("@/contexts/ViewContext", () => ({
  useView: () => ({ orderByTimeAsc: false, timeBasis: "create_time" }),
}));

vi.mock("@/contexts/NewMemoContext", () => ({
  NewMemoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/SpaceContext", () => ({
  useSpaceContext: () => ({
    selectedSpaceName: state.selectedSpaceName,
    creatorUsername: state.creatorUsername,
    memoFilter:
      [
        state.selectedSpaceName && `space == "${state.selectedSpaceName}"`,
        state.creatorUsername && `creator == "users/${state.creatorUsername}"`,
      ]
        .filter(Boolean)
        .join(" && ") || undefined,
  }),
}));

vi.mock("@/hooks", () => ({
  useMemoFilters: (options: Record<string, unknown>) => {
    state.filterOptions = options;
    return "";
  },
  useMemoSorting,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  default: () => (state.signedIn ? { name: "users/steven", username: "steven" } : undefined),
}));

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string) => key,
}));

describe("<Home>", () => {
  beforeEach(() => {
    state.signedIn = true;
    state.filters = [];
    state.memoView = undefined;
    state.selectedSpaceName = undefined;
    state.creatorUsername = undefined;
    state.editorProps = undefined;
    state.listProps = undefined;
    state.memoViewProps = undefined;
    state.filterOptions = undefined;
  });
  it("requests manual order for the owner's unfiltered timeline", () => {
    state.creatorUsername = "steven";
    render(<Home />);
    expect(state.listProps?.orderBy).toBe("manual");
    expect(state.listProps?.reorderEnabled).toBe(true);
    expect(state.memoViewProps?.dragHandle).toBeDefined();
  });

  it.each(["space", "filter", "view", "other", "guest"])("keeps chronological order for a %s feed", (scope) => {
    state.creatorUsername = "steven";
    if (scope === "space") state.selectedSpaceName = "spaces/product";
    if (scope === "filter") state.filters = [{ factor: "tag", value: "work" }];
    if (scope === "view") state.memoView = { name: "memoViews/work" };
    if (scope === "other") state.creatorUsername = "alice";
    if (scope === "guest") state.signedIn = false;
    render(<Home />);
    expect(state.listProps?.orderBy).toBe("pinned desc, create_time desc");
    expect(state.listProps?.reorderEnabled).toBe(false);
  });
  it("renders the editor and memo cards synchronously without blank placeholders", () => {
    render(<Home />);

    expect(screen.getByTestId("memo-editor")).toBeInTheDocument();
    expect(screen.getByTestId("memo-view")).toBeInTheDocument();
    expect(state.listProps).toMatchObject({ contextFilter: undefined });
    expect(state.editorProps).toMatchObject({ cacheKey: "home-memo-editor", defaultSpace: undefined });
    expect(state.editorProps?.autoFocus).toEqual(expect.any(Function));
    expect(state.editorProps?.suggestions).toEqual([{ id: "tag:work" }]);
    expect(state.filterOptions).not.toHaveProperty("creatorName");
    expect(state.memoViewProps).toMatchObject({ showCreator: true });
  });

  it("shows another creator's matching memos without offering an editor", () => {
    state.creatorUsername = "alice";
    render(<Home />);
    expect(state.listProps).toMatchObject({ contextFilter: 'creator == "users/alice"' });
    expect(state.memoViewProps).toMatchObject({ showCreator: false });
    expect(screen.queryByTestId("memo-editor")).not.toBeInTheDocument();
  });

  it("filters the feed and sets new memo placement to the selected Space", () => {
    state.selectedSpaceName = "spaces/product";
    render(<Home />);

    expect(state.listProps).toMatchObject({ contextFilter: 'space == "spaces/product"' });
    expect(state.editorProps).toMatchObject({
      cacheKey: "home-memo-editor:spaces/product",
      defaultSpace: "spaces/product",
    });
  });
});
