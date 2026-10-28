import { i as __toESM } from "../_runtime.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { n as Slot, o as require_jsx_runtime } from "../_libs/@radix-ui/react-collection+[...].mjs";
import { a as Terminal, c as Minus, d as Check, f as BatteryFull, i as Trash2, l as GripHorizontal, n as Wifi, o as StickyNote, s as Plus, t as X, u as Folder } from "../_libs/lucide-react.mjs";
import { n as toast, t as Toaster } from "../_libs/sonner.mjs";
import { n as clsx, t as cva } from "../_libs/class-variance-authority+clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
import { n as persist, r as create, t as createJSONStorage } from "../_libs/zustand.mjs";
import { a as Separator2, i as Root2, n as Item2, o as Trigger, r as Portal2, t as Content2 } from "../_libs/@radix-ui/react-dropdown-menu+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-CVQN6-Rc.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
function nid() {
	return crypto.randomUUID();
}
function todayISO(d = /* @__PURE__ */ new Date()) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatStamp(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function formatClock(d) {
	return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}  ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function formatDuration(ms) {
	const total = Math.max(0, Math.floor(ms / 1e3));
	const h = Math.floor(total / 3600);
	const m = Math.floor(total % 3600 / 60);
	const s = total % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	return `${m}:${String(s).padStart(2, "0")}`;
}
function CornerMark({ className }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
		viewBox: "0 0 24 24",
		className: cn("text-fg", className),
		fill: "currentColor",
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.5 3.5h8.2v1.7H5.2v6.5H3.5V3.5zm17 17h-8.2v-1.7h6.5v-6.5h1.7v8.2z" })
	});
}
var DEFAULT_RULES = [
	{
		id: "r-social",
		text: "No social media"
	},
	{
		id: "r-deep",
		text: "Deep work only"
	},
	{
		id: "r-phone",
		text: "Phone face-down"
	},
	{
		id: "r-one",
		text: "One task until done"
	}
];
var DEFAULT_SETTINGS = {
	corner: "topRight",
	isPinned: true,
	notesVisible: false,
	lastPromptDate: null,
	morningAnswered: false,
	launchAtLogin: true,
	notesPosition: {
		x: 28,
		y: 88
	},
	sessionStartedAt: null
};
function stampHistory(history, kind, title) {
	return [{
		id: nid(),
		kind,
		title,
		at: (/* @__PURE__ */ new Date()).toISOString()
	}, ...history].slice(0, 400);
}
var useFocusStore = create()(persist((set, get) => ({
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
		if (settings.lastPromptDate !== today) set({
			showPrompt: true,
			openPanel: null,
			settings: {
				...settings,
				morningAnswered: false
			}
		});
		else set({ showPrompt: false });
	},
	answerMorning: (yes) => {
		const { settings } = get();
		const now = (/* @__PURE__ */ new Date()).toISOString();
		set({
			showPrompt: false,
			settings: {
				...settings,
				lastPromptDate: todayISO(),
				morningAnswered: true,
				notesVisible: yes,
				sessionStartedAt: yes ? now : settings.sessionStartedAt ?? now
			}
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
				morningAnswered: false
			}
		});
	},
	setCorner: (corner) => set({ settings: {
		...get().settings,
		corner
	} }),
	setPinned: (isPinned) => set({ settings: {
		...get().settings,
		isPinned
	} }),
	setNotesVisible: (notesVisible) => set({ settings: {
		...get().settings,
		notesVisible
	} }),
	toggleNotes: () => {
		const { settings } = get();
		set({
			settings: {
				...settings,
				notesVisible: !settings.notesVisible
			},
			showPrompt: false
		});
	},
	setNotesPosition: (notesPosition) => set({ settings: {
		...get().settings,
		notesPosition
	} }),
	setLaunchAtLogin: (launchAtLogin) => set({ settings: {
		...get().settings,
		launchAtLogin
	} }),
	setOpenPanel: (openPanel) => set({
		openPanel,
		menuOpen: false
	}),
	setMenuOpen: (menuOpen) => set({ menuOpen }),
	addRule: (text = "New rule") => {
		const id = nid();
		set({ rules: [...get().rules, {
			id,
			text
		}] });
		return id;
	},
	updateRule: (id, text) => {
		const trimmed = text.trim();
		if (!trimmed) {
			set({ rules: get().rules.filter((r) => r.id !== id) });
			return;
		}
		set({ rules: get().rules.map((r) => r.id === id ? {
			...r,
			text: trimmed
		} : r) });
	},
	removeRule: (id) => set({ rules: get().rules.filter((r) => r.id !== id) }),
	addTask: (title) => {
		const trimmed = title.trim();
		if (!trimmed) return;
		const task = {
			id: nid(),
			title: trimmed,
			completed: false,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			completedAt: null
		};
		set({ tasks: [...get().tasks, task] });
	},
	updateTask: (id, title) => {
		const trimmed = title.trim();
		if (!trimmed) {
			const task = get().tasks.find((t) => t.id === id);
			if (task) set({
				tasks: get().tasks.filter((t) => t.id !== id),
				history: stampHistory(get().history, "deleted", task.title)
			});
			return;
		}
		set({ tasks: get().tasks.map((t) => t.id === id ? {
			...t,
			title: trimmed
		} : t) });
	},
	toggleTask: (id) => {
		const task = get().tasks.find((t) => t.id === id);
		if (!task) return;
		const completing = !task.completed;
		set({
			tasks: get().tasks.map((t) => t.id === id ? {
				...t,
				completed: completing,
				completedAt: completing ? (/* @__PURE__ */ new Date()).toISOString() : null
			} : t),
			history: completing ? stampHistory(get().history, "completed", task.title) : get().history
		});
	},
	removeTask: (id) => {
		const task = get().tasks.find((t) => t.id === id);
		if (!task) return;
		set({
			tasks: get().tasks.filter((t) => t.id !== id),
			history: stampHistory(get().history, "deleted", task.title)
		});
	},
	clearCompleted: () => {
		set({ tasks: get().tasks.filter((t) => !t.completed) });
	},
	resetWorkspace: () => set({
		rules: DEFAULT_RULES,
		tasks: [],
		history: [],
		settings: { ...DEFAULT_SETTINGS },
		showPrompt: true,
		openPanel: null
	})
}), {
	name: "focus-corner",
	storage: createJSONStorage(() => {
		if (typeof window === "undefined") return {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {}
		};
		return localStorage;
	}),
	skipHydration: true,
	partialize: (s) => ({
		rules: s.rules,
		tasks: s.tasks,
		history: s.history,
		settings: s.settings
	})
}));
function historyMarkdown(entries) {
	if (entries.length === 0) return "# FocusCorner History\n\n_No activity yet._\n";
	const groups = /* @__PURE__ */ new Map();
	for (const e of entries) {
		const day = e.at.slice(0, 10);
		const list = groups.get(day) ?? [];
		list.push(e);
		groups.set(day, list);
	}
	const days = [...groups.keys()].sort((a, b) => a < b ? 1 : -1);
	let out = "# FocusCorner History\n";
	for (const day of days) {
		out += `\n## ${day}\n`;
		const items = groups.get(day) ?? [];
		for (const e of items) {
			const mark = e.kind === "completed" ? "x" : "deleted";
			const stamp = e.at.replace("T", " ").slice(0, 16);
			if (e.kind === "completed") out += `- [${mark}] [${stamp}] ${e.title}\n`;
			else out += `- [deleted] [${stamp}] ${e.title}\n`;
		}
	}
	return out;
}
function Dock() {
	const notesVisible = useFocusStore((s) => s.settings.notesVisible);
	const toggleNotes = useFocusStore((s) => s.toggleNotes);
	const setOpenPanel = useFocusStore((s) => s.setOpenPanel);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
		"aria-label": "Dock",
		className: "pointer-events-none absolute inset-x-0 bottom-2 z-30 hidden justify-center md:flex",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "pointer-events-auto flex items-end gap-2 rounded-xl bg-fg/8 px-2.5 py-2 shadow-[0_0_0_1px_rgba(255,255,255,0.1)] backdrop-blur-xl",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DockIcon, {
					label: "Files",
					icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Folder, { className: "size-5" }),
					muted: true
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DockIcon, {
					label: "Notes",
					icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StickyNote, { className: "size-5" }),
					active: notesVisible,
					onClick: () => toggleNotes()
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DockIcon, {
					label: "History",
					icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Terminal, { className: "size-5" }),
					onClick: () => setOpenPanel("history")
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "mx-0.5 h-8 w-px bg-fg/15",
					"aria-hidden": true
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DockIcon, {
					label: "FocusCorner",
					icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CornerMark, { className: "size-5" }),
					active: true,
					onClick: () => setOpenPanel("about")
				})
			]
		})
	});
}
function DockIcon({ label, icon, active, muted, onClick }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type: "button",
		"aria-label": label,
		disabled: !onClick,
		onClick,
		className: cn("flex size-11 items-center justify-center rounded-lg text-fg", "bg-fg/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]", "transition-[background-color,transform] duration-[var(--motion-quick)] ease-[var(--ease-out)]", "hover:bg-fg/16 pressable", muted && "opacity-55", active && "bg-fg/18"),
		children: icon
	});
}
var DropdownMenu = Root2;
var DropdownMenuTrigger = Trigger;
function DropdownMenuContent({ className, sideOffset = 6, ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Portal2, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Content2, {
		sideOffset,
		className: cn("menu-surface z-80 min-w-52 overflow-hidden p-1 text-sm", "data-[state=open]:animate-in data-[state=closed]:animate-out", className),
		...props
	}) });
}
function DropdownMenuItem({ className, inset, ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item2, {
		className: cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-sm px-2.5 text-sm text-fg outline-none", "data-[highlighted]:bg-fg/8 data-disabled:pointer-events-none data-disabled:opacity-40", inset && "pl-8", className),
		...props
	});
}
function DropdownMenuSeparator({ className, ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Separator2, {
		className: cn("my-1 h-px bg-fg/10", className),
		...props
	});
}
function DropdownMenuShortcut({ className, ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: cn("ml-auto font-mono text-xs tracking-wide text-subtle", className),
		...props
	});
}
function MenuBar() {
	const notesVisible = useFocusStore((s) => s.settings.notesVisible);
	const toggleNotes = useFocusStore((s) => s.toggleNotes);
	const setOpenPanel = useFocusStore((s) => s.setOpenPanel);
	const reopenMorning = useFocusStore((s) => s.reopenMorning);
	const sessionStartedAt = useFocusStore((s) => s.settings.sessionStartedAt);
	const [now, setNow] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		setNow(/* @__PURE__ */ new Date());
		const id = window.setInterval(() => setNow(/* @__PURE__ */ new Date()), 1e3);
		return () => window.clearInterval(id);
	}, []);
	const elapsed = now && sessionStartedAt && notesVisible ? formatDuration(now.getTime() - new Date(sessionStartedAt).getTime()) : null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "relative z-50 flex h-8 shrink-0 items-center bg-bg/55 px-2 text-xs text-fg backdrop-blur-xl",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DropdownMenu, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropdownMenuTrigger, {
				asChild: true,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "flex h-8 items-center gap-1.5 rounded-xs px-1.5 font-medium hover:bg-fg/10",
					"aria-label": "FocusCorner menu",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CornerMark, { className: "size-3.5" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "FocusCorner" })]
				})
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DropdownMenuContent, {
				align: "start",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropdownMenuItem, {
						onSelect: () => setOpenPanel("about"),
						children: "About FocusCorner"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropdownMenuSeparator, {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DropdownMenuItem, {
						onSelect: () => toggleNotes(),
						children: [notesVisible ? "Hide notes" : "Show notes", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropdownMenuShortcut, { children: "⌘⇧F" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropdownMenuItem, {
						onSelect: () => setOpenPanel("history"),
						children: "Open history.md"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropdownMenuItem, {
						onSelect: () => setOpenPanel("settings"),
						children: "Settings"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropdownMenuSeparator, {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropdownMenuItem, {
						onSelect: () => reopenMorning(),
						children: "Morning check-in"
					})
				]
			})] }),
			elapsed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "ml-2 hidden items-center gap-1.5 rounded-full bg-fg/8 px-2 py-0.5 font-mono tabular-nums text-muted sm:inline-flex",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "size-1.5 rounded-full bg-sage" }), elapsed]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "ml-auto flex items-center gap-3 pr-1 text-fg/90",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Wifi, {
						className: "hidden size-3.5 sm:block",
						"aria-hidden": true
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BatteryFull, {
						className: "hidden size-3.5 sm:block",
						"aria-hidden": true
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", {
						className: cn("tabular-nums tracking-wide"),
						dateTime: now ? now.toISOString() : void 0,
						suppressHydrationWarning: true,
						children: now ? formatClock(now) : "\xA0"
					})
				]
			})
		]
	});
}
var buttonVariants = cva("pressable inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,box-shadow,opacity] duration-[var(--motion-quick)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0", {
	variants: {
		variant: {
			default: "bg-accent text-accent-fg hover:bg-accent/90",
			ghost: "bg-fg/6 text-fg hover:bg-fg/10",
			outline: "bg-transparent text-fg shadow-[0_0_0_1px_rgba(255,255,255,0.12)] hover:bg-fg/6",
			danger: "bg-danger/15 text-danger hover:bg-danger/22",
			quiet: "bg-transparent text-muted hover:bg-fg/8 hover:text-fg"
		},
		size: {
			default: "h-11 rounded-md px-4 text-sm",
			sm: "h-9 rounded-sm px-3 text-sm",
			lg: "h-12 rounded-lg px-5 text-sm",
			icon: "size-11 rounded-md [&_svg]:size-4",
			"icon-sm": "relative size-8 rounded-sm [&_svg]:size-3.5 after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2"
		}
	},
	defaultVariants: {
		variant: "default",
		size: "default"
	}
});
function Button({ className, variant, size, asChild = false, type = "button", ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(asChild ? Slot : "button", {
		className: cn(buttonVariants({
			variant,
			size
		}), className),
		...!asChild ? { type } : {},
		...props
	});
}
function AboutPanel() {
	const setOpenPanel = useFocusStore((s) => s.setOpenPanel);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "absolute inset-0 z-40 flex items-center justify-center p-4",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			className: "backdrop-in absolute inset-0 bg-bg/45",
			"aria-label": "Close about",
			onClick: () => setOpenPanel(null)
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			role: "dialog",
			"aria-labelledby": "about-title",
			className: "hud-panel modal-in relative z-10 w-full max-w-sm px-7 py-7 text-center",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "quiet",
					size: "icon-sm",
					"aria-label": "Close about",
					className: "absolute top-3 right-3",
					onClick: () => setOpenPanel(null),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, {})
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CornerMark, { className: "mx-auto mb-4 size-8" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					id: "about-title",
					className: "font-display text-3xl font-medium italic",
					children: "FocusCorner"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 text-sm leading-normal text-pretty text-muted",
					children: "A quiet overlay for deep work. Rules stay pinned to a corner. Notes stay optional. History is a permanent markdown log."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-5 font-mono text-xs text-subtle",
					children: "macOS 13+ overlay"
				})
			]
		})]
	});
}
function HistoryPanel() {
	const history = useFocusStore((s) => s.history);
	const setOpenPanel = useFocusStore((s) => s.setOpenPanel);
	const md = historyMarkdown(history);
	async function copy() {
		try {
			await navigator.clipboard.writeText(md);
			toast("Copied history.md");
		} catch {
			toast("Could not copy");
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "absolute inset-0 z-40 flex items-center justify-center p-4",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			className: "backdrop-in absolute inset-0 bg-bg/45",
			"aria-label": "Close history",
			onClick: () => setOpenPanel(null)
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			role: "dialog",
			"aria-labelledby": "history-title",
			className: "hud-panel modal-in relative z-10 flex max-h-96 w-full max-w-lg flex-col overflow-hidden",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "flex items-center gap-2 px-4 pt-4 pb-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "min-w-0 flex-1",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							id: "history-title",
							className: "hud-kicker",
							children: "history.md"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-mono text-xs text-muted",
							children: "~/.focus_corner/history.md"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "ghost",
						size: "sm",
						className: "h-8 px-3 text-xs",
						onClick: copy,
						children: "Copy"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "quiet",
						size: "icon-sm",
						"aria-label": "Close history",
						onClick: () => setOpenPanel(null),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, {})
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "min-h-0 flex-1 overflow-y-auto px-4 pb-4",
				children: history.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "py-8 text-center text-sm text-muted",
					children: "Completed and deleted tasks land here as a permanent log."
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
					className: "flex flex-col gap-1.5 pt-1",
					children: history.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex gap-3 rounded-sm bg-fg/4 px-3 py-2.5",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: entry.kind === "completed" ? "font-mono text-xs text-sage" : "font-mono text-xs text-danger",
							children: entry.kind === "completed" ? "[x]" : "[del]"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "min-w-0 flex-1",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "truncate text-sm text-fg",
								children: entry.title
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "font-mono text-xs tabular-nums text-subtle",
								children: formatStamp(entry.at)
							})]
						})]
					}, entry.id))
				})
			})]
		})]
	});
}
function MorningPrompt() {
	const answerMorning = useFocusStore((s) => s.answerMorning);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "absolute inset-0 z-40 flex items-center justify-center p-4",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "backdrop-in absolute inset-0 bg-bg/45",
			"aria-hidden": true
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			role: "dialog",
			"aria-labelledby": "morning-title",
			"aria-describedby": "morning-desc",
			className: "hud-panel modal-in relative z-10 w-full max-w-md px-8 py-8 text-center",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stagger-in flex flex-col items-center",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CornerMark, { className: "mb-5 size-7 text-fg/80" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "hud-kicker",
						children: "Morning check-in"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						id: "morning-title",
						className: "font-display mt-3 text-3xl leading-tight font-medium text-balance text-fg italic sm:text-4xl",
						children: "Bugun yangi tasklar bormi?"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						id: "morning-desc",
						className: "mt-3 max-w-xs text-sm leading-normal text-pretty text-muted",
						children: "New tasks for today? Notes stay hidden unless you need them. Rules remain pinned either way."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-7 flex w-full max-w-xs gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							variant: "ghost",
							className: "h-12 flex-1 rounded-md",
							onClick: () => answerMorning(false),
							children: "Yo'q"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							className: "h-12 flex-1 rounded-md",
							onClick: () => answerMorning(true),
							children: "Ha"
						})]
					})
				]
			})
		})]
	});
}
function InlineField({ value, onCommit, className, completed = false, placeholder = "Untitled", autoFocus = false, onAutoFocusConsumed }) {
	const [draft, setDraft] = (0, import_react.useState)(value);
	const [editing, setEditing] = (0, import_react.useState)(autoFocus);
	const ref = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		setDraft(value);
	}, [value]);
	(0, import_react.useEffect)(() => {
		if (editing) {
			ref.current?.focus();
			ref.current?.select();
			onAutoFocusConsumed?.();
		}
	}, [editing, onAutoFocusConsumed]);
	function commit() {
		setEditing(false);
		if (draft !== value) onCommit(draft);
	}
	if (!editing) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type: "button",
		"data-no-drag": true,
		onClick: () => setEditing(true),
		className: cn("relative min-h-8 w-full truncate rounded-xs px-1 text-left text-sm leading-snug text-fg", completed && "text-muted", className),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "relative inline-block max-w-full",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "block truncate",
				children: value || placeholder
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("strike-line", completed && "is-on") })]
		})
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
		ref,
		"data-no-drag": true,
		value: draft,
		placeholder,
		onChange: (e) => setDraft(e.target.value),
		onBlur: commit,
		onKeyDown: (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				commit();
			}
			if (e.key === "Escape") {
				setDraft(value);
				setEditing(false);
			}
		},
		className: cn("h-8 w-full rounded-xs bg-fg/8 px-1.5 text-sm text-fg outline-none", "placeholder:text-subtle", className)
	});
}
function NotesHud({ stacked, desktopRef, requestFocus, onFocused }) {
	const tasks = useFocusStore((s) => s.tasks);
	const pos = useFocusStore((s) => s.settings.notesPosition);
	const setNotesPosition = useFocusStore((s) => s.setNotesPosition);
	const setNotesVisible = useFocusStore((s) => s.setNotesVisible);
	const addTask = useFocusStore((s) => s.addTask);
	const updateTask = useFocusStore((s) => s.updateTask);
	const toggleTask = useFocusStore((s) => s.toggleTask);
	const removeTask = useFocusStore((s) => s.removeTask);
	const clearCompleted = useFocusStore((s) => s.clearCompleted);
	const [draft, setDraft] = (0, import_react.useState)("");
	const inputRef = (0, import_react.useRef)(null);
	const panelRef = (0, import_react.useRef)(null);
	const drag = (0, import_react.useRef)(null);
	const remaining = tasks.filter((t) => !t.completed).length;
	const done = tasks.filter((t) => t.completed).length;
	(0, import_react.useEffect)(() => {
		if (requestFocus) {
			inputRef.current?.focus();
			onFocused();
		}
	}, [requestFocus, onFocused]);
	function submit() {
		addTask(draft);
		setDraft("");
	}
	function onPointerDown(e) {
		if (stacked) return;
		if (e.target.closest("input, textarea, button, a, [data-no-drag]")) return;
		if (!desktopRef.current?.getBoundingClientRect()) return;
		drag.current = {
			dx: e.clientX,
			dy: e.clientY,
			startX: pos.x,
			startY: pos.y
		};
		e.currentTarget.setPointerCapture(e.pointerId);
	}
	function onPointerMove(e) {
		if (!drag.current) return;
		const desk = desktopRef.current;
		const panel = panelRef.current;
		if (!desk || !panel) return;
		const dx = e.clientX - drag.current.dx;
		const dy = e.clientY - drag.current.dy;
		const maxX = Math.max(16, desk.clientWidth - panel.offsetWidth - 16);
		const maxY = Math.max(40, desk.clientHeight - panel.offsetHeight - 16);
		const x = Math.min(maxX, Math.max(16, drag.current.startX + dx));
		const y = Math.min(maxY, Math.max(40, drag.current.startY + dy));
		setNotesPosition({
			x,
			y
		});
	}
	function onPointerUp() {
		drag.current = null;
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		ref: panelRef,
		className: cn("hud-panel flex w-full flex-col overflow-hidden md:w-hud-notes", !stacked && "cursor-grab active:cursor-grabbing"),
		"aria-label": "Today notes",
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel: onPointerUp,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "flex items-center gap-2 px-3.5 pt-3.5 pb-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "min-w-0 flex-1",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "hud-kicker",
							children: "Today"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "text-xs tabular-nums text-muted",
							children: [
								remaining,
								" remaining",
								done > 0 ? ` · ${done} done` : ""
							]
						})]
					}),
					!stacked ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GripHorizontal, {
						className: "size-4 text-subtle",
						"aria-hidden": true
					}) : null,
					done > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "quiet",
						size: "sm",
						className: "h-8 px-2 text-xs text-muted",
						onClick: clearCompleted,
						children: "Clear done"
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "quiet",
						size: "icon-sm",
						"aria-label": "Hide notes",
						onClick: () => setNotesVisible(false),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Minus, {})
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "flex max-h-72 flex-col overflow-y-auto px-2",
				children: tasks.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "px-2 py-5 text-sm text-muted",
					children: "Nothing queued. Add a task to start."
				}) : tasks.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "hud-row flex items-center gap-1 rounded-sm px-1 py-0.5",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							"data-no-drag": true,
							"aria-label": task.completed ? "Mark not done" : "Mark done",
							"aria-pressed": task.completed,
							onClick: () => {
								const completing = !task.completed;
								toggleTask(task.id);
								if (completing) toast("Appended to history.md");
							},
							className: cn("relative mx-0.5 flex size-5 shrink-0 items-center justify-center rounded-xs", "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]", "after:absolute after:inset-[-12px]", task.completed && "bg-sage text-accent-fg shadow-none"),
							children: task.completed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
								className: "size-3",
								strokeWidth: 3
							}) : null
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(InlineField, {
							value: task.title,
							completed: task.completed,
							onCommit: (title) => updateTask(task.id, title),
							className: "flex-1"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							variant: "quiet",
							size: "icon-sm",
							"aria-label": `Delete ${task.title}`,
							className: "row-action text-muted hover:text-danger",
							onClick: () => {
								removeTask(task.id);
								toast("Removed and logged");
							},
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, {})
						})
					]
				}, task.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "flex items-center gap-1.5 px-3 pb-3 pt-1",
				onSubmit: (e) => {
					e.preventDefault();
					submit();
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, {
					className: "size-3.5 shrink-0 text-subtle",
					"aria-hidden": true
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					ref: inputRef,
					"data-no-drag": true,
					value: draft,
					onChange: (e) => setDraft(e.target.value),
					placeholder: "New task",
					className: "h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
				})]
			})
		]
	});
}
var CORNERS$1 = [
	{
		id: "topLeft",
		label: "Top left"
	},
	{
		id: "topRight",
		label: "Top right"
	},
	{
		id: "bottomLeft",
		label: "Bottom left"
	},
	{
		id: "bottomRight",
		label: "Bottom right"
	}
];
function RulesHud() {
	const rules = useFocusStore((s) => s.rules);
	const corner = useFocusStore((s) => s.settings.corner);
	const setCorner = useFocusStore((s) => s.setCorner);
	const addRule = useFocusStore((s) => s.addRule);
	const updateRule = useFocusStore((s) => s.updateRule);
	const removeRule = useFocusStore((s) => s.removeRule);
	const [focusId, setFocusId] = (0, import_react.useState)(null);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "hud-panel flex w-full flex-col overflow-hidden md:w-hud-rules",
		"aria-label": "Pinned rules",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "flex items-center gap-2 px-3.5 pt-3.5 pb-2",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "min-w-0 flex-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "hud-kicker",
						children: "Rules"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-muted",
						children: "Pinned · non-negotiable"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CornerPicker, {
					value: corner,
					onChange: setCorner
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "quiet",
					size: "icon-sm",
					"aria-label": "Add rule",
					onClick: () => {
						const id = addRule("");
						setFocusId(id);
					},
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, {})
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "flex flex-col px-2 pb-3",
			children: rules.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
				className: "px-2 py-3 text-sm text-muted",
				children: "No rules yet. Add one."
			}) : rules.map((rule) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
				className: "hud-row group flex items-center gap-1 rounded-sm px-1 py-0.5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "mx-1 size-1 shrink-0 rounded-full bg-fg/45",
						"aria-hidden": true
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(InlineField, {
						value: rule.text,
						onCommit: (text) => updateRule(rule.id, text),
						autoFocus: focusId === rule.id,
						onAutoFocusConsumed: () => setFocusId(null),
						placeholder: "Write a rule",
						className: "flex-1"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "quiet",
						size: "icon-sm",
						"aria-label": `Delete ${rule.text || "rule"}`,
						className: "row-action text-muted hover:text-danger",
						onClick: () => removeRule(rule.id),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, {})
					})
				]
			}, rule.id))
		})]
	});
}
function CornerPicker({ value, onChange }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "grid size-8 grid-cols-2 gap-0.5 rounded-xs bg-fg/8 p-0.5",
		role: "group",
		"aria-label": "Pin corner",
		children: CORNERS$1.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			"aria-label": c.label,
			"aria-pressed": value === c.id,
			onClick: () => onChange(c.id),
			className: cn("relative rounded-[2px] after:absolute after:inset-[-6px]", value === c.id ? "bg-accent" : "bg-fg/20 hover:bg-fg/35")
		}, c.id))
	});
}
function Separator({ className }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		role: "separator",
		className: cn("h-px w-full bg-fg/10", className)
	});
}
var CORNERS = [
	{
		id: "topLeft",
		label: "Top left"
	},
	{
		id: "topRight",
		label: "Top right"
	},
	{
		id: "bottomLeft",
		label: "Bottom left"
	},
	{
		id: "bottomRight",
		label: "Bottom right"
	}
];
function SettingsPanel() {
	const settings = useFocusStore((s) => s.settings);
	const setCorner = useFocusStore((s) => s.setCorner);
	const setLaunchAtLogin = useFocusStore((s) => s.setLaunchAtLogin);
	const setOpenPanel = useFocusStore((s) => s.setOpenPanel);
	const reopenMorning = useFocusStore((s) => s.reopenMorning);
	const resetWorkspace = useFocusStore((s) => s.resetWorkspace);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "absolute inset-0 z-40 flex items-center justify-center p-4",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			className: "backdrop-in absolute inset-0 bg-bg/45",
			"aria-label": "Close settings",
			onClick: () => setOpenPanel(null)
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			role: "dialog",
			"aria-labelledby": "settings-title",
			className: "hud-panel modal-in relative z-10 w-full max-w-md overflow-hidden",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "flex items-center gap-2 px-4 pt-4 pb-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "min-w-0 flex-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						id: "settings-title",
						className: "hud-kicker",
						children: "Settings"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-muted",
						children: "Pin, boot, overlay"
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "quiet",
					size: "icon-sm",
					"aria-label": "Close settings",
					onClick: () => setOpenPanel(null),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, {})
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-col gap-4 px-4 pb-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mb-2 text-xs font-medium text-muted",
						children: "Rules corner"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid grid-cols-2 gap-1.5",
						children: CORNERS.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => setCorner(c.id),
							className: cn("h-11 rounded-sm text-sm transition-colors duration-[var(--motion-quick)]", settings.corner === c.id ? "bg-accent text-accent-fg" : "bg-fg/6 text-fg hover:bg-fg/10"),
							children: c.label
						}, c.id))
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToggleRow, {
						label: "Launch at login",
						hint: "Show the morning prompt on boot",
						on: settings.launchAtLogin,
						onChange: setLaunchAtLogin
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Separator, {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-col gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							variant: "ghost",
							onClick: reopenMorning,
							children: "Simulate morning boot"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							variant: "danger",
							onClick: () => {
								resetWorkspace();
							},
							children: "Reset workspace"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "font-mono text-xs leading-relaxed text-subtle",
						children: [
							"~/.focus_corner/rules.json",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
							"~/.focus_corner/tasks.json",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
							"~/.focus_corner/history.md"
						]
					})
				]
			})]
		})]
	});
}
function ToggleRow({ label, hint, on, onChange }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
		type: "button",
		onClick: () => onChange(!on),
		className: "flex min-h-11 w-full items-center gap-3 rounded-sm text-left",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "min-w-0 flex-1",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "block text-sm text-fg",
				children: label
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "block text-xs text-muted",
				children: hint
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: cn("flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-[var(--motion-quick)]", on ? "bg-accent" : "bg-fg/15"),
			"aria-hidden": true,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("size-5 rounded-full transition-transform duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)]", on ? "translate-x-4 bg-accent-fg" : "translate-x-0 bg-fg/80") })
		})]
	});
}
function Desktop() {
	const setHydrated = useFocusStore((s) => s.setHydrated);
	const maybeShowMorningPrompt = useFocusStore((s) => s.maybeShowMorningPrompt);
	const showPrompt = useFocusStore((s) => s.showPrompt);
	const notesVisible = useFocusStore((s) => s.settings.notesVisible);
	const corner = useFocusStore((s) => s.settings.corner);
	const notesPosition = useFocusStore((s) => s.settings.notesPosition);
	const openPanel = useFocusStore((s) => s.openPanel);
	const setOpenPanel = useFocusStore((s) => s.setOpenPanel);
	const toggleNotes = useFocusStore((s) => s.toggleNotes);
	const desktopRef = (0, import_react.useRef)(null);
	const [stacked, setStacked] = (0, import_react.useState)(false);
	const [focusInput, setFocusInput] = (0, import_react.useState)(false);
	const prevNotes = (0, import_react.useRef)(notesVisible);
	(0, import_react.useEffect)(() => {
		let cancelled = false;
		Promise.resolve(useFocusStore.persist.rehydrate()).catch(() => void 0).then(() => {
			if (cancelled) return;
			setHydrated(true);
			maybeShowMorningPrompt();
		});
		return () => {
			cancelled = true;
		};
	}, [maybeShowMorningPrompt, setHydrated]);
	(0, import_react.useEffect)(() => {
		const mq = window.matchMedia("(max-width: 767px)");
		const apply = () => setStacked(mq.matches);
		apply();
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, []);
	(0, import_react.useEffect)(() => {
		if (notesVisible && !prevNotes.current) setFocusInput(true);
		prevNotes.current = notesVisible;
	}, [notesVisible]);
	(0, import_react.useEffect)(() => {
		function onKey(e) {
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "f" || e.key === "F")) {
				e.preventDefault();
				toggleNotes();
				return;
			}
			if (e.key === "Escape") {
				if (openPanel) {
					setOpenPanel(null);
					return;
				}
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [
		openPanel,
		setOpenPanel,
		toggleNotes
	]);
	const onFocused = (0, import_react.useCallback)(() => setFocusInput(false), []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "relative flex h-dvh min-h-dvh flex-col overflow-hidden bg-bg text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "pointer-events-none absolute inset-0 bg-cover bg-center",
				style: { backgroundImage: "url(/wallpaper.jpg)" },
				"aria-hidden": true
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "pointer-events-none absolute inset-0 bg-bg/25",
				"aria-hidden": true
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuBar, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				ref: desktopRef,
				className: "relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 pb-6 md:block md:overflow-hidden md:px-0 md:py-0 md:pb-0",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: cn("hud-float-rules transition-[top,right,bottom,left] duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)]", cornerClass(corner)),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RulesHud, {})
					}),
					notesVisible ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "hud-float-notes",
						style: {
							left: notesPosition.x,
							top: notesPosition.y
						},
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NotesHud, {
							stacked,
							desktopRef,
							requestFocus: focusInput,
							onFocused
						})
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dock, {}),
					showPrompt ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MorningPrompt, {}) : null,
					openPanel === "history" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HistoryPanel, {}) : null,
					openPanel === "settings" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SettingsPanel, {}) : null,
					openPanel === "about" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AboutPanel, {}) : null
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toaster, {
				theme: "dark",
				position: "top-center",
				offset: 44,
				toastOptions: { classNames: {
					toast: "hud-panel-tight border-0 text-fg text-sm px-4 py-3 shadow-[var(--shadow-hud)]",
					title: "text-fg"
				} }
			})
		]
	});
}
function cornerClass(corner) {
	switch (corner) {
		case "topLeft": return "top-6 left-6";
		case "topRight": return "top-6 right-6";
		case "bottomLeft": return "bottom-24 left-6";
		case "bottomRight": return "bottom-24 right-6";
	}
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Desktop, {});
}
//#endregion
export { Home as component };
