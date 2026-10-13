const TASK_ICONS = [
  '1.png', '2.png', '3.png', '4.png', '5.png',
  '6.png', '7.png', '8.png', '9.png', '10.png', '11.png'
];

// 随机分配图标时的候选池：1.png 保留给系统「未知任务」，不参与随机分配
const ASSIGNABLE_ICONS = TASK_ICONS.filter(icon => icon !== '1.png');

// 系统任务「未知任务」的固定 id：多处创建点与备份合并都依赖它保持唯一
const UNKNOWN_TASK_ID = 'task_unknown';

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

// ========== 任务安全写入 ==========
// 后台流程常在 await（AI 调用，耗时数秒）之后才写回数据。若直接沿用调用前读到的旧
// 数组整份覆盖，会把这段时间内用户删除的任务「复活」。以下助手统一在写回前重新读取
// 最新数据：目标已不存在则放弃写入；追加任务则基于最新列表追加。

// 按 id 更新单个任务；任务若已被删除则放弃写入（不再用旧快照整份覆盖）
async function writeTaskPatch(taskId, buildPatch) {
  const result = await chrome.storage.local.get('tasks');
  const freshTasks = result.tasks || [];
  const index = freshTasks.findIndex(t => t.id === taskId);
  if (index === -1) {
    console.log('[任务写入] 任务已不存在，放弃写入:', taskId);
    return false;
  }
  const patch = buildPatch(freshTasks[index], freshTasks);
  if (!patch) return false;
  const updatedTasks = freshTasks.map((t, i) => (i === index ? { ...t, ...patch } : t));
  await chrome.storage.local.set({ tasks: updatedTasks });
  return true;
}

// 追加一个新任务，基于最新列表追加而非 AI 调用前的旧快照
async function appendTaskSafely(buildTask) {
  const result = await chrome.storage.local.get('tasks');
  const freshTasks = result.tasks || [];
  const newTask = buildTask(freshTasks);
  await chrome.storage.local.set({ tasks: [...freshTasks, newTask] });
  return newTask;
}

// 确保「未知任务」存在并返回它（重新读取最新数据，避免覆盖用户近期的删除）
async function ensureUnknownTask() {
  const result = await chrome.storage.local.get('tasks');
  const freshTasks = result.tasks || [];
  let unknownTask = freshTasks.find(t => t.title === '未知任务');
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
    await chrome.storage.local.set({ tasks: [...freshTasks, unknownTask] });
    console.log('[任务分类] 未知任务已创建:', unknownTask.id);
  }
  return unknownTask;
}

// 向指定标签页注入浮层通知
async function sendToastToTab(tabId, message, iconPath = 'icons/saved/savedpaw.png') {
  try {
    const iconUrl = chrome.runtime.getURL(iconPath);
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [message, iconUrl],
      func: (msg, imgUrl) => {
        try {
          const CONTAINER_ID = "__ws_toast_container__";
          let container = document.getElementById(CONTAINER_ID);
          if (!container) {
            container = document.createElement("div");
            container.id = CONTAINER_ID;
            container.style.cssText = "position:fixed;bottom:24px;left:24px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-start;gap:8px;pointer-events:none;";
            if (document.body) {
              document.body.appendChild(container);
            } else {
              document.documentElement.appendChild(container);
            }
          }
          const toast = document.createElement("div");
          toast.style.cssText = "position:relative;display:flex;align-items:center;background:#FFFFFF;color:#000000;font-size:14px;font-weight:500;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;box-sizing:border-box;padding:5px 16px;height:40px;min-height:40px;border:1px solid #E5E7EB;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.1);opacity:0;transform:translateY(8px);transition:opacity 0.25s ease,transform 0.25s ease;pointer-events:none;white-space:nowrap;line-height:1.4;";
          
          const img = document.createElement("img");
          img.src = imgUrl;
          img.style.cssText = "position:absolute;left:-18px;top:-9px;width:50px;height:50px;z-index:1;object-fit:contain;pointer-events:none;transform-origin:center 65%;";
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            img.style.opacity = '0';
            img.addEventListener('load', () => {
              img.animate([
                { offset: 0, opacity: 0, transform: 'translateY(-10px) scale(1.55) rotate(-12deg)', easing: 'cubic-bezier(.55,0,.85,.4)' },
                { offset: .28, opacity: 1, transform: 'translateY(2px) scale(1.16,.78) rotate(2deg)' },
                { offset: .55, opacity: 1, transform: 'translateY(2px) scale(1.16,.78) rotate(2deg)', easing: 'cubic-bezier(.15,.65,.3,1)' },
                { offset: .73, opacity: 1, transform: 'translateY(-1px) scale(.96,1.08) rotate(-2deg)', easing: 'ease-in-out' },
                { offset: .87, opacity: 1, transform: 'translateY(0) scale(1.03,.97) rotate(0deg)' },
                { offset: 1, opacity: 1, transform: 'translateY(0) scale(1) rotate(0deg)' }
              ], { duration: 520, delay: 120, fill: 'both' });
            }, { once: true });
          }
          
          const span = document.createElement("span");
          span.textContent = msg;
          span.style.cssText = "position:relative;z-index:2;margin-left:24px;";
          
          toast.appendChild(img);
          toast.appendChild(span);
          container.appendChild(toast);
          
          requestAnimationFrame(() => requestAnimationFrame(() => {
            toast.style.opacity = "1";
            toast.style.transform = "translateY(0)";
          }));
          setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(8px)";
            setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
          }, 3000);
        } catch (err) {
          console.error("[Toast] Inject wrapper error:", err);
        }
      }
    });
  } catch (e) {
    console.error("[Toast] 无法注入浮层:", e);
  }
}

// 向活动标签页发送浮层通知（任务分类时用）
async function sendToastToActiveTab(message, iconPath = 'icons/saved/savedpaw.png') {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) return;
    await sendToastToTab(tab.id, message, iconPath);
  } catch (e) {
    console.log('[Toast] 查询活动标签页失败:', e.message);
  }
}

// 监听快捷键命令
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'save-work') {
    saveCurrentWork(tab);
  }
  if (command === 'snapshot-active-tab') {
    saveActiveTabOnly(tab);
  }
});

const DEFAULT_LLM_SETTINGS = {
  apiKey: '',
  model: 'qwen-plus-latest',
  endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  includeScreenshot: true,
  maxTabsForPrompt: 20,
  enableAI: true,
  textLengthBeginning: 500,
  textLengthViewport: 500,
  textLengthEnding: 300
};

// 存档当前窗口所有标签页（Option+1）
async function saveCurrentWork(activeTab) {
  try {
    if (!activeTab) {
      const [focusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      activeTab = focusedTab;
    }
    if (!activeTab) {
      console.error('未找到活动标签页');
      return;
    }
    const tabs = await chrome.tabs.query({ windowId: activeTab.windowId });
    await createSnapshot(activeTab, tabs);
  } catch (error) {
    console.error('保存工作失败:', error);
  }
}

// 仅存档当前活动标签页（Option+2）
async function saveActiveTabOnly(activeTab) {
  try {
    if (!activeTab) {
      const [focusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      activeTab = focusedTab;
    }
    if (!activeTab) {
      console.error('未找到活动标签页');
      return;
    }
    await createSnapshot(activeTab, [activeTab]);
  } catch (error) {
    console.error('单页存档失败:', error);
  }
}

// 通用存档函数：接收 activeTab 和要存档的 tabs 列表
async function createSnapshot(activeTab, tabs) {
  try {
    // 读取文本抓取量设置
    const { llmSettings } = await chrome.storage.local.get('llmSettings');
    const extractSettings = { ...DEFAULT_LLM_SETTINGS, ...(llmSettings || {}) };
    const textLengths = {
      beginning: extractSettings.textLengthBeginning,
      viewport: extractSettings.textLengthViewport,
      ending: extractSettings.textLengthEnding
    };

    // 捕获当前活动标签页的截图
    let screenshot = null;
    try {
      screenshot = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
        format: 'jpeg',
        quality: 80
      });
    } catch (error) {
      console.error('无法捕获截图:', error);
    }

    // 为每个标签页提取信息和摘录
    const tabsInfo = [];

    for (const tab of tabs) {
      let summary = {
        h1Titles: [],
        h2Titles: [],
        bodyText: '',
        selectedText: '',
        isSearchPage: false
      };

      // 尝试从标签页提取摘录信息
      try {
        // 跳过 chrome:// 等特殊页面
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('edge://')) {
          // 使用 scripting API 动态注入脚本提取内容
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (lengths) => {
              try {
                const url = window.location.href;

                // 判断是否为搜索页面
                const isSearchPage =
                  url.includes('google.com/search') ||
                  url.includes('bing.com/search') ||
                  url.includes('baidu.com/s') ||
                  url.includes('duckduckgo.com/');

                // 获取用户选中的文字
                const selectedText = window.getSelection()?.toString().trim() || '';

                // 如果是搜索页面，只返回标题和选中文字
                if (isSearchPage) {
                  return {
                    h1Titles: [],
                    h2Titles: [],
                    bodyText: '',
                    selectedText,
                    isSearchPage: true,
                    scrollPercent: 0,
                    beginningText: '',
                    viewportText: '',
                    endingText: '',
                    success: true
                  };
                }

                // 提取所有 h1 和 h2 标题
                const h1Elements = Array.from(document.querySelectorAll('h1'));
                const h2Elements = Array.from(document.querySelectorAll('h2'));

                const h1Titles = h1Elements.map(el => el.textContent.trim()).filter(text => text.length > 0);
                const h2Titles = h2Elements.map(el => el.textContent.trim()).filter(text => text.length > 0);

                // 优先从 article 或 main 提取正文
                const contentSelectors = ['article', 'main', '[role="main"]', 'body'];
                let contentElement = null;

                for (const selector of contentSelectors) {
                  const element = document.querySelector(selector);
                  if (element) {
                    const text = element.textContent || element.innerText || '';
                    if (text.trim().length > 100) {
                      contentElement = element;
                      break;
                    }
                  }
                }

                // 计算滚动百分比
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
                const scrollPercent = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;

                // 提取文本的辅助函数
                const cleanText = (text) => text.replace(/\s+/g, ' ').trim();

                // 提取开头文本
                let beginningText = '';
                if (contentElement) {
                  const fullText = cleanText(contentElement.textContent || contentElement.innerText || '');
                  beginningText = fullText.substring(0, lengths.beginning);
                }

                // 提取当前视口可见区域的文本
                let viewportText = '';
                if (contentElement) {
                  const range = document.caretRangeFromPoint(window.innerWidth / 2, window.innerHeight / 2);
                  if (range) {
                    const walker = document.createTreeWalker(
                      contentElement,
                      NodeFilter.SHOW_TEXT,
                      null
                    );

                    let foundStart = false;
                    let collectedText = '';

                    while (walker.nextNode()) {
                      const node = walker.currentNode;
                      const rect = node.parentElement?.getBoundingClientRect();

                      if (rect && rect.top >= 0 && rect.top <= window.innerHeight) {
                        foundStart = true;
                        collectedText += node.textContent || '';
                        if (collectedText.length >= lengths.viewport) break;
                      } else if (foundStart) {
                        break;
                      }
                    }

                    viewportText = cleanText(collectedText).substring(0, lengths.viewport);
                  }

                  // 如果视口提取失败，使用滚动位置估算
                  if (!viewportText) {
                    const fullText = cleanText(contentElement.textContent || contentElement.innerText || '');
                    const estimatedPosition = Math.floor(fullText.length * (scrollPercent / 100));
                    viewportText = fullText.substring(estimatedPosition, estimatedPosition + lengths.viewport);
                  }
                }

                // 提取结尾文本
                let endingText = '';
                if (contentElement) {
                  const fullText = cleanText(contentElement.textContent || contentElement.innerText || '');
                  endingText = fullText.substring(Math.max(0, fullText.length - lengths.ending));
                }

                // 保留原有的 bodyText 用于向后兼容
                const bodyText = beginningText;

                return {
                  h1Titles,
                  h2Titles,
                  bodyText,
                  selectedText,
                  isSearchPage: false,
                  scrollPercent,
                  beginningText,
                  viewportText,
                  endingText,
                  success: true
                };
              } catch (error) {
                return {
                  h1Titles: [],
                  h2Titles: [],
                  bodyText: '',
                  selectedText: '',
                  isSearchPage: false,
                  scrollPercent: 0,
                  beginningText: '',
                  viewportText: '',
                  endingText: '',
                  success: false,
                  error: error.message
                };
              }
            },
            args: [textLengths]
          });

          if (results && results[0] && results[0].result) {
            summary = results[0].result;
          }
        }
      } catch (error) {
        console.log(`无法从标签页 ${tab.id} 提取摘录:`, error.message);
      }

      tabsInfo.push({
        url: tab.url,
        title: tab.title,
        // 保存网站自身的图标（浏览器标签页上显示的那一个）
        favIconUrl: tab.favIconUrl || '',
        active: tab.id === activeTab.id,
        summary: {
          h1Titles: summary.h1Titles || [],
          h2Titles: summary.h2Titles || [],
          bodyText: summary.bodyText || '',
          selectedText: summary.selectedText || '',
          isSearchPage: summary.isSearchPage || false,
          scrollPercent: summary.scrollPercent || 0,
          beginningText: summary.beginningText || '',
          viewportText: summary.viewportText || '',
          endingText: summary.endingText || ''
        }
      });
    }

    // 创建工作卡片数据
    const workCard = {
      id: `work_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      updatedAt: Date.now(),
      tabs: tabsInfo,
      screenshot: screenshot,
      tabCount: tabsInfo.length,
      llmSummary: '正在生成概要...',
      llmSummaryStatus: 'pending',
      llmSummaryUpdatedAt: null
    };

    // 获取现有的所有卡片
    const result = await chrome.storage.local.get('workCards');
    const workCards = result.workCards || [];

    // 将新卡片添加到列表开头
    workCards.unshift(workCard);

    // 保存回 storage
    await chrome.storage.local.set({ workCards: workCards });

    console.log('工作存档成功:', workCard.id);

    // 发送存档成功浮层通知（直接用已知的 activeTab.id）
    if (activeTab && activeTab.id) {
      await sendToastToTab(activeTab.id, '已存档');
    }

    // 异步生成任务概要 + 任务分类，不阻塞存档
    generateAndSaveCardSummary(workCard).then(async () => {
      // 摘要生成完成后，进行任务分类
      await classifyCardToTask(workCard.id).catch((error) => {
        console.error('[任务分类] 失败:', error);
      });
    }).catch((error) => {
      console.error('概要生成失败:', error);
    });

  } catch (error) {
    console.error('保存工作失败:', error);
  }
}

async function generateAndSaveCardSummary(workCard) {
  console.log('[摘要生成] 开始生成摘要，卡片ID:', workCard.id);

  // 重置 Token 统计
  await resetTokenUsage();

  const { llmSettings } = await chrome.storage.local.get('llmSettings');
  console.log('[摘要生成] 从 storage 读取的原始设置:', llmSettings);

  const settings = {
    ...DEFAULT_LLM_SETTINGS,
    ...(llmSettings || {})
  };

  console.log('[摘要生成] 配置信息:', {
    enableAI: settings.enableAI,
    hasApiKey: Boolean(settings.apiKey),
    apiKeyLength: settings.apiKey?.length || 0,
    apiKeyPreview: settings.apiKey ? settings.apiKey.substring(0, 10) + '...' + settings.apiKey.substring(settings.apiKey.length - 4) : 'none',
    model: settings.model,
    endpoint: settings.endpoint,
    includeScreenshot: settings.includeScreenshot
  });

  // 检查 AI 是否启用
  if (!settings.enableAI) {
    console.log('[摘要生成] AI 功能已禁用，跳过生成');
    await updateWorkCardSummary(
      workCard.id,
      'AI 摘要功能已禁用',
      'disabled'
    );
    return;
  }

  if (!settings.apiKey) {
    console.log('[摘要生成] 未配置 API Key，跳过生成');
    await updateWorkCardSummary(
      workCard.id,
      '尚未配置千问 API Key，未生成概要。',
      'not_configured'
    );
    return;
  }

  try {
    // 先生成每个页面的一句话总结
    const tabSummaries = await generateTabSummaries(workCard, settings);
    console.log('[摘要生成] 标签页总结已生成');

    // 更新每个标签页的一句话总结
    await updateTabSummaries(workCard.id, tabSummaries);
    console.log('[摘要生成] 标签页总结已保存');

    // 基于标签页总结生成卡片总体摘要
    const cardSummary = await generateCardOverviewWithTabSummaries(workCard, tabSummaries, settings);
    console.log('[摘要生成] 卡片摘要已生成');

    // 更新卡片摘要
    await updateWorkCardSummary(workCard.id, cardSummary, 'done');
    console.log('[摘要生成] 卡片摘要已保存');

  } catch (error) {
    console.error('[摘要生成] 最终失败:', error);
    await updateWorkCardSummary(
      workCard.id,
      `概要生成失败：${error.message || '未知错误'}`,
      'error'
    );
  }
}

// 生成卡片总体摘要（基于已生成的标签页总结）
async function generateCardOverviewWithTabSummaries(workCard, tabSummaries, settings) {
  const prompt = buildTaskSummaryPrompt(workCard, tabSummaries, settings.maxTabsForPrompt);
  const enableImage = Boolean(workCard.screenshot && settings.includeScreenshot);

  console.log('[卡片摘要] Prompt 长度:', prompt.length, '字符');
  console.log('[卡片摘要] 是否包含截图:', enableImage);

  try {
    console.log('[卡片摘要] 开始调用 API...');
    const summaryText = await requestQwenSummary({
      ...settings,
      prompt,
      screenshot: enableImage ? workCard.screenshot : null,
      useImage: enableImage
    });
    console.log('[卡片摘要] API 调用成功，摘要长度:', summaryText.length, '字符');
    return summaryText;
  } catch (error) {
    console.log('[卡片摘要] API 调用失败:', error.message);
    // 文本模型不支持图片时，自动降级为纯文本请求
    if (enableImage) {
      console.log('[卡片摘要] 尝试降级为纯文本请求...');
      const summaryText = await requestQwenSummary({
        ...settings,
        prompt,
        screenshot: null,
        useImage: false
      });
      console.log('[卡片摘要] 降级请求成功，摘要长度:', summaryText.length, '字符');
      return summaryText;
    }
    throw error;
  }
}

// 生成卡片总体摘要
async function generateCardOverview(workCard, settings) {
  // 先生成每个标签页的总结
  const tabSummaries = await generateTabSummaries(workCard, settings);

  // 将标签页总结传递给卡片摘要生成
  const prompt = buildTaskSummaryPrompt(workCard, tabSummaries, settings.maxTabsForPrompt);
  const enableImage = Boolean(workCard.screenshot && settings.includeScreenshot);

  console.log('[卡片摘要] Prompt 长度:', prompt.length, '字符');
  console.log('[卡片摘要] 是否包含截图:', enableImage);

  try {
    console.log('[卡片摘要] 开始调用 API...');
    const summaryText = await requestQwenSummary({
      ...settings,
      prompt,
      screenshot: enableImage ? workCard.screenshot : null,
      useImage: enableImage
    });
    console.log('[卡片摘要] API 调用成功，摘要长度:', summaryText.length, '字符');
    return summaryText;
  } catch (error) {
    console.log('[卡片摘要] API 调用失败:', error.message);
    // 文本模型不支持图片时，自动降级为纯文本请求
    if (enableImage) {
      console.log('[卡片摘要] 尝试降级为纯文本请求...');
      const summaryText = await requestQwenSummary({
        ...settings,
        prompt,
        screenshot: null,
        useImage: false
      });
      console.log('[卡片摘要] 降级请求成功，摘要长度:', summaryText.length, '字符');
      return summaryText;
    }
    throw error;
  }
}

// 为每个标签页生成一句话总结
async function generateTabSummaries(workCard, settings) {
  console.log('[标签页总结] 开始为', workCard.tabs.length, '个标签页生成总结');

  const summaries = [];
  const enableScreenshot = Boolean(workCard.screenshot && settings.includeScreenshot);

  for (const tab of workCard.tabs) {
    // 跳过特殊页面和搜索页面，但生成基于标题的简单总结
    if (!tab.url ||
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.summary?.isSearchPage) {
      const fallbackSummary = generateFallbackSummary(tab);
      summaries.push({ url: tab.url, summary: fallbackSummary });
      console.log('[标签页总结]', tab.title, '→ (使用备用总结)', fallbackSummary);
      continue;
    }

    try {
      // 如果是活动标签页且启用了截图，则发送截图
      const isActiveTab = tab.active;
      const useScreenshot = isActiveTab && enableScreenshot;

      const prompt = buildTabSummaryPrompt(tab, useScreenshot);
      const summary = await requestQwenSummary({
        ...settings,
        prompt,
        screenshot: useScreenshot ? workCard.screenshot : null,
        useImage: useScreenshot
      });
      console.log('[标签页总结]', tab.title, '→', summary, useScreenshot ? '(含截图)' : '');
      summaries.push({ url: tab.url, summary: summary.trim() });
    } catch (error) {
      console.error('[标签页总结] 失败:', tab.title, error.message);

      // 如果是因为截图导致失败，尝试不带截图重试
      if (tab.active && enableScreenshot) {
        try {
          console.log('[标签页总结] 尝试不带截图重试:', tab.title);
          const prompt = buildTabSummaryPrompt(tab, false);
          const summary = await requestQwenSummary({
            ...settings,
            prompt,
            screenshot: null,
            useImage: false
          });
          console.log('[标签页总结] 重试成功:', tab.title, '→', summary);
          summaries.push({ url: tab.url, summary: summary.trim() });
          continue;
        } catch (retryError) {
          console.error('[标签页总结] 重试也失败:', tab.title, retryError.message);
        }
      }

      // AI 生成失败时，使用备用总结
      const fallbackSummary = generateFallbackSummary(tab);
      summaries.push({ url: tab.url, summary: fallbackSummary });
      console.log('[标签页总结]', tab.title, '→ (AI失败，使用备用总结)', fallbackSummary);
    }
  }

  return summaries;
}

// 生成备用总结（当AI无法生成时）
function generateFallbackSummary(tab) {
  if (!tab.title || tab.title === 'New Tab' || tab.title === '新标签页') {
    return '浏览新标签页';
  }

  // 基于标题生成简单总结
  const title = tab.title.substring(0, 20);
  return `浏览「${title}」`;
}

// 构建单个标签页的总结 prompt
function buildTabSummaryPrompt(tab, includeScreenshotNote = false) {
  const summary = tab.summary || {};
  const urlPath = new URL(tab.url || 'about:blank').pathname;
  const isActive = tab.active;

  const parts = [
    '请用一句话（25个汉字以内）总结在这个页面上正在做什么。',
    '',
    '【要求】',
    '1. 语气自然、亲切、客观，不要出现「核心任务是……」这样的生硬句式',
    '2. 不要出现「你」「我」「他」这样的人称代词',
    '3. 不要用对页面操作时间作为进度推测（坏例子：刚打开页面浏览）',
    '4. 进度推测应当指向任务内容的完成度，且足够具体，避免笼统（坏例子：查看论文文档；好例子：正在论文文档撰写摘要和引言）',
    '',
    '【示例】',
    '- 论文格式探讨，正在沟通摘要的写法',
    '- 观看绘画教学视频第二集，阅读评论中',
    '',
    '---',
    '',
    `标题: ${tab.title || '无标题'}`,
    `URL 路径: ${urlPath}`,
    isActive ? '【这是当前打开的标签页】' : ''
  ];

  if (summary.h1Titles?.length > 0) {
    parts.push(`H1 标题: ${summary.h1Titles[0]}`);
  }

  if (summary.scrollPercent !== undefined) {
    parts.push(`滚动位置: ${summary.scrollPercent}%`);
  }

  if (summary.beginningText) {
    parts.push(`【这是开头】${summary.beginningText}`);
  }

  if (summary.viewportText) {
    parts.push(`【这是当前屏幕看到的】${summary.viewportText}`);
  }

  if (summary.endingText) {
    parts.push(`【这是结尾】${summary.endingText}`);
  }

  // 如果包含截图，添加说明
  if (includeScreenshotNote && isActive) {
    parts.push('', '【附带截图】已附上当前屏幕截图，请结合截图内容综合判断。');
  }

  return parts.filter(line => line).join('\n');
}

function buildTaskSummaryPrompt(workCard, tabSummaries, maxTabsForPrompt = 20) {
  // 构建标签页总结列表
  const tabSummaryList = workCard.tabs
    .slice(0, maxTabsForPrompt)
    .map((tab, index) => {
      const summaryObj = tabSummaries.find(s => s.url === tab.url);
      const summary = summaryObj?.summary || '';
      const isActive = tab.active ? '【当前打开】' : '';
      return `${index + 1}. ${tab.title || '无标题'} ${isActive}${summary ? '\n   ' + summary : ''}`;
    })
    .join('\n');

  const parts = [
    '你是一个工作流分析助手。基于以下所有标签页的总结，生成一个存档摘要。',
    '',
    '【要求】',
    '1. 区分工具与任务：不要把工具当成目标（例如"使用 Claude"不是任务，"开发 Chrome 插件"才是）',
    '2. 总结当下这一刻多个标签页共同指向的主题任务，综合判断做了什么，以及主题任务进行的进度或状态',
    '3. 注意哪个页面是当前打开的标签页，用于分析此次存档的最新操作或任务进程是什么',
    '4. 语气自然、亲切、客观，不要出现「核心任务是……」这样的生硬句式',
    '5. 不要出现「你」「我」「他」这样的人称代词',
    '6. 不要出现「尚未进行…」等负面进度推测',
    '7. 每次总结的输出在90汉字以内',
    '',
    '【示例】',
    '正在进行AI工作流插件的开发。重点梳理了不同网页层级的内容抓取策略，并调研了阿里云通义千问模型的API接入细节、性能指标及成本，为后续编码做准备。',
    '',
    '---',
    '',
    '【所有标签页总结】',
    tabSummaryList,
    '',
    `（共 ${workCard.tabCount} 个标签页）`
  ];

  return parts.filter(line => line !== undefined).join('\n');
}

async function requestQwenSummary({ apiKey, model, endpoint, prompt, screenshot, useImage }) {
  console.log('[API 调用] 准备请求:', {
    endpoint,
    model,
    useImage,
    hasScreenshot: Boolean(screenshot),
    promptLength: prompt.length
  });

  const systemMessage = '你擅长根据浏览器工作上下文总结用户任务。请准确、简洁、避免臆测。';

  const userMessage = useImage && screenshot
    ? {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: screenshot } }
        ]
      }
    : {
        role: 'user',
        content: prompt
      };

  const requestBody = {
    model,
    temperature: 0.2,
    max_tokens: 360,
    messages: [
      { role: 'system', content: systemMessage },
      userMessage
    ]
  };

  console.log('[API 调用] 请求体:', JSON.stringify({
    ...requestBody,
    messages: requestBody.messages.map(msg => ({
      ...msg,
      content: typeof msg.content === 'string'
        ? msg.content.substring(0, 100) + '...'
        : '[multipart content]'
    }))
  }, null, 2));

  console.log('[API 调用] 使用 API Key:', apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 4));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  console.log('[API 调用] 响应状态:', response.status, response.statusText);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[API 调用] 错误响应:', errorText);
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log('[API 调用] 响应数据:', JSON.stringify(data, null, 2));

  // 解析并保存 Token 使用数据
  const tokenUsage = parseTokenUsage(data);
  if (tokenUsage) {
    await accumulateTokenUsage(tokenUsage);
  }

  const content = extractMessageContent(data);

  if (!content) {
    console.error('[API 调用] 未能提取到内容');
    throw new Error('模型未返回可用概要');
  }

  console.log('[API 调用] 提取的内容:', content);
  return content.trim();
}

function extractMessageContent(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((item) => item?.type === 'text' && typeof item?.text === 'string')
      .map((item) => item.text)
      .join('\n')
      .trim();
  }

  return '';
}

// 解析 Token 使用数据（支持多厂商扩展）
function parseTokenUsage(data) {
  try {
    // 通义千问格式
    if (data?.usage) {
      const usage = data.usage;
      return {
        promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
        completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        totalTokens: usage.total_tokens || 0
      };
    }

    // 未来可扩展其他厂商格式
    // 例如 OpenAI: data.usage.prompt_tokens, data.usage.completion_tokens
    // 例如 Claude: data.usage.input_tokens, data.usage.output_tokens

    return null;
  } catch (error) {
    console.error('[Token 解析] 解析失败:', error);
    return null;
  }
}

// 累加并保存 Token 使用数据（覆盖页面总结、卡片摘要、任务判定、任务更新四个步骤）
async function accumulateTokenUsage(newUsage) {
  if (!newUsage) return;

  try {
    const result = await chrome.storage.local.get('last_token_usage');
    const currentUsage = result.last_token_usage || {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };

    const updatedUsage = {
      promptTokens: currentUsage.promptTokens + newUsage.promptTokens,
      completionTokens: currentUsage.completionTokens + newUsage.completionTokens,
      totalTokens: currentUsage.totalTokens + (newUsage.totalTokens || (newUsage.promptTokens + newUsage.completionTokens))
    };

    await chrome.storage.local.set({ last_token_usage: updatedUsage });
    console.log('[Token 统计] 已更新:', updatedUsage);
  } catch (error) {
    console.error('[Token 统计] 保存失败:', error);
  }
}

// 重置 Token 统计（每次新存档时调用）
async function resetTokenUsage() {
  try {
    await chrome.storage.local.set({
      last_token_usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      }
    });
    console.log('[Token 统计] 已重置');
  } catch (error) {
    console.error('[Token 统计] 重置失败:', error);
  }
}

async function updateWorkCardSummary(cardId, summaryText, status) {
  console.log('[Storage 更新] 开始更新卡片摘要:', {
    cardId,
    status,
    summaryLength: summaryText.length
  });

  const result = await chrome.storage.local.get('workCards');
  const workCards = result.workCards || [];

  console.log('[Storage 更新] 当前卡片总数:', workCards.length);

  const updatedCards = workCards.map((card) => {
    if (card.id !== cardId) {
      return card;
    }

    console.log('[Storage 更新] 找到目标卡片，更新摘要');
    return {
      ...card,
      llmSummary: summaryText,
      llmSummaryStatus: status,
      llmSummaryUpdatedAt: new Date().toISOString(),
      updatedAt: Date.now()
    };
  });

  await chrome.storage.local.set({ workCards: updatedCards });
  console.log('[Storage 更新] 摘要已保存到 storage');
}

// 更新标签页的一句话总结
async function updateTabSummaries(cardId, tabSummaries) {
  console.log('[Storage 更新] 开始更新标签页总结:', cardId);

  const result = await chrome.storage.local.get('workCards');
  const workCards = result.workCards || [];

  const updatedCards = workCards.map((card) => {
    if (card.id !== cardId) {
      return card;
    }

    console.log('[Storage 更新] 找到目标卡片，更新标签页总结');

    // 为每个标签页添加 aiSummary 字段
    const updatedTabs = card.tabs.map((tab) => {
      const summaryObj = tabSummaries.find(s => s.url === tab.url);
      return {
        ...tab,
        aiSummary: summaryObj?.summary || ''
      };
    });

    return {
      ...card,
      tabs: updatedTabs,
      updatedAt: Date.now()
    };
  });

  await chrome.storage.local.set({ workCards: updatedCards });
  console.log('[Storage 更新] 标签页总结已保存到 storage');
}

// ========== 任务管理系统 ==========

// 对卡片进行任务分类
async function classifyCardToTask(cardId) {
  console.log('[任务分类] 开始分类卡片:', cardId);

  const { llmSettings } = await chrome.storage.local.get('llmSettings');
  const settings = { ...DEFAULT_LLM_SETTINGS, ...(llmSettings || {}) };

  if (!settings.enableAI || !settings.apiKey) {
    console.log('[任务分类] AI 未启用或未配置 API Key，跳过');
    return;
  }

  // 读取当前卡片和所有任务
  const result = await chrome.storage.local.get(['workCards', 'tasks']);
  const workCards = result.workCards || [];
  const tasks = result.tasks || [];

  const card = workCards.find(c => c.id === cardId);
  if (!card || card.llmSummaryStatus !== 'done') {
    console.log('[任务分类] 卡片不存在或摘要未完成，跳过');
    return;
  }

  // 如果卡片已有任务分类，跳过
  if (card.taskId) {
    console.log('[任务分类] 卡片已分类，跳过重复分类');
    return;
  }

  // 检测空白页
  const isBlankPage = card.tabs.length === 1 && (
    !card.tabs[0].title ||
    card.tabs[0].title === 'New Tab' ||
    card.tabs[0].title === '新标签页' ||
    card.tabs[0].url === 'about:blank' ||
    card.tabs[0].url?.startsWith('chrome://newtab')
  );

  if (isBlankPage) {
    console.log('[任务分类] 检测到空白页，直接归入未知任务');
    const unknownTask = await ensureUnknownTask();
    await assignCardToTask(cardId, unknownTask.id);
    return;
  }

  // 构建分类 prompt
  const prompt = buildTaskClassificationPrompt(card, tasks, workCards);
  console.log('[任务分类] Prompt 长度:', prompt.length);

  try {
    const responseText = await requestQwenSummary({
      ...settings,
      prompt,
      screenshot: null,
      useImage: false
    });

    console.log('[任务分类] AI 返回:', responseText);

    // 解析 AI 返回的 JSON
    const decision = parseTaskDecision(responseText);
    console.log('[任务分类] 解析结果:', decision);

    if (decision.action === 'existing' && decision.taskId) {
      // 归入已有任务
      await assignCardToTask(cardId, decision.taskId);
      const existingTask = tasks.find(t => t.id === decision.taskId);
      if (existingTask) await sendToastToActiveTab(`分类至「${existingTask.title}」`, `icons/labels/${encodeURIComponent(existingTask.labelIcon || '1.png')}`);
      // 异步更新任务描述，不阻塞
      updateTaskWithLatestCards(decision.taskId, settings).catch(err => {
        console.error('[任务更新] 异步更新失败:', err);
      });
    } else if (decision.action === 'pending') {
      // 归入未知任务，不存在则创建（重新读取最新数据，避免覆盖用户近期的删除）
      const unknownTask = await ensureUnknownTask();
      await assignCardToTask(cardId, unknownTask.id);
      await sendToastToActiveTab(`分类至「${unknownTask.title}」`, `icons/labels/${encodeURIComponent(unknownTask.labelIcon || '1.png')}`);
    } else if (decision.action === 'new') {
      // 创建新任务
      const rawTitle = decision.title || card.llmSummary?.substring(0, 30) || '未命名任务';
      const newTask = await appendTaskSafely((freshTasks) => ({
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: deduplicateTaskTitle(rawTitle, freshTasks),
        description: decision.description || '',
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        isTitleLocked: true,
        // 系统自动新建标记：用户从未编辑且仅含一张卡片时，卡片被手动移出后可整体清理
        autoCreated: true,
        labelIcon: getLeastUsedRandomIcon(freshTasks)
      }));
      console.log('[任务分类] 新任务已创建:', newTask.id, newTask.title);

      // 将卡片归入新任务
      await assignCardToTask(cardId, newTask.id);
      await sendToastToActiveTab(`分类至「${newTask.title}」`, `icons/labels/${encodeURIComponent(newTask.labelIcon || '1.png')}`);
      // 异步更新任务描述，与归入已有任务保持一致
      updateTaskWithLatestCards(newTask.id, settings).catch(err => {
        console.error('[任务更新] 异步更新失败:', err);
      });
    }
  } catch (error) {
    console.error('[任务分类] 失败:', error);
  }
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

// 构建任务分类 prompt
function buildTaskClassificationPrompt(card, tasks, workCards) {
  const filteredTasks = tasks.filter(t => t.title !== '未知任务' && !t.isArchived);

  // 计算每个任务最近一张卡片的时间
  const taskLastCardTime = {};
  (workCards || []).forEach(c => {
    if (!c.taskId) return;
    const t = new Date(c.timestamp).getTime();
    if (!taskLastCardTime[c.taskId] || t > taskLastCardTime[c.taskId]) {
      taskLastCardTime[c.taskId] = t;
    }
  });

  const taskList = filteredTasks.length > 0
    ? filteredTasks.map((t, i) => {
        const lastTime = taskLastCardTime[t.id]
          ? new Date(taskLastCardTime[t.id]).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '暂无存档';
        return `${i + 1}. [ID: ${t.id}] ${t.title}（最近更新: ${lastTime}）\n   ${t.description || '暂无描述'}`;
      }).join('\n')
    : '（暂无已有任务）';

  // 标签页标题与单页摘要：比总摘要更贴近真实工作对象，作为分类依据一并传入
  const tabList = (card.tabs || [])
    .map((tab, i) => {
      const title = tab.title || '无标题';
      const summary = tab.aiSummary || '';
      return summary ? `${i + 1}. ${title}：${summary}` : `${i + 1}. ${title}`;
    })
    .join('\n');

  return [
    '你是一个任务分类助手。根据以下存档快照的摘要与各标签页内容，判断它属于哪个已有任务。',
    '',
    '【已有任务列表】（包含任务ID、标题、最近更新时间、描述）',
    taskList,
    '',
    '【本次存档快照摘要】',
    card.llmSummary || '无',
    '',
    '【本次存档的标签页】（序号. 页面标题：单页摘要）',
    tabList || '（无标签页）',
    '',
    '【判断规则】',
    '1. 结合卡片摘要与各标签页的具体内容综合判断：仅当最终核心目标或工作内容与某个已有任务高度一致，或存在接续、工作流关系时，才归入该任务',
    '2. 如果只是工具相同、领域相近或关键词重叠，但目标/内容不同，不要强行归入同一任务',
    '3. 标签页细节更能反映真实工作对象；当标签页内容与摘要概括不一致时，以标签页细节为准',
    '4. 只有在是空白页（无任何实质内容）时，才归入"未知任务"',
    '5. 正常有内容的卡片必须判断是否为同一任务：推断最终目标或上下文明显不同，应创建新任务',
    '6. 新任务必须主题具体清晰，严禁创建类似「其他」「杂项」「新任务」等模糊名称',
    '7. 当两个任务语义高度相似难以区分时，优先归入最近更新时间更新的任务',
    '',
    '【输出格式】严格按以下 JSON 格式输出，不要输出其他内容：',
    '归入已有任务: {"action":"existing","taskId":"task_xxx"}',
    '创建新任务: {"action":"new","title":"任务标题（15字以内）","description":"任务描述（30字以内）"}',
  ].filter(line => line !== undefined).join('\n');
}

// 解析 AI 返回的任务分类决策
function parseTaskDecision(text) {
  try {
    // 尝试直接解析
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[任务分类] JSON 解析失败:', e, '原文:', text);
  }
  // 默认归入待定区
  return { action: 'pending' };
}

// 将卡片归入指定任务
async function assignCardToTask(cardId, taskId) {
  const result = await chrome.storage.local.get('workCards');
  const workCards = result.workCards || [];

  const updatedCards = workCards.map(card => {
    if (card.id === cardId) {
      return { ...card, taskId, updatedAt: Date.now() };
    }
    return card;
  });

  await chrome.storage.local.set({ workCards: updatedCards });
  console.log('[任务分类] 卡片', cardId, '已归入任务', taskId);
}

// 根据最近的卡片更新任务标题和描述
async function updateTaskWithLatestCards(taskId, settings, force = false, ignorePrevious = false) {
  console.log('[任务更新] 开始更新任务:', taskId, force ? '(强制)' : '', ignorePrevious ? '(忽略旧描述)' : '');

  const result = await chrome.storage.local.get(['workCards', 'tasks']);
  const workCards = result.workCards || [];
  const tasks = result.tasks || [];

  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    console.log('[任务更新] 任务不存在:', taskId);
    return { ok: false, reason: 'task-missing', llmCalled: false, updated: false };
  }

  // 兼容旧 userLocked 字段：userLocked===true 视为两者均锁定
  const isTitleLocked = true;
  const isDescLocked = task.isDescLocked || task.userLocked || false;

  // 两个字段都锁定，无需更新（force 时也跳过）
  if (isTitleLocked && isDescLocked) {
    console.log('[任务更新] 标题和描述均已锁定，跳过 AI 改写:', taskId);
    return { ok: true, reason: 'desc-locked', llmCalled: false, updated: false };
  }

  // 获取该任务下最近 10 张卡片（按时间从新到旧）
  // 只要求「有真实摘要文本」：占位文案（生成中/未配置）不参与，避免把状态字段误当作可用依据
  const isPlaceholderSummary = (text) => !text || /正在生成概要|尚未配置千问|未生成概要/.test(text);
  const ownedCards = workCards
    .filter(c => c.taskId === taskId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const taskCards = ownedCards
    .filter(c => !isPlaceholderSummary(c.llmSummary))
    .slice(0, 10);

  console.log('[任务更新] 存档统计:', {
    总数: ownedCards.length,
    参与生成: taskCards.length,
    被排除: ownedCards.filter(c => isPlaceholderSummary(c.llmSummary))
      .map(c => ({ id: c.id, status: c.llmSummaryStatus || 'unknown' }))
  });

  // 0 张卡片：直接写入固定描述，不调用 AI
  if (taskCards.length === 0) {
    if (!isDescLocked) {
      await writeTaskPatch(taskId, () => ({
        description: '当前任务没有存档进度',
        updatedAt: Date.now()
      }));
      console.log('[任务更新] 0 张卡片，已写入默认描述');
    }
    return { ok: true, reason: 'no-cards', llmCalled: false, updated: !isDescLocked };
  }

  const prompt = buildTaskUpdatePrompt(task, taskCards, isTitleLocked, isDescLocked, ignorePrevious);
  console.log('[任务更新] Prompt 长度:', prompt.length);

  try {
    const responseText = await requestQwenSummary({
      ...settings,
      prompt,
      screenshot: null,
      useImage: false
    });

    console.log('[任务更新] AI 返回:', responseText);

    const update = parseTaskUpdate(responseText);
    const nextDescription = update.description || '';
    // 旧描述与新描述一致时，说明模型只是原样复述，用户侧看到的就是「纹丝不动」
    const changed = Boolean(nextDescription) && nextDescription !== (task.description || '');
    if (update.title || update.description) {
      // 写回前重新读取最新数据：任务若在这段 AI 等待期间被删除，则放弃写入
      await writeTaskPatch(taskId, (t, freshTasks) => ({
        title: (!isTitleLocked && update.title)
          ? deduplicateTaskTitle(update.title, freshTasks, taskId)
          : t.title,
        description: (!isDescLocked && update.description) ? update.description : t.description,
        updatedAt: Date.now()
      }));
      console.log('[任务更新] 任务已更新:', update.title, '描述是否变化:', changed);
      return { ok: true, reason: 'updated', llmCalled: true, updated: true, changed };
    }
    console.log('[任务更新] AI 未返回可写入的字段，内容未变更');
    return { ok: true, reason: 'empty-parse', llmCalled: true, updated: false, changed: false };
  } catch (error) {
    console.error('[任务更新] 失败:', error);
    return { ok: true, reason: 'llm-error', llmCalled: true, updated: false, error: error.message };
  }
}

// 构建任务更新 prompt
function buildTaskUpdatePrompt(task, taskCards, isTitleLocked = false, isDescLocked = false, ignorePrevious = false) {
  const cardSummaries = taskCards
    .map((c, i) => {
      const time = new Date(c.timestamp).toLocaleString('zh-CN');
      return `${i + 1}. [${time}] ${c.llmSummary || '无摘要'}`;
    })
    .join('\n');

  const titleNote = isTitleLocked ? '（已手动锁定，输出时保持原值不变）' : '';
  const descNote = isDescLocked ? '（已手动锁定，输出时保持原值不变）' : '';

  return [
    '你是一个任务管理助手。根据以下任务的历史存档记录，更新任务的标题和描述。',
    '',
    `【当前任务】`,
    `标题: ${task.title}${titleNote}`,
    // 手动刷新时不再把旧描述喂给模型：否则模型会锚定旧文本，忽略新存档的变化
    ignorePrevious
      ? '描述: （旧描述已作废，禁止参考，必须完全依据下面的存档重新撰写）'
      : `描述: ${task.description || '暂无'}${descNote}`,
    '',
    '【该任务下的最近存档（从新到旧）】',
    cardSummaries,
    '',
    '【要求】',
    '1. 标题必须具体，明确描述任务主体和目标（15字以内），避免泛化表述',
    '2. 描述必须具体，包含关键对象/产出/进展（50字以内），避免空泛总结',
    '3. 基于上面列出的全部存档综合判断，不要只看最新一条',
    '4. 【重要】描述只能反映上面列出的存档内容，不得出现列表中没有体现的对象、节点或交付物',
    '5. 【重要】禁止沿用上一次的旧概括，必须结合当前存档重新组织表述',
    '6. 如果发现任务主题与当前标题不一致，应更正为更具体的主题',
    isTitleLocked ? '7. 【标题已锁定】不得修改标题，JSON 中 title 字段必须原样返回当前标题' : '',
    isDescLocked ? '8. 【描述已锁定】不得修改描述，JSON 中 description 字段必须原样返回当前描述' : '',
    ignorePrevious ? '9. 【重新生成】描述必须覆盖存档列表中最新的关键任务节点与交付物，尤其是列表第 1 条' : '',
    '',
    '【输出格式】严格按以下 JSON 格式输出，不要输出其他内容：',
    '{"title":"更新后的标题","description":"更新后的描述"}',
  ].filter(line => line !== undefined && line !== '').join('\n');
}

// 解析任务更新结果
function parseTaskUpdate(text) {
  try {
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[任务更新] JSON 解析失败:', e);
  }
  return {};
}

// ========== 任务简报 ==========

// 构建任务简报 prompt
function buildTaskBriefingPrompt(task, taskCards) {
  const cardList = taskCards
    .map((c, i) => {
      const time = new Date(c.timestamp).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      // 提取卡片中所有 URL（去重，过滤掉 chrome:// 等）
      const urls = (c.tabs || [])
        .map(t => t.url)
        .filter(u => u && !u.startsWith('chrome://') && !u.startsWith('chrome-extension://') && !u.startsWith('about:'))
        .filter((u, idx, arr) => arr.indexOf(u) === idx);
      const urlLine = urls.length > 0 ? `\n   URLs: ${urls.join(' | ')}` : '';
      return `${i + 1}. [${time}] ${c.llmSummary || '无摘要'}${urlLine}`;
    })
    .join('\n');

  return [
    '你是一位高效的首席幕僚，擅长从零碎的工作记录中还原逻辑。',
    '',
    `任务名称：${task.title}`,
    task.description ? `任务描述：${task.description}` : '',
    '',
    '以下是该任务下所有存档卡片（从旧到新排列）：',
    cardList,
    '',
    '请基于以上记录，生成一份结构化简报。简报必须包含以下两个部分：',
    '',
    '## 演进脉络',
    '以逻辑主线为主导，梳理这段时间内工作是如何演进的（例如：从尝试 A 方案报错 → 转向 B 方案 → 最终落地到 C 工具）。不要逐条罗列，要提炼出关键转折点和推进节奏。注意避免引用复杂不可读编号、数字串、url等，保证段落易阅读性；用有序编号的方式罗列陈述，每一句开头先总结短语，然后再展开陈述',
    '',
    '## 关键交付物',
    '总览全部卡片，挑选卡片中的重点的、带有核心产出物的卡片内容，挑选值得列出的这段时间内产出的核心文档或成果。如果全部记录中没有明确的文档或某种成果产出，可以写「暂无明确交付物记录」。注意，此处梳理的是产出物，不要泛泛描述页面，应该是明确输出成果的罗列。例如xx文档、xx素材资源等，而不能是xx页面、xx会话这种非产出指向的描述。',
    '',
    '【格式要求】',
    '- 使用 Markdown，两个部分分别用 ## 标题',
    '- 语言简洁，不使用「你」「我」等人称代词',
    '- 总字数控制在 300 字以内',
  ].filter(line => line !== undefined).join('\n');
}

// 生成并保存任务简报
async function generateTaskBriefing(taskId) {
  console.log('[任务简报] 开始生成，任务ID:', taskId);

  const { llmSettings } = await chrome.storage.local.get('llmSettings');
  const settings = { ...DEFAULT_LLM_SETTINGS, ...(llmSettings || {}) };

  if (!settings.enableAI || !settings.apiKey) {
    throw new Error('AI 未启用或未配置 API Key');
  }

  const result = await chrome.storage.local.get(['workCards', 'tasks']);
  const workCards = result.workCards || [];
  const tasks = result.tasks || [];

  const task = tasks.find(t => t.id === taskId);
  if (!task) throw new Error('任务不存在');

  // 该任务下所有卡片，从旧到新排列
  const taskCards = workCards
    .filter(c => c.taskId === taskId && c.llmSummaryStatus === 'done')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (taskCards.length === 0) throw new Error('该任务下暂无已生成摘要的存档');

  const prompt = buildTaskBriefingPrompt(task, taskCards);
  console.log('[任务简报] Prompt 长度:', prompt.length);

  const briefingText = await requestQwenSummary({
    ...settings,
    prompt,
    screenshot: null,
    useImage: false
  });

  // 保存简报到任务数据（写回前重新读取最新数据，任务若已被删除则放弃写入）
  const generatedAt = new Date().toISOString();
  await writeTaskPatch(taskId, () => ({
    briefing: briefingText,
    briefingGeneratedAt: generatedAt,
    updatedAt: Date.now()
  }));
  console.log('[任务简报] 已保存，生成时间:', generatedAt);

  return { briefingText, generatedAt };
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'generate-task-briefing') {
    generateTaskBriefing(message.taskId)
      .then(({ briefingText, generatedAt }) => sendResponse({ ok: true, briefingText, generatedAt }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // 保持消息通道开放，等待异步响应
  }
  if (message.type === 'trigger-card-regen') {
    triggerCardRegeneration(message.cardId, Boolean(message.force))
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'trigger-task-desc-update') {
    triggerTaskDescUpdate(message.taskId, Boolean(message.force))
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'regenerate-task-desc') {
    regenerateTaskDesc(message.taskId)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// 联动：重新生成卡片摘要（备注变更或标签页删除后触发）
async function triggerCardRegeneration(cardId, force = false) {
  console.log('[联动] 触发卡片摘要重生成:', cardId, force ? '(强制)' : '');

  const { llmSettings } = await chrome.storage.local.get('llmSettings');
  const settings = { ...DEFAULT_LLM_SETTINGS, ...(llmSettings || {}) };

  if (!settings.enableAI || !settings.apiKey) {
    console.log('[联动] AI 未启用，跳过重生成');
    return;
  }

  const { workCards = [] } = await chrome.storage.local.get('workCards');
  const card = workCards.find(c => c.id === cardId);
  if (!card) return;

  if (!card.isSummaryLocked) {
    // 使用已有的标签页总结（aiSummary），不重新调用 AI 生成
    const tabSummaries = card.tabs.map(tab => ({ url: tab.url, summary: tab.aiSummary || '' }));

    const prompt = buildTaskSummaryPrompt(card, tabSummaries, settings.maxTabsForPrompt);
    const summaryText = await requestQwenSummary({
      ...settings,
      prompt,
      screenshot: null,
      useImage: false
    });
    await updateWorkCardSummary(cardId, summaryText, 'done');
    console.log('[联动] 卡片摘要已重生成');

    // 仅当摘要重新生成时，触发任务描述更新
    const { workCards: latest = [] } = await chrome.storage.local.get('workCards');
    const latestCard = latest.find(c => c.id === cardId);
    if (latestCard && latestCard.taskId) {
      await triggerTaskDescUpdate(latestCard.taskId, true);
    }
  } else {
    console.log('[联动] 摘要已锁定，跳过重生成');
  }
}

// 联动：更新任务描述（卡片摘要变更后触发）
async function triggerTaskDescUpdate(taskId, force = false) {
  console.log('[联动] 触发任务描述更新:', taskId, force ? '(强制)' : '');

  const { llmSettings } = await chrome.storage.local.get('llmSettings');
  const settings = { ...DEFAULT_LLM_SETTINGS, ...(llmSettings || {}) };

  if (!settings.enableAI || !settings.apiKey) {
    console.log('[联动] AI 未启用，跳过任务更新');
    return;
  }

  // 不重置 Token，联动调用直接累加
  await updateTaskWithLatestCards(taskId, settings, force);
}

// 手动刷新任务概要：先解除手动编辑锁定，允许覆盖用户编辑过的文本，再重新生成
// 解锁只针对本次刷新，用户下次手动编辑描述时仍会重新写入锁定标记
async function regenerateTaskDesc(taskId) {
  console.log('[任务概要] 手动刷新:', taskId);

  const { llmSettings } = await chrome.storage.local.get('llmSettings');
  const settings = { ...DEFAULT_LLM_SETTINGS, ...(llmSettings || {}) };

  if (!settings.enableAI || !settings.apiKey) {
    console.log('[任务概要] AI 未启用，跳过刷新');
    return { ok: false, reason: 'ai-disabled', llmCalled: false, updated: false, error: '未启用 AI 或未配置 API Key' };
  }

  await writeTaskPatch(taskId, () => ({ isDescLocked: false, userLocked: false }));
  // ignorePrevious=true：不把旧描述喂给模型，避免它锚定旧文本、忽略新存档
  const result = (await updateTaskWithLatestCards(taskId, settings, true, true)) || {};

  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const task = tasks.find(t => t.id === taskId);
  return {
    ok: result.ok !== false,
    reason: result.reason || 'unknown',
    llmCalled: Boolean(result.llmCalled),
    updated: Boolean(result.updated),
    changed: Boolean(result.changed),
    raw: result.reason === 'updated' ? (result.changed ? '' : '模型返回的描述与原文完全一致') : '',
    error: result.error || '',
    description: task?.description || ''
  };
}

// ========== [+页面]：抓取新标签页正文并生成逐页摘要 ==========

// 在指定标签页注入脚本提取正文（与 createSnapshot 中的抓取逻辑一致）
function extractPageContentInjected(lengths) {
  try {
    const url = window.location.href;
    const isSearchPage =
      url.includes('google.com/search') ||
      url.includes('bing.com/search') ||
      url.includes('baidu.com/s') ||
      url.includes('duckduckgo.com/');
    const selectedText = window.getSelection()?.toString().trim() || '';
    if (isSearchPage) {
      return { h1Titles: [], h2Titles: [], bodyText: '', selectedText, isSearchPage: true, scrollPercent: 0, beginningText: '', viewportText: '', endingText: '', success: true };
    }
    const h1Elements = Array.from(document.querySelectorAll('h1'));
    const h2Elements = Array.from(document.querySelectorAll('h2'));
    const h1Titles = h1Elements.map(el => el.textContent.trim()).filter(text => text.length > 0);
    const h2Titles = h2Elements.map(el => el.textContent.trim()).filter(text => text.length > 0);
    const contentSelectors = ['article', 'main', '[role="main"]', 'body'];
    let contentElement = null;
    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent || element.innerText || '';
        if (text.trim().length > 100) { contentElement = element; break; }
      }
    }
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrollPercent = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;
    const cleanText = (text) => text.replace(/\s+/g, ' ').trim();
    let beginningText = '';
    if (contentElement) {
      const fullText = cleanText(contentElement.textContent || contentElement.innerText || '');
      beginningText = fullText.substring(0, lengths.beginning);
    }
    let viewportText = '';
    if (contentElement) {
      const range = document.caretRangeFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      if (range) {
        const walker = document.createTreeWalker(contentElement, NodeFilter.SHOW_TEXT, null);
        let foundStart = false;
        let collectedText = '';
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const rect = node.parentElement?.getBoundingClientRect();
          if (rect && rect.top >= 0 && rect.top <= window.innerHeight) {
            foundStart = true;
            collectedText += node.textContent || '';
            if (collectedText.length >= lengths.viewport) break;
          } else if (foundStart) {
            break;
          }
        }
        viewportText = cleanText(collectedText).substring(0, lengths.viewport);
      }
      if (!viewportText) {
        const fullText = cleanText(contentElement.textContent || contentElement.innerText || '');
        const estimatedPosition = Math.floor(fullText.length * (scrollPercent / 100));
        viewportText = fullText.substring(estimatedPosition, estimatedPosition + lengths.viewport);
      }
    }
    let endingText = '';
    if (contentElement) {
      const fullText = cleanText(contentElement.textContent || contentElement.innerText || '');
      endingText = fullText.substring(Math.max(0, fullText.length - lengths.ending));
    }
    const bodyText = beginningText;
    return { h1Titles, h2Titles, bodyText, selectedText, isSearchPage: false, scrollPercent, beginningText, viewportText, endingText, success: true };
  } catch (error) {
    return { h1Titles: [], h2Titles: [], bodyText: '', selectedText: '', isSearchPage: false, scrollPercent: 0, beginningText: '', viewportText: '', endingText: '', success: false, error: error.message };
  }
}

async function scrapeTabContent(tabId) {
  const lengths = { beginning: 500, viewport: 500, ending: 300 };
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: extractPageContentInjected, args: [lengths] });
    if (results && results[0] && results[0].result) return results[0].result;
  } catch (error) {
    console.error('[+页面] 抓取页面正文失败:', error);
  }
  return null;
}

async function handleAddPagesToCard(cardId, selectedTabs) {
  console.log('[+页面] 开始为卡片追加页面:', cardId, '数量:', selectedTabs.length);
  const { workCards = [] } = await chrome.storage.local.get('workCards');
  const card = workCards.find(c => c.id === cardId);
  if (!card) return;
  const newTabs = [];
  for (const t of selectedTabs) {
    let summary = { h1Titles: [], h2Titles: [], bodyText: '', selectedText: '', isSearchPage: false, scrollPercent: 0, beginningText: '', viewportText: '', endingText: '' };
    if (t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('edge://')) {
      const scraped = await scrapeTabContent(t.tabId);
      if (scraped) summary = scraped;
    }
    newTabs.push({ url: t.url, title: t.title || t.url || '未命名', favIconUrl: t.favIconUrl || '', active: false, summary });
  }
  const mergedTabs = (card.tabs || []).concat(newTabs);
  const updatedCards = workCards.map(c => c.id === cardId ? { ...c, tabs: mergedTabs, tabCount: mergedTabs.length, updatedAt: Date.now() } : c);
  await chrome.storage.local.set({ workCards: updatedCards });
  const { llmSettings } = await chrome.storage.local.get('llmSettings');
  const settings = { ...DEFAULT_LLM_SETTINGS, ...(llmSettings || {}) };
  if (settings.enableAI && settings.apiKey) {
    await updateWorkCardSummary(cardId, '正在更新概要...', 'pending');
    const freshCard = (await chrome.storage.local.get('workCards')).workCards.find(c => c.id === cardId);
    const tabSummaries = await generateTabSummaries(freshCard, settings);
    await updateTabSummaries(cardId, tabSummaries);
  }
  await triggerCardRegeneration(cardId, true);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'add-pages-to-card') {
    handleAddPagesToCard(message.cardId, message.tabs || [])
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});