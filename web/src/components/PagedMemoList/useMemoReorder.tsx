import { useDirection } from "@base-ui/react/direction-provider";
import { GripVerticalIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { useMoveMemo } from "@/hooks/useMemoQueries";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { type MemoReorderTarget, memoInsertionIndex, memoMoveAnchors } from "./memoReorderGeometry";

interface Gesture {
  name: string;
  pointerId: number;
  handle: HTMLButtonElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  scrollX: number;
  scrollY: number;
  targets: MemoReorderTarget[];
  names: string[];
  destination: number;
  active: boolean;
  cleanup: () => void;
}

export function useMemoReorder({
  memos,
  enabled,
  containerRef,
  scope,
  refetch,
}: {
  memos: Memo[];
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  scope: string;
  refetch: () => Promise<{ isError?: boolean }>;
}) {
  const t = useTranslate();
  const direction = useDirection();
  const statusId = useId();
  const mutation = useMoveMemo();
  const gesture = useRef<Gesture | null>(null);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ names: string[]; name: string; position: number } | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  // Includes document/content changes, not just names: SSE and newly fetched pages
  // must not leave a gesture with stale geometry or neighbors. Protobuf timestamps
  // contain bigint seconds, so use a bigint-safe serialization.
  const revision = JSON.stringify(memos, (_key, value) => (typeof value === "bigint" ? String(value) : value));

  const stop = useCallback((clearPreview = true) => {
    const current = gesture.current;
    gesture.current = null;
    current?.cleanup();
    if (mounted.current) {
      setActiveName(null);
      if (clearPreview) setPreview(null);
    }
  }, []);

  useLayoutEffect(() => {
    stop();
  }, [revision, enabled, scope, direction, stop]);

  useLayoutEffect(() => {
    // Moving the captured node in the DOM can clear native capture even though
    // React retained its identity. Re-establish it after preview reconciliation.
    const current = gesture.current;
    if (current && !current.handle.hasPointerCapture(current.pointerId)) {
      current.handle.setPointerCapture(current.pointerId);
    }
  }, [preview]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);

  const save = async (current: Gesture) => {
    savingRef.current = true;
    setSaving(true);
    let saved = false;
    try {
      await mutation.mutateAsync(memoMoveAnchors(current.names, current.name, current.destination));
      saved = true;
      // Keep the preview until the authoritative pages are available. The mutation
      // also invalidates lists; awaiting this refresh bounds the disabled state.
      const result = await refetch();
      if (result.isError && mounted.current) toast.error(t("search.load-error"));
    } catch {
      if (mounted.current) {
        setPreview(null);
        toast.error(t(saved ? "search.load-error" : "memo.reorder-error"));
      }
      if (!saved) await refetch().catch(() => undefined);
    } finally {
      savingRef.current = false;
      if (mounted.current) {
        setPreview(null);
        setSaving(false);
      }
    }
  };

  const start = (event: ReactPointerEvent<HTMLButtonElement>, name: string) => {
    if (!enabled || savingRef.current || mutation.isPending || gesture.current || event.button !== 0 || event.isPrimary === false) return;
    const container = containerRef.current;
    if (!container || memos.length < 2) return;
    const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-memo-reorder-item]"));
    const targets = elements
      .map((element) => ({ name: element.dataset.memoReorderItem!, rect: element.getBoundingClientRect() }))
      .filter((target) => target.name !== name && target.rect.width > 0 && target.rect.height > 0);
    if (targets.length !== memos.length - 1) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let frame: number | null = null;
    const current: Gesture = {
      name,
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      targets,
      names: memos.map((memo) => memo.name),
      destination: memos.findIndex((memo) => memo.name === name),
      active: false,
      cleanup: () => {},
    };
    gesture.current = current;

    const update = () => {
      if (!current.active) return;
      const destination = memoInsertionIndex(
        current.targets,
        current.x + window.scrollX - current.scrollX,
        current.y + window.scrollY - current.scrollY,
        direction === "rtl",
      );
      current.destination = destination;
      const names = current.names.filter((value) => value !== name);
      names.splice(destination, 0, name);
      setPreview((previous) =>
        previous?.position === destination && previous.name === name ? previous : { names, name, position: destination },
      );
    };
    const tick = () => {
      frame = null;
      if (gesture.current !== current || !current.active) return;
      const edge = 64;
      const delta =
        current.y < edge
          ? -Math.min(18, (edge - current.y) / 4)
          : current.y > window.innerHeight - edge
            ? Math.min(18, (current.y - window.innerHeight + edge) / 4)
            : 0;
      if (delta) window.scrollBy(0, delta);
      update();
      frame = requestAnimationFrame(tick);
    };
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== current.pointerId) return;
      current.x = pointer.clientX;
      current.y = pointer.clientY;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 8) {
        current.active = true;
        setActiveName(name);
        frame = requestAnimationFrame(tick);
      }
      if (current.active) {
        pointer.preventDefault();
        update();
      }
    };
    const cancel = () => stop();
    const pointerCancel = (pointer: PointerEvent) => {
      if (pointer.pointerId === current.pointerId) cancel();
    };
    const keydown = (key: KeyboardEvent) => {
      if (key.key === "Escape") {
        key.preventDefault();
        cancel();
      }
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== current.pointerId) return;
      const changed = current.active && current.destination !== current.names.indexOf(name);
      stop(!changed);
      if (changed) void save(current);
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", pointerCancel);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", cancel);
    window.addEventListener("blur", cancel);
    handle.addEventListener("lostpointercapture", cancel);
    // Our preview changes container height deliberately, but any card's size
    // change (images, editor, comments) invalidates the snapshot geometry.
    const width = container.clientWidth;
    const sizes = elements.map((element) => ({ element, rect: element.getBoundingClientRect() }));
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (
              container.clientWidth !== width ||
              sizes.some(({ element, rect }) => {
                const next = element.getBoundingClientRect();
                return next.width !== rect.width || next.height !== rect.height;
              })
            )
              cancel();
          });
    observer?.observe(container);
    for (const element of elements) observer?.observe(element);
    current.cleanup = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", pointerCancel);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("blur", cancel);
      handle.removeEventListener("lostpointercapture", cancel);
      if (handle.hasPointerCapture(current.pointerId)) handle.releasePointerCapture(current.pointerId);
    };
  };

  const byName = new Map(memos.map((memo) => [memo.name, memo]));
  const items = preview ? preview.names.flatMap((name) => (byName.has(name) ? [byName.get(name)!] : [])) : memos;
  const dragHandle = (memo: Memo) =>
    enabled ? (
      <button
        type="button"
        aria-label={t("memo.reorder")}
        aria-description={t("memo.reorder-position", { position: items.indexOf(memo) + 1, total: items.length })}
        aria-describedby={activeName === memo.name ? statusId : undefined}
        aria-pressed={activeName === memo.name}
        disabled={saving || mutation.isPending || memos.length < 2}
        className="inline-flex size-10 shrink-0 touch-none select-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => start(event, memo.name)}
      >
        <GripVerticalIcon className="size-4" aria-hidden="true" />
      </button>
    ) : undefined;

  return {
    items,
    dragHandle,
    destinationName: activeName && preview ? preview.name : null,
    status: enabled ? (
      <div id={statusId} role="status" aria-live="polite" className="sr-only">
        {activeName && preview
          ? `${t("memo.reorder-active")} ${t("memo.reorder-position", { position: preview.position + 1, total: items.length })}`
          : ""}
      </div>
    ) : null,
  };
}
