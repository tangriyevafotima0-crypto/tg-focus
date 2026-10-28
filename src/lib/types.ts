export type CornerPosition = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export type RuleItem = {
  id: string;
  text: string;
};

export type TaskItem = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
};

export type HistoryKind = "completed" | "deleted";

export type HistoryEntry = {
  id: string;
  kind: HistoryKind;
  title: string;
  at: string;
};

export type NotesPosition = {
  x: number;
  y: number;
};

export type Settings = {
  corner: CornerPosition;
  isPinned: boolean;
  notesVisible: boolean;
  lastPromptDate: string | null;
  morningAnswered: boolean;
  launchAtLogin: boolean;
  notesPosition: NotesPosition;
  sessionStartedAt: string | null;
};

export type PanelId = "history" | "settings" | "about" | null;
