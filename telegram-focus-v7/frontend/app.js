// AWS yoki lokal muhit uchun API manzili
const CONFIGURED_API_BASE_URL = "http://<AWS_IP>:8000";
const API_BASE_URL =
  window.location.protocol === "file:" ? CONFIGURED_API_BASE_URL : window.location.origin;

const PAGE_LIMIT = 100;

const state = {
  sources: [],
  messages: [],
  hasMoreMessages: false,
  socket: null,
  reconnectDelay: 1000,
  reconnectTimer: null,
  replyFiles: {}, // messageId -> [{name, mime, data_b64}]
  // Telegram state
  selectedSourceId: null, // null = Barcha faol manbalar, number = tanlangan manba
  sourceFilterType: "all", // "all" | "channel" | "group" | "user" | "paused"
  sourceSearch: "",
  activeTab: "inbox", // "inbox" | "starred" | "archive"
  tgQuickFilter: "all", // "all" | "unread" | "media" | "links"
  tgSort: "desc", // "desc" | "asc"
  archiveSearch: "",
  selectedIds: new Set(),
  // Counts & Settings
  counts: {
    telegram_unread: 0,
    email_unread: 0,
    archived: 0,
    opportunity_unread: 0,
    starred: 0,
    telegram_total: 0,
    email_total: 0,
    notifications_unread: 0,
  },
  archiveSettings: { archive_on_read: false, archive_on_reply: true, auto_archive_days: 0 },
  autoReplyEnabled: false,
  section: "telegram", // "telegram" | "email" | "opportunity" | "notifications"
  // Email state
  email: {
    accounts: [],
    messages: [],
    presets: [],
    selectedAccountId: null,
    tab: "inbox", // "inbox" | "starred" | "archive"
    quickFilter: "all", // "all" | "unread"
    search: "",
    expanded: new Set(),
    selectedIds: new Set(),
  },
  // Opportunity state (Bug #5)
  opp: {
    tab: "feed", // feed | channels | profile | settings | groups | test
    feedTab: "inbox", // inbox | starred | archive
    viewMode: "daily", // "daily" | "hierarchy"
    periodFilter: "all", // "all" | "today" | "yesterday" | "this_week" | "older"
    tierFilter: "all", // "all" | "gold" | "silver" | "bronze" | "base"
    collapsedGroups: new Set(),
    summary: null,
    feed: [],
    channels: [],
    groups: [],
    profile: null,
    settings: null,
    status: null,
    delivery: null,
  },
};

const OPP_INTERESTS = ["IT", "Til", "Fan", "Biznes", "Debat", "Liderlik", "Madaniyat", "San'at"];

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #6366f1, #8b5cf6)",
  "linear-gradient(135deg, #3b82f6, #06b6d4)",
  "linear-gradient(135deg, #10b981, #059669)",
  "linear-gradient(135deg, #f59e0b, #ef4444)",
  "linear-gradient(135deg, #ec4899, #8b5cf6)",
  "linear-gradient(135deg, #14b8a6, #3b82f6)",
];

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const container = $("#toast-container");
  if (!container) return;
  container.innerHTML = "";
  const item = document.createElement("div");
  item.className = "toast-item";
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => {
    item.style.opacity = "0";
    item.style.transition = "opacity 0.2s ease";
    setTimeout(() => item.remove(), 220);
  }, 2400);
}

function showError(message) {
  const box = $("#global-error");
  if (!box) return;
  box.textContent = message;
  box.classList.remove("hidden");
}

function clearError() {
  const box = $("#global-error");
  if (box) box.classList.add("hidden");
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
    ...options,
  });
  if (response.status === 401) {
    window.location.href = "/login.html";
    throw new Error("Autentifikatsiya talab qilinadi");
  }
  if (!response.ok) {
    let detail = `Server xatosi (${response.status})`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }
  return response.status === 204 ? null : response.json();
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("uz-UZ", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function formatDateDivider(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (msgDay === todayStart) return "Bugun";
  if (msgDay === yesterdayStart) return "Kecha";
  return date.toLocaleDateString("uz-UZ", { day: "numeric", month: "long", year: "numeric" });
}

function sourceTypeLabel(type) {
  return { user: "Odam", group: "Guruh", channel: "Kanal" }[type] || type;
}

function sourceTypeIcon(type) {
  return { user: "👤", group: "👥", channel: "📢" }[type] || "💬";
}

function avatarInitials(name) {
  const clean = String(name || "")
    .replace(/^@/, "")
    .trim();
  if (!clean) return "TF";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function avatarGradient(seed) {
  let hash = 0;
  const str = String(seed || "");
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function telegramPublicUrl(identifier) {
  const raw = String(identifier || "").trim();
  if (!raw || raw === "dm_unmonitored") return null;
  if (/^https?:\/\/t\.me\//i.test(raw)) return raw;
  if (/^t\.me\//i.test(raw)) return `https://${raw}`;
  const clean = raw.replace(/^@/, "");
  if (/^[a-zA-Z][a-zA-Z0-9_]{3,}$/.test(clean)) {
    return `https://t.me/${clean}`;
  }
  return null;
}

// ── BUG #2 & #4: ZERO-DOM-DESTRUCTION AUTO-READ ON SITE ───────────

let tgObserver = null;
let emailObserver = null;
let oppObserver = null;
const pendingAutoReadIds = new Set();
const inFlightReadIds = new Set();
let autoReadFlushTimer = null;

function queueAutoRead(messageId) {
  const numId = Number(messageId);
  if (!numId || inFlightReadIds.has(numId)) return;
  pendingAutoReadIds.add(numId);
  clearTimeout(autoReadFlushTimer);
  autoReadFlushTimer = setTimeout(flushAutoReadQueue, 400);
}

function updateSourceBadgeInPlace(sourceId, newCount) {
  // Update sidebar unread badge in-place WITHOUT re-rendering #source-list!
  const row = document.querySelector(`#source-list .source-item[data-source-select="${sourceId}"]`);
  if (row) {
    let pill = row.querySelector(".source-unread-pill");
    if (newCount > 0) {
      if (!pill) {
        const meta = row.querySelector(".source-right-meta");
        if (meta) {
          pill = document.createElement("span");
          pill.className = "source-unread-pill";
          meta.prepend(pill);
        }
      }
      if (pill) pill.textContent = String(newCount);
    } else if (pill) {
      pill.remove();
    }
  }
  // Update horizontal chip pill in-place
  const chip = document.querySelector(`#source-profile-bar [data-profile-select-source="${sourceId}"]`);
  if (chip) {
    let cPill = chip.querySelector(".chip-unread");
    if (newCount > 0) {
      if (!cPill) {
        cPill = document.createElement("span");
        cPill.className = "chip-unread";
        chip.appendChild(cPill);
      }
      cPill.textContent = String(newCount);
    } else if (cPill) {
      cPill.remove();
    }
  }
  // Update active profile header unread text in-place
  const profUnread = document.getElementById("active-profile-unread-count");
  if (profUnread && state.selectedSourceId === sourceId) {
    profUnread.textContent = String(newCount);
  }
}

async function flushAutoReadQueue() {
  if (!pendingAutoReadIds.size) return;
  const ids = Array.from(pendingAutoReadIds);
  pendingAutoReadIds.clear();
  ids.forEach((id) => inFlightReadIds.add(id));

  try {
    await api("/api/messages/read-bulk", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });

    ids.forEach((id) => {
      const tgMsg = state.messages.find((m) => m.id === id);
      if (tgMsg && !tgMsg.is_read) {
        tgMsg.is_read = true;
        const src = state.sources.find((s) => s.id === tgMsg.source_id);
        if (src && src.unread_count > 0) {
          src.unread_count = Math.max(0, src.unread_count - 1);
          updateSourceBadgeInPlace(src.id, src.unread_count);
        }
      }

      const emailMsg = state.email.messages.find((m) => m.id === id);
      if (emailMsg && !emailMsg.is_read) {
        emailMsg.is_read = true;
        const acc = state.email.accounts.find(
          (a) => a.id === emailMsg.chat_id || a.source_id === emailMsg.source_id
        );
        if (acc && acc.unread_count > 0) {
          acc.unread_count = Math.max(0, acc.unread_count - 1);
        }
      }

      const oppMsg = state.opp.feed.find((m) => m.id === id);
      if (oppMsg && !oppMsg.is_read) {
        oppMsg.is_read = true;
      }

      // Smoothly update DOM card in-place without touching any other element
      const card =
        document.querySelector(`.message-card[data-message-id="${id}"]`) ||
        document.querySelector(`.email-card[data-email-id="${id}"]`) ||
        document.querySelector(`.message-card[data-opp-id="${id}"]`);
      if (card) {
        card.classList.remove("unread");
        const indicator = card.querySelector(".read-state-indicator");
        if (indicator) {
          indicator.classList.remove("is-unread");
          indicator.textContent = "✓✓";
          indicator.title = "Saytda o‘qilgan";
        }
        const readBtn =
          card.querySelector('[data-action="read"]') ||
          card.querySelector('[data-email-action="read"]') ||
          card.querySelector('[data-opp-action="read"]');
        if (readBtn) readBtn.remove();
      }
    });

    await loadCounts();
    // Update "All sources" unread pill in sidebar in-place
    const allRowPill = document.querySelector('#source-list [data-source-select="all"] .source-unread-pill');
    if (state.counts.telegram_unread > 0) {
      if (allRowPill) allRowPill.textContent = String(state.counts.telegram_unread);
    } else if (allRowPill) {
      allRowPill.remove();
    }
  } catch (_) {
    // Non-fatal
  } finally {
    ids.forEach((id) => inFlightReadIds.delete(id));
  }
}

function attachViewportAutoRead(containerSelector, cardSelector, idDatasetKey, itemsArray, observerRefSetter) {
  const container = $(containerSelector);
  if (!container) return;

  const visibleTimers = new Map();

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const rawId = entry.target.dataset[idDatasetKey];
        if (!rawId) return;

        if (!entry.isIntersecting) {
          const existingTimer = visibleTimers.get(rawId);
          if (existingTimer) {
            clearTimeout(existingTimer);
            visibleTimers.delete(rawId);
          }
          return;
        }

        const item = itemsArray.find((m) => String(m.id) === String(rawId));
        if (!item || item.is_read) {
          observer.unobserve(entry.target);
          return;
        }

        if (!visibleTimers.has(rawId)) {
          const timer = setTimeout(() => {
            visibleTimers.delete(rawId);
            if (entry.target.isConnected) {
              observer.unobserve(entry.target);
              queueAutoRead(rawId);
            }
          }, 420);
          visibleTimers.set(rawId, timer);
        }
      });
    },
    { threshold: 0.05 }
  );

  observerRefSetter(observer);
  container.querySelectorAll(cardSelector).forEach((card) => {
    const rawId = card.dataset[idDatasetKey];
    const item = itemsArray.find((m) => String(m.id) === String(rawId));
    if (item && !item.is_read) {
      observer.observe(card);
    }
  });
}

// ── BUG #6: COMPACT TELEGRAM SIDEBAR & SOURCE PROFILE BAR ─────────

function getFilteredSources() {
  return state.sources.filter((src) => {
    if (state.sourceFilterType === "paused") {
      if (src.is_active) return false;
    } else if (state.sourceFilterType !== "all") {
      if (src.type !== state.sourceFilterType) return false;
    }
    if (state.sourceSearch) {
      const q = state.sourceSearch.toLowerCase();
      const matchName = (src.display_name || "").toLowerCase().includes(q);
      const matchIdent = (src.identifier || "").toLowerCase().includes(q);
      if (!matchName && !matchIdent) return false;
    }
    return true;
  });
}

function renderSources() {
  $("#source-count").textContent = state.sources.length;
  const list = $("#source-list");
  if (!list) return;

  const totalUnread = state.counts.telegram_unread || 0;
  const isAllSelected = state.selectedSourceId === null;

  let html = `
    <div class="source-item ${isAllSelected ? "active-source" : ""}" data-source-select="all">
      <div class="source-item-main">
        <div class="source-avatar" style="background: linear-gradient(135deg, #5273ff, #34d399);">🌐</div>
        <div class="source-info">
          <div class="source-top-line">
            <span class="source-name">Barcha faol manbalar</span>
            <div class="source-right-meta">
              ${totalUnread > 0 ? `<span class="source-unread-pill">${totalUnread}</span>` : ""}
            </div>
          </div>
          <div class="source-preview-line">
            <span class="source-preview">Umumiy jonli oqim (${state.counts.telegram_total || 0} ta)</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const filtered = getFilteredSources();
  if (!filtered.length) {
    html += `<div class="empty-state small">${
      state.sources.length ? "Filtrga mos manba yo‘q." : "Manba qo‘shish uchun '＋ Qo‘shish' tugmasini bosing."
    }</div>`;
    list.innerHTML = html;
    return;
  }

  html += filtered
    .map((source) => {
      const selected = state.selectedSourceId === source.id;
      const grad = avatarGradient(source.display_name || source.identifier);
      const initials = avatarInitials(source.display_name);
      const icon = sourceTypeIcon(source.type);
      const unread = source.unread_count || 0;
      const preview =
        source.last_message_preview ||
        (source.is_active ? `${source.identifier}` : "⏸ Uzatish to‘xtatilgan");

      return `
        <div class="source-item ${selected ? "active-source" : ""} ${source.is_active ? "" : "paused-source"}" data-source-select="${source.id}">
          <div class="source-item-main">
            <div class="source-avatar" style="background: ${grad};">
              ${escapeHtml(initials)}
              <span class="source-avatar-badge" title="${escapeHtml(sourceTypeLabel(source.type))}">${icon}</span>
            </div>
            <div class="source-info">
              <div class="source-top-line">
                <span class="source-name" title="${escapeHtml(source.display_name)}">${escapeHtml(source.display_name)}</span>
                <div class="source-right-meta">
                  ${unread > 0 && source.is_active ? `<span class="source-unread-pill">${unread}</span>` : ""}
                </div>
              </div>
              <div class="source-preview-line">
                <span class="source-preview" title="${escapeHtml(preview)}">${escapeHtml(preview)}</span>
                <div class="source-mini-controls">
                  <button class="toggle ${source.is_active ? "active" : ""}" data-action="toggle" data-id="${source.id}" type="button" title="${source.is_active ? "Uzatishni to‘xtatish" : "Uzatishni yoqish"}"></button>
                  <button class="mini-del-btn" data-action="delete" data-id="${source.id}" type="button" title="Manbani o‘chirish">🗑</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  list.innerHTML = html;
}

function renderSourceProfileBar() {
  const bar = $("#source-profile-bar");
  if (!bar) return;

  if (state.selectedSourceId === null) {
    // Compact Single-Line Channel Strip
    const chipsHtml = state.sources
      .map((src) => {
        const grad = avatarGradient(src.display_name || src.identifier);
        const initials = avatarInitials(src.display_name);
        return `
          <button type="button" class="channel-chip-pill ${src.is_active ? "" : "paused"}" data-profile-select-source="${src.id}" title="${escapeHtml(src.display_name)} (${escapeHtml(src.identifier)})">
            <span class="chip-mini-avatar" style="background: ${grad};">${escapeHtml(initials)}</span>
            <span>${escapeHtml(src.display_name)}</span>
            ${src.unread_count > 0 && src.is_active ? `<span class="chip-unread">${src.unread_count}</span>` : ""}
            ${!src.is_active ? `<span title="To‘xtatilgan">⏸</span>` : ""}
          </button>
        `;
      })
      .join("");

    bar.innerHTML = `
      <div class="channel-strip-scroll">
        <button type="button" class="channel-chip-pill" style="border-color: var(--accent); color: var(--text);" data-profile-action="back">
          <span class="chip-mini-avatar" style="background: linear-gradient(135deg, #5273ff, #34d399);">🌐</span>
          <span>Barcha faollar</span>
        </button>
        ${chipsHtml || '<span class="opp-note">Manba qo‘shilmagan</span>'}
      </div>
    `;
    return;
  }

  // Dedicated Telegram-Style Profile Bar for Selected Channel/Group/Person
  const source = state.sources.find((s) => s.id === state.selectedSourceId);
  if (!source) {
    state.selectedSourceId = null;
    renderSourceProfileBar();
    return;
  }

  const grad = avatarGradient(source.display_name || source.identifier);
  const initials = avatarInitials(source.display_name);
  const typeIcon = sourceTypeIcon(source.type);
  const typeText = sourceTypeLabel(source.type);
  const tgUrl = telegramPublicUrl(source.identifier);

  bar.innerHTML = `
    <div class="tg-profile-top">
      <div class="tg-profile-identity">
        <button type="button" class="icon-btn sm" data-profile-action="back" title="Barcha manbalarga qaytish">←</button>
        <div class="tg-profile-avatar" style="background: ${grad};">${escapeHtml(initials)}</div>
        <div class="tg-profile-titles">
          <div class="tg-profile-name-row">
            <span class="tg-profile-name">${escapeHtml(source.display_name)}</span>
            <span class="tg-profile-type-badge">${typeIcon} ${escapeHtml(typeText)}</span>
          </div>
          <div class="tg-profile-sub">
            <span>${escapeHtml(source.identifier)}</span>
            ${tgUrl ? `<a href="${escapeHtml(tgUrl)}" target="_blank" rel="noopener noreferrer">Telegram ↗</a>` : ""}
            <span>· Jami: <b>${source.total_count || 0}</b></span>
            <span>· Yangi: <b id="active-profile-unread-count">${source.unread_count || 0}</b></span>
            <span>· Media: <b>${source.media_count || 0}</b></span>
          </div>
        </div>
      </div>

      <div class="tg-profile-actions">
        <button type="button" class="status-pill-btn ${source.is_active ? "active" : "paused"}" data-profile-action="toggle-active" data-id="${source.id}" title="Ushbu manbadan xabar kelishini yoqish yoki to‘xtatish">
          ${source.is_active ? "🟢 Uzatish faol" : "⏸ To‘xtatilgan (Yoqish)"}
        </button>
        <button type="button" class="icon-btn sm" data-profile-action="mark-source-read" data-id="${source.id}" title="Shu manbadagi barcha xabarlarni o‘qildi qilish">✓✓</button>
        <button type="button" class="icon-btn sm" data-profile-action="export-source" data-id="${source.id}" title="Shu manba xabarlarini CSV eksport qilish">📥</button>
        <button type="button" class="icon-btn sm" data-profile-action="rename-source" data-id="${source.id}" title="Manba nomini o‘zgartirish">✏️</button>
        <button type="button" class="icon-btn sm danger" data-profile-action="clear-source" data-id="${source.id}" title="Shu manba xabarlar tarixini tozalash">🧹</button>
      </div>
    </div>
  `;
}

// ── MESSAGE CARDS & STREAM RENDERING ──────────────────────────────

function linkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

function mediaMarkup(message) {
  if (!message.has_media_file) return "";
  const url = `${API_BASE_URL}/api/media/${message.id}`;
  const mime = message.media_mime || "";
  if (mime.startsWith("image/")) {
    return `<img class="message-media" src="${url}" alt="Rasm" loading="lazy" />`;
  }
  if (mime.startsWith("video/")) {
    return `<video class="message-media" src="${url}" controls preload="none"></video>`;
  }
  if (mime.startsWith("audio/")) {
    return `<audio src="${url}" controls></audio>`;
  }
  return `<a class="media-download" href="${url}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(message.media_name || "Faylni yuklab olish")}</a>`;
}

const HOLAT_CLASS = {
  Bepul: "holat-bepul",
  Pullik: "holat-pullik",
  Shubhali: "holat-shubhali",
  Muhim: "holat-muhim",
};
const TAVSIYA_CLASS = {
  "E'tiborsiz qoldirish": "tavsiya-ignore",
  "Xabardor qilish": "tavsiya-notify",
  "Darhol javob berish": "tavsiya-urgent",
};

function dashboardCardMarkup(dashboard, title) {
  if (!dashboard || !dashboard.xulosa) return "";
  const holatClass = HOLAT_CLASS[dashboard.holat] || "holat-shubhali";
  const tavsiyaClass = TAVSIYA_CLASS[dashboard.tavsiya] || "tavsiya-notify";
  const tahlil = Array.isArray(dashboard.tahlil) ? dashboard.tahlil : [];
  return `
    <div class="dashboard-card">
      ${title ? `<div class="dashboard-card-title">${escapeHtml(title)}</div>` : ""}
      <div class="dashboard-xulosa">${escapeHtml(dashboard.xulosa)}</div>
      <div class="dashboard-badges">
        <span class="dashboard-badge ${holatClass}">Holat: ${escapeHtml(dashboard.holat)}</span>
        <span class="dashboard-badge ${tavsiyaClass}">Tavsiya: ${escapeHtml(dashboard.tavsiya)}</span>
      </div>
      ${tahlil.length ? `<ul class="dashboard-tahlil">${tahlil.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

const TRIAGE_LABELS = { 0: "Spam", 1: "Info", 2: "🔔 Muhim", 3: "🚨 Shoshilinch" };

function triageBadgeMarkup(message) {
  const level = message.triage_level;
  if (level === null || level === undefined) return "";
  const label = TRIAGE_LABELS[level] || `D-${level}`;
  return `<span class="triage-badge level-${level}" title="${escapeHtml(message.triage_reason || "")}">${label}</span>`;
}

function renderMessages() {
  if (tgObserver) {
    tgObserver.disconnect();
    tgObserver = null;
  }

  const list = $("#message-list");
  if (!list) return;

  const loadMoreWrap = $("#tg-load-more-wrap");
  if (loadMoreWrap) {
    loadMoreWrap.classList.toggle("hidden", !state.hasMoreMessages);
  }

  if (!state.messages.length) {
    const emptyTitle =
      state.activeTab === "archive"
        ? "Arxiv bo‘sh"
        : state.activeTab === "starred"
          ? "Saqlangan xabarlar yo‘q"
          : state.selectedSourceId !== null
            ? "Ushbu manbada xabarlar topilmadi"
            : "Xabarlar topilmadi";
    const emptySub =
      state.activeTab === "archive"
        ? "Arxivlangan xabarlar shu yerda ko‘rinadi."
        : state.activeTab === "starred"
          ? "Muhim xabarlar ustidagi ☆ tugmasini bosib saqlab qo‘ying."
          : "Yangi xabar kelishini kuting yoki filtr/qidiruvni tekshiring.";

    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✦</div>
        <strong>${emptyTitle}</strong>
        <span>${emptySub}</span>
      </div>`;
    updateBulkBar();
    return;
  }

  const isArchiveTab = state.activeTab === "archive";
  let lastDateLabel = "";
  const chunks = [];

  state.messages.forEach((message) => {
    const dateLabel = formatDateDivider(message.received_at);
    if (dateLabel && dateLabel !== lastDateLabel) {
      lastDateLabel = dateLabel;
      chunks.push(`<div class="date-divider"><span>${escapeHtml(dateLabel)}</span></div>`);
    }

    const isOut = message.direction === "out";
    const checked = state.selectedIds.has(message.id) ? "checked" : "";
    const starred = !!message.is_starred;
    const showSender =
      message.sender_name &&
      message.sender_name.trim().toLowerCase() !== (message.source_display_name || "").trim().toLowerCase();

    chunks.push(`
      <article class="message-card ${message.is_read ? "" : "unread"} ${starred ? "starred-card" : ""} ${isOut ? "outgoing" : ""}" data-message-id="${message.id}">
        <div class="message-meta">
          <div class="message-meta-left">
            <input type="checkbox" class="select-checkbox" data-action="select" data-id="${message.id}" ${checked} title="Tanlash" />
            <button type="button" class="message-source-btn" data-action="open-source" data-source-id="${message.source_id}" title="Shu manba profilini ochish">
              ${isOut ? "Siz → " : ""}${escapeHtml(message.source_display_name)}
            </button>
            ${showSender ? `<span class="sender-inline">${escapeHtml(message.sender_name)}</span>` : ""}
            ${triageBadgeMarkup(message)}
            ${!message.has_media_file && message.media_type ? `<span class="opp-tag">📎 ${escapeHtml(message.media_type)}</span>` : ""}
          </div>
          <div class="message-meta-right">
            <span class="read-state-indicator ${message.is_read ? "" : "is-unread"}" title="${message.is_read ? "Saytda o‘qilgan" : "Yangi (o‘qilmagan)"}">${message.is_read ? "✓✓" : "● Yangi"}</span>
            <time>${escapeHtml(formatTime(message.received_at))}</time>
            <div class="card-icon-actions">
              ${!isOut ? `<button type="button" class="card-act-btn" data-action="reply-toggle" data-id="${message.id}" title="Javob yozish">↩</button>` : ""}
              ${message.is_read ? "" : `<button type="button" class="card-act-btn" data-action="read" data-id="${message.id}" title="O‘qildi deb belgilash">✓</button>`}
              <button type="button" class="card-act-btn ${starred ? "starred" : ""}" data-action="star" data-id="${message.id}" title="Saqlanganlarga qo‘shish / olish">
                ${starred ? "★" : "☆"}
              </button>
              ${
                isArchiveTab
                  ? `<button type="button" class="card-act-btn" data-action="unarchive" data-id="${message.id}" title="Arxivdan qaytarish">📤</button>`
                  : `<button type="button" class="card-act-btn" data-action="archive" data-id="${message.id}" title="Arxivga o‘tkazish">📦</button>`
              }
              <button type="button" class="card-act-btn danger" data-action="delete-single" data-id="${message.id}" title="O‘chirish">🗑</button>
            </div>
          </div>
        </div>
        <div class="message-text">${message.text ? linkify(message.text) : "Media xabar"}</div>
        ${mediaMarkup(message)}
        ${dashboardCardMarkup(message.media_analysis, "Media tahlili")}
        <div class="reply-panel hidden" id="reply-panel-${message.id}">
          <textarea class="reply-textarea" placeholder="Javob yozing... (Ctrl/Cmd+Enter — yuborish)" rows="2"></textarea>
          <div class="reply-files"></div>
          <div class="reply-controls">
            <label class="file-picker-label">
              <input type="file" class="reply-file-input" multiple accept="image/*,video/*,.pdf,.zip,.txt" hidden />
              📎 Fayl
            </label>
            <label class="as-document-label">
              <input type="checkbox" class="as-document-checkbox" /> Hujjat sifatida
            </label>
            <button class="primary-button reply-send-button" data-action="reply-send" data-id="${message.id}" type="button">Yuborish</button>
          </div>
        </div>
      </article>
    `);
  });

  list.innerHTML = chunks.join("");

  attachViewportAutoRead(
    "#message-list",
    ".message-card",
    "messageId",
    state.messages,
    (obs) => {
      tgObserver = obs;
    }
  );

  updateBulkBar();
}

async function loadCounts() {
  try {
    const counts = await api("/api/messages/counts");
    state.counts = { ...state.counts, ...counts };
  } catch (_) {}
  try {
    const notifs = await api("/api/notifications?limit=100");
    state.counts.notifications_unread = notifs.filter((m) => !m.is_read).length;
  } catch (_) {}
  renderTabBadges();
  updateDocumentTitle();
}

function renderTabBadges() {
  $("#tab-inbox-count").textContent = state.counts.telegram_unread || 0;
  $("#tab-archive-count").textContent = state.counts.archived || 0;
  const starredEl = $("#tab-starred-count");
  if (starredEl) starredEl.textContent = state.counts.starred || 0;
  $("#section-telegram-count").textContent = state.counts.telegram_unread || 0;
  $("#section-email-count").textContent = state.counts.email_unread || 0;
  $("#email-tab-inbox-count").textContent = state.counts.email_unread || 0;
  $("#section-opportunity-count").textContent = state.counts.opportunity_unread || 0;
  $("#opp-tab-feed-count").textContent = state.counts.opportunity_unread || 0;
  $("#section-notifications-count").textContent = state.counts.notifications_unread || 0;
}

function updateDocumentTitle() {
  const unread =
    (state.counts.telegram_unread || 0) +
    (state.counts.email_unread || 0) +
    (state.counts.opportunity_unread || 0);
  document.title = unread > 0 ? `(${unread}) Telegram Focus` : "Telegram Focus";
}

function buildMessagesParams(offset = 0) {
  const params = new URLSearchParams({
    limit: String(PAGE_LIMIT),
    offset: String(offset),
    channel: "telegram",
    sort: state.tgSort,
  });

  if (state.selectedSourceId !== null) {
    params.set("source_id", String(state.selectedSourceId));
  }

  if (state.activeTab === "archive") {
    params.set("archived", "true");
  } else if (state.activeTab === "starred") {
    params.set("starred_only", "true");
  } else {
    params.set("archived", "false");
  }

  if (state.tgQuickFilter === "unread") params.set("unread_only", "true");
  else if (state.tgQuickFilter === "media") params.set("has_media", "true");
  else if (state.tgQuickFilter === "links") params.set("has_links", "true");

  if (state.archiveSearch.trim()) {
    params.set("search", state.archiveSearch.trim());
  }
  return params;
}

async function loadData() {
  clearError();
  try {
    const params = buildMessagesParams(0);
    const [sources, messages] = await Promise.all([
      api("/api/sources"),
      api(`/api/messages?${params.toString()}`),
    ]);
    state.sources = sources;
    state.messages = messages;
    state.hasMoreMessages = messages.length >= PAGE_LIMIT;
    renderSources();
    renderSourceProfileBar();
    renderMessages();
    await loadCounts();
  } catch (error) {
    showError(error.message);
  }
}

async function loadMoreMessages() {
  const btn = $("#tg-load-more-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Yuklanmoqda...";
  }
  try {
    const params = buildMessagesParams(state.messages.length);
    const nextBatch = await api(`/api/messages?${params.toString()}`);
    const existingIds = new Set(state.messages.map((m) => m.id));
    nextBatch.forEach((m) => {
      if (!existingIds.has(m.id)) state.messages.push(m);
    });
    state.hasMoreMessages = nextBatch.length >= PAGE_LIMIT;
    renderMessages();
  } catch (error) {
    showError(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "▼ Yana yuklash";
    }
  }
}

async function addSource(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const created = await api("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        identifier: $("#identifier").value,
        display_name: $("#display-name").value || null,
        type: $("#source-type").value,
      }),
    });
    form.reset();
    $("#source-modal")?.classList.add("hidden");
    showToast(`"${created.display_name}" qo‘shildi`);
    await loadData();
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function toggleSourceActive(sourceId) {
  const source = state.sources.find((item) => String(item.id) === String(sourceId));
  if (!source) return;
  const nextActive = !source.is_active;
  // Optimistic update for instant UI response
  source.is_active = nextActive;
  renderSources();
  renderSourceProfileBar();

  try {
    await api(`/api/sources/${source.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: nextActive }),
    });
    showToast(
      nextActive
        ? `🟢 "${source.display_name}" uzatishi yoqildi`
        : `⏸ "${source.display_name}" uzatishi to‘xtatildi`
    );
    await loadData();
  } catch (error) {
    source.is_active = !nextActive;
    renderSources();
    renderSourceProfileBar();
    showError(error.message);
  }
}

async function handleSourceListClick(event) {
  const actionBtn = event.target.closest("[data-action]");
  if (actionBtn) {
    event.stopPropagation();
    const id = actionBtn.dataset.id;
    try {
      if (actionBtn.dataset.action === "toggle") {
        await toggleSourceActive(id);
      } else if (actionBtn.dataset.action === "delete") {
        if (!window.confirm("Bu manba va uning xabarlar tarixini o‘chirasizmi?")) return;
        if (String(state.selectedSourceId) === String(id)) {
          state.selectedSourceId = null;
        }
        await api(`/api/sources/${id}`, { method: "DELETE" });
        showToast("Manba o‘chirildi");
        await loadData();
      }
    } catch (error) {
      showError(error.message);
    }
    return;
  }

  const row = event.target.closest("[data-source-select]");
  if (!row) return;
  const val = row.dataset.sourceSelect;
  if (val === "all") {
    state.selectedSourceId = null;
  } else {
    const numId = Number(val);
    // Agar tanlangan kanalga qayta bosilsa, umumiy oqimga qaytadi
    state.selectedSourceId = state.selectedSourceId === numId ? null : numId;
  }
  state.selectedIds.clear();
  await loadData();
}

async function handleSourceProfileBarClick(event) {
  const chip = event.target.closest("[data-profile-select-source]");
  if (chip) {
    const numId = Number(chip.dataset.profileSelectSource);
    state.selectedSourceId = state.selectedSourceId === numId ? null : numId;
    state.selectedIds.clear();
    await loadData();
    return;
  }

  const btn = event.target.closest("[data-profile-action]");
  if (!btn) return;
  const action = btn.dataset.profileAction;
  const id = Number(btn.dataset.id);

  try {
    if (action === "back") {
      state.selectedSourceId = null;
      state.selectedIds.clear();
      await loadData();
    } else if (action === "toggle-active") {
      await toggleSourceActive(id);
    } else if (action === "mark-source-read") {
      const res = await api("/api/messages/read-bulk", {
        method: "POST",
        body: JSON.stringify({ source_id: id }),
      });
      showToast(`✓✓ ${res.read} ta xabar o‘qildi deb belgilandi`);
      await loadData();
    } else if (action === "export-source") {
      await triggerMessagesExport({ source_id: id, channel: "telegram", format: "csv", then_action: "none" });
    } else if (action === "rename-source") {
      const src = state.sources.find((s) => s.id === id);
      const nextName = window.prompt("Manba uchun yangi ko‘rinadigan nom:", src ? src.display_name : "");
      if (!nextName || !nextName.trim()) return;
      await api(`/api/sources/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ display_name: nextName.trim() }),
      });
      showToast("Manba nomi yangilandi");
      await loadData();
    } else if (action === "clear-source") {
      if (!window.confirm("Ushbu manbadagi barcha xabarlarni o‘chirasizmi? (Manbaning o‘zi saqlanadi)")) return;
      const res = await api("/api/messages/delete-bulk", {
        method: "POST",
        body: JSON.stringify({ source_id: id }),
      });
      showToast(`🧹 ${res.deleted} ta xabar tozalandi`);
      await loadData();
    }
  } catch (error) {
    showError(error.message);
  }
}

async function markRead(event) {
  const button = event.target.closest('[data-action="read"]');
  if (!button) return;
  const id = Number(button.dataset.id);
  try {
    const archive = state.archiveSettings.archive_on_read;
    await api(`/api/messages/${id}/read?archive=${archive}`, { method: "PATCH" });
    if (archive) {
      await fadeOutCard(id);
      await loadData();
    } else {
      const msg = state.messages.find((m) => m.id === id);
      if (msg && !msg.is_read) {
        msg.is_read = true;
        const src = state.sources.find((s) => s.id === msg.source_id);
        if (src && src.unread_count > 0) {
          src.unread_count = Math.max(0, src.unread_count - 1);
          updateSourceBadgeInPlace(src.id, src.unread_count);
        }
      }
      const card = document.querySelector(`.message-card[data-message-id="${id}"]`);
      if (card) {
        card.classList.remove("unread");
        const ind = card.querySelector(".read-state-indicator");
        if (ind) {
          ind.classList.remove("is-unread");
          ind.textContent = "✓✓";
        }
      }
      button.remove();
      await loadCounts();
    }
  } catch (error) {
    showError(error.message);
  }
}

async function toggleStarMessage(messageId) {
  try {
    const updated = await api(`/api/messages/${messageId}/star`, { method: "PATCH" });
    const isStarred = !!updated.is_starred;

    const msg = state.messages.find((m) => String(m.id) === String(messageId));
    if (msg) msg.is_starred = isStarred;
    const emailMsg = state.email.messages.find((m) => String(m.id) === String(messageId));
    if (emailMsg) emailMsg.is_starred = isStarred;
    const oppMsg = state.opp.feed.find((m) => String(m.id) === String(messageId));
    if (oppMsg) oppMsg.is_starred = isStarred;

    // Update star button in-place without re-rendering whole list
    const card =
      document.querySelector(`.message-card[data-message-id="${messageId}"]`) ||
      document.querySelector(`.email-card[data-email-id="${messageId}"]`) ||
      document.querySelector(`.message-card[data-opp-id="${messageId}"]`);
    if (card) {
      card.classList.toggle("starred-card", isStarred);
      const starBtn =
        card.querySelector('[data-action="star"]') ||
        card.querySelector('[data-email-action="star"]') ||
        card.querySelector('[data-opp-action="star"]');
      if (starBtn) {
        starBtn.classList.toggle("starred", isStarred);
        starBtn.textContent = isStarred ? "★" : "☆";
      }
    }

    if (state.activeTab === "starred" && !isStarred) {
      await loadData();
    }
    showToast(isStarred ? "★ Saqlandi" : "☆ Saqlanganlardan olindi");
    await loadCounts();
  } catch (error) {
    showError(error.message);
  }
}

async function handleNotificationsClick(event) {
  const readButton = event.target.closest('[data-action="read"]');
  const confirmButton = event.target.closest('[data-action="confirm-auto-reply"]');
  const cancelButton = event.target.closest('[data-action="cancel-auto-reply"]');
  try {
    if (readButton) {
      await api(`/api/messages/${readButton.dataset.id}/read?archive=false`, { method: "PATCH" });
      await loadNotifications();
      await loadCounts();
    } else if (confirmButton) {
      const result = await api(`/api/messages/${confirmButton.dataset.id}/confirm-auto-reply`, { method: "POST" });
      if (!result.sent && result.reason === "rate_limited") {
        showError("Bu chatga so‘nggi 24 soatda allaqachon auto-javob yuborilgan.");
      } else {
        showToast("Javob yuborildi");
      }
      await loadNotifications();
    } else if (cancelButton) {
      await api(`/api/messages/${cancelButton.dataset.id}/cancel-auto-reply`, { method: "POST" });
      await fadeOutCard(cancelButton.dataset.id);
      await loadNotifications();
      await loadCounts();
    }
  } catch (error) {
    showError(error.message);
  }
}

async function fadeOutCard(messageId) {
  const card = document.querySelector(`.message-card[data-message-id="${messageId}"]`);
  if (!card) return;
  card.classList.add("removing");
  await new Promise((resolve) => setTimeout(resolve, 160));
}

async function archiveMessage(messageId) {
  try {
    await api(`/api/messages/${messageId}/archive`, { method: "PATCH" });
    await fadeOutCard(messageId);
    state.selectedIds.delete(Number(messageId));
    state.messages = state.messages.filter((m) => String(m.id) !== String(messageId));
    renderMessages();
    await loadCounts();
  } catch (error) {
    showError(error.message);
  }
}

async function unarchiveMessage(messageId) {
  try {
    await api(`/api/messages/${messageId}/unarchive`, { method: "PATCH" });
    await fadeOutCard(messageId);
    state.selectedIds.delete(Number(messageId));
    state.messages = state.messages.filter((m) => String(m.id) !== String(messageId));
    renderMessages();
    await loadCounts();
  } catch (error) {
    showError(error.message);
  }
}

async function deleteSingleMessage(messageId) {
  try {
    await api(`/api/messages/${messageId}`, { method: "DELETE" });
    await fadeOutCard(messageId);
    state.selectedIds.delete(Number(messageId));
    state.messages = state.messages.filter((m) => String(m.id) !== String(messageId));
    renderMessages();
    showToast("Xabar o‘chirildi");
    await loadCounts();
  } catch (error) {
    showError(error.message);
  }
}

// ── BUG #3: BULK SELECTION, EXPORT, ARCHIVE & DELETE ──────────────

function toggleSelect(messageId, checked) {
  const id = Number(messageId);
  if (checked) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  updateBulkBar();
}

function updateBulkBar() {
  const bar = $("#bulk-bar");
  const selectAllBox = $("#tg-select-all-checkbox");
  const count = state.selectedIds.size;

  if (selectAllBox) {
    const allVisibleSelected =
      state.messages.length > 0 && state.messages.every((m) => state.selectedIds.has(m.id));
    selectAllBox.checked = allVisibleSelected;
  }

  if (bar) {
    if (count > 0) {
      bar.classList.remove("hidden");
      $("#bulk-selected-count").textContent = `${count} ta tanlandi`;
    } else {
      bar.classList.add("hidden");
    }
  }
}

function buildCurrentTgBulkPayload() {
  if (state.selectedIds.size > 0) {
    return { ids: Array.from(state.selectedIds) };
  }
  // Agar qidiruv yoki maxsus filtr yoqilgan bo'lsa, faqat ko'rinib turgan xabarlarga qo'llaymiz
  if (state.archiveSearch.trim() || state.tgQuickFilter !== "all" || state.activeTab === "starred") {
    return { ids: state.messages.map((m) => m.id) };
  }
  const payload = {
    channel: "telegram",
    archived: state.activeTab === "archive",
    all_matching: true,
  };
  if (state.selectedSourceId !== null) {
    payload.source_id = state.selectedSourceId;
  }
  return payload;
}

async function bulkMarkReadTg() {
  try {
    const payload = buildCurrentTgBulkPayload();
    const res = await api("/api/messages/read-bulk", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.selectedIds.clear();
    showToast(`✓✓ ${res.read} ta xabar o‘qildi deb belgilandi`);
    await loadData();
  } catch (error) {
    showError(error.message);
  }
}

async function bulkArchiveSelected() {
  try {
    if (state.activeTab === "archive") {
      // Arxiv tabida bo'lsa — arxivdan qaytarish
      const payload = buildCurrentTgBulkPayload();
      const res = await api("/api/messages/unarchive-bulk", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.selectedIds.clear();
      showToast(`📤 ${res.unarchived} ta xabar arxivdan qaytarildi`);
      await loadData();
      return;
    }

    if (state.selectedIds.size === 0) {
      if (!state.messages.length) return;
      const scopeLabel =
        state.selectedSourceId !== null ? "shu manbadagi barcha xabarlarni" : "ko‘rinib turgan xabarlarni";
      if (!window.confirm(`${scopeLabel} arxivga o‘tkazasizmi?`)) return;
    }
    const payload = buildCurrentTgBulkPayload();
    const result = await api("/api/messages/archive-bulk", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.selectedIds.clear();
    showToast(`📦 ${result.archived} ta xabar arxivlandi`);
    await loadData();
    return result;
  } catch (error) {
    showError(error.message);
  }
}

async function bulkDeleteSelected() {
  const hasSelection = state.selectedIds.size > 0;
  if (!hasSelection && !state.messages.length) return;
  const confirmText = hasSelection
    ? `Tanlangan ${state.selectedIds.size} ta xabarni butunlay o‘chirasizmi?`
    : `Ushbu bo‘limdagi barcha xabarlarni butunlay o‘chirasizmi?`;
  if (!window.confirm(confirmText)) return;

  try {
    const payload = buildCurrentTgBulkPayload();
    const res = await api("/api/messages/delete-bulk", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.selectedIds.clear();
    showToast(`🗑 ${res.deleted} ta xabar o‘chirildi`);
    await loadData();
  } catch (error) {
    showError(error.message);
  }
}

async function triggerMessagesExport({
  ids = null,
  source_id = null,
  channel = "telegram",
  archived = null,
  format = "csv",
  then_action = "none",
}) {
  if (then_action === "delete") {
    if (!window.confirm("Eksport qilingandan so‘ng ushbu xabarlar bazadan o‘chiriladi. Davom etasizmi?")) return;
  }
  const params = new URLSearchParams({ format, then_action });
  if (ids && ids.length) {
    params.set("ids", ids.join(","));
  } else {
    if (channel) params.set("channel", channel);
    if (source_id !== null && source_id !== undefined) params.set("source_id", String(source_id));
    if (archived !== null && archived !== undefined) params.set("archived", String(archived));
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/messages/export?${params.toString()}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error(`Eksport xatosi (${response.status})`);
    const blob = await response.blob();
    const disp = response.headers.get("Content-Disposition") || "";
    const match = disp.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `${channel}-export.${format}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast(
      then_action === "archive"
        ? "📥 Eksport yuklandi va xabarlar arxivlandi"
        : then_action === "delete"
          ? "📥 Eksport yuklandi va xabarlar o‘chirildi"
          : `📥 ${filename} yuklab olindi`
    );

    if (then_action !== "none") {
      state.selectedIds.clear();
      state.email.selectedIds.clear();
      if (state.section === "email") await loadEmailData();
      else await loadData();
    }
  } catch (error) {
    showError(error.message);
  }
}

function switchTab(tab) {
  if (!tab || state.activeTab === tab) return;
  state.activeTab = tab;
  state.selectedIds.clear();
  document.querySelectorAll("#telegram-section .seg-tabs [data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  const archBtn = $("#bulk-archive-button");
  if (archBtn) {
    archBtn.textContent = tab === "archive" ? "📤" : "📦";
    archBtn.title = tab === "archive" ? "Arxivdan qaytarish" : "Arxivlash (e)";
  }
  loadData();
}

let searchDebounceTimer = null;
function handleArchiveSearchInput(event) {
  clearTimeout(searchDebounceTimer);
  const value = event.target.value;
  const clearBtn = $("#clear-search-btn");
  if (clearBtn) clearBtn.classList.toggle("hidden", !value);
  searchDebounceTimer = setTimeout(() => {
    state.archiveSearch = value;
    loadData();
  }, 240);
}

async function loadArchiveSettings() {
  try {
    state.archiveSettings = await api("/api/settings/archive");
  } catch (_) {}
}

async function loadAutoResponderSettings() {
  try {
    const result = await api("/api/settings/auto-responder");
    state.autoReplyEnabled = result.auto_reply_enabled;
  } catch (_) {}
}

function openArchiveSettingsDialog() {
  $("#setting-archive-on-read").checked = state.archiveSettings.archive_on_read;
  $("#setting-archive-on-reply").checked = state.archiveSettings.archive_on_reply;
  $("#setting-auto-archive-days").value = state.archiveSettings.auto_archive_days;
  const autoReplyCheckbox = $("#setting-auto-reply-enabled");
  if (autoReplyCheckbox) autoReplyCheckbox.checked = state.autoReplyEnabled;
  $("#archive-settings-dialog").classList.remove("hidden");
}

function closeArchiveSettingsDialog() {
  $("#archive-settings-dialog").classList.add("hidden");
}

async function saveArchiveSettings() {
  const payload = {
    archive_on_read: $("#setting-archive-on-read").checked,
    archive_on_reply: $("#setting-archive-on-reply").checked,
    auto_archive_days: Number($("#setting-auto-archive-days").value) || 0,
  };
  try {
    state.archiveSettings = await api("/api/settings/archive", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    const autoReplyCheckbox = $("#setting-auto-reply-enabled");
    if (autoReplyCheckbox) {
      const result = await api("/api/settings/auto-responder", {
        method: "PUT",
        body: JSON.stringify({ auto_reply_enabled: autoReplyCheckbox.checked }),
      });
      state.autoReplyEnabled = result.auto_reply_enabled;
    }
    closeArchiveSettingsDialog();
    showToast("Sozlamalar saqlandi");
    await loadNotifications();
  } catch (error) {
    showError(error.message);
  }
}

function handleGlobalKeydown(event) {
  const tag = (event.target.tagName || "").toLowerCase();
  const isEditable = tag === "input" || tag === "textarea" || tag === "select" || event.target.isContentEditable;
  if (event.key === "Escape") {
    document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.add("hidden"));
    $("#tg-export-dropdown")?.classList.add("hidden");
    if (!isEditable && state.selectedIds.size > 0) {
      state.selectedIds.clear();
      renderMessages();
    }
    return;
  }
  if (isEditable) return;

  if (event.key === "/") {
    event.preventDefault();
    if (state.section === "telegram") $("#archive-search")?.focus();
    else if (state.section === "email") $("#email-search-input")?.focus();
    else if (state.section === "opportunity") $("#opp-search-input")?.focus();
    return;
  }
  if (event.key === "?") {
    event.preventDefault();
    $("#shortcuts-dialog")?.classList.toggle("hidden");
    return;
  }

  if (state.section === "telegram") {
    if ((event.key === "e" || event.key === "a") && state.selectedIds.size > 0) {
      event.preventDefault();
      bulkArchiveSelected();
    } else if (event.key === "r") {
      event.preventDefault();
      bulkMarkReadTg();
    } else if (event.key === "u") {
      event.preventDefault();
      state.tgQuickFilter = state.tgQuickFilter === "unread" ? "all" : "unread";
      document.querySelectorAll("#tg-quick-filters .filter-chip").forEach((c) => {
        c.classList.toggle("active", c.dataset.tgFilter === state.tgQuickFilter);
      });
      loadData();
    }
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addReplyFiles(messageId, fileList) {
  const files = state.replyFiles[messageId] || (state.replyFiles[messageId] = []);
  for (const file of fileList) {
    try {
      const data_b64 = await fileToBase64(file);
      files.push({ name: file.name, mime: file.type || "application/octet-stream", data_b64 });
    } catch (error) {
      showError("Faylni o‘qishda xato: " + error.message);
    }
  }
  renderReplyFileChips(messageId);
}

function renderReplyFileChips(messageId) {
  const panel = document.getElementById(`reply-panel-${messageId}`);
  if (!panel) return;
  const container = panel.querySelector(".reply-files");
  const files = state.replyFiles[messageId] || [];
  container.innerHTML = files
    .map(
      (file, index) => `
        <span class="file-chip">
          ${escapeHtml(file.name)}
          <button type="button" class="file-chip-remove" data-action="reply-file-remove" data-id="${messageId}" data-index="${index}">✕</button>
        </span>
      `
    )
    .join("");
}

function toggleReplyPanel(messageId) {
  const panel = document.getElementById(`reply-panel-${messageId}`);
  if (!panel) return;
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    panel.querySelector(".reply-textarea").focus();
  }
}

async function sendReply(messageId) {
  const panel = document.getElementById(`reply-panel-${messageId}`);
  if (!panel) return;
  const textarea = panel.querySelector(".reply-textarea");
  const button = panel.querySelector(".reply-send-button");
  const asDocument = panel.querySelector(".as-document-checkbox").checked;
  const text = textarea.value.trim();
  const files = state.replyFiles[messageId] || [];

  if (!text && !files.length) {
    showError("Matn yoki fayl kiriting.");
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Yuborilmoqda…";
  try {
    await api(`/api/messages/${messageId}/reply`, {
      method: "POST",
      body: JSON.stringify({ text, files, as_document: asDocument }),
    });
    textarea.value = "";
    delete state.replyFiles[messageId];
    panel.classList.add("hidden");
    showToast("Javob yuborildi");
    await loadData();
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function handleMessageListClick(event) {
  const openSourceBtn = event.target.closest('[data-action="open-source"]');
  if (openSourceBtn) {
    const srcId = Number(openSourceBtn.dataset.sourceId);
    if (srcId) {
      state.selectedSourceId = state.selectedSourceId === srcId ? null : srcId;
      state.selectedIds.clear();
      await loadData();
    }
    return;
  }

  const starBtn = event.target.closest('[data-action="star"]');
  if (starBtn) {
    await toggleStarMessage(starBtn.dataset.id);
    return;
  }

  const readButton = event.target.closest('[data-action="read"]');
  if (readButton) return markRead(event);

  const replyToggle = event.target.closest('[data-action="reply-toggle"]');
  if (replyToggle) {
    toggleReplyPanel(replyToggle.dataset.id);
    return;
  }

  const replySend = event.target.closest('[data-action="reply-send"]');
  if (replySend) {
    await sendReply(replySend.dataset.id);
    return;
  }

  const fileRemove = event.target.closest('[data-action="reply-file-remove"]');
  if (fileRemove) {
    const files = state.replyFiles[fileRemove.dataset.id] || [];
    files.splice(Number(fileRemove.dataset.index), 1);
    renderReplyFileChips(fileRemove.dataset.id);
    return;
  }

  const archiveButton = event.target.closest('[data-action="archive"]');
  if (archiveButton) {
    await archiveMessage(archiveButton.dataset.id);
    return;
  }

  const unarchiveButton = event.target.closest('[data-action="unarchive"]');
  if (unarchiveButton) {
    await unarchiveMessage(unarchiveButton.dataset.id);
    return;
  }

  const deleteSingleBtn = event.target.closest('[data-action="delete-single"]');
  if (deleteSingleBtn) {
    await deleteSingleMessage(deleteSingleBtn.dataset.id);
    return;
  }

  const card = event.target.closest(".message-card");
  if (card && card.classList.contains("unread")) {
    queueAutoRead(card.dataset.messageId);
  }
}

function handleMessageListChangeEvent(event) {
  const select = event.target.closest('[data-action="select"]');
  if (select) {
    toggleSelect(select.dataset.id, select.checked);
    return;
  }
  handleMessageListChange(event);
}

function handleMessageListChange(event) {
  const input = event.target.closest(".reply-file-input");
  if (!input) return;
  const card = input.closest(".message-card");
  const messageId = card?.dataset.messageId;
  if (messageId && input.files.length) {
    addReplyFiles(messageId, input.files);
    input.value = "";
  }
}

function handleMessageListKeydown(event) {
  const textarea = event.target.closest(".reply-textarea");
  if (!textarea) return;
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    const card = textarea.closest(".message-card");
    if (card?.dataset.messageId) sendReply(card.dataset.messageId);
  }
}

function handleMessageListPaste(event) {
  const textarea = event.target.closest(".reply-textarea");
  if (!textarea) return;
  const card = textarea.closest(".message-card");
  const messageId = card?.dataset.messageId;
  if (!messageId || !event.clipboardData) return;
  const imageItems = Array.from(event.clipboardData.items || []).filter((item) => item.type.startsWith("image/"));
  if (!imageItems.length) return;
  event.preventDefault();
  const files = imageItems.map((item) => item.getAsFile()).filter(Boolean);
  if (files.length) addReplyFiles(messageId, files);
}

function handleMessageListDragOver(event) {
  if (event.target.closest(".reply-panel")) event.preventDefault();
}

function handleMessageListDrop(event) {
  const panel = event.target.closest(".reply-panel");
  if (!panel) return;
  event.preventDefault();
  const card = panel.closest(".message-card");
  const messageId = card?.dataset.messageId;
  if (messageId && event.dataTransfer?.files?.length) {
    addReplyFiles(messageId, event.dataTransfer.files);
  }
}

// ── SECTION SWITCHER & NOTIFICATIONS ──────────────────────────────

function switchSection(section) {
  if (state.section === section) return;
  state.section = section;
  document.querySelectorAll(".section-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === section);
  });
  $("#telegram-section").classList.toggle("hidden", section !== "telegram");
  $("#email-section").classList.toggle("hidden", section !== "email");
  $("#opportunity-section").classList.toggle("hidden", section !== "opportunity");
  $("#notifications-section").classList.toggle("hidden", section !== "notifications");
  if (section === "email") loadEmailData();
  else if (section === "opportunity") loadOppData();
  else if (section === "notifications") loadNotifications();
  else loadData();
}

async function loadNotifications() {
  try {
    const items = await api("/api/notifications?limit=150");
    renderNotifications(items);
  } catch (_) {}
}

function renderNotifications(items) {
  const list = $("#notif-list");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔔</div>
        <strong>Bildirishnomalar yo‘q</strong>
        <span>Shoshilinch va e'tibor talab qiladigan xabarlar shu yerda ko‘rinadi.</span>
      </div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (message) => `
      <article class="message-card ${message.is_read ? "" : "unread"}" data-message-id="${message.id}">
        <div class="message-meta">
          <div class="message-meta-left">
            <span class="message-source-btn">${escapeHtml(message.source_display_name)}</span>
            <span class="sender-inline">${escapeHtml(message.sender_name)}</span>
            ${triageBadgeMarkup(message)}
          </div>
          <div class="message-meta-right">
            <time>${escapeHtml(formatTime(message.received_at))}</time>
            ${message.is_read ? "" : `<button class="card-act-btn" data-action="read" data-id="${message.id}" title="O‘qildi">✓</button>`}
          </div>
        </div>
        <div class="message-text">${message.text ? linkify(message.text) : "Media xabar"}</div>
        ${
          message.triage_level === 3 && message.triage_dashboard
            ? dashboardCardMarkup(message.triage_dashboard, "🚨 Shoshilinch tahlil")
            : message.triage_reason
              ? `<div class="opp-reasons">Tavsiya: ${escapeHtml(message.triage_reason)}</div>`
              : ""
        }
        ${message.triage_auto_reply ? `<div class="opp-reasons">Auto-javob: ${escapeHtml(message.triage_auto_reply)}</div>` : ""}
        ${
          message.triage_level === 2 && !state.autoReplyEnabled
            ? `<div style="margin-top:8px; display:flex; gap:6px;">
                 <button class="chip-action-btn primary" data-action="confirm-auto-reply" data-id="${message.id}">✓ Auto-javobni yuborish</button>
                 <button class="chip-action-btn danger" data-action="cancel-auto-reply" data-id="${message.id}">Bekor qilish</button>
               </div>`
            : ""
        }
      </article>`
    )
    .join("");
}

// ── EMAIL SECTION (STAGE 4 + BUG #3 & #4) ─────────────────────────

function safeLinkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s<&]+(?:&amp;[^\s<&]*)*)/g, (raw) => {
    const url = raw.replace(/&amp;/g, "&");
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return raw;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return raw;
    return `<a href="${escapeHtml(parsed.href)}" target="_blank" rel="noopener noreferrer nofollow">${raw}</a>`;
  });
}

function splitEmailText(text) {
  const value = String(text || "");
  const index = value.indexOf("\n\n");
  if (index === -1) return { subject: value || "(mavzusiz)", body: "" };
  return { subject: value.slice(0, index) || "(mavzusiz)", body: value.slice(index + 2) };
}

function splitAttachments(body) {
  const lines = body.split("\n");
  const attachments = [];
  while (lines.length && lines[lines.length - 1].startsWith("📎 ")) {
    attachments.unshift(lines.pop());
  }
  return { body: lines.join("\n").trim(), attachments };
}

async function loadEmailPresets() {
  try {
    state.email.presets = await api("/api/email/presets");
  } catch (_) {
    state.email.presets = [];
  }
  const select = $("#email-preset");
  if (!select) return;
  select.innerHTML =
    '<option value="">Boshqa (qo‘lda)</option>' +
    state.email.presets
      .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`)
      .join("");
}

function handleEmailPresetChange() {
  const preset = state.email.presets.find((item) => item.id === $("#email-preset").value);
  const note = $("#email-preset-note");
  if (!preset) {
    note.classList.add("hidden");
    return;
  }
  $("#email-host").value = preset.imap_host;
  $("#email-port").value = preset.imap_port;
  note.textContent = preset.note;
  note.classList.remove("hidden");
}

function renderEmailAccounts() {
  $("#email-account-count").textContent = state.email.accounts.length;
  const list = $("#email-account-list");
  if (!list) return;

  const isAll = state.email.selectedAccountId === null;
  let html = `
    <div class="source-item ${isAll ? "active-source" : ""}" data-email-select="all">
      <div class="source-item-main">
        <div class="source-avatar" style="background: linear-gradient(135deg, #3b82f6, #8b5cf6);">✉</div>
        <div class="source-info">
          <div class="source-top-line">
            <span class="source-name">Barcha hisoblar</span>
            <div class="source-right-meta">
              ${state.counts.email_unread > 0 ? `<span class="source-unread-pill">${state.counts.email_unread}</span>` : ""}
            </div>
          </div>
          <div class="source-preview-line">
            <span class="source-preview">Jami ${state.counts.email_total || 0} ta xat</span>
          </div>
        </div>
      </div>
    </div>
  `;

  if (!state.email.accounts.length) {
    html += '<div class="empty-state small">Hisob ulash uchun "＋ Ulash" tugmasini bosing.</div>';
    list.innerHTML = html;
    return;
  }

  html += state.email.accounts
    .map((account) => {
      const dotClass = account.last_error ? "error" : account.is_active ? "" : "paused";
      const selected = state.email.selectedAccountId === account.id;
      const grad = avatarGradient(account.label || account.username);
      const initials = avatarInitials(account.label);
      return `
        <div class="source-item ${selected ? "active-source" : ""} ${account.is_active ? "" : "paused-source"}" data-email-select="${account.id}">
          <div class="source-item-main">
            <div class="source-avatar" style="background: ${grad};">${escapeHtml(initials)}</div>
            <div class="source-info">
              <div class="source-top-line">
                <span class="source-name" title="${escapeHtml(account.label)}">
                  <span class="email-dot ${dotClass}"></span>${escapeHtml(account.label)}
                </span>
                <div class="source-right-meta">
                  ${account.unread_count > 0 ? `<span class="source-unread-pill">${account.unread_count}</span>` : ""}
                </div>
              </div>
              <div class="source-preview-line">
                <span class="source-preview">${escapeHtml(account.username)}</span>
                <div class="source-mini-controls">
                  <button class="toggle ${account.is_active ? "active" : ""}" data-email-action="toggle" data-id="${account.id}" type="button" title="Faollik"></button>
                  <button class="mini-del-btn" data-email-action="check" data-id="${account.id}" type="button" title="Hozir tekshirish">🔄</button>
                  <button class="mini-del-btn" data-email-action="password" data-id="${account.id}" type="button" title="Parolni yangilash">🔑</button>
                  <button class="mini-del-btn" data-email-action="delete" data-id="${account.id}" type="button" title="O‘chirish">🗑</button>
                </div>
              </div>
            </div>
          </div>
          ${account.last_error ? `<div style="color:var(--red); font-size:10.5px; margin-top:4px;">${escapeHtml(account.last_error)}</div>` : ""}
        </div>`;
    })
    .join("");

  list.innerHTML = html;
}

function renderEmailProfileBar() {
  const bar = $("#email-profile-bar");
  if (!bar) return;
  if (state.email.selectedAccountId === null) {
    bar.innerHTML = `
      <div class="tg-profile-top">
        <div class="tg-profile-identity">
          <span>✉️ <b>Barcha ulangan pochta hisoblari</b></span>
          <span class="opp-note">(${state.email.accounts.length} ta hisob · ${state.counts.email_unread || 0} ta yangi)</span>
        </div>
        <span class="opp-note">Ko‘rilgan xatlar saytda avtomatik o‘qildi deb belgilanadi</span>
      </div>
    `;
    return;
  }
  const acc = state.email.accounts.find((a) => a.id === state.email.selectedAccountId);
  if (!acc) {
    state.email.selectedAccountId = null;
    renderEmailProfileBar();
    return;
  }
  const grad = avatarGradient(acc.label || acc.username);
  bar.innerHTML = `
    <div class="tg-profile-top">
      <div class="tg-profile-identity">
        <button type="button" class="icon-btn sm" data-email-profile-back="1" title="Barcha hisoblarga qaytish">←</button>
        <div class="tg-profile-avatar" style="background: ${grad};">${escapeHtml(avatarInitials(acc.label))}</div>
        <div class="tg-profile-titles">
          <div class="tg-profile-name-row">
            <span class="tg-profile-name">${escapeHtml(acc.label)}</span>
            <span class="tg-profile-type-badge">${escapeHtml(acc.imap_host)}</span>
          </div>
          <div class="tg-profile-sub">
            <span>${escapeHtml(acc.username)}</span>
            <span>· Jami: <b>${acc.total_count || 0}</b></span>
            <span>· Yangi: <b>${acc.unread_count || 0}</b></span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderEmailMessages() {
  if (emailObserver) {
    emailObserver.disconnect();
    emailObserver = null;
  }

  const list = $("#email-list");
  if (!list) return;

  if (!state.email.messages.length) {
    const archive = state.email.tab === "archive";
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✉</div>
        <strong>${archive ? "Arxiv bo‘sh" : "Xatlar topilmadi"}</strong>
        <span>${archive ? "Arxivlangan xatlar shu yerda ko‘rinadi." : state.email.accounts.length ? "Yangi xat kelishini kuting." : "Chapdan '＋ Ulash' orqali email hisob qo‘shing."}</span>
      </div>`;
    return;
  }

  const isArchive = state.email.tab === "archive";

  list.innerHTML = state.email.messages
    .map((message) => {
      const { subject, body: rawBody } = splitEmailText(message.text);
      const { body, attachments } = splitAttachments(rawBody);
      const expanded = state.email.expanded.has(message.id);
      const checked = state.email.selectedIds.has(message.id) ? "checked" : "";
      const starred = !!message.is_starred;
      return `
        <article class="message-card email-card ${message.is_read ? "" : "unread"} ${starred ? "starred-card" : ""} ${expanded ? "expanded" : ""}" data-email-id="${message.id}">
          <div class="message-meta">
            <div class="message-meta-left">
              <input type="checkbox" class="select-checkbox" data-email-select-id="${message.id}" ${checked} onclick="event.stopPropagation()" />
              <span class="message-source-btn">${escapeHtml(message.source_display_name)}</span>
              <span class="email-from">${escapeHtml(message.sender_name)}</span>
            </div>
            <div class="message-meta-right">
              <span class="read-state-indicator ${message.is_read ? "" : "is-unread"}">${message.is_read ? "✓✓" : "● Yangi"}</span>
              <time>${escapeHtml(formatTime(message.received_at))}</time>
              <div class="card-icon-actions">
                ${message.is_read ? "" : `<button type="button" class="card-act-btn" data-email-action="read" data-id="${message.id}" title="O‘qildi">✓</button>`}
                <button type="button" class="card-act-btn ${starred ? "starred" : ""}" data-email-action="star" data-id="${message.id}">${starred ? "★" : "☆"}</button>
                ${
                  isArchive
                    ? `<button type="button" class="card-act-btn" data-email-action="unarchive" data-id="${message.id}" title="Qaytarish">📤</button>`
                    : `<button type="button" class="card-act-btn" data-email-action="archive" data-id="${message.id}" title="Arxivga">📦</button>`
                }
                <button type="button" class="card-act-btn danger" data-email-action="delete-single" data-id="${message.id}" title="O‘chirish">🗑</button>
              </div>
            </div>
          </div>
          <div class="email-subject">${escapeHtml(subject)}</div>
          <div class="email-snippet">${expanded ? safeLinkify(body || "(matn yo‘q)") : escapeHtml(body)}</div>
          ${attachments.length ? `<div style="margin-top:6px; font-size:11px; color:var(--accent);">${attachments.map((line) => escapeHtml(line)).join("<br>")}</div>` : ""}
        </article>`;
    })
    .join("");

  attachViewportAutoRead(
    "#email-list",
    ".email-card",
    "emailId",
    state.email.messages,
    (obs) => {
      emailObserver = obs;
    }
  );
}

async function loadEmailData() {
  clearError();
  try {
    const params = new URLSearchParams({
      limit: "200",
      channel: "email",
    });
    if (state.email.tab === "archive") {
      params.set("archived", "true");
    } else if (state.email.tab === "starred") {
      params.set("starred_only", "true");
    } else {
      params.set("archived", "false");
    }
    if (state.email.quickFilter === "unread") {
      params.set("unread_only", "true");
    }
    if (state.email.search.trim()) {
      params.set("search", state.email.search.trim());
    }

    const [accounts, allMessages] = await Promise.all([
      api("/api/email/accounts"),
      api(`/api/messages?${params.toString()}`),
    ]);
    state.email.accounts = accounts;
    if (state.email.selectedAccountId !== null) {
      const acc = accounts.find((a) => a.id === state.email.selectedAccountId);
      state.email.messages = allMessages.filter(
        (m) => m.chat_id === state.email.selectedAccountId || (acc && m.source_id === acc.source_id)
      );
    } else {
      state.email.messages = allMessages;
    }
    renderEmailAccounts();
    renderEmailProfileBar();
    renderEmailMessages();
    await loadCounts();
  } catch (error) {
    showError(error.message);
  }
}

async function addEmailAccount(event) {
  event.preventDefault();
  const button = $("#email-add-button");
  button.disabled = true;
  button.textContent = "Tekshirilmoqda...";
  try {
    await api("/api/email/accounts", {
      method: "POST",
      body: JSON.stringify({
        label: $("#email-label").value,
        imap_host: $("#email-host").value,
        imap_port: Number($("#email-port").value) || 993,
        username: $("#email-username").value,
        password: $("#email-password").value,
        folder: $("#email-folder").value || "INBOX",
      }),
    });
    $("#email-account-form").reset();
    $("#email-port").value = 993;
    $("#email-folder").value = "INBOX";
    $("#email-preset-note").classList.add("hidden");
    $("#email-modal")?.classList.add("hidden");
    showToast("Email hisob ulandi");
    await loadEmailData();
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Hisobni ulash";
    $("#email-password").value = "";
  }
}

async function handleEmailAccountAction(event) {
  const button = event.target.closest("[data-email-action]");
  if (button) {
    event.stopPropagation();
    const id = button.dataset.id;
    const action = button.dataset.emailAction;
    try {
      if (action === "toggle") {
        const account = state.email.accounts.find((item) => String(item.id) === String(id));
        await api(`/api/email/accounts/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_active: !account.is_active }),
        });
        showToast(!account.is_active ? "Hisob yoqildi" : "Hisob to‘xtatildi");
      } else if (action === "check") {
        button.disabled = true;
        const result = await api(`/api/email/accounts/${id}/check-now`, { method: "POST" });
        if (result.last_error) showError(result.last_error);
        else showToast(`Tekshirildi: ${result.new} ta yangi xat`);
      } else if (action === "password") {
        const password = window.prompt("Yangi parol / App Password:");
        if (!password) return;
        await api(`/api/email/accounts/${id}`, { method: "PATCH", body: JSON.stringify({ password }) });
        showToast("Parol yangilandi");
      } else if (action === "delete") {
        if (!window.confirm("Bu hisob va uning barcha xatlari o‘chiriladi. Davom etasizmi?")) return;
        if (String(state.email.selectedAccountId) === String(id)) state.email.selectedAccountId = null;
        await api(`/api/email/accounts/${id}`, { method: "DELETE" });
        showToast("Hisob o‘chirildi");
      }
      await loadEmailData();
    } catch (error) {
      showError(error.message);
    }
    return;
  }

  const row = event.target.closest("[data-email-select]");
  if (!row) return;
  const val = row.dataset.emailSelect;
  if (val === "all") {
    state.email.selectedAccountId = null;
  } else {
    const numId = Number(val);
    state.email.selectedAccountId = state.email.selectedAccountId === numId ? null : numId;
  }
  state.email.selectedIds.clear();
  await loadEmailData();
}

async function handleEmailListClick(event) {
  const selectInput = event.target.closest("[data-email-select-id]");
  if (selectInput) {
    const id = Number(selectInput.dataset.emailSelectId);
    if (selectInput.checked) state.email.selectedIds.add(id);
    else state.email.selectedIds.delete(id);
    return;
  }

  const actionButton = event.target.closest("[data-email-action]");
  if (actionButton) {
    event.stopPropagation();
    const id = actionButton.dataset.id;
    const action = actionButton.dataset.emailAction;
    try {
      if (action === "star") {
        await toggleStarMessage(id);
        return;
      }
      if (action === "read") await api(`/api/messages/${id}/read`, { method: "PATCH" });
      else if (action === "archive") await api(`/api/messages/${id}/archive`, { method: "PATCH" });
      else if (action === "unarchive") await api(`/api/messages/${id}/unarchive`, { method: "PATCH" });
      else if (action === "delete-single") await api(`/api/messages/${id}`, { method: "DELETE" });
      await loadEmailData();
    } catch (error) {
      showError(error.message);
    }
    return;
  }

  if (event.target.closest("a")) return;
  const card = event.target.closest(".email-card");
  if (!card) return;
  const id = Number(card.dataset.emailId);

  // Bug #4: Expanding or clicking an email immediately marks it read on the site
  queueAutoRead(id);

  if (state.email.expanded.has(id)) state.email.expanded.delete(id);
  else state.email.expanded.add(id);
  renderEmailMessages();
}

function switchEmailTab(tab) {
  if (!tab || state.email.tab === tab) return;
  state.email.tab = tab;
  state.email.selectedIds.clear();
  document.querySelectorAll(".email-tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.emailTab === tab);
  });
  loadEmailData();
}

// ── BUG #5: OPPORTUNITIES SECTION (KUNLIK YANGILAR & FOIZLI IERARXIYA) ──

function safeHttpUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch (_) {
    return null;
  }
}

function oppScoreClass(pct) {
  if (pct >= 85) return "high";
  if (pct >= 65) return "mid";
  return "low";
}

function oppDeadlineMarkup(item) {
  if (!item.deadline) return "";
  const days = item.days_left;
  if (days === null || days === undefined) return `<span class="opp-deadline">📅 ${escapeHtml(item.deadline)}</span>`;
  if (days < 0) return `<span class="opp-deadline urgent">⌛ Muddat o‘tgan (${escapeHtml(item.deadline)})</span>`;
  const urgent = days <= 3;
  return `<span class="opp-deadline ${urgent ? "urgent" : ""}">${urgent ? "⏰" : "📅"} ${days} kun qoldi (${escapeHtml(item.deadline)})</span>`;
}

function renderOppCategorySubbar() {
  const subbar = $("#opp-category-subbar");
  if (!subbar) return;

  const summary = state.opp.summary || {
    daily: { today: 0, yesterday: 0, this_week: 0, older: 0, total: state.opp.feed.length },
    tiers: { gold: 0, silver: 0, bronze: 0, base: 0 },
  };

  if (state.opp.viewMode === "daily") {
    const d = summary.daily || {};
    const buckets = [
      { key: "all", title: "🗂 Barchasi", count: d.total || 0 },
      { key: "today", title: "🔥 Bugun", count: d.today || 0 },
      { key: "yesterday", title: "⏳ Kecha", count: d.yesterday || 0 },
      { key: "this_week", title: "📆 7 kun", count: d.this_week || 0 },
      { key: "older", title: "📁 Avvalgi", count: d.older || 0 },
    ];

    subbar.innerHTML = buckets
      .map(
        (b) => `
        <button type="button" class="opp-pill-btn ${state.opp.periodFilter === b.key ? "active" : ""}" data-opp-period="${b.key}">
          <span>${b.title}</span>
          <span class="opp-pill-count">${b.count}</span>
        </button>
      `
      )
      .join("");
  } else {
    const t = summary.tiers || {};
    const tiers = [
      { key: "all", title: "🌐 Barchasi", count: summary.daily?.total || 0 },
      { key: "gold", title: "🏆 90–100% Oltin", count: t.gold || 0 },
      { key: "silver", title: "💎 75–89% Kumush", count: t.silver || 0 },
      { key: "bronze", title: "⚡ 55–74% Bronza", count: t.bronze || 0 },
      { key: "base", title: "📌 <55%", count: t.base || 0 },
    ];

    subbar.innerHTML = tiers
      .map(
        (tier) => `
        <button type="button" class="opp-pill-btn ${state.opp.tierFilter === tier.key ? "active" : ""}" data-opp-tier="${tier.key}">
          <span>${tier.title}</span>
          <span class="opp-pill-count">${tier.count}</span>
        </button>
      `
      )
      .join("");
  }
}

function renderSingleOppCard(item, archive) {
  const link = safeHttpUrl(item.link);
  const pct = item.match_percent ?? 65;
  const rawScore = item.score === null || item.score === undefined ? "—" : `${item.score}b`;
  const starred = !!item.is_starred;
  const isToday = item.discovered_bucket === "today";
  const barCls = item.tier_key || "silver";

  return `
    <article class="message-card ${item.is_read ? "" : "unread"} ${starred ? "starred-card" : ""}" data-opp-id="${item.id}">
      <div class="message-meta">
        <div class="message-meta-left">
          <span class="message-source-btn">📢 ${escapeHtml(item.channel_name || "Kanal")}</span>
          ${isToday ? '<span class="opp-new-badge">🔥 YANGI</span>' : ""}
          <span class="opp-tag">${escapeHtml(item.tier_label || "")}</span>
        </div>
        <div class="message-meta-right">
          <span class="read-state-indicator ${item.is_read ? "" : "is-unread"}">${item.is_read ? "✓✓" : "● Yangi"}</span>
          <time>${escapeHtml(formatTime(item.received_at))}</time>
          <div class="card-icon-actions">
            ${item.is_read ? "" : `<button type="button" class="card-act-btn" data-opp-action="read" data-id="${item.id}" title="O‘qildi">✓</button>`}
            <button type="button" class="card-act-btn ${starred ? "starred" : ""}" data-opp-action="star" data-id="${item.id}" title="Saqlash">
              ${starred ? "★" : "☆"}
            </button>
            ${
              archive
                ? `<button type="button" class="card-act-btn" data-opp-action="unarchive" data-id="${item.id}" title="Qaytarish">📤</button>`
                : `<button type="button" class="card-act-btn" data-opp-action="archive" data-id="${item.id}" title="Arxivga">📦</button>`
            }
            <button type="button" class="card-act-btn danger" data-opp-action="delete" data-id="${item.id}" title="O‘chirish">🗑</button>
          </div>
        </div>
      </div>

      <div class="opp-card-head">
        <div class="opp-title">${escapeHtml(item.title)}</div>
        <span class="opp-score ${oppScoreClass(pct)}" title="Moslik foizi va bali">
          ${pct}% (${escapeHtml(rawScore)})
        </span>
      </div>

      <div class="opp-tier-bar-track">
        <div class="opp-tier-bar-fill ${escapeHtml(barCls)}" style="width: ${pct}%;"></div>
      </div>

      ${item.reasons ? `<div class="opp-reasons">✅ ${escapeHtml(item.reasons)}</div>` : ""}

      <div class="opp-meta-row">
        <div class="opp-tags">
          ${item.is_free ? '<span class="opp-tag free">💰 Bepul</span>' : ""}
          ${(item.fields || []).map((field) => `<span class="opp-tag">#${escapeHtml(field)}</span>`).join("")}
          ${oppDeadlineMarkup(item)}
        </div>
        ${
          link
            ? `<a class="opp-link-button" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer nofollow">🔗 Havola ↗</a>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderOppFeed() {
  if (oppObserver) {
    oppObserver.disconnect();
    oppObserver = null;
  }

  const list = $("#opp-feed-list");
  if (!list) return;
  const archive = state.opp.feedTab === "archive";

  if (!state.opp.feed.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎯</div>
        <strong>${archive ? "Arxiv bo‘sh" : "Tanlangan kategoriyada imkoniyatlar yo‘q"}</strong>
        <span>${archive ? "Arxivlangan imkoniyatlar shu yerda ko‘rinadi." : "Boshqa kun yoki foiz darajasini tanlang."}</span>
      </div>`;
    return;
  }

  let html = "";

  if (state.opp.viewMode === "daily") {
    const groups = [
      { key: "today", label: "🔥 Bugun qo‘shilgan yangi imkoniyatlar", items: [] },
      { key: "yesterday", label: "⏳ Kecha qo‘shilgan imkoniyatlar", items: [] },
      { key: "this_week", label: "📆 Shu haftada qo‘shilganlar (oxirgi 7 kun)", items: [] },
      { key: "older", label: "📁 Avvalgi imkoniyatlar", items: [] },
    ];
    const map = Object.fromEntries(groups.map((g) => [g.key, g]));
    state.opp.feed.forEach((item) => {
      const bucket = map[item.discovered_bucket] ? item.discovered_bucket : "older";
      map[bucket].items.push(item);
    });

    groups.forEach((g) => {
      if (!g.items.length) return;
      const collapsed = state.opp.collapsedGroups.has(`daily:${g.key}`);
      html += `
        <div class="opp-group-section">
          <div class="opp-group-header" data-opp-group-collapse="daily:${g.key}">
            <span>${collapsed ? "▶" : "▼"} ${g.label}</span>
            <span class="count-badge">${g.items.length} ta</span>
          </div>
          ${
            collapsed
              ? ""
              : `<div class="source-list">${g.items.map((item) => renderSingleOppCard(item, archive)).join("")}</div>`
          }
        </div>
      `;
    });
  } else {
    const tiers = [
      { key: "gold", cls: "tier-gold", label: "🏆 1-Daraja: Oliy moslik (90% – 100%)", items: [] },
      { key: "silver", cls: "tier-silver", label: "💎 2-Daraja: Yuqori moslik (75% – 89%)", items: [] },
      { key: "bronze", cls: "tier-bronze", label: "⚡ 3-Daraja: O‘rta moslik (55% – 74%)", items: [] },
      { key: "base", cls: "tier-base", label: "📌 4-Daraja: Qo‘shimcha (< 55%)", items: [] },
    ];
    const map = Object.fromEntries(tiers.map((t) => [t.key, t]));
    const sortedByPct = [...state.opp.feed].sort((a, b) => (b.match_percent || 0) - (a.match_percent || 0));
    sortedByPct.forEach((item) => {
      const tKey = map[item.tier_key] ? item.tier_key : "bronze";
      map[tKey].items.push(item);
    });

    tiers.forEach((t) => {
      if (!t.items.length) return;
      const collapsed = state.opp.collapsedGroups.has(`tier:${t.key}`);
      html += `
        <div class="opp-group-section">
          <div class="opp-group-header ${t.cls}" data-opp-group-collapse="tier:${t.key}">
            <span>${collapsed ? "▶" : "▼"} ${t.label}</span>
            <span class="count-badge">${t.items.length} ta</span>
          </div>
          ${
            collapsed
              ? ""
              : `<div class="source-list">${t.items.map((item) => renderSingleOppCard(item, archive)).join("")}</div>`
          }
        </div>
      `;
    });
  }

  list.innerHTML = html;

  attachViewportAutoRead(
    "#opp-feed-list",
    "[data-opp-id]",
    "oppId",
    state.opp.feed,
    (obs) => {
      oppObserver = obs;
    }
  );
}

async function loadOppFeed() {
  const archived = state.opp.feedTab === "archive";
  const starredOnly = state.opp.feedTab === "starred";
  const sortBy = state.opp.viewMode === "hierarchy" ? "score" : "date";

  const params = new URLSearchParams({
    limit: "200",
    archived: String(archived),
    sort_by: sortBy,
  });
  if (starredOnly) params.set("starred_only", "true");
  if (state.opp.viewMode === "daily" && state.opp.periodFilter !== "all") {
    params.set("period", state.opp.periodFilter);
  }
  if (state.opp.viewMode === "hierarchy" && state.opp.tierFilter !== "all") {
    params.set("tier", state.opp.tierFilter);
  }

  const fieldEl = $("#opp-filter-field");
  const triageEl = $("#opp-filter-triage");
  const fromEl = $("#opp-filter-date-from");
  const toEl = $("#opp-filter-date-to");
  const searchEl = $("#opp-search-input");

  if (fieldEl && fieldEl.value) params.set("field_filter", fieldEl.value);
  if (triageEl && triageEl.value !== "") params.set("triage_level", triageEl.value);
  if (fromEl && fromEl.value) params.set("date_from", fromEl.value);
  if (toEl && toEl.value) params.set("date_to", toEl.value);
  if (searchEl && searchEl.value.trim()) params.set("search", searchEl.value.trim());

  const [summary, feed] = await Promise.all([
    api(`/api/opp/summary?archived=${archived}`),
    api(`/api/opp/feed?${params.toString()}`),
  ]);
  state.opp.summary = summary;
  state.opp.feed = feed;
  renderOppCategorySubbar();
  renderOppFeed();
}

function renderOppChannels() {
  const list = $("#opp-channel-list");
  if (!list) return;
  if (!state.opp.channels.length) {
    list.innerHTML = '<div class="empty-state small">Hali kanal qo‘shilmagan.</div>';
    return;
  }
  list.innerHTML = state.opp.channels
    .map((channel) => {
      const active = channel.is_active !== false;
      return `
      <div class="source-item ${active ? "" : "paused-source"}">
        <div class="source-top-line">
          <span class="source-name">📢 ${escapeHtml(channel.name)}</span>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="toggle ${active ? "active" : ""}" data-opp-channel-toggle="${channel.id}" data-active="${active}" type="button" title="Faollik"></button>
            <button class="mini-del-btn" data-opp-channel-delete="${channel.id}" type="button" title="O‘chirish">🗑</button>
          </div>
        </div>
        <div class="source-preview-line">
          <span class="source-preview">ID: ${escapeHtml(channel.channel_id)} · Oxirgi post: #${escapeHtml(channel.last_seen)}</span>
        </div>
      </div>`;
    })
    .join("");
}

function renderOppProfile() {
  const profile = state.opp.profile;
  if (!profile) return;
  $("#opp-p-age").value = profile.age ?? "";
  $("#opp-p-grade").value = profile.grade ?? "";
  $("#opp-p-ielts").value = profile.ielts ?? "";
  $("#opp-p-knows-english").checked = !!profile.knows_english;
  $("#opp-p-is-pupil").checked = !!profile.is_pupil;
  $("#opp-p-is-student").checked = !!profile.is_student;
  $("#opp-p-only-free").checked = !!profile.only_free;
  const selected = new Set(profile.interests || []);
  $("#opp-p-interests").innerHTML = OPP_INTERESTS.map(
    (name) => `
      <label class="opp-check">
        <input type="checkbox" value="${escapeHtml(name)}" ${selected.has(name) ? "checked" : ""} />
        <span>${escapeHtml(name)}</span>
      </label>`
  ).join("");
}

function renderOppSettings() {
  const settings = state.opp.settings;
  if (settings) {
    $("#opp-s-enabled").classList.toggle("active", !!settings.enabled);
    $("#opp-s-min-score").value = settings.min_score;
    $("#opp-s-min-score-label").textContent = settings.min_score;
  }
  const status = state.opp.status;
  $("#opp-status").innerHTML = status
    ? `<div>Holat: <b>${status.enabled ? "yoqilgan" : "o‘chirilgan"}</b> · Kanallar: <b>${escapeHtml(status.channels_count)}</b> · Topilgan: <b>${escapeHtml(status.total_found)}</b></div>`
    : "";
  renderOppDelivery();
}

function renderOppDelivery() {
  const delivery = state.opp.delivery;
  const box = $("#opp-delivery-mode");
  const warn = $("#opp-groups-warning");
  if (!delivery || !box || !warn) return;
  const isBot = delivery.mode === "bot";
  box.innerHTML = `<div>Rejim: <b>${isBot ? "Bot (BOT_TOKEN)" : "Userbot"}</b></div>`;
  if (delivery.warning) {
    warn.textContent = `⚠ ${delivery.warning}`;
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
  }
}

function renderOppGroups() {
  const list = $("#opp-group-list");
  if (!list) return;
  if (!state.opp.groups.length) {
    list.innerHTML = '<div class="empty-state small">Hali guruh qo‘shilmagan.</div>';
    return;
  }
  list.innerHTML = state.opp.groups
    .map((group) => {
      const confirmed = group.status === "confirmed";
      return `
      <div class="source-item">
        <div class="source-top-line">
          <span class="source-name">👥 ${escapeHtml(group.title)}</span>
          <span style="font-size:11px; color:${confirmed ? "var(--green)" : "var(--amber)"};">${confirmed ? "✓ tasdiqlangan" : "● kutilmoqda"}</span>
        </div>
        <div class="source-preview-line">
          <span class="source-preview">ID: ${escapeHtml(group.chat_id)}</span>
          <div style="display:flex; gap:6px;">
            ${confirmed ? "" : `<button class="chip-action-btn" data-opp-group-confirm="${group.id}" type="button">Tasdiqlash</button>`}
            <button class="mini-del-btn" data-opp-group-delete="${group.id}" type="button">🗑</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

async function loadOppData() {
  clearError();
  try {
    await loadOppTab(state.opp.tab);
    await loadCounts();
  } catch (error) {
    showError(error.message);
  }
}

async function loadOppTab(tab) {
  if (tab === "feed") {
    await loadOppFeed();
  } else if (tab === "channels") {
    state.opp.channels = await api("/api/opp/channels");
    renderOppChannels();
  } else if (tab === "profile") {
    state.opp.profile = await api("/api/opp/profile");
    renderOppProfile();
  } else if (tab === "settings") {
    const [settings, status, delivery] = await Promise.all([
      api("/api/opp/settings"),
      api("/api/opp/status"),
      api("/api/opp/delivery-mode"),
    ]);
    state.opp.settings = settings;
    state.opp.status = status;
    state.opp.delivery = delivery;
    renderOppSettings();
  } else if (tab === "groups") {
    const [groups, delivery] = await Promise.all([api("/api/opp/groups"), api("/api/opp/delivery-mode")]);
    state.opp.groups = groups;
    state.opp.delivery = delivery;
    renderOppGroups();
    renderOppDelivery();
  }
}

function switchOppTab(tab) {
  if (!tab) return;
  state.opp.tab = tab;
  document.querySelectorAll(".opp-tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.oppTab === tab);
  });
  ["feed", "channels", "profile", "settings", "groups", "test"].forEach((name) => {
    $(`#opp-pane-${name}`)?.classList.toggle("hidden", name !== tab);
  });
  loadOppData();
}

function switchOppFeedTab(tab) {
  if (!tab || state.opp.feedTab === tab) return;
  state.opp.feedTab = tab;
  document.querySelectorAll(".opp-feed-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.feedTab === tab);
  });
  updateOppExportLink();
  loadOppData();
}

async function handleOppFeedClick(event) {
  const collapseHeader = event.target.closest("[data-opp-group-collapse]");
  if (collapseHeader) {
    const key = collapseHeader.dataset.oppGroupCollapse;
    if (state.opp.collapsedGroups.has(key)) state.opp.collapsedGroups.delete(key);
    else state.opp.collapsedGroups.add(key);
    renderOppFeed();
    return;
  }

  const button = event.target.closest("[data-opp-action]");
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.oppAction;
  try {
    if (action === "star") {
      await toggleStarMessage(id);
      return;
    }
    if (action === "read") await api(`/api/messages/${id}/read?archive=false`, { method: "PATCH" });
    else if (action === "archive") await api(`/api/messages/${id}/archive`, { method: "PATCH" });
    else if (action === "unarchive") await api(`/api/messages/${id}/unarchive`, { method: "PATCH" });
    else if (action === "delete") await api(`/api/messages/${id}`, { method: "DELETE" });
    await loadOppData();
  } catch (error) {
    showError(error.message);
  }
}

async function addOppChannel(event) {
  event.preventDefault();
  const input = $("#opp-channel-identifier");
  try {
    await api("/api/opp/channels", { method: "POST", body: JSON.stringify({ identifier: input.value }) });
    input.value = "";
    showToast("Kanal qo‘shildi");
    await loadOppData();
  } catch (error) {
    showError(error.message);
  }
}

async function handleOppChannelListClick(event) {
  const toggleBtn = event.target.closest("[data-opp-channel-toggle]");
  if (toggleBtn) {
    const id = toggleBtn.dataset.oppChannelToggle;
    const currentActive = toggleBtn.dataset.active === "true";
    try {
      await api(`/api/opp/channels/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !currentActive }),
      });
      showToast(!currentActive ? "Kanal kuzatuvi yoqildi" : "Kanal kuzatuvi to‘xtatildi");
      await loadOppData();
    } catch (error) {
      showError(error.message);
    }
    return;
  }

  const button = event.target.closest("[data-opp-channel-delete]");
  if (!button) return;
  if (!window.confirm("Kanalni kuzatuvdan o‘chirasizmi?")) return;
  try {
    await api(`/api/opp/channels/${button.dataset.oppChannelDelete}`, { method: "DELETE" });
    showToast("Kanal o‘chirildi");
    await loadOppData();
  } catch (error) {
    showError(error.message);
  }
}

async function oppRefreshDialogs() {
  const note = $("#opp-channels-note");
  if (note) note.textContent = "Yangilanmoqda...";
  try {
    const result = await api("/api/opp/refresh-dialogs", { method: "POST" });
    if (note) note.textContent = `Dialoglar yangilandi: ${result.count} ta.`;
  } catch (error) {
    if (note) note.textContent = "";
    showError(error.message);
  }
}

async function oppScanNow() {
  const note = $("#opp-channels-note");
  const button = $("#opp-scan-now");
  if (button) button.disabled = true;
  if (note) note.textContent = "Tekshirilmoqda...";
  try {
    const result = await api("/api/opp/scan-now", { method: "POST" });
    if (note) note.textContent = `Tekshiruv tugadi: ${result.found} ta yangi imkoniyat topildi.`;
    showToast(`Tekshiruv: ${result.found} ta yangi imkoniyat`);
    await loadOppData();
  } catch (error) {
    if (note) note.textContent = "";
    showError(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveOppProfile(event) {
  event.preventDefault();
  const numberOrNull = (selector) => {
    const raw = $(selector).value.trim();
    return raw === "" ? null : Number(raw);
  };
  const interests = Array.from(document.querySelectorAll("#opp-p-interests input:checked")).map((input) => input.value);
  try {
    state.opp.profile = await api("/api/opp/profile", {
      method: "PUT",
      body: JSON.stringify({
        age: Number($("#opp-p-age").value),
        grade: numberOrNull("#opp-p-grade"),
        ielts: numberOrNull("#opp-p-ielts"),
        knows_english: $("#opp-p-knows-english").checked,
        is_pupil: $("#opp-p-is-pupil").checked,
        is_student: $("#opp-p-is-student").checked,
        only_free: $("#opp-p-only-free").checked,
        interests,
      }),
    });
    renderOppProfile();
    showToast("Profil saqlandi");
    clearError();
  } catch (error) {
    showError(error.message);
  }
}

async function saveOppSettings() {
  const current = state.opp.settings || { check_interval: 600 };
  try {
    state.opp.settings = await api("/api/opp/settings", {
      method: "PUT",
      body: JSON.stringify({
        enabled: $("#opp-s-enabled").classList.contains("active"),
        min_score: Number($("#opp-s-min-score").value),
        check_interval: current.check_interval,
      }),
    });
    state.opp.status = await api("/api/opp/status");
    renderOppSettings();
    showToast("Sozlamalar saqlandi");
    clearError();
  } catch (error) {
    showError(error.message);
  }
}

async function addOppGroup(event) {
  event.preventDefault();
  const identifier = $("#opp-group-identifier");
  const title = $("#opp-group-title");
  try {
    await api("/api/opp/groups", {
      method: "POST",
      body: JSON.stringify({ identifier: identifier.value, title: title.value || null }),
    });
    identifier.value = "";
    title.value = "";
    showToast("Guruh qo‘shildi");
    await loadOppData();
  } catch (error) {
    showError(error.message);
  }
}

async function handleOppGroupListClick(event) {
  const confirmButton = event.target.closest("[data-opp-group-confirm]");
  const deleteButton = event.target.closest("[data-opp-group-delete]");
  try {
    if (confirmButton) {
      confirmButton.disabled = true;
      await api(`/api/opp/groups/${confirmButton.dataset.oppGroupConfirm}/confirm`, { method: "POST" });
      showToast("Guruh tasdiqlandi");
      await loadOppData();
    } else if (deleteButton) {
      if (!window.confirm("Guruhni ro‘yxatdan o‘chirasizmi?")) return;
      await api(`/api/opp/groups/${deleteButton.dataset.oppGroupDelete}`, { method: "DELETE" });
      await loadOppData();
    }
  } catch (error) {
    showError(error.message);
    await loadOppData();
  }
}

async function runOppAnalyze() {
  const text = $("#opp-test-text").value.trim();
  const box = $("#opp-test-result");
  if (!text) {
    box.innerHTML = '<div style="color:var(--red);">Matn kiriting.</div>';
    return;
  }
  box.innerHTML = "Tahlil qilinmoqda...";
  try {
    const r = await api("/api/opp/analyze", { method: "POST", body: JSON.stringify({ text }) });
    const link = safeHttpUrl(r.link);
    box.innerHTML = `
      <div style="margin-top:8px;"><b>${escapeHtml(r.title || "(sarlavhasiz)")}</b> · Ball: <b>${escapeHtml(r.score)}</b></div>
      ${r.deadline ? `<div>Muddat: <b>${escapeHtml(r.deadline)}</b></div>` : ""}
      ${link ? `<div style="margin-top:6px;"><a class="opp-link-button" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Havola ↗</a></div>` : ""}`;
  } catch (error) {
    box.innerHTML = `<div style="color:var(--red);">${escapeHtml(error.message)}</div>`;
  }
}

// ── WEBSOCKET LIVE STREAM ─────────────────────────────────────────

function setConnection(online, label) {
  $("#connection-dot").className = `status-dot ${online ? "online" : "offline"}`;
  $("#connection-label").textContent = label;
}

function connectWebSocket() {
  const wsBase = API_BASE_URL.replace(/^http/, "ws");
  try {
    state.socket = new WebSocket(`${wsBase}/ws/messages`);
  } catch (_) {
    setConnection(false, "Xato");
    return;
  }
  state.socket.addEventListener("open", () => {
    state.reconnectDelay = 1000;
    setConnection(true, "Jonli");
  });
  state.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    // BUG #1 GUARD: Agar manba o'chirilgan (is_active === false) bo'lsa, bloklaymiz
    if (message.channel === "telegram" || !message.channel) {
      if (message.source_is_active === false) return;
      const src = state.sources.find((s) => s.id === message.source_id);
      if (src && !src.is_active) return;
    }

    if (message.channel === "opportunity") {
      if (state.section === "opportunity" && state.opp.tab === "feed") {
        loadOppFeed().catch(() => {});
      }
    } else if (message.channel === "email") {
      if (state.section === "email" && state.email.tab === "inbox" && !message.is_archived) {
        state.email.messages = [message, ...state.email.messages.filter((item) => item.id !== message.id)].slice(0, 200);
        renderEmailMessages();
      }
    } else if (message.is_update) {
      const idx = state.messages.findIndex((item) => item.id === message.id);
      if (idx !== -1) {
        state.messages[idx] = { ...state.messages[idx], ...message };
      }
    } else if (state.activeTab === "inbox" && !message.is_archived) {
      if (state.selectedSourceId === null || state.selectedSourceId === message.source_id) {
        if (state.tgSort === "asc") {
          state.messages = [...state.messages.filter((item) => item.id !== message.id), message];
        } else {
          state.messages = [message, ...state.messages.filter((item) => item.id !== message.id)].slice(0, 200);
        }
        renderMessages();
      }
      const src = state.sources.find((s) => s.id === message.source_id);
      if (src) {
        src.unread_count = (src.unread_count || 0) + 1;
        src.total_count = (src.total_count || 0) + 1;
        src.last_message_preview = (message.text || "").slice(0, 80);
        updateSourceBadgeInPlace(src.id, src.unread_count);
      }
    }

    loadCounts();
  });
  state.socket.addEventListener("close", () => {
    setConnection(false, "Ulanmoqda...");
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(connectWebSocket, state.reconnectDelay);
    state.reconnectDelay = Math.min(state.reconnectDelay * 2, 15000);
  });
  state.socket.addEventListener("error", () => setConnection(false, "Xato"));
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    showError("Bu brauzer tizim bildirishnomalarini qo‘llamaydi.");
    return;
  }
  const permission = await Notification.requestPermission();
  showToast(permission === "granted" ? "🔔 Bildirishnomalar yoqildi" : "Bildirishnoma rad etildi");
}

function updateOppExportLink() {
  const archived = state.opp.feedTab === "archive";
  const csvLink = $("#opp-export-btn");
  const jsonLink = $("#opp-export-json-btn");
  if (csvLink) csvLink.href = `/api/opp/export?format=csv&archived=${archived}`;
  if (jsonLink) jsonLink.href = `/api/opp/export?format=json&archived=${archived}`;
}

function refreshOppFeedFromFilters() {
  updateOppExportLink();
  loadOppFeed().catch(() => {});
}

// ── EVENT LISTENERS WIRING ────────────────────────────────────────

// Modals open/close
$("#open-source-modal-btn")?.addEventListener("click", () => {
  $("#source-modal")?.classList.remove("hidden");
  $("#identifier")?.focus();
});
$("#close-source-modal-btn")?.addEventListener("click", () => $("#source-modal")?.classList.add("hidden"));
$("#cancel-source-modal-btn")?.addEventListener("click", () => $("#source-modal")?.classList.add("hidden"));

$("#open-email-modal-btn")?.addEventListener("click", () => {
  $("#email-modal")?.classList.remove("hidden");
  $("#email-label")?.focus();
});
$("#close-email-modal-btn")?.addEventListener("click", () => $("#email-modal")?.classList.add("hidden"));
$("#cancel-email-modal-btn")?.addEventListener("click", () => $("#email-modal")?.classList.add("hidden"));

// Close any modal when clicking backdrop
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.add("hidden");
  });
});

$("#source-form")?.addEventListener("submit", addSource);

$("#source-search-input")?.addEventListener("input", (e) => {
  state.sourceSearch = e.target.value.trim();
  renderSources();
});

$("#source-type-pills")?.addEventListener("click", (e) => {
  const pill = e.target.closest("[data-source-filter]");
  if (!pill) return;
  state.sourceFilterType = pill.dataset.sourceFilter;
  document.querySelectorAll("#source-type-pills .mini-pill").forEach((p) => {
    p.classList.toggle("active", p.dataset.sourceFilter === state.sourceFilterType);
  });
  renderSources();
});

$("#source-list")?.addEventListener("click", handleSourceListClick);
$("#source-profile-bar")?.addEventListener("click", handleSourceProfileBarClick);

$("#message-list")?.addEventListener("click", handleMessageListClick);
$("#message-list")?.addEventListener("change", handleMessageListChangeEvent);
$("#message-list")?.addEventListener("keydown", handleMessageListKeydown);
$("#message-list")?.addEventListener("paste", handleMessageListPaste);
$("#message-list")?.addEventListener("dragover", handleMessageListDragOver);
$("#message-list")?.addEventListener("drop", handleMessageListDrop);
$("#tg-load-more-btn")?.addEventListener("click", loadMoreMessages);

$("#notification-button")?.addEventListener("click", requestNotifications);

document.querySelectorAll("#telegram-section .seg-tabs [data-tab]").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

$("#tg-quick-filters")?.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-tg-filter]");
  if (!chip) return;
  state.tgQuickFilter = chip.dataset.tgFilter;
  document.querySelectorAll("#tg-quick-filters .filter-chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.tgFilter === state.tgQuickFilter);
  });
  loadData();
});

$("#tg-sort-toggle")?.addEventListener("click", () => {
  state.tgSort = state.tgSort === "desc" ? "asc" : "desc";
  showToast(state.tgSort === "asc" ? "↑ Telegram tartibi (Eski → Yangi)" : "↓ Yangilari tepada");
  loadData();
});

$("#archive-search")?.addEventListener("input", handleArchiveSearchInput);
$("#clear-search-btn")?.addEventListener("click", () => {
  const inp = $("#archive-search");
  if (inp) inp.value = "";
  $("#clear-search-btn")?.classList.add("hidden");
  state.archiveSearch = "";
  loadData();
});

// Telegram Bulk & Export Controls
$("#tg-select-all-checkbox")?.addEventListener("change", (e) => {
  if (e.target.checked) {
    state.messages.forEach((m) => state.selectedIds.add(m.id));
  } else {
    state.selectedIds.clear();
  }
  renderMessages();
});

$("#bulk-select-all-btn")?.addEventListener("click", () => {
  state.messages.forEach((m) => state.selectedIds.add(m.id));
  renderMessages();
});

$("#tg-select-read-btn")?.addEventListener("click", () => {
  state.selectedIds.clear();
  state.messages.filter((m) => m.is_read).forEach((m) => state.selectedIds.add(m.id));
  if (!state.selectedIds.size) showToast("O‘qilgan xabarlar topilmadi");
  else showToast(`${state.selectedIds.size} ta o‘qilgan xabar tanlandi`);
  renderMessages();
});

$("#tg-mark-all-read-btn")?.addEventListener("click", bulkMarkReadTg);
$("#bulk-read-selected-btn")?.addEventListener("click", bulkMarkReadTg);
$("#bulk-clear-selection")?.addEventListener("click", () => {
  state.selectedIds.clear();
  renderMessages();
});

$("#bulk-archive-button")?.addEventListener("click", bulkArchiveSelected);
$("#bulk-archive-selected-btn")?.addEventListener("click", bulkArchiveSelected);
$("#bulk-delete-button")?.addEventListener("click", bulkDeleteSelected);
$("#bulk-delete-selected-btn")?.addEventListener("click", bulkDeleteSelected);

$("#tg-export-menu-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  $("#tg-export-dropdown")?.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".dropdown-wrap")) {
    $("#tg-export-dropdown")?.classList.add("hidden");
  }
});

$("#tg-export-dropdown")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tg-export]");
  if (!btn) return;
  $("#tg-export-dropdown")?.classList.add("hidden");
  const fmt = btn.dataset.tgExport;
  const thenAction = btn.dataset.then || "none";
  const ids = state.selectedIds.size > 0 ? Array.from(state.selectedIds) : null;
  triggerMessagesExport({
    ids,
    source_id: state.selectedSourceId,
    channel: "telegram",
    archived: state.activeTab === "archive",
    format: fmt,
    then_action: thenAction,
  });
});

$("#bulk-export-archive-btn")?.addEventListener("click", () => {
  const ids = state.selectedIds.size > 0 ? Array.from(state.selectedIds) : null;
  triggerMessagesExport({
    ids,
    source_id: state.selectedSourceId,
    channel: "telegram",
    archived: state.activeTab === "archive",
    format: "csv",
    then_action: "archive",
  });
});

$("#bulk-export-delete-btn")?.addEventListener("click", () => {
  const ids = state.selectedIds.size > 0 ? Array.from(state.selectedIds) : null;
  triggerMessagesExport({
    ids,
    source_id: state.selectedSourceId,
    channel: "telegram",
    archived: state.activeTab === "archive",
    format: "csv",
    then_action: "delete",
  });
});

// Settings & Shortcuts
$("#archive-settings-button")?.addEventListener("click", openArchiveSettingsDialog);
$("#archive-settings-cancel")?.addEventListener("click", closeArchiveSettingsDialog);
$("#archive-settings-close-x")?.addEventListener("click", closeArchiveSettingsDialog);
$("#archive-settings-save")?.addEventListener("click", saveArchiveSettings);

$("#shortcuts-help-button")?.addEventListener("click", () => {
  $("#shortcuts-dialog")?.classList.toggle("hidden");
});
$("#shortcuts-close-btn")?.addEventListener("click", () => {
  $("#shortcuts-dialog")?.classList.add("hidden");
});

document.addEventListener("keydown", handleGlobalKeydown);

document.querySelectorAll(".section-tab").forEach((button) => {
  button.addEventListener("click", () => switchSection(button.dataset.section));
});

// Email Section Listeners
$("#email-profile-bar")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-email-profile-back]")) {
    state.email.selectedAccountId = null;
    loadEmailData();
  }
});

document.querySelectorAll(".email-tab-button").forEach((button) => {
  button.addEventListener("click", () => switchEmailTab(button.dataset.emailTab));
});

$("#email-quick-filters")?.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-email-filter]");
  if (!chip) return;
  state.email.quickFilter = chip.dataset.emailFilter;
  document.querySelectorAll("#email-quick-filters .filter-chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.emailFilter === state.email.quickFilter);
  });
  loadEmailData();
});

let emailSearchTimer = null;
$("#email-search-input")?.addEventListener("input", (e) => {
  clearTimeout(emailSearchTimer);
  const val = e.target.value;
  emailSearchTimer = setTimeout(() => {
    state.email.search = val;
    loadEmailData();
  }, 240);
});

$("#email-select-all-checkbox")?.addEventListener("change", (e) => {
  if (e.target.checked) {
    state.email.messages.forEach((m) => state.email.selectedIds.add(m.id));
  } else {
    state.email.selectedIds.clear();
  }
  renderEmailMessages();
});

$("#email-mark-all-read-btn")?.addEventListener("click", async () => {
  const payload = state.email.selectedIds.size
    ? { ids: Array.from(state.email.selectedIds) }
    : { channel: "email", all_matching: true };
  const res = await api("/api/messages/read-bulk", { method: "POST", body: JSON.stringify(payload) });
  state.email.selectedIds.clear();
  showToast(`✓✓ ${res.read} ta xat o‘qildi deb belgilandi`);
  await loadEmailData();
});

$("#email-export-csv-btn")?.addEventListener("click", () => {
  const ids = state.email.selectedIds.size ? Array.from(state.email.selectedIds) : null;
  triggerMessagesExport({ ids, channel: "email", archived: state.email.tab === "archive", format: "csv", then_action: "none" });
});

$("#email-export-archive-btn")?.addEventListener("click", () => {
  const ids = state.email.selectedIds.size ? Array.from(state.email.selectedIds) : null;
  triggerMessagesExport({ ids, channel: "email", archived: state.email.tab === "archive", format: "csv", then_action: "archive" });
});

$("#email-bulk-archive-btn")?.addEventListener("click", async () => {
  const payload = state.email.selectedIds.size
    ? { ids: Array.from(state.email.selectedIds) }
    : { channel: "email", archived: false, all_matching: true };
  const res = await api("/api/messages/archive-bulk", { method: "POST", body: JSON.stringify(payload) });
  state.email.selectedIds.clear();
  showToast(`📦 ${res.archived} ta xat arxivlandi`);
  await loadEmailData();
});

$("#email-bulk-delete-btn")?.addEventListener("click", async () => {
  if (!window.confirm("Tanlangan yoki ko‘rinib turgan xatlarni o‘chirasizmi?")) return;
  const payload = state.email.selectedIds.size
    ? { ids: Array.from(state.email.selectedIds) }
    : { channel: "email", archived: state.email.tab === "archive", all_matching: true };
  const res = await api("/api/messages/delete-bulk", { method: "POST", body: JSON.stringify(payload) });
  state.email.selectedIds.clear();
  showToast(`🗑 ${res.deleted} ta xat o‘chirildi`);
  await loadEmailData();
});

$("#email-preset")?.addEventListener("change", handleEmailPresetChange);
$("#email-account-form")?.addEventListener("submit", addEmailAccount);
$("#email-account-list")?.addEventListener("click", handleEmailAccountAction);
$("#email-list")?.addEventListener("click", handleEmailListClick);

// Notifications Mark All Read
$("#notif-mark-all-read-btn")?.addEventListener("click", async () => {
  await api("/api/messages/read-bulk", {
    method: "POST",
    body: JSON.stringify({ channel: "telegram", all_matching: true }),
  });
  showToast("Barcha bildirishnomalar o‘qildi deb belgilandi");
  await loadNotifications();
  await loadCounts();
});

// Opportunity Section Listeners (Bug #5)
document.querySelectorAll(".opp-tab-button").forEach((button) => {
  button.addEventListener("click", () => switchOppTab(button.dataset.oppTab));
});

document.querySelectorAll(".opp-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.oppMode;
    if (state.opp.viewMode === mode) return;
    state.opp.viewMode = mode;
    document.querySelectorAll(".opp-mode-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.oppMode === mode);
    });
    loadOppFeed().catch(() => {});
  });
});

$("#opp-category-subbar")?.addEventListener("click", (e) => {
  const periodBtn = e.target.closest("[data-opp-period]");
  if (periodBtn) {
    state.opp.periodFilter = periodBtn.dataset.oppPeriod;
    loadOppFeed().catch(() => {});
    return;
  }
  const tierBtn = e.target.closest("[data-opp-tier]");
  if (tierBtn) {
    state.opp.tierFilter = tierBtn.dataset.oppTier;
    loadOppFeed().catch(() => {});
  }
});

const oppFilterField = $("#opp-filter-field");
const oppFilterTriage = $("#opp-filter-triage");
const oppFilterFrom = $("#opp-filter-date-from");
const oppFilterTo = $("#opp-filter-date-to");
const oppSearchInput = $("#opp-search-input");

if (oppFilterField) oppFilterField.addEventListener("change", refreshOppFeedFromFilters);
if (oppFilterTriage) oppFilterTriage.addEventListener("change", refreshOppFeedFromFilters);
if (oppFilterFrom) oppFilterFrom.addEventListener("change", refreshOppFeedFromFilters);
if (oppFilterTo) oppFilterTo.addEventListener("change", refreshOppFeedFromFilters);

let oppSearchTimer = null;
if (oppSearchInput) {
  oppSearchInput.addEventListener("input", () => {
    clearTimeout(oppSearchTimer);
    oppSearchTimer = setTimeout(refreshOppFeedFromFilters, 240);
  });
}

$("#opp-filter-clear")?.addEventListener("click", () => {
  if (oppFilterField) oppFilterField.value = "";
  if (oppFilterTriage) oppFilterTriage.value = "";
  if (oppFilterFrom) oppFilterFrom.value = "";
  if (oppFilterTo) oppFilterTo.value = "";
  if (oppSearchInput) oppSearchInput.value = "";
  state.opp.periodFilter = "all";
  state.opp.tierFilter = "all";
  refreshOppFeedFromFilters();
});

$("#opp-mark-all-read-btn")?.addEventListener("click", async () => {
  const res = await api("/api/messages/read-bulk", {
    method: "POST",
    body: JSON.stringify({ channel: "opportunity", all_matching: true }),
  });
  showToast(`✓✓ ${res.read} ta imkoniyat o‘qildi deb belgilandi`);
  await loadOppData();
});

$("#opp-bulk-archive-btn")?.addEventListener("click", async () => {
  const res = await api("/api/messages/archive-bulk", {
    method: "POST",
    body: JSON.stringify({ channel: "opportunity", only_read: true, all_matching: true }),
  });
  showToast(`📦 ${res.archived} ta o‘qilgan imkoniyat arxivlandi`);
  await loadOppData();
});

$("#opp-quick-scan-btn")?.addEventListener("click", oppScanNow);

updateOppExportLink();

document.querySelectorAll(".opp-feed-tab").forEach((button) => {
  button.addEventListener("click", () => switchOppFeedTab(button.dataset.feedTab));
});
$("#opp-feed-list")?.addEventListener("click", handleOppFeedClick);
$("#notif-list")?.addEventListener("click", handleNotificationsClick);
$("#opp-channel-form")?.addEventListener("submit", addOppChannel);
$("#opp-channel-list")?.addEventListener("click", handleOppChannelListClick);
$("#opp-refresh-dialogs")?.addEventListener("click", oppRefreshDialogs);
$("#opp-scan-now")?.addEventListener("click", oppScanNow);
$("#opp-profile-form")?.addEventListener("submit", saveOppProfile);
$("#opp-s-enabled")?.addEventListener("click", () => $("#opp-s-enabled").classList.toggle("active"));
$("#opp-s-min-score")?.addEventListener("input", (event) => {
  $("#opp-s-min-score-label").textContent = event.target.value;
});
$("#opp-s-save")?.addEventListener("click", saveOppSettings);
$("#opp-group-form")?.addEventListener("submit", addOppGroup);
$("#opp-group-list")?.addEventListener("click", handleOppGroupListClick);
$("#opp-test-run")?.addEventListener("click", runOppAnalyze);

// Initial Boot
loadArchiveSettings();
loadAutoResponderSettings();
loadEmailPresets();
loadData();
connectWebSocket();

// === AI SIDEBAR CONTROLLER (COLLAPSIBLE SLIDE-OVER) ===
(function () {
  const aiHistory = [];

  function safeText(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function toggleAiDrawer(forceOpen) {
    const panel = document.getElementById("ai-sidebar");
    const btn = document.getElementById("ai-drawer-toggle");
    if (!panel) return;
    const isCollapsed = panel.classList.contains("collapsed");
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : isCollapsed;
    panel.classList.toggle("collapsed", !shouldOpen);
    document.body.classList.toggle("ai-drawer-open", shouldOpen);
    if (btn) btn.classList.toggle("active", shouldOpen);
  }

  function getActiveScreenContext() {
    const sectionNames = {
      telegram: "Telegram",
      email: "Email",
      opportunity: "Imkoniyatlar",
      notifications: "Bildirishnomalar",
    };
    const tab = sectionNames[state.section] || "Telegram";

    let source = "Barcha xabarlar";
    const srcEl = document.querySelector(".source-item.active-source .source-name");
    if (srcEl) {
      source = srcEl.textContent.trim().replace(/\s+/g, " ");
    }

    const items = [];
    document.querySelectorAll(".message-card").forEach((c, idx) => {
      if (idx < 8 && c.offsetParent !== null) {
        const t = c.textContent.trim().replace(/\s+/g, " ");
        const linkEl = c.querySelector("a[href^='http']");
        const href = linkEl ? linkEl.getAttribute("href") : "";
        if (t.length > 5) {
          items.push(href ? `${t.slice(0, 220)} [HAVOLA: ${href}]` : t.slice(0, 220));
        }
      }
    });

    return {
      active_tab: tab,
      active_source: source,
      visible_items: items.join("\n---\n"),
    };
  }

  function addMsg(sender, text) {
    const box = document.getElementById("ai-sidebar-chat");
    if (!box) return;
    const row = document.createElement("div");
    row.className = "ai-msg-row " + sender;
    const bubble = document.createElement("div");
    bubble.className = "ai-msg-bubble";
    const formatted = safeText(text)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
    bubble.innerHTML = formatted;
    row.appendChild(bubble);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    aiHistory.push({ sender, text });
  }

  async function loadWelcome() {
    const ruleEl = document.getElementById("ai-sidebar-rule");
    const modelEl = document.getElementById("ai-model-label");
    try {
      const res = await fetch("/api/ai/welcome", { credentials: "include" });
      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }
      if (!res.ok) throw new Error("Status " + res.status);
      const d = await res.json();
      if (d.facts && d.facts.rule_of_one_focus && ruleEl) {
        ruleEl.textContent = d.facts.rule_of_one_focus;
      }
      if (d.used_model && modelEl) {
        modelEl.textContent = d.used_model.replace("gemini-", "");
      }
      addMsg("ai", d.greeting);
    } catch (_) {
      addMsg("ai", "Assalomu alaykum! Tizim faktlari yuklandi. Xabarlaringiz tahlilga tayyor.");
    }
  }

  function showTyping() {
    const box = document.getElementById("ai-sidebar-chat");
    if (!box) return null;
    const row = document.createElement("div");
    row.className = "ai-msg-row ai";
    row.innerHTML = `<div class="ai-msg-bubble">...</div>`;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    return row;
  }

  async function sendMsg(overrideText) {
    const inp = document.getElementById("ai-side-input");
    const text = (overrideText || (inp ? inp.value : "")).trim();
    if (!text) return;
    if (inp) inp.value = "";

    addMsg("user", text);
    const ctx = getActiveScreenContext();
    const typingRow = showTyping();

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: text,
          history: aiHistory.slice(-6).map((h) => ({ sender: h.sender, text: h.text })),
          current_context: ctx,
        }),
      });
      if (typingRow) typingRow.remove();
      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }
      if (!res.ok) throw new Error("Status " + res.status);
      const d = await res.json();
      addMsg("ai", d.reply);
    } catch (_) {
      if (typingRow) typingRow.remove();
      addMsg("ai", "Tarmoq bilan uzilish yuz berdi. Qayta urinib ko'ring.");
    }
  }

  function init() {
    document.getElementById("ai-drawer-toggle")?.addEventListener("click", () => toggleAiDrawer());
    document.getElementById("ai-sidebar-close-btn")?.addEventListener("click", () => toggleAiDrawer(false));

    const btn = document.getElementById("ai-side-send-btn");
    const inp = document.getElementById("ai-side-input");
    if (btn) btn.addEventListener("click", () => sendMsg());
    if (inp) {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sendMsg();
      });
    }
    document.querySelectorAll(".ai-chip[data-q]").forEach((c) => {
      c.addEventListener("click", () => {
        toggleAiDrawer(true);
        sendMsg(c.getAttribute("data-q"));
      });
    });
    const weeklyBtn = document.getElementById("ai-weekly-briefing-btn");
    if (weeklyBtn) {
      weeklyBtn.addEventListener("click", async () => {
        toggleAiDrawer(true);
        addMsg("user", "Haftalik xulosani ko'rsat");
        const typingRow = showTyping();
        try {
          const res = await fetch("/api/opp/briefing/weekly", { credentials: "include" });
          if (typingRow) typingRow.remove();
          if (res.status === 401) {
            window.location.href = "/login.html";
            return;
          }
          if (!res.ok) throw new Error("Status " + res.status);
          const d = await res.json();
          addMsg("ai", d.summary);
        } catch (_) {
          if (typingRow) typingRow.remove();
          addMsg("ai", "Haftalik xulosani yuklab bo'lmadi. Qayta urinib ko'ring.");
        }
      });
    }
    loadWelcome();

    const hamburger = document.getElementById("hamburger-toggle");
    if (hamburger) {
      hamburger.addEventListener("click", () => {
        document.querySelectorAll(".workspace:not(.hidden) .settings-panel").forEach((p) => {
          p.classList.toggle("mobile-open");
        });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
