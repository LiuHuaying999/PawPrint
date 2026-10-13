// 系统任务「未知任务」的固定 id：多处创建点与备份合并都依赖它保持唯一
const UNKNOWN_TASK_ID = 'task_unknown';

const DEFAULT_LLM_SETTINGS = {
  apiKey: '',
  model: 'qwen-plus-latest',
  endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  includeScreenshot: true,
  enableAI: true
};

// 自定义弹窗 UI
function customModal(options) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('custom-modal-title');
    const messageEl = document.getElementById('custom-modal-message');
    const wrapperEl = document.getElementById('custom-modal-input-wrapper');
    const iconEl = document.getElementById('custom-modal-icon');
    const inputEl = document.getElementById('custom-modal-input');
    const cancelBtn = document.getElementById('custom-modal-cancel');
    const confirmBtn = document.getElementById('custom-modal-confirm');

    titleEl.textContent = options.title || '提示';
    messageEl.textContent = options.message || '';
    
    let currentIcon = options.defaultIcon || '1.png';

    if (options.type === 'prompt') {
      messageEl.classList.toggle('hidden', !options.message);
      wrapperEl.style.display = 'flex';
      inputEl.classList.remove('hidden');
      inputEl.value = options.defaultValue || '';
      
      if (options.showIcon) {
        iconEl.classList.remove('hidden');
        iconEl.innerHTML = `<img src="icons/labels/${currentIcon}" alt=""/>`;
        iconEl.onclick = (e) => {
          e.stopPropagation();
          openIconDropdown(iconEl, (newIcon) => {
            currentIcon = newIcon;
            iconEl.innerHTML = `<img src="icons/labels/${currentIcon}" alt=""/>`;
          });
        };
      } else {
        iconEl.classList.add('hidden');
      }
      setTimeout(() => inputEl.focus(), 50);
    } else {
      messageEl.classList.remove('hidden');
      wrapperEl.style.display = 'none';
      inputEl.classList.add('hidden');
      iconEl.classList.add('hidden');
      inputEl.value = '';
    }

    if (options.isDanger) {
      confirmBtn.className = 'btn-danger';
    } else {
      confirmBtn.className = 'btn-primary';
    }
    
    confirmBtn.textContent = options.confirmText || '确定';
    cancelBtn.textContent = options.cancelText || '取消';

    const cleanup = () => {
      overlay.classList.add('hidden');
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      inputEl.removeEventListener('keydown', onKeydown);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      let result = true;
      if (options.type === 'prompt') {
        if (options.showIcon) {
          result = { title: inputEl.value, icon: currentIcon };
        } else {
          result = inputEl.value;
        }
      }
      cleanup();
      resolve(result);
    };

    const onKeydown = (e) => {
      if (e.key === 'Enter') {
        onConfirm();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    };

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    inputEl.addEventListener('keydown', onKeydown);

    overlay.classList.remove('hidden');
  });
}

let archiveMotionState = new Map();
let archiveLoaded = false;
let archiveLoadVersion = 0;
let archiveTrailMode = false;
let archiveWorkCards = [];
let archiveTaskIconMap = {};
let archiveTrailTooltip = null;
let archiveTrailAnimCleanup = null;

function ensureArchiveTrailTooltip() {
  if (archiveTrailTooltip) return archiveTrailTooltip;
  archiveTrailTooltip = document.createElement('div');
  archiveTrailTooltip.className = 'trail-tooltip hidden';
  document.body.appendChild(archiveTrailTooltip);
  return archiveTrailTooltip;
}

function showArchiveTrailTooltip(anchor, card) {
  const tooltip = ensureArchiveTrailTooltip();
  tooltip.innerHTML =
    `<strong>${escapeHtml(card._taskTitle || '未分类')}</strong>` +
    `<span>${escapeHtml(formatCardTimestamp(card.timestamp))}</span>` +
    `<p>${escapeHtml(card.llmSummary || '暂无概要')}</p>`;
  tooltip.classList.remove('hidden');
  const rect = anchor.getBoundingClientRect();
  moveArchiveTrailTooltip({ clientX: rect.right, clientY: rect.top });
}

function moveArchiveTrailTooltip(event) {
  if (!archiveTrailTooltip || archiveTrailTooltip.classList.contains('hidden')) return;
  const rect = archiveTrailTooltip.getBoundingClientRect();
  const left = Math.min(event.clientX + 12, window.innerWidth - rect.width - 10);
  const top = Math.min(event.clientY + 10, window.innerHeight - rect.height - 10);
  archiveTrailTooltip.style.left = `${Math.max(8, left)}px`;
  archiveTrailTooltip.style.top = `${Math.max(8, top)}px`;
}

function hideArchiveTrailTooltip() {
  archiveTrailTooltip?.classList.add('hidden');
}

function ensureTrailAnimLayer() {
  let layer = document.getElementById('trail-anim-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'trail-anim-layer';
    layer.className = 'trail-anim-layer hidden';
    layer.innerHTML = '';
    document.body.appendChild(layer);
  }
  return layer;
}

function applyTrailLayout(container, enabled) {
  container.classList.toggle('trail-mode', enabled);
  container.style.display = enabled ? 'grid' : 'flex';
}

// 只让 label 做 FLIP 位移动画；卡片直接切换布局，连接线不参与位移动画。
function animateTrailLayout(container, enabled, onDone = null) {
  archiveTrailAnimCleanup?.();
  const nodes = Array.from(container.querySelectorAll('.work-card > .timeline-node'));
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || nodes.length === 0) {
    applyTrailLayout(container, enabled);
    onDone?.();
    return;
  }

  const before = nodes.map((node) => node.getBoundingClientRect());
  container.classList.add('trail-animating');
  container.classList.toggle('trail-collapsing', enabled);
  container.classList.toggle('trail-expanding', !enabled);
  applyTrailLayout(container, enabled);
  const after = nodes.map((node) => node.getBoundingClientRect());
  const duration = Math.min(420, Math.max(240, 260 + nodes.length * 4));
  const maxTravel = enabled ? 30 : 24;
  let rafId = 0;
  let lineRafId = 0;
  let timer = 0;

  nodes.forEach((node, index) => {
    const rawDx = before[index].left - after[index].left;
    const rawDy = before[index].top - after[index].top;
    const distance = Math.hypot(rawDx, rawDy);
    const ratio = distance > maxTravel ? maxTravel / distance : 1;
    const dx = rawDx * ratio;
    const dy = rawDy * ratio;
    node.style.transition = 'none';
    node.style.transform = `translate(${dx}px, ${dy}px)`;
    node.style.opacity = '0.72';
  });

  const cleanup = () => {
    cancelAnimationFrame(rafId);
    cancelAnimationFrame(lineRafId);
    window.clearTimeout(timer);
    nodes.forEach((node) => {
      node.style.transition = '';
      node.style.transform = '';
      node.style.opacity = '';
    });
    container.classList.remove('trail-collapsing', 'trail-expanding', 'trail-animating');
    container.style.removeProperty('--trail-line-opacity');
    archiveTrailAnimCleanup = null;
  };
  archiveTrailAnimCleanup = cleanup;

  rafId = requestAnimationFrame(() => {
    nodes.forEach((node, index) => {
      const delay = Math.min(180, index * 12);
      node.style.transition = `transform ${duration}ms cubic-bezier(.22,.75,.2,1) ${delay}ms, opacity ${duration}ms ease ${delay}ms`;
      node.style.transform = '';
      node.style.opacity = '1';
    });
    // 线条不跟随 label 移动，单独在原位做连续渐隐/渐显。
    const lineStart = performance.now();
    const animateLines = (now) => {
      const progress = Math.min(1, (now - lineStart) / duration);
      const opacity = enabled ? 1 - progress : progress;
      container.style.setProperty('--trail-line-opacity', String(opacity));
      if (progress < 1) lineRafId = requestAnimationFrame(animateLines);
    };
    lineRafId = requestAnimationFrame(animateLines);
    timer = window.setTimeout(() => {
      cleanup();
      onDone?.();
    }, duration + Math.min(180, Math.max(0, nodes.length - 1) * 12));
  });
}

// enabled=true 进入轨迹概览；enabled=false 时若传入 focusCardId 则展开并定位到该卡片
// 爪印概览（折叠态）右下角水印：默认取卡片最多的任务；悬停某爪印时切换为该卡片所属任务
function ensureTrailWatermarkEl() {
  let el = document.getElementById('trail-watermark');
  if (!el) {
    el = document.createElement('div');
    el.id = 'trail-watermark';
    document.body.appendChild(el);
  }
  return el;
}

function setTrailWatermarkIcon(icon) {
  const el = ensureTrailWatermarkEl();
  el.style.backgroundImage = `url("icons/taskpics/${icon}")`;
  el.style.display = 'block';
}

// 悬停某爪印时，把水印切到该卡片所属任务的 taskpics 图
function setTrailWatermarkToTask(taskId) {
  if (!archiveTrailMode || !taskId) return;
  setTrailWatermarkIcon(archiveTaskIconMap[taskId] || '1.png');
}

function updateTrailWatermark() {
  const el = document.getElementById('trail-watermark');
  const show = archiveTrailMode && archiveWorkCards.length > 0;
  if (!show) {
    if (el) el.style.display = 'none';
    return;
  }
  const counts = {};
  archiveWorkCards.forEach((c) => { if (c.taskId) counts[c.taskId] = (counts[c.taskId] || 0) + 1; });
  let topId = null;
  let topCount = -1;
  for (const id in counts) {
    if (counts[id] > topCount) { topCount = counts[id]; topId = id; }
  }
  if (!topId) { if (el) el.style.display = 'none'; return; }
  setTrailWatermarkIcon(archiveTaskIconMap[topId] || '1.png');
}

function setArchiveTrailMode(enabled, focusCardId = null) {
  archiveTrailMode = enabled;
  const container = document.getElementById('cards-container');
  const toggle = document.getElementById('trail-overview-btn');
  if (!container) return;
  toggle?.classList.toggle('active', enabled);
  toggle?.setAttribute('aria-pressed', String(enabled));
  hideArchiveTrailTooltip();
  updateTrailWatermark();
  if (enabled && window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });

  animateTrailLayout(container, enabled, () => {
    // 展开动画结束后再定位，避免滚动与飞行中的 label 错位
    if (enabled || !focusCardId) return;
    const target = container.querySelector(`[data-card-id="${CSS.escape(focusCardId)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('trail-focus');
    window.setTimeout(() => target.classList.remove('trail-focus'), 1200);
  });
}

function applyArchiveMotion(element, card, now) {
  const previous = archiveMotionState.get(card.id);
  const assigned = Boolean(card.taskId && card._taskTitle);
  const state = {
    assigned,
    enteredAt: previous?.enteredAt ?? (archiveLoaded ? now : null),
    revealedAt: previous?.revealedAt ?? null
  };
  if (assigned && !previous?.assigned && (previous || archiveLoaded)) {
    state.revealedAt = Math.max(now, (state.enteredAt ?? now) + 280);
  }
  if (!assigned) state.revealedAt = null;
  element.classList.toggle('timeline-pending', !assigned);
  if (state.enteredAt !== null && now - state.enteredAt < 280) {
    element.classList.add('card-entering');
    element.style.setProperty('--card-entry-delay', `${state.enteredAt - now}ms`);
  }
  if (state.revealedAt !== null && now - state.revealedAt < 700) {
    element.classList.add('timeline-revealing');
    element.style.setProperty('--timeline-delay', `${state.revealedAt - now}ms`);
  }
  archiveMotionState.set(card.id, state);
}

// 加载并显示所有工作卡片
async function loadWorkCards() {
  console.log('[Popup] 开始加载工作卡片');
  // 列表即将重建，正在进行的折叠动画坐标会失效，先收尾
  archiveTrailAnimCleanup?.();
  const version = ++archiveLoadVersion;
  const result = await chrome.storage.local.get(['workCards', 'tasks']);
  if (version !== archiveLoadVersion) return;
  const workCards = result.workCards || [];
  const now = performance.now();
  const currentIds = new Set(workCards.map(card => card.id));
  for (const id of archiveMotionState.keys()) {
    if (!currentIds.has(id)) archiveMotionState.delete(id);
  }
  const tasks = result.tasks || [];

  // 构建 taskId -> title 和 icon 映射
  const taskMap = {};
  const taskIconMap = {};
  tasks.forEach(t => { 
    taskMap[t.id] = t.title; 
    taskIconMap[t.id] = t.labelIcon || '1.png';
  });
  archiveWorkCards = workCards;
  archiveTaskIconMap = taskIconMap;

  console.log('[Popup] 加载到', workCards.length, '个卡片');

  const container = document.getElementById('cards-container');
  const emptyState = document.getElementById('empty-state');

  if (workCards.length === 0) {
    emptyState.style.display = 'block';
    container.style.display = 'none';
    container.innerHTML = '';
    archiveLoaded = true;
    return;
  }

  emptyState.style.display = 'none';
  container.style.display = archiveTrailMode ? 'grid' : 'flex';
  container.innerHTML = '';

  workCards.forEach((card, index) => {
    // 注入任务标题用于显示
    if (card.taskId && taskMap[card.taskId]) {
      card._taskTitle = taskMap[card.taskId];
      card._taskIcon = taskIconMap[card.taskId];
    }
    const cardElement = createCardElement(card, index, { isArchive: true });
    cardElement.dataset.cardId = card.id;
    applyArchiveMotion(cardElement, card, now);
    container.appendChild(cardElement);
  });
  archiveLoaded = true;
  updateTrailWatermark();
}

// 创建卡片元素
function createCardElement(card, index, options = {}) {
  // 三点菜单里的「切换任务」：任务详情页没有可见标题/label，爪印页同样保留该入口
  const showMoveToTask = options.showMoveToTask === true || options.isArchive === true;
  const cardDiv = document.createElement('div');
  cardDiv.className = 'work-card';

  const timeString = formatCardTimestamp(card.timestamp);
  const taskTitle = card._taskTitle || '未分类';
  const taskLabel = card.taskId
  ? `<span class="timeline-label task-card-label" data-task-id="${card.taskId}" data-card-id="${card.id}"><img src="icons/labels/${card._taskIcon || '1.png'}" alt="" /></span>`
  : `<span class="timeline-label task-card-label task-card-label--unset" data-card-id="${card.id}">未</span>`;

  cardDiv.innerHTML = `
    <div class="card-card-header">
      <div class="card-category task-category-trigger" data-task-id="${card.taskId || ''}" data-card-id="${card.id}" title="点击修改分类">${escapeHtml(taskTitle)}</div>
      <div class="card-meta"><span class="card-time">${timeString}</span><span class="card-meta-dot">·</span><span class="card-count">${card.tabCount} 标签页</span></div>
    </div>
    <div class="card-main-layout">
      <div class="card-left-info">
        ${renderOverviewHtml(card)}
      </div>
      ${card.screenshot ? `<img class="card-screenshot" src="${card.screenshot}" alt="截图" />` : ''}
    </div>

    <div class="card-tabs">
      ${card.tabs.map((tab, tabIndex) => `
        <div class="tab-item ${tab.active ? 'active' : ''}" data-url="${tab.url}" data-tab-index="${tabIndex}">
          <div class="tab-header-row">
            <span class="tab-favicon">${tab.favIconUrl ? `<img class="tab-favicon-img" src="${escapeHtml(tab.favIconUrl)}" alt="" />` : '📄'}</span>
            <div class="tab-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title)}</div>
          </div>
          ${tab.aiSummary ? `<div class="tab-ai-summary">${escapeHtml(tab.aiSummary)}</div>` : ''}
          <div class="tab-url">${escapeHtml(tab.url)}</div>
          <button class="tab-delete-btn" data-card-id="${card.id}" data-tab-index="${tabIndex}" title="删除此标签页">×</button>
        </div>
      `).join('')}
    </div>

    <div class="card-bottom-actions">
      <div class="card-more-wrap">
        <button class="card-more-btn" type="button" aria-label="更多操作">⋮</button>
        <div class="card-more-menu hidden">
          ${showMoveToTask ? `<button class="move-task-btn" data-card-id="${card.id}">切换任务</button>` : ''}
          <button class="delete-btn" data-card-id="${card.id}">删除</button>
        </div>
      </div>
      <button class="open-all-btn btn-ghost" data-index="${index}"><span class="open-all-icon">↗</span>一键打开</button>
      <button class="add-pages-btn btn-ghost" data-card-id="${card.id}"><span class="add-pages-icon">+</span>页面</button>
    </div>
    <div class="timeline-node">${taskLabel}</div>
  `;

  // 点击概要文本进入编辑状态
  const overviewText = cardDiv.querySelector('.card-overview-text');
  if (overviewText) {
    overviewText.addEventListener('click', () => {
      if (overviewText.isContentEditable) return;
      overviewText._originalText = overviewText.textContent.trim();
      overviewText.contentEditable = 'true';
      overviewText.classList.add('editing');
      overviewText.focus();
      // 将光标移到末尾
      const range = document.createRange();
      range.selectNodeContents(overviewText);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    overviewText.addEventListener('blur', async () => {
      if (!overviewText.isContentEditable) return;
      overviewText.contentEditable = 'false';
      overviewText.classList.remove('editing');
      const newText = overviewText.textContent.trim();
      const cardId = overviewText.getAttribute('data-card-id');
      if (!cardId) return;
      const contentChanged = newText !== overviewText._originalText;
      const result = await chrome.storage.local.get('workCards');
      const workCards = result.workCards || [];
      const updated = workCards.map(c =>
        c.id === cardId ? { ...c, llmSummary: newText, llmSummaryStatus: 'done', updatedAt: Date.now(), ...(contentChanged ? { isSummaryLocked: true } : {}) } : c
      );
      await chrome.storage.local.set({ workCards: updated });
      // 若内容有变更，刷新标注显示
      if (contentChanged) {
        const manualLabel = overviewText.closest('.card-overview')?.querySelector('.card-overview-manual-label');
        if (manualLabel) manualLabel.style.display = 'inline';
      }
      // 触发任务描述联动更新（摘要手动锁定后仍需更新任务描述）
      const card = updated.find(c => c.id === cardId);
      if (card && card.taskId) {
        chrome.runtime.sendMessage({ type: 'trigger-task-desc-update', taskId: card.taskId, force: true });
      }
    });

    overviewText.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        overviewText.blur();
      }
    });
  }

  // 爪印页：label 用于切换轨迹概览；任务详情页沿用原有更换分组逻辑
  const archiveLabel = cardDiv.querySelector('.task-card-label');
  if (archiveLabel && options.isArchive) {
    archiveLabel.addEventListener('mouseenter', () => {
      if (archiveTrailMode) {
        showArchiveTrailTooltip(archiveLabel, card);
        setTrailWatermarkToTask(card.taskId);
      }
    });
    archiveLabel.addEventListener('mousemove', (e) => {
      if (archiveTrailMode) moveArchiveTrailTooltip(e);
    });
    archiveLabel.addEventListener('mouseleave', () => {
      hideArchiveTrailTooltip();
      updateTrailWatermark();
    });
    archiveLabel.addEventListener('click', (e) => {
      e.stopPropagation();
      hideArchiveTrailTooltip();
      // 折叠态点击 label：展开并定位到该卡片；展开态点击 label：进入折叠
      setArchiveTrailMode(!archiveTrailMode, card.id);
    });
  } else if (archiveLabel) {
    archiveLabel.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskClassifyDropdown(archiveLabel, card.id);
    });
  }

  // 点击任务标题，弹出分类选择下拉框（更换分组入口）
  const categoryTrigger = cardDiv.querySelector('.task-category-trigger');
  if (categoryTrigger) {
    categoryTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskClassifyDropdown(categoryTrigger, card.id);
    });
  }

  // 点击标签页打开链接
  const tabItems = cardDiv.querySelectorAll('.tab-item');

  tabItems.forEach((item) => {
    item.addEventListener('click', () => {
      const url = item.getAttribute('data-url');
      chrome.tabs.create({ url: url });
    });
  });

  // 网站图标加载失败（旧存档无图标、图标失效等）时回退为 📄
  cardDiv.querySelectorAll('.tab-favicon-img').forEach((img) => {
    img.addEventListener('error', () => {
      img.replaceWith(document.createTextNode('📄'));
    });
  });

  // 删除标签页
  cardDiv.querySelectorAll('.tab-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cardId = btn.getAttribute('data-card-id');
      const tabIndex = parseInt(btn.getAttribute('data-tab-index'), 10);
      const { workCards = [] } = await chrome.storage.local.get('workCards');
      const target = workCards.find(c => c.id === cardId);
      if (!target) return;
      const updatedTabs = target.tabs.filter((_, i) => i !== tabIndex);
      const updatedCards = workCards.map(c =>
        c.id === cardId ? { ...c, tabs: updatedTabs, tabCount: updatedTabs.length, updatedAt: Date.now() } : c
      );
      await chrome.storage.local.set({ workCards: updatedCards });
      // 触发联动重生成
      chrome.runtime.sendMessage({ type: 'trigger-card-regen', cardId, force: true });
    });
  });

  // 点击截图放大
  const screenshot = cardDiv.querySelector('.card-screenshot');
  if (screenshot) {
    screenshot.addEventListener('click', () => {
      chrome.tabs.create({ url: card.screenshot });
    });
  }

  // 悬停截图放大预览
  bindScreenshotPreview(cardDiv);

  // 一键打开所有标签页
  cardDiv.querySelector('.open-all-btn').addEventListener('click', async (e) => {
    e.stopPropagation();

    // 找到活跃标签页（有截图的那个）
    const activeTab = card.tabs.find(tab => tab.active);
    const otherTabs = card.tabs.filter(tab => !tab.active);

    // 先打开其他标签页
    for (const tab of otherTabs) {
      if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        await chrome.tabs.create({ url: tab.url, active: false });
      }
    }

    // 最后打开活跃标签页，使其成为当前活动标签
    if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome://') && !activeTab.url.startsWith('chrome-extension://')) {
      await chrome.tabs.create({ url: activeTab.url, active: true });
    }
  });

  // 「+页面」：把当前浏览器标签页勾选后追加进本卡片
  const addPagesBtn = cardDiv.querySelector('.add-pages-btn');
  if (addPagesBtn) {
    addPagesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddPagesModal(card.id);
    });
  }

  // 三点菜单仅提供删除操作
  const moreButton = cardDiv.querySelector('.card-more-btn');
  const moreMenu = cardDiv.querySelector('.card-more-menu');
  moreButton.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.card-more-menu').forEach((menu) => {
      if (menu !== moreMenu) menu.classList.add('hidden');
    });
    moreMenu.classList.toggle('hidden');
  });
  cardDiv.querySelector('.delete-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    moreMenu.classList.add('hidden');
    await deleteCard(e.currentTarget.getAttribute('data-card-id'));
  });
  if (showMoveToTask) {
    cardDiv.querySelector('.move-task-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      moreMenu.classList.add('hidden');
      // 三点按钮位于卡片底部，下拉框以它为锚点向上展开
      openTaskClassifyDropdown(moreButton, card.id, { placement: 'above' });
    });
  }

  cardDiv.addEventListener('click', (e) => {
    if (!e.target.closest('.card-more-wrap')) moreMenu.classList.add('hidden');
  });

  return cardDiv;
}

// 卡片「+页面」：弹出当前所有标签页，勾选后追加进指定卡片
async function openAddPagesModal(cardId) {
  document.getElementById('add-pages-overlay')?.remove();

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (err) {
    console.error('[+页面] 获取标签页失败:', err);
  }

  const overlay = document.createElement('div');
  overlay.id = 'add-pages-overlay';
  overlay.className = 'add-pages-overlay';

  const itemsHtml = tabs.map((tab, i) => {
    const icon = tab.favIconUrl
      ? `<img class="add-pages-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="" />`
      : '📄';
    const title = escapeHtml(tab.title || tab.url || '未命名');
    const url = escapeHtml(tab.url || '');
    return `<label class="add-pages-item">
      <input type="checkbox" class="add-pages-check" data-index="${i}" />
      <span class="add-pages-favicon-wrap">${icon}</span>
      <span class="add-pages-text">
        <span class="add-pages-title">${title}</span>
        <span class="add-pages-url">${url}</span>
      </span>
    </label>`;
  }).join('');

  overlay.innerHTML = `
    <div class="add-pages-modal">
      <div class="add-pages-header">
        <h3>加入当前卡片</h3>
        <input type="text" class="add-pages-search" placeholder="搜索标签页…" />
      </div>
      <div class="add-pages-list">${itemsHtml || '<div class="add-pages-empty">没有可加入的标签页</div>'}</div>
      <div class="add-pages-footer">
        <span class="add-pages-count">已选 0 个</span>
        <span class="add-pages-actions">
          <button class="btn-ghost add-pages-select-all">全选</button>
          <button class="btn-ghost add-pages-cancel">取消</button>
          <button class="btn-primary add-pages-confirm">确认加入</button>
        </span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const checks = () => Array.from(overlay.querySelectorAll('.add-pages-check'));
  const updateCount = () => {
    overlay.querySelector('.add-pages-count').textContent = `已选 ${checks().filter(c => c.checked).length} 个`;
  };

  overlay.querySelector('.add-pages-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    overlay.querySelectorAll('.add-pages-item').forEach((item) => {
      item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  checks().forEach(c => c.addEventListener('change', updateCount));
  overlay.querySelector('.add-pages-select-all').addEventListener('click', () => {
    const all = checks();
    const allChecked = all.length > 0 && all.every(c => c.checked);
    all.forEach(c => { c.checked = !allChecked; });
    updateCount();
  });

  const close = () => overlay.remove();
  overlay.querySelector('.add-pages-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('.add-pages-confirm').addEventListener('click', async () => {
    const selectedIdx = checks().filter(c => c.checked).map(c => Number(c.getAttribute('data-index')));
    if (selectedIdx.length === 0) { close(); return; }
    const selectedTabs = selectedIdx.map((idx) => {
      const t = tabs[idx];
      return { tabId: t.id, url: t.url, title: t.title || t.url || '未命名', favIconUrl: t.favIconUrl || '' };
    });
    close();
    // 交由后台抓取每页正文、生成逐页摘要，并重算卡片/任务概要
    chrome.runtime.sendMessage({ type: 'add-pages-to-card', cardId, tabs: selectedTabs });
  });
}

function formatCardTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const dayStart = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayDiff = Math.floor((dayStart(now) - dayStart(date)) / 86400000);
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (dayDiff >= 0 && dayDiff <= 2) {
    const dayLabel = ['今天', '昨天', '前天'][dayDiff];
    return `${dayLabel} ${time}`;
  }
  const dateLabel = sameYear
    ? date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
  return `${dateLabel} ${time}`;
}

function renderOverviewHtml(card) {
  const status = card.llmSummaryStatus || 'pending';
  let text = card.llmSummary || '正在生成概要...';

  if (status === 'not_configured') {
    text = card.llmSummary || '尚未配置千问 API，未生成概要。';
  }

  const statusClass = status === 'error'
    ? 'error'
    : (status === 'pending' ? 'pending' : 'done');

  return `
    <div class="card-overview ${statusClass}">
      ${card.isSummaryLocked ? '<div class="card-overview-manual-label">已手动编辑</div>' : ''}
      <div class="card-overview-text" data-card-id="${card.id}" title="点击编辑">${escapeHtml(text)}</div>
    </div>
  `;
}

// HTML 转义函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 删除卡片
async function deleteCard(cardId) {
  const confirmed = await customModal({
    title: '删除存档',
    message: '确定要删除这个存档吗？',
    confirmText: '删除',
    isDanger: true
  });
  if (!confirmed) {
    return;
  }

  const result = await chrome.storage.local.get('workCards');
  const workCards = result.workCards || [];

  const target = workCards.find(c => c.id === cardId);
  if (!target) return;

  const updatedCards = workCards.filter(c => c.id !== cardId);

  await chrome.storage.local.set({ workCards: updatedCards });

  if (target.taskId) {
    chrome.runtime.sendMessage({ type: 'trigger-task-desc-update', taskId: target.taskId, force: true });
  }

  // 检查当前是否在任务详情页
  const taskDetailView = document.getElementById('task-detail-view');
  if (taskDetailView && !taskDetailView.classList.contains('hidden')) {
    // 从 header 中获取当前任务 ID
    const taskTitle = document.querySelector('.task-detail-title');
    if (taskTitle) {
      const result = await chrome.storage.local.get('tasks');
      const tasks = result.tasks || [];
      const currentTask = tasks.find(t => t.title === taskTitle.textContent);
      if (currentTask) {
        await showTaskDetail(currentTask.id);
        return;
      }
    }
  }

  await loadWorkCards();
}

async function loadSettings() {
  const result = await chrome.storage.local.get(['llmSettings', 'last_token_usage']);
  const settings = {
    ...DEFAULT_LLM_SETTINGS,
    ...(result.llmSettings || {})
  };

  document.getElementById('enable-ai').checked = settings.enableAI !== false;
  document.getElementById('api-key').value = settings.apiKey || '';
  document.getElementById('model-name').value = settings.model || DEFAULT_LLM_SETTINGS.model;
  document.getElementById('api-endpoint').value = settings.endpoint || DEFAULT_LLM_SETTINGS.endpoint;
  document.getElementById('include-screenshot').checked = settings.includeScreenshot !== false;
  document.getElementById('text-length-beginning').value = settings.textLengthBeginning ?? 500;
  document.getElementById('text-length-viewport').value = settings.textLengthViewport ?? 500;
  document.getElementById('text-length-ending').value = settings.textLengthEnding ?? 300;

  // 显示 Token 使用情况
  updateTokenUsageDisplay(result.last_token_usage);
}

function updateTokenUsageDisplay(tokenUsage) {
  const displayEl = document.getElementById('token-usage-text');

  if (!tokenUsage || tokenUsage.totalTokens === 0) {
    displayEl.textContent = '未知';
    return;
  }

  const { promptTokens, completionTokens, totalTokens } = tokenUsage;
  displayEl.textContent = `发送: ${promptTokens} / 接收: ${completionTokens} / 总计: ${totalTokens} Tokens`;
}

// 接口地址补全：用户常常只填到域名或 /v1，这里统一补成 OpenAI 兼容的 /chat/completions
function normalizeEndpoint(input) {
  let e = (input || '').trim();
  if (!e) return DEFAULT_LLM_SETTINGS.endpoint;
  if (!/^https?:\/\//i.test(e)) e = 'https://' + e;
  e = e.replace(/\/+$/, '');
  if (!/\/chat\/completions$/i.test(e)) e = e + '/chat/completions';
  return e;
}

async function saveSettings() {
  const enableAI = document.getElementById('enable-ai').checked;
  const apiKey = document.getElementById('api-key').value.trim();
  const model = document.getElementById('model-name').value.trim() || DEFAULT_LLM_SETTINGS.model;
  const endpointInput = document.getElementById('api-endpoint');
  const endpoint = normalizeEndpoint(endpointInput.value);
  // 写回补全后的完整地址，让用户直观看到补成了什么
  if (endpointInput.value.trim() !== endpoint) endpointInput.value = endpoint;
  const includeScreenshot = document.getElementById('include-screenshot').checked;
  const textLengthBeginning = Math.max(0, parseInt(document.getElementById('text-length-beginning').value, 10) || 500);
  const textLengthViewport = Math.max(0, parseInt(document.getElementById('text-length-viewport').value, 10) || 500);
  const textLengthEnding = Math.max(0, parseInt(document.getElementById('text-length-ending').value, 10) || 300);

  await chrome.storage.local.set({
    llmSettings: {
      enableAI,
      apiKey,
      model,
      endpoint,
      includeScreenshot,
      textLengthBeginning,
      textLengthViewport,
      textLengthEnding
    }
  });

  const statusEl = document.getElementById('settings-status');
  statusEl.textContent = '已保存';
  setTimeout(() => { statusEl.textContent = ''; }, 1200);
}

function bindSettingsEvents() {
  const toggleBtn = document.getElementById('toggle-settings');
  const closeBtn = document.getElementById('close-settings');
  const settingsView = document.getElementById('settings-view');

  toggleBtn.addEventListener('click', () => {
    settingsView.classList.remove('hidden');
  });

  closeBtn.addEventListener('click', () => {
    saveSettings();
    settingsView.classList.add('hidden');
  });

  // 实时保存：所有输入控件变更时也可选自动保存，或主要依靠关闭时保存
  const inputs = settingsView.querySelectorAll('input');
  inputs.forEach(input => {
    // 备份区的控件不参与设置保存
    if (input.id === 'backup-include-screenshot' || input.id === 'import-file-input') return;
    const event = (input.type === 'checkbox') ? 'change' : 'blur';
    input.addEventListener(event, saveSettings);
  });
}

// ========== 数据备份与恢复 ==========

const BACKUP_FORMAT = 'tasksaving-backup';
const BACKUP_VERSION = 1;

// 统一时间口径：数值毫秒 / ISO 字符串都归一为毫秒，非法值记 0
function toMillis(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const t = new Date(value || '').getTime();
  return Number.isFinite(t) ? t : 0;
}

function cardMtime(card) {
  return toMillis(card?.updatedAt) || toMillis(card?.timestamp);
}

function taskMtime(task) {
  return toMillis(task?.updatedAt) || toMillis(task?.createdAt);
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatStamp(date) {
  const d = date || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function formatDateTime(value) {
  const t = toMillis(value);
  if (!t) return '未知时间';
  return new Date(t).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

// 读取全部数据并规整身份 id 与 updatedAt，作为导出与合并的统一数据源
async function buildBackupPayload(includeScreenshot) {
  const result = await chrome.storage.local.get(['workCards', 'tasks', 'llmSettings', 'last_token_usage']);

  const workCards = (result.workCards || []).map((card) => {
    const clean = { ...card };
    // 运行时注入的展示字段不导出
    delete clean._taskTitle;
    delete clean._taskIcon;
    if (!clean.id) clean.id = genId('work');
    if (!clean.updatedAt) clean.updatedAt = cardMtime(clean) || Date.now();
    if (!includeScreenshot) clean.screenshot = '';
    return clean;
  });

  const tasks = (result.tasks || []).map((task) => {
    const clean = { ...task };
    // 系统任务「未知任务」全局唯一，避免合并后出现两条
    if (clean.isSystem || clean.title === '未知任务') {
      clean.id = UNKNOWN_TASK_ID;
    } else if (!clean.id) {
      clean.id = genId('task');
    }
    if (!clean.updatedAt) clean.updatedAt = taskMtime(clean) || Date.now();
    return clean;
  });

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    includeScreenshot: !!includeScreenshot,
    data: {
      workCards,
      tasks,
      llmSettings: result.llmSettings || null,
      last_token_usage: result.last_token_usage || null
    }
  };
}

// 通过 chrome.downloads 落盘（弹窗关闭也能完成下载）
function downloadTextFile(filename, mimeType, text) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
      { url, filename, saveAs: true, conflictAction: 'uniquify' },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          URL.revokeObjectURL(url);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(downloadId);
      }
    );
    // 延迟释放，避免下载尚未开始 blob 就失效
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
}

// 生成 Markdown 可读归档
function buildMarkdown(payload) {
  const workCards = payload.data.workCards || [];
  const tasks = payload.data.tasks || [];
  const lines = [];

  lines.push('# 本咪的工作爪印 · 数据归档');
  lines.push('');
  lines.push(`- 导出时间：${formatDateTime(payload.exportedAt)}`);
  lines.push(`- 存档：${workCards.length} 条　任务：${tasks.length} 个`);
  lines.push('- 说明：Markdown 归档不包含截图（避免 base64 乱码），完整截图请使用 JSON 备份');
  lines.push('');

  const cardsByTask = new Map();
  workCards.forEach((card) => {
    const key = card.taskId || '__none__';
    if (!cardsByTask.has(key)) cardsByTask.set(key, []);
    cardsByTask.get(key).push(card);
  });
  cardsByTask.forEach((list) => list.sort((a, b) => cardMtime(b) - cardMtime(a)));

  const renderCards = (cards, level) => {
    cards.forEach((card) => {
      lines.push(`${'#'.repeat(level)} ${formatDateTime(card.timestamp || card.updatedAt)}`);
      lines.push('');
      // Markdown 供人阅读，不内嵌 base64 截图（会变成几万字的乱码并撑爆文件）
      if (card.screenshot) {
        lines.push('（本条存档含截图，Markdown 中已省略；完整截图请导出 JSON 备份）');
        lines.push('');
      }
      lines.push(`**概要**：${card.llmSummary || '（无）'}`);
      lines.push('');
      lines.push(`**标签页（${(card.tabs || []).length}）**`);
      (card.tabs || []).forEach((tab) => {
        lines.push(`- [${tab.title || tab.url}](${tab.url})${tab.aiSummary ? ` — ${tab.aiSummary}` : ''}`);
      });
      lines.push('');
    });
  };

  const taskIds = new Set(tasks.map(t => t.id));
  [...tasks].sort((a, b) => taskMtime(b) - taskMtime(a)).forEach((task) => {
    lines.push(`## 任务：${task.title}${task.isArchived ? '（已归档）' : ''}`);
    lines.push('');
    lines.push(`- 创建时间：${formatDateTime(task.createdAt)}`);
    lines.push(`- 最后更新：${formatDateTime(task.updatedAt || task.createdAt)}`);
    if (task.description) lines.push(`- 描述：${task.description}`);
    if (Array.isArray(task.todoList) && task.todoList.length) {
      lines.push('- 待办：');
      task.todoList.forEach(todo => lines.push(`  - [${todo.done ? 'x' : ' '}] ${todo.text}`));
    }
    if (task.briefing) {
      lines.push('');
      lines.push(`### 任务简报（${formatDateTime(task.briefingGeneratedAt)}）`);
      lines.push('');
      task.briefing.split('\n').forEach(line => lines.push(line));
    }
    lines.push('');
    renderCards(cardsByTask.get(task.id) || [], 3);
  });

  // 归类到已不存在的任务、或从未归类的存档
  const orphanCards = workCards.filter(c => !c.taskId || !taskIds.has(c.taskId));
  if (orphanCards.length) {
    lines.push('## 未归类存档');
    lines.push('');
    renderCards(orphanCards, 3);
  }

  return lines.join('\n');
}

// 按唯一 id 合并：同 id 取更新时间较新的一条，并补齐缺失的富字段
function mergeById(localList, incomingList, mtimeFn, fillFn) {
  const map = new Map();
  let added = 0;
  let updated = 0;

  localList.forEach((item) => {
    if (item && item.id) map.set(item.id, item);
  });

  incomingList.forEach((inc) => {
    if (!inc || !inc.id) return;
    const current = map.get(inc.id);
    if (!current) {
      map.set(inc.id, inc);
      added += 1;
      return;
    }
    if (mtimeFn(inc) >= mtimeFn(current)) {
      map.set(inc.id, fillFn(current, inc));
      updated += 1;
    }
  });

  return { list: [...map.values()], added, updated };
}

function mergeCardFields(current, incoming) {
  const merged = { ...incoming };
  // 无截图的备份不应抹掉本地已有截图
  if (!merged.screenshot && current.screenshot) merged.screenshot = current.screenshot;
  if (!merged.taskId && current.taskId) merged.taskId = current.taskId;
  if (!merged.llmSummary && current.llmSummary) merged.llmSummary = current.llmSummary;
  return merged;
}

function mergeTaskFields(current, incoming) {
  const merged = { ...incoming };
  if (!merged.briefing && current.briefing) {
    merged.briefing = current.briefing;
    merged.briefingGeneratedAt = current.briefingGeneratedAt;
  }
  const incomingTodos = Array.isArray(merged.todoList) ? merged.todoList : [];
  const currentTodos = Array.isArray(current.todoList) ? current.todoList : [];
  if (!incomingTodos.length && currentTodos.length) merged.todoList = currentTodos;
  if (!merged.labelIcon && current.labelIcon) merged.labelIcon = current.labelIcon;
  merged.isSystem = !!(merged.isSystem || current.isSystem || merged.title === '未知任务');
  return merged;
}

// 解析并校验备份文件
function parseBackupFile(text) {
  const data = JSON.parse(text);
  if (!data || data.format !== BACKUP_FORMAT) {
    throw new Error('这不是本插件导出的备份文件');
  }
  const workCards = Array.isArray(data.data?.workCards) ? data.data.workCards : [];
  const tasks = Array.isArray(data.data?.tasks) ? data.data.tasks : [];
  if (!workCards.length && !tasks.length) {
    throw new Error('备份文件中没有可导入的数据');
  }
  return { workCards, tasks, exportedAt: data.exportedAt };
}

function setBackupStatus(message, kind) {
  const el = document.getElementById('backup-status');
  if (!el) return;
  el.textContent = message || '';
  el.className = `backup-status${kind ? ` ${kind}` : ''}`;
}

function setBackupBusy(busy) {
  ['export-json-btn', 'export-md-btn', 'import-backup-btn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = busy;
  });
}

async function exportBackup(kind) {
  const includeScreenshot = document.getElementById('backup-include-screenshot')?.checked !== false;
  setBackupBusy(true);
  setBackupStatus('正在生成备份…');
  try {
    const payload = await buildBackupPayload(includeScreenshot);
    const stamp = formatStamp();
    if (kind === 'json') {
      await downloadTextFile(
        `爪印备份-${stamp}.json`,
        'application/json;charset=utf-8',
        JSON.stringify(payload, null, 2)
      );
      setBackupStatus(
        `已导出 ${payload.data.workCards.length} 条存档、${payload.data.tasks.length} 个任务` +
        `${includeScreenshot ? '' : '（不含截图）'}`,
        'ok'
      );
    } else {
      await downloadTextFile(`爪印归档-${stamp}.md`, 'text/markdown;charset=utf-8', buildMarkdown(payload));
      setBackupStatus('已导出 Markdown 归档文件', 'ok');
    }
  } catch (error) {
    console.error('[备份] 导出失败:', error);
    setBackupStatus(`导出失败：${error.message}`, 'error');
  } finally {
    setBackupBusy(false);
  }
}

async function importBackupFile(file) {
  setBackupBusy(true);
  setBackupStatus('正在读取备份…');
  try {
    const text = await file.text();
    const backup = parseBackupFile(text);

    // 与导出一致的身份规整：补 id、统一未知任务
    const incomingCards = backup.workCards.map((card) => ({
      ...card,
      id: card.id || genId('work'),
      updatedAt: card.updatedAt || cardMtime(card) || Date.now()
    }));
    const incomingTasks = backup.tasks.map((task) => ({
      ...task,
      id: (task.isSystem || task.title === '未知任务') ? UNKNOWN_TASK_ID : (task.id || genId('task')),
      updatedAt: task.updatedAt || taskMtime(task) || Date.now()
    }));

    const confirmed = await customModal({
      title: '导入备份',
      message: `备份包含 ${incomingCards.length} 条存档、${incomingTasks.length} 个任务。将按唯一 id 合并到本地，同 id 取更新时间较新的一条（API 设置不会被覆盖）。是否继续？`,
      confirmText: '导入'
    });
    if (!confirmed) {
      setBackupStatus('已取消导入');
      return;
    }

    const stored = await chrome.storage.local.get(['workCards', 'tasks']);
    const mergedCards = mergeById(stored.workCards || [], incomingCards, cardMtime, mergeCardFields);
    const mergedTasks = mergeById(stored.tasks || [], incomingTasks, taskMtime, mergeTaskFields);

    await chrome.storage.local.set({
      workCards: mergedCards.list,
      tasks: mergedTasks.list
    });

    setBackupStatus(
      `导入完成：新增 ${mergedCards.added} 条存档 / 更新 ${mergedCards.updated} 条；` +
      `新增 ${mergedTasks.added} 个任务 / 更新 ${mergedTasks.updated} 个`,
      'ok'
    );

    await loadWorkCards();
    await loadTasks();
  } catch (error) {
    console.error('[备份] 导入失败:', error);
    setBackupStatus(`导入失败：${error.message}`, 'error');
  } finally {
    setBackupBusy(false);
  }
}

function bindBackupEvents() {
  const jsonBtn = document.getElementById('export-json-btn');
  const mdBtn = document.getElementById('export-md-btn');
  const importBtn = document.getElementById('import-backup-btn');
  const fileInput = document.getElementById('import-file-input');

  if (jsonBtn) jsonBtn.addEventListener('click', () => exportBackup('json'));
  if (mdBtn) mdBtn.addEventListener('click', () => exportBackup('md'));

  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      await importBackupFile(file);
      // 清空 value，便于重复导入同一文件
      fileInput.value = '';
    });
  }
}

// 根据当前系统展示对应快捷键文案（Mac 用 Option，Windows/Linux 用 Ctrl+Shift）
function applyShortcutHints() {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '') || /Mac/i.test(navigator.userAgent);
  const saveAll = isMac ? '⌥ 1' : 'Ctrl+Shift+1';
  const saveOne = isMac ? '⌥ 2' : 'Ctrl+Shift+2';

  const subtitle = document.getElementById('shortcut-subtitle');
  if (subtitle) subtitle.textContent = `${saveAll} 存档全部页面　·　${saveOne} 存档当前页面`;

  const hint = document.getElementById('shortcut-hint');
  if (hint) hint.textContent = `按 ${saveAll} 保存工作`;
}

// 页面加载时显示卡片
document.addEventListener('DOMContentLoaded', async () => {
  applyShortcutHints();
  bindSettingsEvents();
  bindBackupEvents();
  bindNavEvents();
  await loadSettings();
  await loadWorkCards();
});

function bindNavEvents() {
  const navArchive = document.getElementById('nav-archive');
  const navTasks = document.getElementById('nav-tasks');
  const pageArchive = document.getElementById('page-archive');
  const pageTasks = document.getElementById('page-tasks');

  const syncDetailChrome = () => {
    const detailView = document.getElementById('task-detail-view');
    const inDetail = detailView && !detailView.classList.contains('hidden');
    setDetailBackButton(!!inDetail);
    document.body.classList.toggle('detail-active', !!inDetail);
  };

  const trailBtn = document.getElementById('trail-overview-btn');
  if (trailBtn) {
    trailBtn.addEventListener('click', () => {
      setArchiveTrailMode(!archiveTrailMode);
    });
  }

  navArchive.addEventListener('click', () => {
    navArchive.classList.add('active');
    navTasks.classList.remove('active');
    pageArchive.classList.remove('hidden');
    pageTasks.classList.add('hidden');
    // 爪印页不显示详情页的返回按钮，也不套用详情间距
    setDetailBackButton(false);
    document.body.classList.remove('detail-active');
    trailBtn?.classList.remove('hidden');
    loadWorkCards();
  });

  navTasks.addEventListener('click', () => {
    if (archiveTrailMode) setArchiveTrailMode(false);
    trailBtn?.classList.add('hidden');
    navTasks.classList.add('active');
    navArchive.classList.remove('active');
    pageTasks.classList.remove('hidden');
    pageArchive.classList.add('hidden');
    // 若此前停在任务详情页，切回后仍显示详情，返回按钮需一并恢复
    syncDetailChrome();
    loadTasks();
  });

  // 新建任务
  const createBtn = document.getElementById('task-create-btn');
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      await createManualTask();
    });
  }

  // 排序按钮：切换排序方向并同步图标（desc = Time down，asc = Time up）
  document.getElementById('task-sort-btn').addEventListener('click', () => {
    taskSortOrder = taskSortOrder === 'desc' ? 'asc' : 'desc';
    loadTasks();
  });

  // 任务搜索
  const searchInput = document.getElementById('task-search-input');
  const searchClear = document.getElementById('task-search-clear');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      taskSearchQuery = searchInput.value;
      if (searchClear) searchClear.classList.toggle('hidden', !searchInput.value);
      loadTasks();
    });
  }
  if (searchClear && searchInput) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      taskSearchQuery = '';
      searchClear.classList.add('hidden');
      loadTasks();
    });
  }

  // 返回任务列表
  document.getElementById('back-to-tasks').addEventListener('click', () => {
    document.getElementById('task-list-view').classList.remove('hidden');
    document.getElementById('task-detail-view').classList.add('hidden');
    setDetailBackButton(false);
    document.body.classList.remove('detail-active');
    loadTasks();
  });

  // 已归档任务折叠/展开
  const archivedToggle = document.getElementById('archived-tasks-toggle');
  const archivedBody = document.getElementById('archived-tasks-body');
  const archivedArrow = archivedToggle.querySelector('.archived-tasks-toggle-arrow');

  archivedToggle.addEventListener('click', () => {
    const isHidden = archivedBody.classList.contains('hidden');
    archivedBody.classList.toggle('hidden', !isHidden);
    archivedArrow.classList.toggle('open', isHidden);
  });
}

// 监听 storage 变化，实时更新
chrome.storage.onChanged.addListener((changes, namespace) => {
  console.log('[Popup] Storage 变化事件:', { namespace, changes });
  if (namespace === 'local' && changes.workCards) {
    console.log('[Popup] 检测到 workCards 变化，重新加载');

    // 检查是否在任务详情页
    const taskDetailView = document.getElementById('task-detail-view');
    if (taskDetailView && !taskDetailView.classList.contains('hidden')) {
      // 在任务详情页,刷新当前任务详情
      const taskId = taskDetailView.dataset.taskId;
      if (taskId) {
        showTaskDetail(taskId);
      }
    } else {
      // 在主页面,刷新卡片列表
      loadWorkCards();
    }
  }
  if (namespace === 'local' && changes.tasks) {
    // 检查是否在任务详情页
    const taskDetailView = document.getElementById('task-detail-view');
    if (taskDetailView && !taskDetailView.classList.contains('hidden')) {
      // 在任务详情页,刷新当前任务详情
      const taskId = taskDetailView.dataset.taskId;
      if (taskId) {
        showTaskDetail(taskId);
      }
    } else {
      // 如果当前任务列表页可见，刷新任务列表
      const pageTasks = document.getElementById('page-tasks');
      if (pageTasks && !pageTasks.classList.contains('hidden')) {
        loadTasks();
      }
      // 同时也静默刷新一下主卡片列表的数据关联(比如标题更新)，以防切回卡片列表时数据陈旧
      loadWorkCards();
    }
  }
  if (namespace === 'local' && changes.last_token_usage) {
    console.log('[Popup] 检测到 Token 使用数据变化，更新显示');
    updateTokenUsageDisplay(changes.last_token_usage.newValue);
  }
});

// ========== 任务管理 UI ==========

// 任务列表排序方向：'desc' 更新时间倒序（默认），'asc' 正序
let taskSortOrder = 'desc';

// 任务搜索关键词
let taskSearchQuery = '';

// 将输入拆分为搜索词（空格分隔，全部命中才算匹配）
function parseSearchTerms(query) {
  return String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 转义后高亮命中词（仅任务名/任务概要使用）
function highlightTerm(text, terms) {
  const safe = escapeHtml(text);
  if (!terms || terms.length === 0) return safe;
  const re = new RegExp('(' + terms.map(escapeRegExp).join('|') + ')', 'gi');
  return safe.replace(re, '<mark class="search-hit">$1</mark>');
}

// 收集一个任务的可搜索文本：
// primary = 任务名、任务概要（命中后标红且优先）；secondary = 简报、待办、卡片概要与标签页（不标红，权重低）
function collectTaskSearchFields(task, workCards) {
  const cards = workCards.filter(c => c.taskId === task.id);
  const todos = Array.isArray(task.todoList)
    ? task.todoList.map(t => (t && t.text ? String(t.text) : ''))
    : [];
  const cardTexts = [];
  cards.forEach(c => {
    if (c.llmSummary) cardTexts.push(String(c.llmSummary));
    (c.tabs || []).forEach(tb => {
      if (tb.title) cardTexts.push(String(tb.title));
      if (tb.aiSummary) cardTexts.push(String(tb.aiSummary));
      if (tb.url) cardTexts.push(String(tb.url));
    });
  });
  return {
    primary: [String(task.title || ''), String(task.description || '')],
    secondary: [String(task.briefing || ''), ...todos, ...cardTexts]
  };
}

// 返回命中信息；未完全命中返回 null
function matchTask(task, workCards, terms) {
  const { primary, secondary } = collectTaskSearchFields(task, workCards);
  let score = 0;
  let primaryHit = false;
  for (const term of terms) {
    let best = 0;
    primary.forEach(field => {
      const n = field.toLowerCase().split(term).length - 1;
      if (n > 0) best = Math.max(best, 60 + n);
    });
    if (best > 0) {
      primaryHit = true;
    } else {
      secondary.forEach(field => {
        const n = field.toLowerCase().split(term).length - 1;
        if (n > 0) best = Math.max(best, 10 + n);
      });
    }
    if (best === 0) return null;
    score += best;
  }
  return { score: primaryHit ? score + 1000 : score, primaryHit };
}

// 一次性规整「未知任务」：合并历史遗留的重复条目，统一 id，并把卡片重新指向唯一条目
// 返回 { tasks, workCards, changed }，changed 为 false 表示数据无需写回
function normalizeUnknownTask(tasks, workCards) {
  const unknownTasks = tasks.filter(t => t.title === '未知任务' || t.isSystem);
  if (unknownTasks.length === 0) return { tasks, workCards, changed: false };

  // 优先保留已经是固定 id 的那条，否则保留第一条
  const primary = unknownTasks.find(t => t.id === UNKNOWN_TASK_ID) || unknownTasks[0];
  const staleIds = unknownTasks.filter(t => t !== primary).map(t => t.id);
  if (primary.id !== UNKNOWN_TASK_ID) staleIds.push(primary.id);
  const redirectIds = new Set(staleIds);

  // 只保留 primary，其余重复条目剔除；并把 primary 的 id 统一为 UNKNOWN_TASK_ID
  const nextTasks = tasks
    .filter(t => !unknownTasks.includes(t) || t === primary)
    .map(t => (t === primary ? { ...t, id: UNKNOWN_TASK_ID } : t));

  // 挂在旧 id 下的卡片全部改指向唯一的未知任务
  const nextCards = redirectIds.size
    ? workCards.map(c => (c.taskId && redirectIds.has(c.taskId) ? { ...c, taskId: UNKNOWN_TASK_ID } : c))
    : workCards;

  const changed = primary.id !== UNKNOWN_TASK_ID || unknownTasks.length > 1;
  return { tasks: nextTasks, workCards: nextCards, changed };
}

// 加载并渲染任务列表
async function loadTasks() {
  const result = await chrome.storage.local.get(['tasks', 'workCards']);
  let tasks = result.tasks || [];
  let workCards = result.workCards || [];

  // 一次性清理：合并历史遗留的重复「未知任务」
  const normalized = normalizeUnknownTask(tasks, workCards);
  if (normalized.changed) {
    tasks = normalized.tasks;
    workCards = normalized.workCards;
    await chrome.storage.local.set({ tasks, workCards });
    console.log('[任务规整] 已合并重复的未知任务条目');
  }

  // 确保"未知任务"始终存在
  let unknownTask = tasks.find(t => t.title === '未知任务');
  if (!unknownTask) {
    unknownTask = {
      id: UNKNOWN_TASK_ID,
      title: '未知任务',
      description: '暂未分类的存档',
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
      isSystem: true,
      labelIcon: '1.png'
    };
    tasks = [...tasks, unknownTask];
    await chrome.storage.local.set({ tasks });
  }

  const container = document.getElementById('tasks-container');
  const emptyEl = document.getElementById('tasks-empty');
  const archivedPanel = document.getElementById('archived-tasks-panel');
  const archivedBody = document.getElementById('archived-tasks-body');

  container.innerHTML = '';
  archivedBody.innerHTML = '';
  emptyEl.classList.add('hidden');

  // 计算每个任务的最新卡片时间作为「更新时间」
  const taskLastCardTime = {};
  workCards.forEach(c => {
    if (!c.taskId) return;
    const t = new Date(c.timestamp).getTime();
    if (!taskLastCardTime[c.taskId] || t > taskLastCardTime[c.taskId]) {
      taskLastCardTime[c.taskId] = t;
    }
  });

  // 分离活跃任务和已归档任务
  const activeTasks = tasks.filter(t => !t.isArchived);
  const archivedTasks = tasks.filter(t => t.isArchived);

  // 按更新时间排序，「未知任务」始终在最后
  const sortTasks = (taskList) => {
    return [...taskList].sort((a, b) => {
      if (a.title === '未知任务') return 1;
      if (b.title === '未知任务') return -1;
      const aTime = taskLastCardTime[a.id] || new Date(a.createdAt).getTime();
      const bTime = taskLastCardTime[b.id] || new Date(b.createdAt).getTime();
      return taskSortOrder === 'desc' ? bTime - aTime : aTime - bTime;
    });
  };

  const sortedActive = sortTasks(activeTasks);
  const sortedArchived = sortTasks(archivedTasks);

  const lastTimeOf = (task) => taskLastCardTime[task.id] || new Date(task.createdAt).getTime();
  const terms = parseSearchTerms(taskSearchQuery);

  // 同步排序按钮图标：desc（最新在最上）用 Time down，asc 用 Time up
  const sortBtn = document.getElementById('task-sort-btn');
  if (sortBtn) {
    const sortIcon = document.getElementById('task-sort-icon');
    if (sortIcon) {
      sortIcon.src = taskSortOrder === 'desc' ? 'icons/Time down.png' : 'icons/Time up.png';
    }
  }

  const renderTaskItem = (task) => {
    const cardCount = workCards.filter(c => c.taskId === task.id).length;
    // 已归档任务沿用原有样式（虚线框 + 已归档标签），由 task.isArchived 决定
    return createTaskItem(task, cardCount, !!task.isArchived, terms);
  };

  if (terms.length > 0) {
    // 搜索模式：按相关性从高到低排序，活跃与已归档结果混排在同列表中
    const scored = [];
    tasks.forEach(task => {
      const hit = matchTask(task, workCards, terms);
      if (hit) scored.push({ task, score: hit.score });
    });
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return taskSortOrder === 'desc'
        ? lastTimeOf(b.task) - lastTimeOf(a.task)
        : lastTimeOf(a.task) - lastTimeOf(b.task);
    });

    archivedPanel.classList.add('hidden');
    scored.forEach(({ task }) => container.appendChild(renderTaskItem(task)));

    if (scored.length === 0) {
      emptyEl.classList.remove('hidden');
      const main = emptyEl.querySelector('p');
      const hint = emptyEl.querySelector('.hint');
      if (main) main.textContent = '没有匹配的任务';
      if (hint) hint.textContent = '换个关键词试试';
    }
    return;
  }

  // 恢复空状态默认文案
  const mainEl = emptyEl.querySelector('p');
  const hintEl = emptyEl.querySelector('.hint');
  if (mainEl) mainEl.textContent = '暂无任务';
  if (hintEl) hintEl.textContent = '存档后 AI 会自动归类任务';

  // 渲染活跃任务
  sortedActive.forEach(task => {
    container.appendChild(renderTaskItem(task));
  });

  // 渲染已归档任务
  if (sortedArchived.length > 0) {
    archivedPanel.classList.remove('hidden');
    sortedArchived.forEach(task => {
      archivedBody.appendChild(renderTaskItem(task));
    });
  } else {
    archivedPanel.classList.add('hidden');
  }
}

// 创建任务列表条目
function createTaskItem(task, cardCount, isArchived = false, terms = []) {
  const div = document.createElement('div');
  div.className = isArchived ? 'task-item task-item--archived' : 'task-item';
  div.dataset.taskId = task.id;

  const date = new Date(task.createdAt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  const isSystemTask = task.title === '未知任务' || task.isSystem;
  const iconName = task.labelIcon || '1.png';

  // 搜索命中时，任务名与任务概要中的关键词标红
  const titleHtml = highlightTerm(task.title, terms);
  const descHtml = task.description ? highlightTerm(task.description, terms) : '';

  div.innerHTML = `
    <img class="task-bg-pic" src="icons/taskpics/${iconName}" alt=""/>
    <div class="task-content-inner">
      <div class="task-title"><img src="icons/labels/${iconName}" alt=""/><span>${titleHtml}</span>${isArchived ? '<span class="task-archived-tag">已归档</span>' : ''}</div>
      ${descHtml ? `<div class="task-description">${descHtml}</div>` : ''}
      <div class="task-meta">
        <span class="task-meta-info">${date} &nbsp;·&nbsp; ${cardCount} 条存档</span>
        <div class="task-meta-actions">
          ${!isSystemTask ? (isArchived ? `<button class="task-archive-btn" data-task-id="${task.id}" data-action="unarchive">移出归档</button>` : `<button class="task-archive-btn" data-task-id="${task.id}" data-action="archive">归档</button>`) : ''}
          ${!isSystemTask ? `<button class="task-delete-btn" data-task-id="${task.id}">删除</button>` : ''}
        </div>
      </div>
    </div>
  `;

  div.querySelector('.task-title, .task-description').addEventListener('click', () => showTaskDetail(task.id));

  if (!isSystemTask) {
    const archiveBtn = div.querySelector('.task-archive-btn');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = archiveBtn.dataset.action;
        await toggleTaskArchive(task.id, action === 'archive');
      });
    }

    div.querySelector('.task-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteTask(task.id, cardCount);
    });
  }

  return div;
}

// 确保任务标题不重复，重复时在末尾加 -2、-3 等序号
function deduplicateTaskTitle(title, tasks, excludeId) {
  const others = tasks.filter(t => !excludeId || t.id !== excludeId);
  const exists = (t) => others.some(task => task.title === t);
  if (!exists(title)) return title;
  let n = 2;
  while (exists(`${title}-${n}`)) n++;
  return `${title}-${n}`;
}

// 任务标题/描述可编辑绑定
function bindTaskFieldEdit(el, taskId, field) {
  if (!el) return;

  el.addEventListener('click', () => {
    if (el.isContentEditable) return;
    el._originalValue = el.textContent.trim();
    el.contentEditable = 'true';
    el.classList.add('editing');
    // 若是占位文本，清空
    if (el.style.color === 'rgb(187, 187, 187)') {
      el.textContent = '';
      el.style.color = '';
    }
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  el.addEventListener('blur', async () => {
    if (!el.isContentEditable) return;
    el.contentEditable = 'false';
    el.classList.remove('editing');
    const newValue = el.textContent.trim();
    if (!newValue) return;
    const contentChanged = newValue !== el._originalValue;
    const result = await chrome.storage.local.get('tasks');
    const tasks = result.tasks || [];
    const finalValue = field === 'title' ? deduplicateTaskTitle(newValue, tasks, taskId) : newValue;
    if (field === 'title' && finalValue !== newValue) el.textContent = finalValue;
    const lockField = field === 'title' ? 'isTitleLocked' : 'isDescLocked';
    const updated = tasks.map(t => {
      if (t.id !== taskId) return t;
      const patch = { [field]: finalValue, updatedAt: Date.now() };
      if (contentChanged) patch[lockField] = true;
      return { ...t, ...patch };
    });
    await chrome.storage.local.set({ tasks: updated });
    if (contentChanged) await markTaskUserEdited(taskId);
    // 若描述内容变更，更新标注显示
    if (field === 'description' && contentChanged) {
      const container = el.closest('#task-detail-header');
      if (container) {
        let label = container.querySelector('.task-desc-manual-label');
        if (label) label.style.display = 'inline';
      }
    }
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') el.blur();
    if (e.key === 'Enter' && field === 'title') {
      e.preventDefault();
      el.blur();
    }
  });
}

const TASK_ICONS = [
  '1.png', '2.png', '3.png', '4.png', '5.png',
  '6.png', '7.png', '8.png', '9.png', '10.png', '11.png'
];

// 随机分配图标时的候选池：1.png 保留给系统「未知任务」，不参与随机分配
const ASSIGNABLE_ICONS = TASK_ICONS.filter(icon => icon !== '1.png');

function getLeastUsedRandomIcon(tasks) {
  const iconCounts = {};
  ASSIGNABLE_ICONS.forEach(icon => {
    iconCounts[icon] = 0;
  });
  tasks.forEach(t => {
    if (t.labelIcon && iconCounts[t.labelIcon] !== undefined) {
      iconCounts[t.labelIcon]++;
    }
  });

  let minCount = Infinity;
  let leastUsedIcons = [];
  
  for (const [icon, count] of Object.entries(iconCounts)) {
    if (count < minCount) {
      minCount = count;
      leastUsedIcons = [icon];
    } else if (count === minCount) {
      leastUsedIcons.push(icon);
    }
  }

  const randomIndex = Math.floor(Math.random() * leastUsedIcons.length);
  return leastUsedIcons[randomIndex];
}

function openIconDropdown(anchorEl, actionOrTaskId) {
  let existing = document.querySelector('.icon-dropdown');
  if (existing) {
    existing.remove();
  }
  
  const dropdown = document.createElement('div');
  dropdown.className = 'icon-dropdown';
  
  TASK_ICONS.forEach(iconName => {
    const item = document.createElement('div');
    item.className = 'icon-dropdown-item';
    item.innerHTML = `<img src="icons/labels/${iconName}" alt="${iconName}" />`;
    item.onclick = async (e) => {
      e.stopPropagation();
      if (typeof actionOrTaskId === 'function') {
        const img = anchorEl.querySelector('img');
        if (img) img.src = `icons/labels/${iconName}`;
        actionOrTaskId(iconName);
      } else {
        const taskId = actionOrTaskId;
        const { tasks = [] } = await chrome.storage.local.get('tasks');
        const updated = tasks.map(t => t.id === taskId ? { ...t, labelIcon: iconName, userEdited: true, updatedAt: Date.now() } : t);
        await chrome.storage.local.set({ tasks: updated });
        const img = anchorEl.querySelector('img');
        if (img) img.src = `icons/labels/${iconName}`;
        
        // 及时刷新卡片上对应的任务标签图标
        document.querySelectorAll(`.task-card-label[data-task-id="${taskId}"] img`).forEach(labelImg => {
          labelImg.src = `icons/labels/${iconName}`;
        });
        // 及时刷新侧边栏上的任务图标
        document.querySelectorAll(`.task-item[data-task-id="${taskId}"] .task-title img`).forEach(sidebarImg => {
          sidebarImg.src = `icons/labels/${iconName}`;
        });
        // 及时刷新侧边栏上的大背景侧图
        document.querySelectorAll(`.task-item[data-task-id="${taskId}"] .task-bg-pic`).forEach(bgImg => {
          bgImg.src = `icons/taskpics/${iconName}`;
        });
      }
      dropdown.remove();
    };
    dropdown.appendChild(item);
  });
  
  anchorEl.appendChild(dropdown);
  
  const closeDropdown = (e) => {
    if (!dropdown.contains(e.target) && !anchorEl.contains(e.target)) {
      dropdown.remove();
      document.removeEventListener('click', closeDropdown);
    }
  };
  setTimeout(() => document.addEventListener('click', closeDropdown), 0);
}

// 显示任务详情页
async function showTaskDetail(taskId) {
  const result = await chrome.storage.local.get(['tasks', 'workCards']);
  const tasks = result.tasks || [];
  const workCards = result.workCards || [];

  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  // 记录滚动位置：保存待办等操作会触发本函数重绘，避免视图跳回顶部
  const scrollEl = document.scrollingElement || document.documentElement;
  const prevScrollTop = scrollEl.scrollTop;

  // 渲染任务详情头部
  const headerEl = document.getElementById('task-detail-header');
  const date = new Date(task.createdAt).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const iconName = task.labelIcon || '1.png';

  // 简报/待办面板常驻于头部卡片内：innerHTML 重绘会销毁它们，必须先取引用，重绘后再挂载
  const briefingPanel = document.getElementById('task-briefing-panel');
  const todoPanel = document.getElementById('task-todo-panel');

  headerEl.innerHTML = `
    <div class="task-title-wrapper">
      <div class="task-icon-selector" data-task-id="${task.id}" title="点击更改图标">
        <img src="icons/labels/${iconName}" alt="Task Icon" />
      </div>
      <div class="task-detail-title" data-task-id="${task.id}" title="点击编辑">${escapeHtml(task.title)}</div>
      <button class="task-desc-refresh-btn" type="button" data-task-id="${task.id}" title="重新生成任务概要" aria-label="重新生成任务概要">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.34 5.66"></path><path d="M20 4v7h-7"></path></svg>
      </button>
      <div class="task-detail-created">创建于 ${date}</div>
    </div>
    ${task.description ? `<div class="task-detail-desc" data-task-id="${task.id}" title="点击编辑">${escapeHtml(task.description)}</div>` : `<div class="task-detail-desc" data-task-id="${task.id}" title="点击编辑" style="color:#bbb">点击添加描述</div>`}
    ${(task.isDescLocked || task.userLocked) ? '<span class="task-desc-manual-label">已手动编辑</span>' : '<span class="task-desc-manual-label" style="display:none">已手动编辑</span>'}
  `;

  // 重新挂载简报/待办面板到头部卡片内
  headerEl.appendChild(briefingPanel);
  headerEl.appendChild(todoPanel);

  // 图标选择可点击
  const iconSelector = headerEl.querySelector('.task-icon-selector');
  if (iconSelector) {
    iconSelector.addEventListener('click', (e) => {
      e.stopPropagation();
      openIconDropdown(iconSelector, task.id);
    });
  }

  // 标题可编辑
  const titleEl = headerEl.querySelector('.task-detail-title');
  bindTaskFieldEdit(titleEl, task.id, 'title');

  // 描述可编辑
  const descEl = headerEl.querySelector('.task-detail-desc');
  bindTaskFieldEdit(descEl, task.id, 'description');

  // 任务概要刷新按钮：重新生成概要，并覆盖（解锁）用户手动编辑过的文本
  const descRefreshBtn = headerEl.querySelector('.task-desc-refresh-btn');
  if (descRefreshBtn) {
    descRefreshBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (descRefreshBtn.disabled) return;
      descRefreshBtn.disabled = true;
      descRefreshBtn.classList.add('loading');
      try {
        const res = await chrome.runtime.sendMessage({ type: 'regenerate-task-desc', taskId: task.id });
        if (!res?.ok) {
          showPopupToast(res?.error || '概要刷新失败', 'error');
          return;
        }
        // 没有真正调用模型：说明本次刷新被静默跳过，明确告知原因
        if (!res.llmCalled) {
          showPopupToast(res.reason === 'no-cards'
            ? '该任务暂无摘要已完成的存档，无法生成概要'
            : `概要未刷新（${res.reason || '未知原因'}）`, 'error');
          return;
        }
        if (!res.updated) {
          showPopupToast(res.reason === 'llm-error'
            ? `AI 调用失败：${res.error || '未知错误'}`
            : '模型未返回可用概要，内容未变更', 'error');
          return;
        }
        // 写入成功但内容与原文一致：模型只是复述，如实告知而不是谎报成功
        if (!res.changed) {
          console.warn('[任务概要] 模型返回内容与原文一致:', res.description);
          showPopupToast('已调用模型，但返回内容与现有概要一致，未发生变化');
          return;
        }
        const currentDesc = headerEl.querySelector('.task-detail-desc');
        if (currentDesc) {
          const nextText = res.description || '点击添加描述';
          currentDesc.textContent = nextText;
          currentDesc.style.color = res.description ? '' : '#bbb';
          currentDesc._originalValue = res.description || '';
        }
        // 已被覆盖，取消「已手动编辑」标注
        const manualLabel = headerEl.querySelector('.task-desc-manual-label');
        if (manualLabel) manualLabel.style.display = 'none';
        showPopupToast('任务概要已重新生成');
      } catch (err) {
        console.error('[任务概要] 刷新失败:', err);
        showPopupToast(`概要刷新失败：${err.message}`, 'error');
      } finally {
        descRefreshBtn.disabled = false;
        descRefreshBtn.classList.remove('loading');
      }
    });
  }

  // 处理未知任务的简报隐藏逻辑
  // 切换到另一个任务时，重置简报的手动折叠状态，让新任务进来默认展开
  const detailViewEl = document.getElementById('task-detail-view');
  const briefingBody = document.getElementById('task-briefing-body');
  if (briefingBody && detailViewEl && detailViewEl.dataset.taskId !== taskId) {
    delete briefingBody.dataset.userToggled;
  }

  if (task.title === '未知任务') {
    briefingPanel.classList.add('hidden');
    todoPanel.classList.add('hidden');
  } else {
    briefingPanel.classList.remove('hidden');
    todoPanel.classList.remove('hidden');
    // 初始化简报面板
    initBriefingPanel(task);
    // 初始化ToDo面板
    initTodoPanel(task);
  }

  // 渲染关联卡片（倒序）
  const taskCards = workCards
    .filter(c => c.taskId === taskId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const cardsEl = document.getElementById('task-detail-cards');
  cardsEl.innerHTML = '';

  if (taskCards.length === 0) {
    cardsEl.innerHTML = '<div class="empty-state"><p>暂无存档</p></div>';
  } else {
    // 找出每张卡片在 workCards 中的原始 index（供删除使用）
    taskCards.forEach(card => {
      const originalIndex = workCards.findIndex(c => c.id === card.id);
      card._taskTitle = task.title;
      card._taskIcon = task.labelIcon || '1.png';
      const el = createCardElement(card, originalIndex, { showMoveToTask: true });
      cardsEl.appendChild(el);
    });
  }

  // 切换视图
  const detailView = document.getElementById('task-detail-view');
  detailView.dataset.taskId = taskId;
  document.getElementById('task-list-view').classList.add('hidden');
  detailView.classList.remove('hidden');
  // 显示页头固定区域中的返回图标
  setDetailBackButton(true);
  document.body.classList.add('detail-active');
  // 恢复滚动位置
  scrollEl.scrollTop = prevScrollTop;
}

// 显示/隐藏页头固定区域中的返回图标（同时切换 class 与 display，避免残留不可见状态）
function setDetailBackButton(visible) {
  const btn = document.getElementById('back-to-tasks');
  if (!btn) return;
  btn.classList.toggle('hidden', !visible);
  btn.style.display = visible ? 'flex' : 'none';
  forceRepaint();
}

// 强制整页重绘：清除 sticky 元素（页头/任务工具栏）在切换视图后概率残留的像素鬼影
function forceRepaint() {
  const el = document.querySelector('.container');
  if (!el) return;
  el.style.display = 'none';
  void el.offsetHeight; // 触发同步重排
  el.style.display = '';
}

// 打开任务分类下拉框
function openTaskClassifyDropdown(labelEl, cardId, options = {}) {
  // 关闭已存在的下拉框
  const existing = document.querySelector('.task-classify-dropdown');
  if (existing) existing.remove();

  const dropdown = document.createElement('div');
  dropdown.className = 'task-classify-dropdown';

  // 异步填充任务列表
  chrome.storage.local.get(['tasks']).then(({ tasks = [] }) => {
    // 分离活跃任务和已归档任务
    const activeTasks = tasks.filter(t => !t.isArchived);
    const archivedTasks = tasks.filter(t => t.isArchived);

    // 按创建时间倒序，未知任务排最后
    const sortTasks = (taskList) => {
      return [...taskList].sort((a, b) => {
        if (a.title === '未知任务') return 1;
        if (b.title === '未知任务') return -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    };

    const sortedActive = sortTasks(activeTasks);
    const sortedArchived = sortTasks(archivedTasks);

    // 渲染活跃任务
    sortedActive.forEach(task => {
      const item = document.createElement('div');
      item.className = 'task-classify-option';
      
      const iconImg = document.createElement('img');
      iconImg.src = `icons/labels/${task.labelIcon || '1.png'}`;
      iconImg.alt = '';
      
      const titleSpan = document.createElement('span');
      titleSpan.textContent = task.title;
      titleSpan.style.overflow = 'hidden';
      titleSpan.style.textOverflow = 'ellipsis';
      
      item.appendChild(iconImg);
      item.appendChild(titleSpan);

      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        dropdown.remove();
        await reassignCardToTask(cardId, task.id, task.title, labelEl);
      });
      dropdown.appendChild(item);
    });

    // 如果有已归档任务，添加折叠组
    if (sortedArchived.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'task-classify-divider';
      dropdown.appendChild(divider);

      // 已归档任务折叠组
      const archivedToggle = document.createElement('div');
      archivedToggle.className = 'task-classify-archived-toggle';
      archivedToggle.innerHTML = '<span>已归档任务</span><span class="task-classify-archived-arrow">▶</span>';
      dropdown.appendChild(archivedToggle);

      const archivedContainer = document.createElement('div');
      archivedContainer.className = 'task-classify-archived-container hidden';
      dropdown.appendChild(archivedContainer);

      // 渲染已归档任务
      sortedArchived.forEach(task => {
        const item = document.createElement('div');
        item.className = 'task-classify-option task-classify-option--archived';
        
        const iconImg = document.createElement('img');
        iconImg.src = `icons/labels/${task.labelIcon || '1.png'}`;
        iconImg.alt = '';
        iconImg.style.opacity = '0.6';
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = task.title;
        titleSpan.style.overflow = 'hidden';
        titleSpan.style.textOverflow = 'ellipsis';
        
        item.appendChild(iconImg);
        item.appendChild(titleSpan);

        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          dropdown.remove();
          await reassignCardToTask(cardId, task.id, task.title, labelEl);
        });
        archivedContainer.appendChild(item);
      });

      // 折叠/展开事件
      archivedToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = archivedContainer.classList.contains('hidden');
        archivedContainer.classList.toggle('hidden', !isHidden);
        const arrow = archivedToggle.querySelector('.task-classify-archived-arrow');
        arrow.textContent = isHidden ? '▼' : '▶';
      });
    }

    // 分隔线
    const divider = document.createElement('div');
    divider.className = 'task-classify-divider';
    dropdown.appendChild(divider);

    // 新建任务
    const newItem = document.createElement('div');
    newItem.className = 'task-classify-option task-classify-option--new';
    newItem.textContent = '+ 新建任务分类';
    newItem.addEventListener('click', (e) => {
      e.stopPropagation();
      showNewTaskInput(dropdown, cardId, labelEl);
    });
    dropdown.appendChild(newItem);
  });

  // 定位：默认在锚点下方；placement='above' 时向上展开（锚点位于卡片底部的场景）
  const rect = labelEl.getBoundingClientRect();
  const popupRect = document.querySelector('.container').getBoundingClientRect();
  if (options.placement === 'above') {
    dropdown.style.top = (rect.top - popupRect.top - 4) + 'px';
    dropdown.style.transform = 'translateY(-100%)';
  } else {
    dropdown.style.top = (rect.bottom - popupRect.top + 4) + 'px';
  }
  dropdown.style.left = (rect.left - popupRect.left) + 'px';

  document.querySelector('.container').appendChild(dropdown);

  // 点击其他区域关闭
  const closeHandler = (e) => {
    if (!dropdown.contains(e.target) && e.target !== labelEl) {
      dropdown.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// 在下拉框内切换为新建任务输入状态
function showNewTaskInput(dropdown, cardId, labelEl) {
  dropdown.innerHTML = '';
  dropdown.style.display = 'flex';
  dropdown.style.alignItems = 'center';
  dropdown.style.padding = '4px';

  let currentIcon = '1.png';

  const iconWrapper = document.createElement('div');
  iconWrapper.className = 'task-icon-selector';
  iconWrapper.style.marginRight = '6px';
  // 先设置一个默认图标，稍后异步获取
  iconWrapper.innerHTML = `<img src="icons/labels/${currentIcon}" alt=""/>`;
  iconWrapper.onclick = (e) => {
    e.stopPropagation();
    openIconDropdown(iconWrapper, (newIcon) => {
      currentIcon = newIcon;
    });
  };
  dropdown.appendChild(iconWrapper);

  const input = document.createElement('input');
  input.className = 'task-classify-input';
  input.type = 'text';
  input.placeholder = '输入新任务名称';
  input.maxLength = 20;
  input.style.flex = '1';
  input.style.marginRight = '6px';
  input.style.width = 'auto'; // override previous fixed width
  dropdown.appendChild(input);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'task-classify-confirm';
  confirmBtn.textContent = '确定';
  dropdown.appendChild(confirmBtn);

  input.focus();

  // 异步获取不常用图标作为默认
  chrome.storage.local.get('tasks').then(({ tasks = [] }) => {
    currentIcon = getLeastUsedRandomIcon(tasks);
    const img = iconWrapper.querySelector('img');
    if (img) img.src = `icons/labels/${currentIcon}`;
  });

  const doCreate = async () => {
    const title = input.value.trim();
    if (!title) return;
    dropdown.remove();

    const { tasks = [] } = await chrome.storage.local.get('tasks');
    const finalTitle = deduplicateTaskTitle(title, tasks);
    const newTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: finalTitle,
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
      isTitleLocked: true,
      labelIcon: currentIcon
    };
    await chrome.storage.local.set({ tasks: [...tasks, newTask] });
    await reassignCardToTask(cardId, newTask.id, newTask.title, labelEl);
  };

  confirmBtn.addEventListener('click', doCreate);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doCreate();
    if (e.key === 'Escape') dropdown.remove();
  });
}

// 轻量提示条：用于反馈 AI 类操作的成功/失败原因
let popupToastTimer = 0;
function showPopupToast(message, kind = 'info') {
  let el = document.getElementById('popup-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'popup-toast';
    el.className = 'popup-toast hidden';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('error', kind === 'error');
  el.classList.remove('hidden');
  window.clearTimeout(popupToastTimer);
  popupToastTimer = window.setTimeout(() => el.classList.add('hidden'), 2800);
}

// 标记任务已被用户主动操作过：此类任务不再被视为「自动新建的误判分类」
async function markTaskUserEdited(taskId) {
  if (!taskId) return;
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const target = tasks.find(t => t.id === taskId);
  if (!target || target.userEdited) return;
  const updated = tasks.map(t => (t.id === taskId ? { ...t, userEdited: true } : t));
  await chrome.storage.local.set({ tasks: updated });
}

// 判定是否为「系统自动新建、用户从未主动编辑、且已不含卡片」的误判分类
function isOrphanAutoTask(task, workCards) {
  if (!task || !task.autoCreated || task.userEdited) return false;
  if (task.isSystem || task.title === '未知任务' || task.id === UNKNOWN_TASK_ID) return false;
  const remaining = workCards.filter(c => c.taskId === task.id).length;
  return remaining === 0;
}

// 重新将卡片归入指定任务，并更新标签显示
async function reassignCardToTask(cardId, taskId, taskTitle, labelEl) {
  const { workCards = [], tasks = [] } = await chrome.storage.local.get(['workCards', 'tasks']);

  // 记录原任务ID
  const originalCard = workCards.find(c => c.id === cardId);
  const oldTaskId = originalCard?.taskId;
  const targetTask = tasks.find(t => t.id === taskId);
  const iconName = targetTask?.labelIcon || '1.png';

  const updated = workCards.map(c =>
    c.id === cardId ? { ...c, taskId, updatedAt: Date.now() } : c
  );
  await chrome.storage.local.set({ workCards: updated });

  // 用户主动把卡片移入目标任务：该任务视为已被用户确认
  await markTaskUserEdited(taskId);

  // 源任务若是系统自动新建、用户从未编辑、且移出后已无卡片，判定为误判分类并自动删除
  const sourceTask = oldTaskId && oldTaskId !== taskId ? tasks.find(t => t.id === oldTaskId) : null;
  const removedGhost = Boolean(sourceTask && isOrphanAutoTask(sourceTask, updated));
  if (removedGhost) {
    // 重新读取最新任务列表后再删除，避免覆盖刚写入的目标任务标记
    const { tasks: freshTasks = [] } = await chrome.storage.local.get('tasks');
    await chrome.storage.local.set({ tasks: freshTasks.filter(t => t.id !== oldTaskId) });
    const detailView = document.getElementById('task-detail-view');
    if (detailView && detailView.dataset.taskId === oldTaskId) {
      // 当前正停留在该任务详情页，返回任务列表避免出现空详情
      detailView.dataset.taskId = '';
      document.getElementById('task-list-view').classList.remove('hidden');
      detailView.classList.add('hidden');
      setDetailBackButton(false);
      document.body.classList.remove('detail-active');
      loadTasks();
    }
  }

  // 同步更新卡片上的分类标题和时间轴 label
  const cardEl = labelEl.closest('.work-card');
  const categoryEl = cardEl?.querySelector('.task-category-trigger');
  const timelineLabelEl = cardEl?.querySelector('.task-card-label');
  const isArchiveCard = Boolean(cardEl?.closest('#cards-container'));
  if (categoryEl) {
    categoryEl.textContent = taskTitle;
    categoryEl.dataset.taskId = taskId;
    categoryEl.title = '点击修改分类';
  }
  if (timelineLabelEl) {
    timelineLabelEl.innerHTML = `<img src="icons/labels/${iconName}" alt="" />`;
    timelineLabelEl.dataset.taskId = taskId;
    timelineLabelEl.classList.remove('task-card-label--unset');
    // 爪印页 label 点击是进入轨迹概览，详情页才是修改分类
    timelineLabelEl.title = isArchiveCard ? '点击打开轨迹概览' : '点击修改分类';
  }

  // 若处于任务详情页：卡片已不属于当前任务，刷新详情让它从列表移除
  if (cardEl && cardEl.closest('#task-detail-cards')) {
    const currentTaskId = document.getElementById('task-detail-view')?.dataset.taskId;
    if (currentTaskId && currentTaskId !== taskId) {
      showTaskDetail(currentTaskId);
    }
  }

  // 触发移入任务的描述更新
  chrome.runtime.sendMessage({ type: 'trigger-task-desc-update', taskId, force: true });

  // 如果有原任务且未被误判删除,也触发移出任务的描述更新
  if (oldTaskId && oldTaskId !== taskId && !removedGhost) {
    chrome.runtime.sendMessage({ type: 'trigger-task-desc-update', taskId: oldTaskId, force: true });
  }
}

// 手动新建任务
async function createManualTask() {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const defaultIcon = getLeastUsedRandomIcon(tasks);

  const result = await customModal({
    type: 'prompt',
    title: '新建任务',
    message: '输入新任务名称:',
    confirmText: '创建',
    showIcon: true,
    defaultIcon: defaultIcon
  });
  if (!result || !result.title) return;

  const finalTitle = deduplicateTaskTitle(result.title.trim(), tasks);
  const newTask = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: finalTitle,
    description: '当前任务没有存档进度',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    isTitleLocked: true,
    labelIcon: result.icon
  };
  await chrome.storage.local.set({ tasks: [...tasks, newTask] });
  await loadTasks();
}

// 删除任务
async function deleteTask(taskId, cardCount) {
  const confirmed = await customModal({
    title: '删除任务',
    message: `确定要删除这个任务吗？该任务包含的 ${cardCount} 条存档也将被删除。`,
    confirmText: '删除',
    isDanger: true
  });
  if (!confirmed) {
    return;
  }

  const result = await chrome.storage.local.get(['tasks', 'workCards']);
  const tasks = result.tasks || [];
  const workCards = result.workCards || [];

  // 删除任务
  const updatedTasks = tasks.filter(t => t.id !== taskId);

  // 删除关联的所有卡片
  const updatedCards = workCards.filter(card => card.taskId !== taskId);

  await chrome.storage.local.set({
    tasks: updatedTasks,
    workCards: updatedCards
  });

  await loadTasks();
}

// 归档/移出归档任务
async function toggleTaskArchive(taskId, shouldArchive) {
  const result = await chrome.storage.local.get('tasks');
  const tasks = result.tasks || [];

  const updatedTasks = tasks.map(t =>
    t.id === taskId ? { ...t, isArchived: shouldArchive, updatedAt: Date.now() } : t
  );

  await chrome.storage.local.set({ tasks: updatedTasks });
  await loadTasks();
}

// ========== 任务简报 UI ==========

// 将简报 Markdown 渲染为 HTML
// 支持：## / ### 标题、**加粗**、`行内代码`、- /* 无序列表、1. 有序列表
// 安全性：先整体 escapeHtml，再做行内替换（替换针对的 * ` 字符不会被转义产生，故无注入风险）
function renderBriefingInline(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderBriefingMarkdown(text) {
  const lines = text.split('\n');
  const html = [];
  let listBuffer = [];   // 暂存连续列表项
  let listType = null;   // 'ul' | 'ol'

  const flushList = () => {
    if (listBuffer.length) {
      html.push(`<${listType}>${listBuffer.join('')}</${listType}>`);
      listBuffer = [];
      listType = null;
    }
  };

  lines.forEach(rawLine => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '') { flushList(); return; }

    // 标题
    const heading = trimmed.match(/^(#{2,4})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length + 1, 4); // ## → h3，### → h4
      html.push(`<h${level}>${renderBriefingInline(escapeHtml(heading[2]))}</h${level}>`);
      return;
    }

    // 无序列表（- 或 * 开头）
    const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (listType === 'ol') flushList();
      listType = 'ul';
      listBuffer.push(`<li>${renderBriefingInline(escapeHtml(ulMatch[1]))}</li>`);
      return;
    }

    // 有序列表（1. 开头）
    const olMatch = trimmed.match(/^\d+[.、]\s*(.*)$/);
    if (olMatch) {
      if (listType === 'ul') flushList();
      listType = 'ol';
      listBuffer.push(`<li>${renderBriefingInline(escapeHtml(olMatch[1]))}</li>`);
      return;
    }

    flushList();
    html.push(`<p>${renderBriefingInline(escapeHtml(trimmed))}</p>`);
  });
  flushList();
  return html.join('');
}

// 初始化简报面板（在 showTaskDetail 中调用）
function initBriefingPanel(task) {
  const toggle = document.getElementById('task-briefing-toggle');
  const body = document.getElementById('task-briefing-body');
  const arrow = toggle.querySelector('.task-briefing-toggle-arrow');
  const metaEl = document.getElementById('task-briefing-meta');
  const contentEl = document.getElementById('task-briefing-content');
  const updateBtn = document.getElementById('task-briefing-update-btn');

  // 渲染已有简报内容
  if (task.briefing && task.briefingGeneratedAt) {
    const genTime = new Date(task.briefingGeneratedAt).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    metaEl.textContent = `根据 ${genTime} 以前的卡片存档梳理`;
    metaEl.style.display = '';
    contentEl.innerHTML = renderBriefingMarkdown(task.briefing);
  } else {
    // 尚未生成简报：隐藏 meta 框，避免渲染一个空白胶囊
    metaEl.textContent = '';
    metaEl.style.display = 'none';
    contentEl.innerHTML = '<p style="color:#bbb">点击「更新简报」生成本任务的结构化简报</p>';
  }

  // 折叠/展开（用户手动操作后记住状态，不再被重新渲染强制展开）
  toggle.onclick = () => {
    const isHidden = body.classList.contains('hidden');
    body.classList.toggle('hidden', !isHidden);
    arrow.classList.toggle('open', isHidden);
    body.dataset.userToggled = '1';
  };

  // 默认展开任务简报（仅在用户未手动折叠/展开过时生效）
  if (!body.dataset.userToggled) {
    body.classList.remove('hidden');
    arrow.classList.add('open');
  }

  // 更新简报按钮
  updateBtn.onclick = async () => {
    updateBtn.disabled = true;
    updateBtn.textContent = '生成中...';
    metaEl.style.display = '';
    metaEl.textContent = '正在调用 AI 生成简报...';
    contentEl.innerHTML = '';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'generate-task-briefing',
        taskId: task.id
      });

      if (response && response.ok) {
        // 手动触发简报生成属于用户主动操作
        await markTaskUserEdited(task.id);
        const genTime = new Date(response.generatedAt).toLocaleString('zh-CN', {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        metaEl.textContent = `根据 ${genTime} 以前的卡片存档梳理`;
        contentEl.innerHTML = renderBriefingMarkdown(response.briefingText);
      } else {
        metaEl.style.display = 'none';
        contentEl.innerHTML = `<p style="color:#c00">生成失败：${escapeHtml(response?.error || '未知错误')}</p>`;
      }
    } catch (err) {
      metaEl.style.display = 'none';
      contentEl.innerHTML = `<p style="color:#c00">生成失败：${escapeHtml(err.message)}</p>`;
    } finally {
      updateBtn.disabled = false;
      updateBtn.textContent = '更新简报';
    }
  };
}

// 初始化ToDo面板
function initTodoPanel(task) {
  const toggle = document.getElementById('task-todo-toggle');
  const body = document.getElementById('task-todo-body');
  const arrow = toggle.querySelector('.task-todo-toggle-arrow');
  const listEl = document.getElementById('task-todo-list');
  const inputEl = document.getElementById('task-todo-input');

  // 由于此前 todoList 是字符串，如果是旧数据兼容处理，默认转为数组
  let todos = [];
  if (Array.isArray(task.todoList)) {
    todos = task.todoList;
  } else if (typeof task.todoList === 'string' && task.todoList.trim()) {
    // 兼容原有的字符串纯文本处理，变成数组对象
    todos = task.todoList.split('\n').filter(s => s.trim()).map(text => ({ text, done: false }));
  }
  task.todoList = todos; // 更新内存

  const saveTodos = async () => {
    const { tasks = [] } = await chrome.storage.local.get('tasks');
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      tasks[idx].todoList = task.todoList;
      tasks[idx].updatedAt = Date.now();
      // 待办的新增/编辑/勾选/删除/排序都属于用户主动操作
      tasks[idx].userEdited = true;
      await chrome.storage.local.set({ tasks });
    }
  };

  const renderTodos = () => {
    listEl.innerHTML = '';
    task.todoList.forEach((todo, index) => {
      const itemEl = document.createElement('div');
      itemEl.className = `task-todo-item ${todo.done ? 'completed' : ''}`;
      // 设置拖拽所需属性
      itemEl.draggable = true;
      itemEl.dataset.index = index;
      
      itemEl.innerHTML = `
        <div class="task-todo-drag" title="拖拽排序">⋮⋮</div>
        <input type="checkbox" class="task-todo-checkbox" ${todo.done ? 'checked' : ''} />
        <div class="task-todo-text" contenteditable="true" spellcheck="false">${escapeHtml(todo.text)}</div>
        <button class="task-todo-delete" title="删除">×</button>
      `;

      // 切换状态
      const checkbox = itemEl.querySelector('.task-todo-checkbox');
      checkbox.addEventListener('change', () => {
        todo.done = checkbox.checked;
        itemEl.classList.toggle('completed', todo.done);
        saveTodos();
      });

      // 编辑文本
      const textEl = itemEl.querySelector('.task-todo-text');
      textEl.addEventListener('blur', () => {
        const newText = textEl.textContent.trim();
        if (newText && newText !== todo.text) {
          todo.text = newText;
          saveTodos();
        } else if (!newText) {
          // 清空文本则删除
          task.todoList.splice(index, 1);
          saveTodos();
          renderTodos();
        } else {
          textEl.textContent = todo.text; // 恢复
        }
      });
      // 输入法组合期间的回车交给输入法确认，不触发保存
      let textImeComposing = false;
      textEl.addEventListener('compositionstart', () => { textImeComposing = true; });
      textEl.addEventListener('compositionend', () => { textImeComposing = false; });
      textEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (textImeComposing || e.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          textEl.blur();
        }
      });

      // 删除
      const deleteBtn = itemEl.querySelector('.task-todo-delete');
      deleteBtn.addEventListener('click', () => {
        task.todoList.splice(index, 1);
        saveTodos();
        renderTodos();
      });

      // 拖拽事件处理
      itemEl.addEventListener('dragstart', (e) => {
        itemEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index);
      });

      itemEl.addEventListener('dragend', () => {
        itemEl.classList.remove('dragging');
        const items = listEl.querySelectorAll('.task-todo-item');
        items.forEach(it => {
          it.classList.remove('drag-over');
          it.classList.remove('drag-over-bottom');
        });
        listEl.classList.remove('drag-over-bottom');
      });

      itemEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const draggingItem = listEl.querySelector('.dragging');
        if (itemEl !== draggingItem) {
          // 判断鼠标位置距离元素顶部还是底部更近
          const rect = itemEl.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          
          if (e.clientY < midY) {
            itemEl.classList.add('drag-over');
            itemEl.classList.remove('drag-over-bottom');
          } else {
            itemEl.classList.remove('drag-over');
            itemEl.classList.add('drag-over-bottom');
          }
        }
      });

      itemEl.addEventListener('dragleave', () => {
        itemEl.classList.remove('drag-over');
        itemEl.classList.remove('drag-over-bottom');
      });

      itemEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const isBottom = itemEl.classList.contains('drag-over-bottom');
        itemEl.classList.remove('drag-over');
        itemEl.classList.remove('drag-over-bottom');
        
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        let toIndex = index;
        
        // 如果放到下方半区，目标位置应+1（除非拖拽项是从上方下来且要放到下方）
        if (isBottom) {
          toIndex += 1;
        }
        
        // 当把项往后移时，由于splice先移除了fromIndex位置的元素，所以后面的索引都减了1，
        // 只有当插入位置超过原位置时，我们才需要在原插入位置基础上减1
        if (fromIndex < toIndex) {
          toIndex -= 1;
        }
        
        if (fromIndex !== toIndex) {
          // 在数组中移动元素
          const [movedItem] = task.todoList.splice(fromIndex, 1);
          task.todoList.splice(toIndex, 0, movedItem);
          saveTodos();
          renderTodos();
        }
      });

      listEl.appendChild(itemEl);
    });

    // 允许拖拽到整个列表最后（空白区域）
    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (e.target === listEl) {
        listEl.classList.add('drag-over-bottom');
      }
    });

    listEl.addEventListener('dragleave', (e) => {
      if (e.target === listEl) {
        listEl.classList.remove('drag-over-bottom');
      }
    });

    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.target === listEl) {
        listEl.classList.remove('drag-over-bottom');
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const toIndex = task.todoList.length; // 想要放到最后
        
        if (fromIndex !== toIndex - 1) {
          const [movedItem] = task.todoList.splice(fromIndex, 1);
          task.todoList.push(movedItem);
          saveTodos();
          renderTodos();
        }
      }
    });
  };

  renderTodos();

  // 绑定折叠逻辑
  toggle.onclick = () => {
    const isHidden = body.classList.contains('hidden');
    body.classList.toggle('hidden', !isHidden);
    arrow.classList.toggle('open', isHidden);
    if (isHidden) {
      setTimeout(() => inputEl.focus(), 50); // 展开时聚焦输入框
    }
  };

  // 中文输入法组合期间（候选词未上屏）按回车应交给输入法确认，而不是新建待办
  let todoImeComposing = false;
  inputEl.addEventListener('compositionstart', () => { todoImeComposing = true; });
  inputEl.addEventListener('compositionend', () => { todoImeComposing = false; });

  // 添加新待办
  inputEl.onkeydown = (e) => {
    if (e.key === 'Enter') {
      // 组合输入中或按键码为 229（IME 处理中）时不做处理，保留输入栏内容
      if (todoImeComposing || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const text = inputEl.value.trim();
      if (text) {
        task.todoList.push({ text, done: false });
        inputEl.value = '';
        saveTodos();
        renderTodos();
      }
    }
  };
}

// ========== 截图悬停放大预览（区域放大镜） ==========

const PREVIEW_ZOOM = 8;
const PREVIEW_W = 280;
const PREVIEW_H = 160;
// 放大后的尺寸必须按「截图自身比例」计算：
// 缩略图是 16:9 的裁切框，若直接拿它的宽高各自乘倍数，预览就会被拉成 16:9 而变扁
let previewMetrics = { w: 0, h: 0, nw: 0, nh: 0, s: 1 };

// 为卡片截图绑定悬停区域放大
function bindScreenshotPreview(scope){
  scope.querySelectorAll(".card-screenshot").forEach((img)=>{
    img.addEventListener("mouseenter",(e)=>{
      showScreenshotPreview(img);
      updateScreenshotZoom(e, img);
      positionScreenshotPreview(e);
    });
    img.addEventListener("mousemove",(e)=>{
      updateScreenshotZoom(e, img);
      positionScreenshotPreview(e);
    });
    img.addEventListener("mouseleave",hideScreenshotPreview);
  });
}

function showScreenshotPreview(imgEl){
  const layer=document.getElementById("screenshot-preview");
  if(!layer)return;
  const img=layer.querySelector("img");
  const rect=imgEl.getBoundingClientRect();

  // 缩略图是 object-fit:cover，图片按 cover 缩放后居中裁切。
  // 取原图尺寸与这个缩放比，宽高同比放大，才能保住截图原始比例
  const nw=imgEl.naturalWidth||rect.width;
  const nh=imgEl.naturalHeight||rect.height;
  const s=Math.max(rect.width/nw, rect.height/nh)||1;
  const scale=s*PREVIEW_ZOOM;

  previewMetrics={ w:nw*scale, h:nh*scale, nw, nh, s };
  img.src=imgEl.src;
  img.style.width=previewMetrics.w+"px";
  img.style.height=previewMetrics.h+"px";
  layer.classList.remove("hidden");
}

// 以鼠标所在位置为中心，平移放大后的图片
function updateScreenshotZoom(e, imgEl){
  const layer=document.getElementById("screenshot-preview");
  if(!layer)return;
  const img=layer.querySelector("img");
  const rect=imgEl.getBoundingClientRect();
  const { nw, nh, s, w, h }=previewMetrics;
  const rx=Math.min(Math.max((e.clientX-rect.left)/rect.width,0),1);
  const ry=Math.min(Math.max((e.clientY-rect.top)/rect.height,0),1);

  // 鼠标在缩略图里的位置 → 回推成截图原始像素坐标
  // （cover 会居中裁切，所以要按缩放比换算并补回居中偏移）
  const nx=(rx*rect.width-rect.width/2)/s+nw/2;
  const ny=(ry*rect.height-rect.height/2)/s+nh/2;

  const scale=s*PREVIEW_ZOOM;
  let ox=nx*scale-PREVIEW_W/2;
  let oy=ny*scale-PREVIEW_H/2;
  ox=Math.max(0,Math.min(ox,w-PREVIEW_W));
  oy=Math.max(0,Math.min(oy,h-PREVIEW_H));
  img.style.left=(-ox)+"px";
  img.style.top=(-oy)+"px";
}

// 浮窗跟随鼠标，并限制在窗口可见范围内
function positionScreenshotPreview(e){
  const layer=document.getElementById("screenshot-preview");
  if(!layer)return;
  const rect=layer.getBoundingClientRect();const gap=14;const m=8;
  let left=e.clientX+gap;let top=e.clientY+gap;
  if(left+rect.width>window.innerWidth-m)left=e.clientX-rect.width-gap;
  if(left<m)left=m;
  if(top+rect.height>window.innerHeight-m)top=window.innerHeight-rect.height-m;
  if(top<m)top=m;
  layer.style.left=left+"px";layer.style.top=top+"px";
}

function hideScreenshotPreview(){
  const layer=document.getElementById("screenshot-preview");
  if(!layer)return;
  layer.classList.add("hidden");
  layer.querySelector("img").removeAttribute("src");
}
