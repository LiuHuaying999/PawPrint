// Content script 用于提取页面摘录信息

function extractPageSummary() {
  try {
    // 提取所有 h1 和 h2 标题
    const h1Elements = Array.from(document.querySelectorAll('h1'));
    const h2Elements = Array.from(document.querySelectorAll('h2'));

    const h1Titles = h1Elements.map(el => el.textContent.trim()).filter(text => text.length > 0);
    const h2Titles = h2Elements.map(el => el.textContent.trim()).filter(text => text.length > 0);

    // 提取页面正文的前 800 个字符
    // 尝试从 main, article, body 等常见正文容器中提取
    let bodyText = '';
    const contentSelectors = ['main', 'article', '[role="main"]', 'body'];

    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        bodyText = element.textContent || element.innerText || '';
        break;
      }
    }

    // 清理文本：去除多余空白字符
    bodyText = bodyText
      .replace(/\s+/g, ' ')  // 将多个空白字符替换为单个空格
      .trim()
      .substring(0, 800);    // 截取前 800 个字符

    return {
      h1Titles,
      h2Titles,
      bodyText,
      success: true
    };
  } catch (error) {
    console.error('提取页面摘录失败:', error);
    return {
      h1Titles: [],
      h2Titles: [],
      bodyText: '',
      success: false,
      error: error.message
    };
  }
}

// 浮层容器
let _toastContainer = null;

function getToastContainer() {
  if (_toastContainer && document.body.contains(_toastContainer)) {
    return _toastContainer;
  }
  const container = document.createElement('div');
  container.style.cssText = [
    'position: fixed',
    'bottom: 24px',
    'right: 24px',
    'z-index: 2147483647',
    'display: flex',
    'flex-direction: column',
    'align-items: flex-end',
    'gap: 8px',
    'pointer-events: none'
  ].join(';');
  document.body.appendChild(container);
  _toastContainer = container;
  return container;
}

function showToast(message) {
  const container = getToastContainer();

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = [
    'background: rgba(30,30,30,0.88)',
    'color: #fff',
    'font-size: 13px',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'padding: 8px 14px',
    'border-radius: 8px',
    'box-shadow: 0 4px 12px rgba(0,0,0,0.25)',
    'opacity: 0',
    'transform: translateY(6px)',
    'transition: opacity 0.2s ease, transform 0.2s ease',
    'pointer-events: none',
    'white-space: nowrap'
  ].join(';');

  container.appendChild(toast);

  // 触发进入动画
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
  });

  // 3 秒后淡出并移除
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 220);
  }, 3000);
}

// 监听来自 background script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractSummary') {
    const summary = extractPageSummary();
    sendResponse(summary);
  }
  if (request.action === 'showToast') {
    showToast(request.message);
  }
  return true;  // 保持消息通道开放以支持异步响应
});
