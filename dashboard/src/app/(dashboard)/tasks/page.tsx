"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Bug,
  Sparkles,
  ClipboardList,
  Plus,
  Trash2,
  X,
  Flag,
  Link as LinkIcon,
  User,
  FileDown,
  Download,
} from "lucide-react";
import {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  type Task,
  type TaskStatus,
  type TaskType,
  type TaskPriority,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COLUMNS: { key: TaskStatus; label: string; tone: string }[] = [
  { key: "OPEN", label: "Open", tone: "border-slate-500/40" },
  { key: "IN_PROGRESS", label: "In behandeling", tone: "border-blue-500/60" },
  { key: "BLOCKED", label: "Geblokkeerd", tone: "border-amber-500/60" },
  { key: "DONE", label: "Afgerond", tone: "border-emerald-500/60" },
];

const TYPE_ICON: Record<TaskType, typeof Bug> = {
  BUG: Bug,
  FEATURE: Sparkles,
  TASK: ClipboardList,
};

const TYPE_COLOR: Record<TaskType, string> = {
  BUG: "text-red-400 bg-red-500/10",
  FEATURE: "text-violet-400 bg-violet-500/10",
  TASK: "text-slate-300 bg-slate-500/10",
};

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  LOW: "text-slate-400",
  MEDIUM: "text-blue-400",
  HIGH: "text-orange-400",
  CRITICAL: "text-red-500",
};

const TYPE_LABEL: Record<TaskType, string> = {
  BUG: "Bug",
  FEATURE: "Feature request",
  TASK: "Taak",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In behandeling",
  BLOCKED: "Geblokkeerd",
  DONE: "Afgerond",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Laag",
  MEDIUM: "Normaal",
  HIGH: "Hoog",
  CRITICAL: "Kritiek",
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "taak";
}

function taskToMarkdown(task: Task): string {
  const created = new Date(task.createdAt).toISOString().slice(0, 10);
  const updated = new Date(task.updatedAt).toISOString().slice(0, 10);
  const labels = task.labels.length ? task.labels.map((l) => `\`${l}\``).join(", ") : "_(geen)_";
  const description = (task.description ?? "").trim() || "_(geen omschrijving toegevoegd)_";
  const isBug = task.type === "BUG";

  const lines = [
    `# [${TYPE_LABEL[task.type]}] ${task.title}`,
    "",
    "## Metadata",
    "",
    `- **Task ID:** #${task.id}`,
    `- **Type:** ${TYPE_LABEL[task.type]}`,
    `- **Status:** ${STATUS_LABEL[task.status]}`,
    `- **Prioriteit:** ${PRIORITY_LABEL[task.priority]}`,
    `- **Assignee:** ${task.assignee ?? "_(niet toegewezen)_"}`,
    `- **Reporter:** ${task.reporter ?? "_(onbekend)_"}`,
    `- **Labels:** ${labels}`,
    `- **Gerelateerde URL / pad:** ${task.relatedUrl ? `\`${task.relatedUrl}\`` : "_(geen)_"}`,
    `- **Aangemaakt:** ${created}`,
    `- **Laatst gewijzigd:** ${updated}`,
    "",
    "## Omschrijving",
    "",
    description,
    "",
    "## Fix-plan voor Claude Code",
    "",
    "> Plak dit bestand in Claude Code en vraag om het probleem te fixen. Vul onderstaande punten waar mogelijk aan voordat je start.",
    "",
    isBug ? "### Reproductiestappen" : "### Context",
    "",
    isBug
      ? "1. ...\n2. ...\n3. ..."
      : "Beschrijf het doel en de scope van deze wijziging.",
    "",
    isBug ? "### Verwacht gedrag" : "### Gewenst resultaat",
    "",
    "_(beschrijven)_",
    "",
    isBug ? "### Daadwerkelijk gedrag" : "### Acceptatiecriteria",
    "",
    isBug ? "_(beschrijven)_" : "- [ ] ...\n- [ ] ...",
    "",
    "### Vermoedelijke oorzaak / aanpak",
    "",
    "_(optioneel — eerste hypothese)_",
    "",
    "### Te wijzigen bestanden",
    "",
    "- `path/naar/bestand.ts` — _(reden)_",
    "",
    "### Verificatie",
    "",
    "- [ ] `npm run build` slaagt",
    "- [ ] `npm test` slaagt",
    "- [ ] Handmatig getest in de UI",
    "",
  ];

  return lines.join("\n");
}

function downloadFile(filename: string, content: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadTaskMarkdown(task: Task) {
  const filename = `task-${task.id}-${slugify(task.title)}.md`;
  downloadFile(filename, taskToMarkdown(task));
}

function downloadAllTasksMarkdown(tasks: Task[]) {
  if (tasks.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const header = [
    `# Taken export — ${today}`,
    "",
    `Totaal: **${tasks.length}** taken`,
    "",
    "---",
    "",
  ].join("\n");
  const body = tasks.map(taskToMarkdown).join("\n\n---\n\n");
  downloadFile(`taken-export-${today}.md`, header + body);
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<TaskType | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getTasks({ limit: 500 });
      setTasks(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filterType !== "ALL" && t.type !== filterType) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${t.title} ${t.description ?? ""} ${t.assignee ?? ""} ${t.labels.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, filterType, search]);

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { OPEN: [], IN_PROGRESS: [], BLOCKED: [], DONE: [] };
    for (const t of filtered) map[t.status].push(t);
    // Priority order for within-column sort
    const prioRank: Record<TaskPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    for (const col of Object.keys(map) as TaskStatus[]) {
      map[col].sort((a, b) => prioRank[a.priority] - prioRank[b.priority]);
    }
    return map;
  }, [filtered]);

  async function handleDropTo(status: TaskStatus) {
    if (dragId == null) return;
    const target = tasks.find((t) => t.id === dragId);
    setDragId(null);
    if (!target || target.status === status) return;
    // Optimistic
    setTasks((prev) => prev.map((t) => (t.id === dragId ? { ...t, status } : t)));
    try {
      await updateTask(dragId, { status });
    } catch (e) {
      // Rollback on error
      setTasks((prev) => prev.map((t) => (t.id === dragId ? { ...t, status: target.status } : t)));
      setError(e instanceof Error ? e.message : "Verplaatsen mislukt");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Taak verwijderen?")) return;
    const prev = tasks;
    setTasks((cur) => cur.filter((t) => t.id !== id));
    try {
      await deleteTask(id);
    } catch (e) {
      setTasks(prev);
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Taken & Bugs</h1>
          <p className="text-muted-foreground mt-1">
            Kanban board voor bugs, feature requests en taken — sleep een kaart naar een andere kolom om status te wijzigen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadAllTasksMarkdown(filtered)}
            disabled={filtered.length === 0}
            className="gap-2"
            title="Genereer één .md met alle (gefilterde) taken"
          >
            <FileDown className="h-4 w-4" /> Alle taken als .md
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Nieuwe taak
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Zoeken in titel, omschrijving, assignee, labels..."
          className="flex-1 min-w-[250px] rounded-md border bg-background px-3 py-2 text-sm"
        />
        {(["ALL", "BUG", "FEATURE", "TASK"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={cn(
              "rounded-md border px-3 py-2 text-sm transition",
              filterType === t ? "border-primary bg-primary/10" : "hover:bg-accent"
            )}
          >
            {t === "ALL" ? "Alle" : t === "BUG" ? "Bugs" : t === "FEATURE" ? "Features" : "Taken"}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Laden...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDropTo(col.key)}
              className={cn(
                "flex flex-col rounded-lg border-t-2 bg-card/40 min-h-[400px]",
                col.tone
              )}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="font-semibold">{col.label}</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {byStatus[col.key].length}
                </span>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {byStatus[col.key].map((task) => {
                  const Icon = TYPE_ICON[task.type];
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setEditTask(task)}
                      className={cn(
                        "group cursor-grab rounded-md border bg-card p-3 text-sm transition hover:border-primary/60 active:cursor-grabbing",
                        dragId === task.id && "opacity-50"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn("rounded p-1", TYPE_COLOR[task.type])}>
                            <Icon className="h-3 w-3" />
                          </span>
                          <span className="text-xs text-muted-foreground">#{task.id}</span>
                        </div>
                        <Flag className={cn("h-3 w-3", PRIORITY_COLOR[task.priority])} />
                      </div>
                      <p className="mt-2 font-medium line-clamp-2">{task.title}</p>
                      {task.labels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {task.labels.map((l) => (
                            <span key={l} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                              {l}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-2 min-w-0 truncate">
                          {task.assignee && (
                            <span className="flex items-center gap-1 truncate">
                              <User className="h-3 w-3" /> {task.assignee}
                            </span>
                          )}
                          {task.relatedUrl && <LinkIcon className="h-3 w-3 shrink-0" />}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadTaskMarkdown(task);
                            }}
                            className="opacity-0 group-hover:opacity-100 hover:text-primary"
                            aria-label="Download taak als .md"
                            title="Download als .md voor Claude Code"
                          >
                            <Download className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(task.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 hover:text-destructive"
                            aria-label="Verwijder taak"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {byStatus[col.key].length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">Geen taken</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <TaskDialog
          onClose={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      )}
      {editTask && (
        <TaskDialog
          task={editTask}
          onClose={() => setEditTask(null)}
          onSaved={async () => {
            setEditTask(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function TaskDialog({
  task,
  onClose,
  onSaved,
}: {
  task?: Task;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const isEdit = !!task;
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [type, setType] = useState<TaskType>(task?.type ?? "TASK");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "OPEN");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "MEDIUM");
  const [assignee, setAssignee] = useState(task?.assignee ?? "");
  const [labels, setLabels] = useState((task?.labels ?? []).join(", "));
  const [relatedUrl, setRelatedUrl] = useState(task?.relatedUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        status,
        priority,
        assignee: assignee.trim() || undefined,
        labels: labels.split(",").map((l) => l.trim()).filter(Boolean),
        relatedUrl: relatedUrl.trim() || undefined,
      };
      if (isEdit && task) {
        await updateTask(task.id, {
          ...payload,
          description: payload.description ?? null,
          assignee: payload.assignee ?? null,
          relatedUrl: payload.relatedUrl ?? null,
        });
      } else {
        await createTask(payload);
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Opslaan mislukt");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-lg border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? `Taak #${task!.id} bewerken` : "Nieuwe taak"}</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Sluiten">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium">Titel *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-medium">Omschrijving</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as TaskType)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="BUG">Bug</option>
                <option value="FEATURE">Feature request</option>
                <option value="TASK">Taak</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Prioriteit</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="LOW">Laag</option>
                <option value="MEDIUM">Normaal</option>
                <option value="HIGH">Hoog</option>
                <option value="CRITICAL">Kritiek</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In behandeling</option>
                <option value="BLOCKED">Geblokkeerd</option>
                <option value="DONE">Afgerond</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Assignee (email)</label>
              <input
                type="email"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="email@voorbeeld.nl"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium">Labels (comma-separated)</label>
            <input
              type="text"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="urgent, frontend, api"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium">Gerelateerde URL (optioneel)</label>
            <input
              type="text"
              value={relatedUrl}
              onChange={(e) => setRelatedUrl(e.target.value)}
              placeholder="/finalized, /products/123, ..."
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          {err && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {err}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <div>
              {isEdit && task && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => downloadTaskMarkdown(task)}
                  className="gap-2"
                  title="Genereer .md voor Claude Code om dit probleem te fixen"
                >
                  <Download className="h-4 w-4" /> Download .md
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Annuleren</Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Opslaan..." : isEdit ? "Opslaan" : "Aanmaken"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
