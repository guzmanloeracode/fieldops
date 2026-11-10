"use client";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Over,
} from "@dnd-kit/core";
import type { ConflictDto, JobAssignmentInput } from "@fieldops/shared";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AssignForm, type AssignMember } from "@/components/app/assign-form";
import { ConflictPanel, conflictsOf } from "@/components/app/conflict-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { boardAssignAction, previewConflictsAction } from "./actions";
import type { BoardJob, BoardProps } from "./board-data";
import { BlockCard } from "./block";
import { DayView } from "./day-view";
import { STEP_MIN, STEP_PX, firstFreeStart, hhmm, moveAssignees, PX_PER_MIN, snap, toIso } from "./geometry";
import { QueuePanel } from "./queue";
import { WeekView } from "./week-view";

export type DragData =
  | { type: "job"; jobId: string; laneId: string }
  | { type: "queue"; jobId: string }
  | { type: "resize"; jobId: string; laneId: string };
type DropData =
  | { type: "lane"; laneId: string; date: string }
  | { type: "cell"; laneId: string; date: string }
  | { type: "queue" };

/** Where a drag would land: a lane, a day and a time, or the queue. */
type Target =
  | { kind: "slot"; laneId: string; date: string; startMin: number; endMin: number }
  | { kind: "resize"; laneId: string; date: string; startMin: number; endMin: number }
  | { kind: "queue" };

const timeLabel = (job: Pick<BoardJob, "startMin" | "endMin">) => `${hhmm(job.startMin)}–${hhmm(job.endMin)}`;

interface Change {
  job: BoardJob;
  input: JobAssignmentInput;
  next: BoardJob | null;
  message: string;
}

export function DispatchBoard(props: BoardProps & { members: AssignMember[] }) {
  const t = useTranslations("dispatch");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [jobs, setJobs] = useState(props.jobs);
  const [queue, setQueue] = useState(props.queue);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<DragData | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [preview, setPreview] = useState<{ key: string; conflicts: ConflictDto[] | null } | null>(null);
  const [details, setDetails] = useState<BoardJob | null>(null);
  const [conflict, setConflict] = useState<(Change & { conflicts: ConflictDto[] }) | null>(null);
  const [reason, setReason] = useState("");
  const previewKey = useRef("");

  // Server data wins after every refresh.
  useEffect(() => {
    setJobs(props.jobs);
    setQueue(props.queue);
  }, [props.jobs, props.queue]);

  const laneById = useMemo(() => new Map(props.lanes.map((l) => [l.id, l])), [props.lanes]);
  const findJob = useCallback(
    (id: string) => jobs.find((j) => j.id === id) ?? queue.find((j) => j.id === id) ?? null,
    [jobs, queue],
  );

  // ---------------------------------------------------------------- where a drag lands
  const targetOf = useCallback(
    (a: Active, over: Over | null, deltaX: number): Target | null => {
      const data = a.data.current as DragData | undefined;
      if (!data) return null;
      const job = findJob(data.jobId);
      if (!job) return null;
      if (data.type === "resize") {
        const end = Math.max(job.startMin + STEP_MIN, job.endMin + snap(deltaX / PX_PER_MIN));
        return { kind: "resize", laneId: data.laneId, date: job.date!, startMin: job.startMin, endMin: end };
      }
      const drop = over?.data.current as DropData | undefined;
      if (!drop) return null;
      if (drop.type === "queue") return data.type === "job" ? { kind: "queue" } : null;
      const duration = job.durationMin;
      if (drop.type === "cell") {
        const lane = laneById.get(drop.laneId);
        if (!lane) return null;
        const start = data.type === "job" ? job.startMin : firstFreeStart(lane, drop.date, jobs, duration);
        return {
          kind: "slot",
          laneId: drop.laneId,
          date: drop.date,
          startMin: start,
          endMin: start + duration,
        };
      }
      // Day view: the left edge of the dragged block on the lane's time axis.
      const laneEl = document.getElementById(`lane-${drop.laneId}`);
      const rect = a.rect.current.translated;
      if (!laneEl || !rect) return null;
      const from = Number(laneEl.dataset.from ?? 0);
      const raw = from + (rect.left - laneEl.getBoundingClientRect().left) / PX_PER_MIN;
      const start = Math.max(0, Math.min(24 * 60 - STEP_MIN, snap(raw)));
      return {
        kind: "slot",
        laneId: drop.laneId,
        date: drop.date,
        startMin: start,
        endMin: start + duration,
      };
    },
    [findJob, jobs, laneById],
  );

  const changeFor = useCallback(
    (data: DragData, to: Target): Change | null => {
      const job = findJob(data.jobId);
      if (!job) return null;
      if (to.kind === "queue") {
        if (job.status !== "scheduled") {
          toast.error(t("save.cantUnschedule"));
          return null;
        }
        return {
          job,
          input: { member_ids: [], lead_member_id: null, scheduled_start: null, scheduled_end: null },
          next: null,
          message: t("save.unscheduled", { job: job.number }),
        };
      }
      const lane = laneById.get(to.laneId);
      if (!lane) return null;
      const assignees =
        data.type === "queue"
          ? [{ memberId: lane.id, name: lane.name, isLead: true }]
          : data.type === "job"
            ? moveAssignees(job.assignees, data.laneId, lane)
            : job.assignees;
      if (
        data.type !== "queue" &&
        to.date === job.date &&
        to.startMin === job.startMin &&
        to.endMin === job.endMin &&
        assignees.every((a, i) => a.memberId === job.assignees[i]?.memberId)
      ) {
        return null;
      }
      const next: BoardJob = {
        ...job,
        date: to.date,
        startMin: to.startMin,
        endMin: to.endMin,
        durationMin: to.endMin - to.startMin,
        assignees,
        status: job.status === "new" ? "scheduled" : job.status,
      };
      const time = timeLabel(next);
      const message =
        data.type === "resize"
          ? t("save.resized", { job: job.number, time: hhmm(to.endMin) })
          : data.type === "queue"
            ? t("save.scheduled", { job: job.number, name: lane.name, time })
            : t("save.moved", { job: job.number, name: lane.name, time });
      return {
        job,
        next,
        message,
        input: {
          member_ids: assignees.map((a) => a.memberId),
          lead_member_id: assignees.find((a) => a.isLead)?.memberId ?? assignees[0]?.memberId ?? null,
          scheduled_start: toIso(to.date, to.startMin, props.timeZone),
          scheduled_end: toIso(to.date, to.endMin, props.timeZone),
        },
      };
    },
    [findJob, laneById, props.timeZone, t],
  );

  // ---------------------------------------------------------------- saving (optimistic)
  const apply = (c: Change) => {
    setQueue((q) => (c.next ? q.filter((j) => j.id !== c.job.id) : q));
    setJobs((js) =>
      c.next ? [...js.filter((j) => j.id !== c.job.id), c.next] : js.filter((j) => j.id !== c.job.id),
    );
    if (!c.next) setQueue((q) => [{ ...c.job, date: null, assignees: [], status: "new" }, ...q]);
  };
  const rollback = () => {
    setJobs(props.jobs);
    setQueue(props.queue);
  };
  const mark = (id: string, on: boolean) =>
    setSaving((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const send = (c: Change, override?: string) => {
    mark(c.job.id, true);
    startTransition(async () => {
      const result = await boardAssignAction(c.job.id, {
        ...c.input,
        ...(override ? { override_reason: override } : {}),
      });
      mark(c.job.id, false);
      if (result.ok) {
        toast.success(c.message);
        setConflict(null);
        setReason("");
        router.refresh();
        return;
      }
      const conflicts = conflictsOf(result.error);
      if (conflicts && !override) {
        setReason("");
        setConflict({ ...c, conflicts });
        return;
      }
      rollback();
      setConflict(null);
      toast.error(result.error.fields?.[0]?.message ?? result.error.message ?? t("save.failed"));
    });
  };

  const commit = (c: Change) => {
    apply(c);
    send(c);
  };

  // ---------------------------------------------------------------- live conflict preview while dragging
  useEffect(() => {
    if (!active || !target || target.kind === "queue" || active.type === "resize") return;
    const c = changeFor(active, target);
    if (!c) return;
    const key = JSON.stringify(c.input);
    if (key === previewKey.current) return;
    previewKey.current = key;
    setPreview({ key, conflicts: null });
    const handle = setTimeout(async () => {
      const r = await previewConflictsAction(c.job.id, c.input);
      if (previewKey.current === key) setPreview({ key, conflicts: r.ok ? r.data : [] });
    }, 250);
    return () => clearTimeout(handle);
  }, [active, target, changeFor]);

  // ---------------------------------------------------------------- dnd-kit wiring
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates(props.view),
      // Enter is kept for the details dialog; Space picks up, Space or Enter drops.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter", "Tab"] },
    }),
  );

  /**
   * Pointer drags hit the droppable under the pointer. Keyboard drags have no pointer, so they hit the one
   * under the dragged item's top-left corner: a wide queue card dropped into a week cell lands in that cell.
   */
  const collision: CollisionDetection = (args) => {
    const data = args.active.data.current as DragData | undefined;
    if (data?.type === "resize") return [];
    const allowed = args.droppableContainers.filter(
      (c) => (c.data.current as DropData | undefined)?.type !== "queue" || data?.type === "job",
    );
    if (args.pointerCoordinates) return pointerWithin({ ...args, droppableContainers: allowed });
    const x = args.collisionRect.left + 8;
    const y = args.collisionRect.top + 8;
    return allowed
      .filter((c) => {
        const r = args.droppableRects.get(c.id);
        return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      })
      .map((c) => ({ id: c.id, data: { droppableContainer: c, value: 0 } }));
  };

  const describeTarget = (over: Over | null) => {
    const d = over?.data.current as DropData | undefined;
    if (!d) return null;
    if (d.type === "queue") return t("dnd.queue");
    const lane = laneById.get(d.laneId);
    return lane ? (props.view === "week" ? `${lane.name}, ${d.date}` : lane.name) : null;
  };
  const jobLabel = (id: string | number) => {
    const data = String(id).split(":");
    return findJob(data[1] ?? "")?.number ?? "";
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => t("dnd.start", { job: jobLabel(a.id) }),
    onDragOver: ({ active: a, over }) => {
      const where = describeTarget(over);
      return where
        ? t("dnd.over", { job: jobLabel(a.id), target: where })
        : t("dnd.overNothing", { job: jobLabel(a.id) });
    },
    onDragEnd: ({ active: a, over }) => {
      const where = describeTarget(over);
      return where
        ? t("dnd.drop", { job: jobLabel(a.id), target: where })
        : t("dnd.cancel", { job: jobLabel(a.id) });
    },
    onDragCancel: ({ active: a }) => t("dnd.cancel", { job: jobLabel(a.id) }),
  };

  const onDragStart = (e: DragStartEvent) => {
    setActive(e.active.data.current as DragData);
    setTarget(null);
    setPreview(null);
    previewKey.current = "";
  };
  const onDragMove = (e: DragMoveEvent) => {
    const next = targetOf(e.active, e.over, e.delta.x);
    setTarget((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };
  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as DragData | undefined;
    const to = targetOf(e.active, e.over, e.delta.x);
    setActive(null);
    setTarget(null);
    setPreview(null);
    previewKey.current = "";
    if (!data || !to) return;
    const c = changeFor(data, to);
    if (c) commit(c);
  };
  const onDragCancel = () => {
    setActive(null);
    setTarget(null);
    setPreview(null);
  };

  /** Shift+←/→ on a focused block: the keyboard equivalent of the resize handle. */
  const resizeBy = (jobId: string, laneId: string, minutes: number) => {
    const job = findJob(jobId);
    if (!job?.date) return;
    const end = Math.max(job.startMin + STEP_MIN, job.endMin + minutes);
    const c = changeFor(
      { type: "resize", jobId, laneId },
      {
        kind: "resize",
        laneId,
        date: job.date,
        startMin: job.startMin,
        endMin: end,
      },
    );
    if (c) commit(c);
  };

  const activeJob = active ? findJob(active.jobId) : null;
  const resizing = active?.type === "resize" && target?.kind === "resize" ? target : null;
  const shared = {
    lanes: props.lanes,
    jobs,
    timeZone: props.timeZone,
    today: props.today,
    saving,
    activeId: active && active.type !== "resize" ? active.jobId : null,
    resizing: resizing && active?.type === "resize" ? { jobId: active.jobId, endMin: resizing.endMin } : null,
    onOpen: (job: BoardJob) => setDetails(job),
    onResize: resizeBy,
  };

  return (
    <DndContext
      id="dispatch-board"
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("dnd.instructions") } }}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <section aria-label={t("title")} className="min-w-0 flex-1">
          {props.lanes.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
              {t("lane.noLanes")}
            </p>
          ) : props.view === "day" ? (
            <DayView {...shared} date={props.date} />
          ) : (
            <WeekView {...shared} dates={props.dates} />
          )}
        </section>
        <QueuePanel
          jobs={queue}
          saving={saving}
          activeId={active?.type === "queue" ? active.jobId : null}
          acceptsDrop={active?.type === "job"}
          onOpen={(job) => setDetails(job)}
        />
      </div>

      <DragOverlay dropAnimation={null}>
        {activeJob && active && active.type !== "resize" ? (
          <div className="pointer-events-none space-y-1">
            <BlockCard
              job={activeJob}
              compact={props.view === "week" || active.type === "queue"}
              overlay
              width={
                props.view === "day" ? Math.max(activeJob.durationMin, STEP_MIN) * PX_PER_MIN : undefined
              }
            />
            {target?.kind === "slot" ? (
              <div className="bg-popover text-popover-foreground flex w-max items-center gap-1.5 rounded-md border px-2 py-1 text-xs shadow">
                <span className="font-medium">{laneById.get(target.laneId)?.name}</span>
                <span>
                  · {props.view === "week" ? `${target.date} ` : ""}
                  {timeLabel(target)}
                </span>
                {preview?.conflicts === null || !preview ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : preview.conflicts.length ? (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="size-3" aria-hidden />
                    {t("preview.count", { count: preview.conflicts.length })}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="size-3" aria-hidden /> {t("preview.clear")}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </DragOverlay>

      <Dialog
        open={Boolean(conflict)}
        onOpenChange={(open) => {
          if (!open) {
            rollback();
            setConflict(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {conflict
                ? t(conflict.job.status === "new" ? "dialog.scheduleTitle" : "dialog.title", {
                    job: conflict.job.number,
                  })
                : null}
            </DialogTitle>
            <DialogDescription>{conflict?.message}</DialogDescription>
          </DialogHeader>
          {conflict ? (
            <ConflictPanel
              conflicts={conflict.conflicts}
              reason={reason}
              onReasonChange={setReason}
              idPrefix="board"
            />
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                rollback();
                setConflict(null);
              }}
            >
              {t("conflicts.cancel")}
            </Button>
            <Button
              disabled={!reason.trim() || (conflict ? saving.has(conflict.job.id) : false)}
              onClick={() => conflict && send(conflict, reason.trim())}
              data-testid="board-override-save"
            >
              {conflict && saving.has(conflict.job.id) ? <Loader2 className="animate-spin" /> : null}
              {t("conflicts.saveAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(details)} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{details ? t("dialog.title", { job: details.number }) : null}</DialogTitle>
            <DialogDescription>
              {details ? `${details.title} · ${details.customer}. ` : null}
              {t("dialog.description", { timeZone: props.timeZone })}
            </DialogDescription>
          </DialogHeader>
          {details ? (
            <AssignForm
              key={details.id}
              idPrefix="board-dialog"
              timeZone={props.timeZone}
              members={props.members}
              memberIds={details.assignees.map((a) => a.memberId)}
              leadId={details.assignees.find((a) => a.isLead)?.memberId ?? null}
              start={details.date ? toIso(details.date, details.startMin, props.timeZone) : null}
              end={details.date ? toIso(details.date, details.endMin, props.timeZone) : null}
              estimatedDurationMin={details.durationMin}
              onSubmit={(input) => boardAssignAction(details.id, input)}
              onSaved={() => {
                toast.success(t("save.saved", { job: details.number }));
                setDetails(null);
                router.refresh();
              }}
              onCancel={() => setDetails(null)}
              footerStart={
                <Button asChild variant="link" className="px-0">
                  <Link href={`/jobs/${details.number}`}>{t("dialog.openJob")}</Link>
                </Button>
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}

/**
 * Arrow keys while dragging with the keyboard (SCH-02). Day view: ←/→ move by 15 minutes, ↑/↓ to the
 * neighbouring lane. Week view: ←/→ to the neighbouring day, ↑/↓ to the neighbouring technician. A job
 * picked up from the queue first jumps onto the first lane.
 */
function keyboardCoordinates(view: "day" | "week"): KeyboardCoordinateGetter {
  return (event, { currentCoordinates, context }) => {
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const dir = dirs[event.code];
    if (!dir) return undefined;
    event.preventDefault();
    const prefix = view === "day" ? "lane:" : "cell:";
    const rects = [...context.droppableRects.entries()]
      .filter(([id]) => String(id).startsWith(prefix))
      .map(([id, rect]) => ({ id: String(id), rect }));
    if (!rects.length) return undefined;
    const overId = context.over ? String(context.over.id) : null;
    const current = rects.find((r) => r.id === overId);
    const pad = 4;
    if (!current) {
      const first = [...rects].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]!;
      // Land at 08:00 on the first lane (day view) or in the first cell (week view).
      const from = Number(document.getElementById(first.id.replace("lane:", "lane-"))?.dataset.from ?? 360);
      const x =
        view === "day" ? first.rect.left + Math.max(0, 8 * 60 - from) * PX_PER_MIN : first.rect.left + pad;
      return { x, y: first.rect.top + pad };
    }
    if (view === "day") {
      if (dir[0]) return { x: currentCoordinates.x + dir[0] * STEP_PX, y: currentCoordinates.y };
      const lanes = [...rects].sort((a, b) => a.rect.top - b.rect.top);
      const i = lanes.findIndex((l) => l.id === current.id);
      const next = lanes[i + dir[1]];
      if (!next) return currentCoordinates;
      return { x: currentCoordinates.x, y: next.rect.top + pad };
    }
    const [, laneId, date] = current.id.split(":");
    const sameLane = rects
      .filter((r) => r.id.split(":")[1] === laneId)
      .sort((a, b) => a.rect.left - b.rect.left);
    const sameDay = rects.filter((r) => r.id.split(":")[2] === date).sort((a, b) => a.rect.top - b.rect.top);
    const list = dir[0] ? sameLane : sameDay;
    const i = list.findIndex((r) => r.id === current.id);
    const next = list[i + (dir[0] || dir[1])];
    if (!next) return currentCoordinates;
    return { x: next.rect.left + pad, y: next.rect.top + pad };
  };
}
