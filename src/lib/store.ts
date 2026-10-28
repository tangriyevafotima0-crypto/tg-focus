import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  CornerPosition,
  HistoryEntry,
  NotesPosition,
  PanelId,
  RuleItem,
  Settings,
  TaskItem,
} from "@/lib/types";
import { nid, todayISO } from "@/lib/utils";

const DEFAULT_RULES: RuleItem[] = [
  { id: "r-social", text: "No social media" },
  { id: "r-deep", text: "Deep work only" },
  { id: "r-phone", text: "Phone face-down" },
  { id: "r-one", text: "One task until done" },
];

const DEFAULT_SETTINGS: Settings = {
  corner: "topRight",
  isPinned: true,
  notesVisible: false,
  lastPromptDate: null,
  morningAnswered: false,
  launchAtLogin: true,
  notesPosition: { x: 28, y: 88 },
  sessionStartedAt: null,
};

type FocusState = {
  hydrated: boolean;
  rules: RuleItem[];
  tasks: TaskItem[];
  history: HistoryEntry[];
  settings: Settings;
  showPrompt: boolean;
  openPanel: PanelId;
  menuOpen: boolean;
  setHydrated: (v: boolean) => void;
  maybeShowMorningPrompt: () => void;
  answerMorning: (yes: boolean) => void;
  reopenMorning: () => void;
  setCorner: (corner: CornerPosition) => void;
  setPinned: (pinned: boolean) => void;
  setNotesVisible: (visible: boolean) => void;
  toggleNotes: () => void;
  setNotesPosition: (pos: NotesPosition) => void;
  setLaunchAtLogin: (v: boolean) => void;
  setOpenPanel: (panel: PanelId) => void;
  setMenuOpen: (open: boolean) => void;
  addRule: (text?: string) => string;
  updateRule: (id: string, text: string) => void;
  removeRule: (id: string) => void;
  addTask: (title: string) => void;
  updateTask: (id: string, title: string) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  resetWorkspace: () => void;
};

function stampHistory(
  history: HistoryEntry[],
  kind: HistoryEntry["kind"],
  title: string,
): HistoryEntry[] {
  return [
    {
      id: nid(),
      kind,
      title,
      at: new Date().toISOString(),
    },
    ...history,
  ].slice(0, 400);
}

export const useFocusStore = create<FocusState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      rules: DEFAULT_RULES,
      tasks: [],
      history: [],
      settings: DEFAULT_SETTINGS,
      showPrompt: true,
      openPanel: null,
      menuOpen: false,
      setHydrated: (v) => set({ hydrated: v }),
      maybeShowMorningPrompt: () => {
        const { settings } = get();
        const today = todayISO();
        if (settings.lastPromptDate !== today) {
          set({
            showPrompt: true,
            openPanel: null,
            settings: {
              ...settings,
              morningAnswered: false,
            },
          });
        } else {
          set({ showPrompt: false });
        }
      },
      answerMorning: (yes) => {
        const { settings } = get();
        const now = new Date().toISOString();
        set({
          showPrompt: false,
          settings: {
            ...settings,
            lastPromptDate: todayISO(),
            morningAnswered: true,
            notesVisible: yes,
            sessionStartedAt: yes ? now : settings.sessionStartedAt ?? now,
          },
        });
      },
      reopenMorning: () => {
        const { settings } = get();
        set({
          showPrompt: true,
          openPanel: null,
          settings: {
            ...settings,
            lastPromptDate: null,
            morningAnswered: false,
          },
        });
      },
      setCorner: (corner) =>
        set({ settings: { ...get().settings, corner } }),
      setPinned: (isPinned) =>
        set({ settings: { ...get().settings, isPinned } }),
      setNotesVisible: (notesVisible) =>
        set({ settings: { ...get().settings, notesVisible } }),
      toggleNotes: () => {
        const { settings } = get();
        set({
          settings: { ...settings, notesVisible: !settings.notesVisible },
          showPrompt: false,
        });
      },
      setNotesPosition: (notesPosition) =>
        set({ settings: { ...get().settings, notesPosition } }),
      setLaunchAtLogin: (launchAtLogin) =>
        set({ settings: { ...get().settings, launchAtLogin } }),
      setOpenPanel: (openPanel) => set({ openPanel, menuOpen: false }),
      setMenuOpen: (menuOpen) => set({ menuOpen }),
      addRule: (text = "New rule") => {
        const id = nid();
        set({ rules: [...get().rules, { id, text }] });
        return id;
      },
      updateRule: (id, text) => {
        const trimmed = text.trim();
        if (!trimmed) {
          set({ rules: get().rules.filter((r) => r.id !== id) });
          return;
        }
        set({
          rules: get().rules.map((r) => (r.id === id ? { ...r, text: trimmed } : r)),
        });
      },
      removeRule: (id) => set({ rules: get().rules.filter((r) => r.id !== id) }),
      addTask: (title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        const task: TaskItem = {
          id: nid(),
          title: trimmed,
          completed: false,
          createdAt: new Date().toISOString(),
          completedAt: null,
        };
        set({ tasks: [...get().tasks, task] });
      },
      updateTask: (id, title) => {
        const trimmed = title.trim();
        if (!trimmed) {
          const task = get().tasks.find((t) => t.id === id);
          if (task) {
            set({
              tasks: get().tasks.filter((t) => t.id !== id),
              history: stampHistory(get().history, "deleted", task.title),
            });
          }
          return;
        }
        set({
          tasks: get().tasks.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
        });
      },
      toggleTask: (id) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task) return;
        const completing = !task.completed;
        set({
          tasks: get().tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  completed: completing,
                  completedAt: completing ? new Date().toISOString() : null,
                }
              : t,
          ),
          history: completing
            ? stampHistory(get().history, "completed", task.title)
            : get().history,
        });
      },
      removeTask: (id) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task) return;
        set({
          tasks: get().tasks.filter((t) => t.id !== id),
          history: stampHistory(get().history, "deleted", task.title),
        });
      },
      clearCompleted: () => {
        set({ tasks: get().tasks.filter((t) => !t.completed) });
      },
      resetWorkspace: () =>
        set({
          rules: DEFAULT_RULES,
          tasks: [],
          history: [],
          settings: { ...DEFAULT_SETTINGS },
          showPrompt: true,
          openPanel: null,
        }),
    }),
    {
      name: "focus-corner",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
      skipHydration: true,
      partialize: (s) => ({
        rules: s.rules,
        tasks: s.tasks,
        history: s.history,
        settings: s.settings,
      }),
    },
  ),
);

export function historyMarkdown(entries: HistoryEntry[]): string {
  if (entries.length === 0) {
    return "# FocusCorner History\n\n_No activity yet._\n";
  }
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const day = e.at.slice(0, 10);
    const list = groups.get(day) ?? [];
    list.push(e);
    groups.set(day, list);
  }
  const days = [...groups.keys()].sort((a, b) => (a < b ? 1 : -1));
  let out = "# FocusCorner History\n";
  for (const day of days) {
    out += `\n## ${day}\n`;
    const items = groups.get(day) ?? [];
    for (const e of items) {
      const mark = e.kind === "completed" ? "x" : "deleted";
      const stamp = e.at.replace("T", " ").slice(0, 16);
      if (e.kind === "completed") {
        out += `- [${mark}] [${stamp}] ${e.title}\n`;
      } else {
        out += `- [deleted] [${stamp}] ${e.title}\n`;
      }
    }
  }
  return out;
}
