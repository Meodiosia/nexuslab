const workspace = document.querySelector('#workspace');
const openButtons = document.querySelectorAll('[data-open-workspace]');
const closeButton = document.querySelector('[data-close-workspace]');
const navButtons = document.querySelectorAll('[data-view]');
const panels = document.querySelectorAll('[data-view-panel]');
const viewTitle = document.querySelector('#view-title');
const editor = document.querySelector('#editor');
const saveState = document.querySelector('#save-state');

const viewNames = {
  overview: '项目概览',
  document: '策划文档',
  environment: '环境安装',
  tasks: '任务看板',
  people: '团队成员',
  assets: '素材资产',
  ideas: '创意中心'
};

function openWorkspace() {
  workspace.showModal();
  document.body.style.overflow = 'hidden';
}

function closeWorkspace() {
  workspace.close();
  document.body.style.overflow = '';
}

function switchView(view) {
  currentView = view;
  navButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
  viewTitle.textContent = viewNames[view];
  if (view === 'overview') refreshOverview();
  if (view === 'document') loadDocuments('planning');
  if (view === 'environment') loadDocuments('environment');
  if (view === 'tasks') loadTasks();
  if (view === 'assets') loadAssets();
}

openButtons.forEach((button) => button.addEventListener('click', openWorkspace));
closeButton.addEventListener('click', closeWorkspace);
navButtons.forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-view-jump]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewJump)));
workspace.addEventListener('click', (event) => {
  if (event.target === workspace) closeWorkspace();
});

const ideaForm = document.querySelector('#idea-form');
const ideaFeed = document.querySelector('#idea-feed');
const ideaImage = document.querySelector('#idea-image');
const composerPreview = document.querySelector('#composer-preview');
const loginDialog = document.querySelector('#login-dialog');
const loginForm = document.querySelector('#login-form');
const loginSubmit = document.querySelector('#login-submit');
const realIdInput = document.querySelector('#real-id');
const loginMessage = document.querySelector('#login-message');
const currentUserAvatar = document.querySelector('#current-user-avatar');
const serverState = document.querySelector('#server-state');
const loginOpenButton = document.querySelector('[data-open-login]');
const logoutButton = document.querySelector('[data-logout]');
const accountPassword = document.querySelector('#account-password');
const registerFields = document.querySelector('#register-fields');
const registerBio = document.querySelector('#register-bio');
const profileDialog = document.querySelector('#profile-dialog');
const profileAvatarPreview = document.querySelector('#profile-avatar-preview');
const profileBio = document.querySelector('#profile-bio');
const profileMessage = document.querySelector('#profile-message');
const publicTeamGrid = document.querySelector('#public-team-grid');
const projectSettingsDialog = document.querySelector('#project-settings-dialog');
const projectNameInput = document.querySelector('#project-name-input');
const projectIconInput = document.querySelector('#project-icon-input');
const projectIconPreview = document.querySelector('#project-icon-preview');
const projectSettingsMessage = document.querySelector('#project-settings-message');
let pendingImage = '';
let pendingAvatar = '';
let pendingProjectIcon = '';
let currentProject = { name: '', icon: '' };
let authMode = 'login';
let allIdeas = [];
let allTasks = [];
let currentMember = JSON.parse(localStorage.getItem('nexuslab-member') || 'null');
let sessionToken = localStorage.getItem('nexuslab-session') || '';

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
}

/* ---- 轻提示 ---- */
function toast(message, type = 'info', ms = 2600) {
  let stack = document.querySelector('#toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.textContent = message;
  stack.appendChild(item);
  requestAnimationFrame(() => item.classList.add('show'));
  setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 320);
  }, ms);
}

/* ---- 相对时间 ---- */
function timeAgo(value) {
  if (!value) return '';
  const timestamp = new Date(`${value.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return formatDocumentTime(value);
}

function relTimeMarkup(value, extraClass = '') {
  return `<time class="reltime ${extraClass}" data-ts="${escapeHtml(value || '')}">${escapeHtml(timeAgo(value))}</time>`;
}

setInterval(() => {
  document.querySelectorAll('time.reltime[data-ts]').forEach((element) => {
    const value = element.getAttribute('data-ts');
    if (value) element.textContent = timeAgo(value);
  });
}, 30000);

/* ---- 头像占位：首字母 + 稳定色相 ---- */
function nameHue(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

function avatarMarkup(member, className = 'post-avatar avatar-a') {
  const name = member.real_id || member.name || '?';
  const label = escapeHtml(name);
  if (member.avatar) return `<div class="${className} custom-avatar"><img src="${escapeHtml(member.avatar)}" alt="${label} 的头像"></div>`;
  return `<div class="${className} avatar-placeholder" style="--hue:${nameHue(name)}" aria-label="${label} 尚未上传头像"><span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span></div>`;
}

function renderCommentItem(comment) {
  const deleteButton = comment.owned ? `<button class="delete-comment" type="button" data-comment-id="${comment.id}">删除</button>` : '';
  return `<div class="comment-item">${avatarMarkup(comment, 'comment-avatar')}<p><b>${escapeHtml(comment.real_id)}</b><span>${escapeHtml(comment.content)}</span></p>${deleteButton}</div>`;
}

function renderIdea(idea) {
  const image = idea.image ? `<div class="post-image user-post-image"><img src="${escapeHtml(idea.image)}" alt="用户上传的创意图片"></div>` : '';
  const comments = (idea.comment_items || []).map(renderCommentItem).join('');
  const deleteButton = idea.owned ? '<button class="delete-idea" type="button">删除动态</button>' : '';
  const typeLabel = idea.idea_type === 'concept' ? '概念创意' : '玩法创意';
  return `<article class="idea-post" data-idea-id="${idea.id || ''}"><header>${avatarMarkup(idea)}<div><strong>${escapeHtml(idea.name)}</strong><span>团队成员 · ${relTimeMarkup(idea.created_at)}</span></div>${deleteButton}</header><p>${escapeHtml(idea.content).replace(/\n/g, '<br>')}</p>${image}<footer><button class="like-button ${idea.liked ? 'liked' : ''}" type="button"><span>${idea.liked ? '♥' : '♡'}</span> <b>${idea.likes || 0}</b></button><button class="comment-toggle" type="button">◌ <b>${idea.comments || 0} 条评论</b></button><span class="post-tag type-${idea.idea_type}">#${typeLabel}</span></footer><div class="comment-list">${comments}</div></article>`;
}

function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (sessionToken) headers['X-Session'] = sessionToken;
  return fetch(path, { ...options, headers }).then(async (response) => {
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      // 忽略非 JSON 响应
    }
    if (!response.ok) {
      if (response.status === 401 && sessionToken) clearAuth();
      const error = new Error(data.error || '请求失败');
      error.status = response.status;
      throw error;
    }
    return data;
  });
}

function updateAuthButtons() {
  const logged = Boolean(currentMember && sessionToken);
  if (loginOpenButton) loginOpenButton.hidden = logged;
  if (logoutButton) logoutButton.hidden = !logged;
  const bell = document.querySelector('#notify-button');
  if (bell) bell.hidden = !logged;
}

function clearAuth() {
  currentMember = null;
  sessionToken = '';
  localStorage.removeItem('nexuslab-member');
  localStorage.removeItem('nexuslab-session');
  const nameInput = document.querySelector('#idea-name');
  if (nameInput) nameInput.value = '';
  const composerAvatar = document.querySelector('.composer-avatar');
  if (composerAvatar) {
    composerAvatar.innerHTML = '';
    composerAvatar.classList.add('avatar-placeholder');
  }
  currentUserAvatar.innerHTML = '';
  currentUserAvatar.classList.add('avatar-placeholder');
  updateAuthButtons();
  disconnectRealtime();
}

const roleLabels = { admin: '管理员', member: '成员', viewer: '只读成员' };

function canWrite() {
  return Boolean(currentMember && sessionToken && currentMember.role !== 'viewer');
}

/* ---- SSE 实时事件 ---- */
const realtime = { stream: null, onlineIds: new Set() };
let currentView = 'overview';
const eventThrottles = {};

function throttledEvent(key, fn, ms = 1200) {
  const now = Date.now();
  if (now - (eventThrottles[key] || 0) < ms) return;
  eventThrottles[key] = now;
  fn();
}

function renderPresence(online) {
  realtime.onlineIds = new Set((online || []).map((member) => Number(member.id)));
  const stackEl = document.querySelector('.online-stack');
  const chips = (online || []).map((member) => {
    const label = escapeHtml(member.real_id || '?');
    const content = member.avatar
      ? `<img src="${escapeHtml(member.avatar)}" alt="${label} 的头像">`
      : escapeHtml((member.real_id || '?').slice(0, 1).toUpperCase());
    const style = member.avatar ? '' : ` style="--hue:${nameHue(member.real_id)}"`;
    return `<i class="presence-chip"${style} title="${label} 在线">${content}</i>`;
  }).join('');
  if (stackEl) stackEl.innerHTML = chips;
  const bottomText = document.querySelector('.workspace-bottom small');
  if (bottomText) bottomText.innerHTML = (online || []).length ? `<b>${online.length}</b> 位成员在线` : '等待成员登录';
  const ideasOnline = document.querySelector('.ideas-online');
  if (ideasOnline) ideasOnline.textContent = (online || []).length ? `${online.length} 位在线` : '暂无在线状态';
}

function clearPresence() {
  realtime.onlineIds = new Set();
  renderPresence([]);
}

function handleServerEvent(type, data) {
  const payload = data || {};
  switch (type) {
    case 'presence':
      renderPresence(payload.online || []);
      break;
    case 'member':
      refreshMembers();
      if (payload.action === 'joined' || payload.action === 'removed') refreshOverview();
      break;
    case 'project':
      refreshProject();
      refreshOverview();
      break;
    case 'idea':
      throttledEvent('idea', () => { if (currentView === 'ideas') refreshIdeas(); });
      break;
    case 'notify':
      throttledEvent('notify', () => loadNotifications());
      break;
    case 'task':
      throttledEvent('task', () => {
        refreshOverview();
        if (currentView === 'tasks') loadTasks();
      });
      break;
    case 'doc': {
      const actor = payload.actor != null ? Number(payload.actor) : null;
      if (currentMember && actor === Number(currentMember.id)) break; // 自己触发的操作本地已处理
      if (activeDocument && payload.action === 'update' && Number(payload.id) === activeDocument.id) {
        showDocConflict('该文档刚被其他成员保存了新的版本。', false);
        break;
      }
      if (currentView === 'document' || currentView === 'environment') {
        loadDocuments(payload.category === 'environment' ? 'environment' : 'planning');
      }
      refreshOverview();
      break;
    }
    case 'asset':
      throttledEvent('asset', () => {
        if (currentView === 'assets') loadAssets();
        refreshOverview();
      });
      break;
    default:
      break;
  }
}

function connectRealtime() {
  if (!sessionToken) return;
  disconnectRealtime();
  try {
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(sessionToken)}`);
    realtime.stream = es;
    es.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        handleServerEvent(message.type, message.data);
      } catch (error) {
        // 忽略无效帧
      }
    });
  } catch (error) {
    realtime.stream = null;
  }
}

function disconnectRealtime() {
  if (realtime.stream) {
    realtime.stream.close();
    realtime.stream = null;
  }
  clearPresence();
}

/* ---- 通知中心 ---- */
let notificationUnread = 0;
const notifyRefLabels = { idea: '动态', comment: '评论', task: '任务', mention: '提及', assign: '指派' };

function renderNotifyBadge() {
  const badge = document.querySelector('#notify-badge');
  if (!badge) return;
  badge.hidden = !notificationUnread;
  badge.textContent = notificationUnread > 99 ? '99+' : String(notificationUnread);
}

function loadNotifications() {
  return api('/api/notifications').then((data) => {
    renderNotificationItems(data.items || []);
    notificationUnread = data.unread || 0;
    renderNotifyBadge();
  }).catch(() => {});
}

function renderNotificationItems(items) {
  const list = document.querySelector('#notify-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<li class="notify-empty">还没有通知</li>';
    return;
  }
  list.innerHTML = items.map((item) => {
    const kindLabel = notifyRefLabels[item.ref_type] || item.ref_type;
    return `<li class="${item.is_read ? 'read' : ''}"><button type="button" data-notify-item="${item.id}" data-notify-ref="${item.ref_type}" data-notify-ref-id="${item.ref_id || ''}"><b>${item.is_read ? '' : '● '}${escapeHtml(item.text)}</b><small>${escapeHtml(kindLabel)} · ${relTimeMarkup(item.created_at)}</small></button></li>`;
  }).join('');
  list.querySelectorAll('[data-notify-item]').forEach((button) => button.addEventListener('click', () => {
    api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids: [Number(button.dataset.notifyItem)] }) }).then(() => loadNotifications()).catch(() => {});
    document.querySelector('#notify-panel').hidden = true;
    const refType = button.dataset.notifyRef;
    if (refType === 'task') switchView('tasks');
    else if (refType === 'idea' || refType === 'comment') switchView('ideas');
  }));
}

function markAllNotificationsRead() {
  api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) }).then(() => loadNotifications()).catch(() => {});
}

function toggleNotifyPanel() {
  const panel = document.querySelector('#notify-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) loadNotifications();
}

/* ---- 文档冲突 ---- */
let activeDocRevision = null;
let docConflict = false;
let docConflictForce = false;

function hideDocConflict() {
  const bar = document.querySelector('#doc-conflict');
  if (bar) bar.hidden = true;
  docConflict = false;
}

function showDocConflict(message, canForce) {
  docConflict = true;
  docConflictForce = Boolean(canForce);
  const bar = document.querySelector('#doc-conflict');
  if (!bar) return;
  document.querySelector('#doc-conflict-text').textContent = message;
  document.querySelector('[data-conflict-force]').hidden = !canForce;
  bar.hidden = false;
}

document.querySelector('#doc-conflict') && (() => {
  const panel = document.querySelector('#notify-panel');
  document.querySelector('#notify-button').addEventListener('click', (event) => { event.stopPropagation(); toggleNotifyPanel(); });
  document.querySelector('[data-notify-close]').addEventListener('click', () => { panel.hidden = true; });
  document.querySelector('#notify-mark-read').addEventListener('click', markAllNotificationsRead);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) panel.hidden = true; });
  document.querySelector('[data-conflict-reload]').addEventListener('click', () => {
    if (!activeDocument) return;
    clearTimeout(documentSaveTimer);
    openDocument(activeDocument.id, activeDocument.category);
  });
  document.querySelector('[data-conflict-force]').addEventListener('click', () => {
    if (!activeDocument) return;
    clearTimeout(documentSaveTimer);
    saveActiveDocument({ force: true });
  });
  document.querySelector('[data-conflict-dismiss]').addEventListener('click', hideDocConflict);
})();

document.addEventListener('click', (event) => {
  const panel = document.querySelector('#notify-panel');
  if (!panel.hidden && !panel.contains(event.target) && !document.querySelector('#notify-button').contains(event.target)) {
    panel.hidden = true;
  }
});

function renderIdeas(ideas, updateSource = true) {
  if (updateSource) allIdeas = ideas;
  ideaFeed.innerHTML = ideas.length ? ideas.map(renderIdea).join('') : '<div class="feed-empty"><span>NO SIGNALS YET</span><h3>还没有人发布动态</h3><p>登录后发布第一条真实创意。</p></div>';
  reopenExpandedComments();
  bindIdeaActions();
}

function setMember(member, token) {
  currentMember = member;
  sessionToken = token;
  localStorage.setItem('nexuslab-member', JSON.stringify(member));
  localStorage.setItem('nexuslab-session', token);
  document.querySelector('#idea-name').value = member.real_id;
  const composerAvatar = document.querySelector('.composer-avatar');
  composerAvatar.innerHTML = member.avatar ? `<img src="${escapeHtml(member.avatar)}" alt="${escapeHtml(member.real_id)} 的头像">` : '';
  composerAvatar.classList.toggle('avatar-placeholder', !member.avatar);
  currentUserAvatar.innerHTML = member.avatar ? `<img src="${escapeHtml(member.avatar)}" alt="${escapeHtml(member.real_id)} 的头像">` : '';
  currentUserAvatar.classList.toggle('avatar-placeholder', !member.avatar);
  serverState.textContent = `已连接 · ${member.real_id}`;
  loginMessage.textContent = `已登录为 ${member.real_id}`;
  updateAuthButtons();
}

function refreshIdeas() {
  return api('/api/ideas?limit=50').then((data) => {
    ideaFeedState.total = data.total || (data.ideas || []).length;
    ideaFeedState.hasMore = Boolean(data.has_more);
    const items = data.ideas || [];
    ideaFeedState.nextBefore = items.length ? items[items.length - 1].id : null;
    renderIdeas(items);
    renderIdeaFeedMeta();
  }).catch((error) => {
    serverState.textContent = error.message.includes('实名 ID') ? '请重新登录' : '离线原型';
  });
}

const ideaFeedState = { total: 0, hasMore: false, nextBefore: null, loading: false };
let ideaSearch = '';

function renderIdeaFeedMeta() {
  const meta = document.querySelector('#idea-feed-meta');
  const more = document.querySelector('#idea-load-more');
  if (!meta || !more) return;
  meta.textContent = `已加载 ${allIdeas.length} 条 · 共 ${ideaFeedState.total} 条信号`;
  more.hidden = !ideaFeedState.hasMore || !allIdeas.length;
}

function loadMoreIdeas() {
  if (!ideaFeedState.hasMore || ideaFeedState.loading) return;
  ideaFeedState.loading = true;
  const before = ideaFeedState.nextBefore;
  api(`/api/ideas?limit=50&before_id=${before}`).then((data) => {
    ideaFeedState.total = data.total;
    ideaFeedState.hasMore = Boolean(data.has_more);
    const existing = new Set(allIdeas.map((idea) => idea.id));
    const older = (data.ideas || []).filter((idea) => !existing.has(idea.id));
    ideaFeedState.nextBefore = older.length ? older[older.length - 1].id : null;
    if (!older.length) ideaFeedState.hasMore = false;
    allIdeas = allIdeas.concat(older);
    applyIdeaFilters();
    renderIdeaFeedMeta();
  }).catch((error) => { serverState.textContent = error.message; }).finally(() => { ideaFeedState.loading = false; });
}

function applyIdeaFilters() {
  const member = document.querySelector('#filter-member').value;
  const time = document.querySelector('#filter-time').value;
  const type = document.querySelector('#filter-type').value;
  const now = Date.now();
  const windows = { today: 86400000, week: 7 * 86400000, month: 30 * 86400000 };
  const keyword = ideaSearch.trim().toLowerCase();
  const filtered = allIdeas.filter((idea) => {
    const memberMatch = member === 'all' || idea.name === member;
    const typeMatch = type === 'all' || idea.idea_type === type;
    const timestamp = new Date(`${idea.created_at.replace(' ', 'T')}Z`).getTime();
    const timeMatch = time === 'all' || (Number.isFinite(timestamp) && now - timestamp <= windows[time]);
    const keywordMatch = !keyword || idea.content.toLowerCase().includes(keyword) || (idea.name || '').toLowerCase().includes(keyword);
    return memberMatch && typeMatch && timeMatch && keywordMatch;
  });
  renderIdeas(filtered, false);
  if (!filtered.length && allIdeas.length) ideaFeed.innerHTML = '<div class="feed-empty"><span>NO MATCHES</span><h3>没有符合条件的动态</h3><p>调整或清除筛选条件后再试。</p></div>';
  renderIdeaFeedMeta();
}

function roleOptionMarkup(selected) {
  return ['member', 'admin', 'viewer'].map((role) => `<option value="${role}" ${role === selected ? 'selected' : ''}>${roleLabels[role]}</option>`).join('');
}

function changeMemberRole(memberId, role) {
  if (!currentMember || currentMember.role !== 'admin') return;
  api(`/api/members/${memberId}/role`, { method: 'POST', body: JSON.stringify({ role }) }).then(() => refreshMembers()).catch((error) => { serverState.textContent = error.message; });
}

function removeMember(memberId, name) {
  if (!currentMember || currentMember.role !== 'admin') return;
  if (!confirm(`确认移除成员「${name}」？该账号需先清空其创建的内容（文档/任务/动态/素材）。`)) return;
  api(`/api/members/${memberId}`, { method: 'DELETE' }).then(() => {
    refreshMembers();
    refreshOverview();
    serverState.textContent = '成员已移除';
  }).catch((error) => { serverState.textContent = error.message; });
}

function refreshMembers() {
  return api('/api/members').then((data) => {
    const canManage = Boolean(currentMember && currentMember.role === 'admin');
    publicTeamGrid.innerHTML = data.members.length ? data.members.map((member) => `<article class="member-card">${memberAvatarShell(member, 'avatar public-avatar')}<div><span>团队成员</span><h3>${escapeHtml(member.real_id)}</h3><p>${escapeHtml(member.bio || '这个成员还没有填写自我介绍。')}</p><small>${roleLabels[member.role] || '成员'} · VERIFIED</small></div></article>`).join('') : '<div class="team-empty"><span>NO MEMBERS YET</span><h3>团队正在集结</h3><p>新用户创建账号后，会自动出现在这里。</p><button type="button" data-open-workspace>创建第一个账号 →</button></div>';
    publicTeamGrid.querySelector('[data-open-workspace]')?.addEventListener('click', openWorkspace);
    const peopleList = document.querySelector('#workspace-people-list');
    document.querySelector('#member-total').textContent = `${data.members.length} 位成员`;
    peopleList.innerHTML = data.members.length ? data.members.map((member) => {
      const role = member.role || 'member';
      const controls = canManage && Number(member.id) !== Number(currentMember.id)
        ? `<div class="people-controls"><select data-member-role="${member.id}" aria-label="设置 ${escapeHtml(member.real_id)} 的角色">${roleOptionMarkup(role)}</select><button type="button" data-member-remove="${member.id}">移除</button></div>`
        : '';
      return `<article class="people-row">${memberAvatarShell(member, 'people-avatar')}<div class="people-main"><strong>${escapeHtml(member.real_id)}</strong><span>${escapeHtml(member.bio || '暂无自我介绍')}</span></div><span class="role-tag role-${role}">${roleLabels[role] || role}</span>${controls}</article>`;
    }).join('') : '<div class="people-empty">还没有注册成员</div>';
    peopleList.querySelectorAll('[data-member-role]').forEach((select) => select.addEventListener('change', () => changeMemberRole(Number(select.dataset.memberRole), select.value)));
    peopleList.querySelectorAll('[data-member-remove]').forEach((button) => button.addEventListener('click', () => {
      const row = button.closest('.people-row');
      const name = row ? row.querySelector('strong').textContent : '';
      removeMember(Number(button.dataset.memberRemove), name);
    }));
    const memberFilter = document.querySelector('#filter-member');
    const selectedMember = memberFilter.value;
    memberFilter.innerHTML = '<option value="all">全部成员</option>' + data.members.map((member) => `<option value="${escapeHtml(member.real_id)}">${escapeHtml(member.real_id)}</option>`).join('');
    if (data.members.some((member) => member.real_id === selectedMember)) memberFilter.value = selectedMember;
    const assigneeOptions = data.members.map((member) => `<option value="${member.id}">${escapeHtml(member.real_id)}</option>`).join('');
    const taskAssignee = document.querySelector('#task-assignee');
    const taskFilterAssignee = document.querySelector('#task-filter-assignee');
    taskAssignee.innerHTML = '<option value="">暂不指派</option>' + assigneeOptions;
    taskFilterAssignee.innerHTML = '<option value="all">全部指派人</option><option value="unassigned">未指派</option>' + data.members.map((member) => `<option value="${escapeHtml(member.real_id)}">${escapeHtml(member.real_id)}</option>`).join('');
  }).catch(() => {});
}

function applyProject(project) {
  currentProject = Object.assign({ name: '', icon: '', require_invite: false, invite_code: '' }, project || {});
  currentProject.require_invite = Boolean(currentProject.require_invite);
  const name = currentProject.name || '未命名项目';
  document.querySelector('#sidebar-project-name').textContent = name;
  document.querySelector('#public-project-name').textContent = currentProject.name || '等待创建';
  const sidebarIcon = document.querySelector('#sidebar-project-icon');
  sidebarIcon.innerHTML = currentProject.icon ? `<img src="${escapeHtml(currentProject.icon)}" alt="${escapeHtml(name)} 的项目图标">` : '';
  sidebarIcon.classList.toggle('project-icon-empty', !currentProject.icon);
  updateInviteFieldVisibility();
}

function refreshProject() {
  return api('/api/project').then((data) => applyProject(data.project)).catch(() => {});
}

function requireLogin() {
  if (currentMember && sessionToken) return true;
  loginDialog.showModal();
  realIdInput.focus();
  return false;
}

const expandedIdeaIds = new Set();

function applyIdeaLikePatch(post, ideas) {
  const id = Number(post.dataset.ideaId);
  const fresh = (ideas || []).find((idea) => idea.id === id);
  if (!fresh) { refreshIdeas(); return; }
  const index = allIdeas.findIndex((idea) => idea.id === id);
  if (index >= 0) allIdeas[index] = Object.assign({}, allIdeas[index], fresh);
  const button = post.querySelector('.like-button');
  if (button) {
    button.classList.toggle('liked', Boolean(fresh.liked));
    const sign = post.querySelector('.like-button span');
    if (sign) sign.textContent = fresh.liked ? '♥' : '♡';
    const count = post.querySelector('.like-button b');
    if (count) count.textContent = fresh.likes || 0;
  }
}

function bindDeleteCommentActions(scope) {
  scope.querySelectorAll('.delete-comment').forEach((button) => button.addEventListener('click', () => {
    if (!requireLogin()) return;
    if (!canWrite()) { toast('只读成员不能删除评论', 'error'); return; }
    if (!confirm('确认删除这条评论？')) return;
    api(`/api/comments/${button.dataset.commentId}`, { method: 'DELETE' }).then(() => { refreshIdeas(); toast('评论已删除', 'success'); }).catch((error) => { serverState.textContent = error.message; });
  }));
}

function patchCommentsIntoCard(post, ideas) {
  const id = Number(post.dataset.ideaId);
  const fresh = (ideas || []).find((idea) => idea.id === id);
  if (!fresh) { refreshIdeas(); return; }
  const index = allIdeas.findIndex((idea) => idea.id === id);
  if (index >= 0) allIdeas[index] = Object.assign({}, allIdeas[index], fresh);
  const list = post.querySelector('.comment-list');
  if (list) {
    list.innerHTML = (fresh.comment_items || []).map(renderCommentItem).join('');
    bindDeleteCommentActions(list);
  }
  const count = post.querySelector('.comment-toggle b');
  if (count) count.textContent = `${fresh.comments || 0} 条评论`;
}

function ensureCommentComposer(post) {
  let form = post.querySelector('.comment-form');
  if (form) return form;
  const comments = post.querySelector('.comment-list');
  if (!comments) return null;
  comments.insertAdjacentHTML('afterend', '<form class="comment-form"><input placeholder="以实名 ID 评论..." required><button type="submit">发送</button></form>');
  form = post.querySelector('.comment-form');
  const input = form.querySelector('input');
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!requireLogin()) return;
    if (!canWrite()) { toast('只读成员不能评论', 'error'); return; }
    const value = input.value.trim();
    if (!value) return;
    api(`/api/ideas/${post.dataset.ideaId}/comments`, { method: 'POST', body: JSON.stringify({ content: value }) }).then((data) => {
      input.value = '';
      patchCommentsIntoCard(post, data.ideas);
      toast('评论已发布', 'success');
    }).catch((error) => { serverState.textContent = error.message; });
  });
  return form;
}

function reopenExpandedComments() {
  if (!expandedIdeaIds.size) return;
  ideaFeed.querySelectorAll('.idea-post').forEach((post) => {
    if (expandedIdeaIds.has(Number(post.dataset.ideaId))) {
      const list = post.querySelector('.comment-list');
      if (list) list.classList.add('visible');
      ensureCommentComposer(post);
    }
  });
}

function bindIdeaActions(root = ideaFeed) {
  root.querySelectorAll('.delete-idea').forEach((button) => button.addEventListener('click', () => {
    if (!requireLogin()) return;
    if (!canWrite()) { toast('只读成员不能删除动态', 'error'); return; }
    if (!confirm('确认删除这条动态？此操作无法撤销。')) return;
    const post = button.closest('.idea-post');
    api(`/api/ideas/${post.dataset.ideaId}`, { method: 'DELETE' }).then(() => { refreshIdeas(); refreshOverview(); toast('动态已删除', 'success'); }).catch((error) => { serverState.textContent = error.message; });
  }));
  bindDeleteCommentActions(root);
  root.querySelectorAll('.like-button').forEach((button) => button.addEventListener('click', () => {
    if (!requireLogin()) return;
    if (!canWrite()) { serverState.textContent = '只读成员不能点赞'; return; }
    const post = button.closest('.idea-post');
    const wasLiked = button.classList.contains('liked');
    const countEl = button.querySelector('b');
    const previous = Number((countEl && countEl.textContent) || 0);
    const sign = button.querySelector('span');
    // 乐观更新
    button.classList.toggle('liked', !wasLiked);
    if (sign) sign.textContent = !wasLiked ? '♥' : '♡';
    if (countEl) countEl.textContent = String(wasLiked ? Math.max(0, previous - 1) : previous + 1);
    button.classList.remove('pop');
    void button.offsetWidth;
    button.classList.add('pop');
    api(`/api/ideas/${post.dataset.ideaId}/like`, { method: 'POST', body: '{}' }).then((data) => applyIdeaLikePatch(post, data.ideas)).catch((error) => {
      button.classList.toggle('liked', wasLiked);
      if (sign) sign.textContent = wasLiked ? '♥' : '♡';
      if (countEl) countEl.textContent = String(previous);
      serverState.textContent = error.message;
    });
  }));
  root.querySelectorAll('.comment-toggle').forEach((button) => button.addEventListener('click', () => {
    const post = button.closest('.idea-post');
    const id = Number(post.dataset.ideaId);
    const comments = post.querySelector('.comment-list');
    const show = !comments.classList.contains('visible');
    comments.classList.toggle('visible', show);
    if (show) {
      expandedIdeaIds.add(id);
      ensureCommentComposer(post);
    } else {
      expandedIdeaIds.delete(id);
    }
  }));
}

function compressImageFile(file, maxDimension, quality = 0.85) {
  // 非可压缩图片（gif/svg/未知）直接按原样读取
  return new Promise((resolve, reject) => {
    const type = (file.type || '').toLowerCase();
    const compressible = type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
    if (!type.startsWith('image/') || type === 'image/gif' || type === 'image/svg+xml' || !compressible) {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result));
      reader.addEventListener('error', () => reject(new Error('读取图片失败')));
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const image = new Image();
      image.addEventListener('load', () => {
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(image, 0, 0, width, height);
        const encode = (mime) => new Promise((done) => canvas.toBlob(done, mime, quality));
        const original = reader.result;
        encode(type).then((blob) => {
          if (!blob && type !== 'image/jpeg') return encode('image/jpeg');
          return blob;
        }).then((blob) => {
          if (!blob) throw new Error('图片处理失败');
          const output = new FileReader();
          output.addEventListener('load', () => resolve(output.result.length < original.length ? output.result : original));
          output.addEventListener('error', () => reject(new Error('图片处理失败')));
          output.readAsDataURL(blob);
        }).catch(reject);
      });
      image.addEventListener('error', () => reject(new Error('图片解析失败')));
      image.src = reader.result;
    });
    reader.addEventListener('error', () => reject(new Error('读取图片失败')));
    reader.readAsDataURL(file);
  });
}

if (ideaImage) {
  ideaImage.addEventListener('change', () => {
    const file = ideaImage.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { serverState.textContent = '请选择图片文件'; return; }
    if (file.size > 5 * 1024 * 1024) { serverState.textContent = '图片不能超过 5 MB'; return; }
    compressImageFile(file, 1600, 0.85).then((dataUrl) => {
      pendingImage = dataUrl;
      composerPreview.innerHTML = `<img src="${pendingImage}" alt="待发布图片预览">`;
      composerPreview.style.display = 'block';
    }).catch((error) => { serverState.textContent = error.message; });
  });
}

if (ideaForm) {
  ideaForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!requireLogin()) return;
    if (!canWrite()) { serverState.textContent = '只读成员不能发布动态'; return; }
    const content = document.querySelector('#idea-content').value.trim();
    if (!content) return;
    const ideaType = document.querySelector('input[name="idea-type"]:checked').value;
    api('/api/ideas', { method: 'POST', body: JSON.stringify({ content, image: pendingImage, idea_type: ideaType }) }).then(() => {
      refreshIdeas();
      refreshOverview();
      document.querySelector('#idea-content').value = '';
      pendingImage = '';
      composerPreview.innerHTML = '';
      composerPreview.style.display = 'none';
      toast('动态已发布', 'success');
    }).catch((error) => { serverState.textContent = error.message; });
  });
  const ideaContentInput = document.querySelector('#idea-content');
  ideaContentInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      ideaForm.requestSubmit();
    }
  });
}

document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => {
  authMode = button.dataset.authMode;
  document.querySelectorAll('[data-auth-mode]').forEach((item) => item.classList.toggle('active', item === button));
  registerFields.classList.toggle('visible', authMode === 'register');
  document.querySelector('#auth-title').textContent = authMode === 'register' ? '创建账号' : '账号登录';
  document.querySelector('#auth-description').textContent = authMode === 'register' ? '创建公开团队身份，注册后会自动显示在首页成员区。' : '使用名称 ID 和密码登录。发布内容会显示你的公开身份。';
  loginSubmit.firstChild.textContent = authMode === 'register' ? '创建并登录 ' : '登录并继续 ';
  accountPassword.autocomplete = authMode === 'register' ? 'new-password' : 'current-password';
  updateInviteFieldVisibility();
}));
registerBio.addEventListener('input', () => { document.querySelector('#bio-count').textContent = registerBio.value.length; });

loginSubmit.addEventListener('click', () => {
  const realId = realIdInput.value.trim();
  const password = accountPassword.value;
  if (!realId || !password) return;
  const path = authMode === 'register' ? '/api/register' : '/api/login';
  const inviteCodeInput = document.querySelector('#register-invite-code');
  api(path, { method: 'POST', body: JSON.stringify({ real_id: realId, password, bio: registerBio.value.trim(), invite_code: inviteCodeInput ? inviteCodeInput.value.trim() : '' }) }).then((data) => {
    setMember(data.member, data.token);
    loginDialog.close();
    refreshIdeas();
    refreshMembers();
    refreshOverview();
    connectRealtime();
    loadNotifications();
  }).catch((error) => { loginMessage.textContent = error.message; });
});
loginForm.addEventListener('submit', (event) => { event.preventDefault(); loginSubmit.click(); });
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
loginOpenButton.addEventListener('click', () => { loginDialog.showModal(); realIdInput.focus(); });
logoutButton.addEventListener('click', () => {
  api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {}).finally(() => {
    clearAuth();
    serverState.textContent = '未登录';
    loginMessage.textContent = '已退出登录';
    disconnectRealtime();
    notificationUnread = 0;
    renderNotifyBadge();
    const notifyList = document.querySelector('#notify-list');
    if (notifyList) notifyList.innerHTML = '';
    const notifyPanel = document.querySelector('#notify-panel');
    if (notifyPanel) notifyPanel.hidden = true;
    refreshIdeas();
    refreshMembers();
    refreshOverview();
  });
});
if (currentMember && sessionToken) setMember(currentMember, sessionToken);
refreshIdeas();
refreshMembers();
refreshProject();
refreshOverview();
if (sessionToken) {
  connectRealtime();
  loadNotifications();
}

['filter-member', 'filter-time', 'filter-type'].forEach((id) => document.querySelector(`#${id}`).addEventListener('change', applyIdeaFilters));
const ideaSearchInput = document.querySelector('#idea-search');
if (ideaSearchInput) ideaSearchInput.addEventListener('input', () => { ideaSearch = ideaSearchInput.value; applyIdeaFilters(); });
document.querySelector('#idea-load-more')?.addEventListener('click', loadMoreIdeas);
document.querySelector('#clear-filters').addEventListener('click', () => {
  document.querySelector('#filter-member').value = 'all';
  document.querySelector('#filter-time').value = 'all';
  document.querySelector('#filter-type').value = 'all';
  if (ideaSearchInput) { ideaSearchInput.value = ''; ideaSearch = ''; }
  applyIdeaFilters();
});
if (sessionToken) {
  api('/api/session').then((data) => {
    if (data.member) setMember(data.member, sessionToken);
    else clearAuth();
  }).catch(() => {
    clearAuth();
    serverState.textContent = '请重新登录';
  });
}

document.querySelector('[data-open-profile]').addEventListener('click', () => {
  if (!requireLogin()) return;
  pendingAvatar = currentMember.avatar || '';
  profileBio.value = currentMember.bio || '';
  document.querySelector('#avatar-input').value = '';
  profileMessage.textContent = '建议使用正方形图片，最大 2 MB';
  profileAvatarPreview.innerHTML = pendingAvatar ? `<img src="${escapeHtml(pendingAvatar)}" alt="当前头像">` : '';
  profileAvatarPreview.classList.toggle('avatar-placeholder', !pendingAvatar);
  profileDialog.showModal();
});
document.querySelector('#avatar-input').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { profileMessage.textContent = '请选择图片文件'; return; }
  if (file.size > 2 * 1024 * 1024) { profileMessage.textContent = '头像不能超过 2 MB'; return; }
  compressImageFile(file, 512, 0.85).then((dataUrl) => {
    pendingAvatar = dataUrl;
    profileAvatarPreview.classList.remove('avatar-placeholder');
    profileAvatarPreview.classList.add('custom-avatar');
    profileAvatarPreview.innerHTML = `<img src="${pendingAvatar}" alt="新头像预览">`;
    profileMessage.textContent = '头像已选择，点击下方按钮保存';
  }).catch((error) => { profileMessage.textContent = error.message; });
});
document.querySelector('#profile-save').addEventListener('click', () => {
  if (!requireLogin()) return;
  const saveButton = document.querySelector('#profile-save');
  saveButton.disabled = true;
  profileMessage.textContent = '正在保存个人资料...';
  api('/api/profile', { method: 'POST', body: JSON.stringify({ avatar: pendingAvatar, bio: profileBio.value.trim() }) }).then((data) => {
    setMember(data.member, sessionToken);
    return Promise.all([refreshMembers(), refreshIdeas()]);
  }).then(() => {
    profileMessage.textContent = '个人资料已保存';
    setTimeout(() => profileDialog.close(), 350);
  }).catch((error) => {
    profileMessage.textContent = error.message;
    if (error.message.includes('实名 ID')) loginDialog.showModal();
  }).finally(() => { saveButton.disabled = false; });
});

let pendingInviteRotate = false;

function updateInviteFieldVisibility() {
  const field = document.querySelector('#invite-field');
  if (field) field.hidden = !(currentProject.require_invite && authMode === 'register');
}

document.querySelector('[data-open-project-settings]').addEventListener('click', () => {
  if (!requireLogin()) return;
  if (!canWrite()) { saveState.textContent = '只读成员不能修改项目设置'; return; }
  pendingProjectIcon = currentProject.icon || '';
  projectNameInput.value = currentProject.name || '';
  projectIconInput.value = '';
  projectIconPreview.innerHTML = pendingProjectIcon ? `<img src="${escapeHtml(pendingProjectIcon)}" alt="当前项目图标">` : '◇';
  projectIconPreview.classList.toggle('has-image', Boolean(pendingProjectIcon));
  const isAdminUser = currentMember && currentMember.role === 'admin';
  const inviteSettings = document.querySelector('#invite-settings');
  const enableInput = document.querySelector('#project-invite-enable');
  if (inviteSettings) inviteSettings.hidden = !isAdminUser;
  if (enableInput) enableInput.checked = Boolean(currentProject.require_invite);
  pendingInviteRotate = false;
  const codeRow = document.querySelector('#invite-code-row');
  const codeEl = document.querySelector('#project-invite-code');
  if (codeRow && codeEl) {
    codeRow.hidden = !(isAdminUser && currentProject.require_invite && currentProject.invite_code);
    codeEl.textContent = currentProject.invite_code || '';
  }
  projectSettingsMessage.textContent = currentProject.name ? '修改后将同步给所有成员' : '请设置项目名称和图标';
  projectSettingsDialog.showModal();
  projectNameInput.focus();
});
projectIconInput.addEventListener('change', () => {
  const file = projectIconInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { projectSettingsMessage.textContent = '请选择图片文件'; return; }
  if (file.size > 3 * 1024 * 1024) { projectSettingsMessage.textContent = '项目图标不能超过 3 MB'; return; }
  compressImageFile(file, 512, 0.85).then((dataUrl) => {
    pendingProjectIcon = dataUrl;
    projectIconPreview.innerHTML = `<img src="${pendingProjectIcon}" alt="新项目图标预览">`;
    projectIconPreview.classList.add('has-image');
    projectSettingsMessage.textContent = '图标已选择，点击下方按钮保存';
  }).catch((error) => { projectSettingsMessage.textContent = error.message; });
});
document.querySelector('#save-project-settings').addEventListener('click', () => {
  const name = projectNameInput.value.trim();
  if (!name) { projectSettingsMessage.textContent = '请输入项目名称'; return; }
  const button = document.querySelector('#save-project-settings');
  button.disabled = true;
  projectSettingsMessage.textContent = '正在保存项目设置...';
  const requireInvite = Boolean(document.querySelector('#project-invite-enable') && document.querySelector('#project-invite-enable').checked);
  api('/api/project', { method: 'POST', body: JSON.stringify({ name, icon: pendingProjectIcon, require_invite: requireInvite, rotate_code: pendingInviteRotate }) }).then((data) => {
    applyProject(data.project);
    projectSettingsMessage.textContent = '项目设置已保存';
    setTimeout(() => projectSettingsDialog.close(), 350);
  }).catch((error) => { projectSettingsMessage.textContent = error.message; }).finally(() => { button.disabled = false; });
});
document.querySelector('#project-settings-form').addEventListener('submit', (event) => { event.preventDefault(); document.querySelector('#save-project-settings').click(); });
document.querySelector('#project-invite-enable').addEventListener('change', (event) => {
  const row = document.querySelector('#invite-code-row');
  if (row) {
    if (!event.target.checked) row.hidden = true;
    else if (currentProject.invite_code) {
      document.querySelector('#project-invite-code').textContent = currentProject.invite_code;
      row.hidden = false;
    } else {
      row.hidden = true;
      pendingInviteRotate = true;
    }
  }
});
document.querySelector('#project-invite-rotate').addEventListener('click', () => {
  pendingInviteRotate = true;
  document.querySelector('#project-invite-code').textContent = '将在保存时生成新码…';
  projectSettingsMessage.textContent = '已标记重新生成，点击保存生效';
});
document.querySelector('#project-invite-copy').addEventListener('click', () => {
  const code = document.querySelector('#project-invite-code').textContent || '';
  navigator.clipboard && navigator.clipboard.writeText(code).then(() => { projectSettingsMessage.textContent = '邀请码已复制'; }).catch(() => {});
});

/* ---- 素材资产 ---- */
const assetCategoryLabels = { visual: '视觉', audio: '音频', build: '构建', other: '其他' };
const assetGrid = document.querySelector('#asset-grid');
let currentAssetCategory = 'all';

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(new Error('读取文件失败')));
    reader.readAsDataURL(file);
  });
}

function guessAssetCategory(file) {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (type.startsWith('image/')) return 'visual';
  if (type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|mid|midi|aac|m4a)$/.test(name)) return 'audio';
  return 'build';
}

function assetPreviewMarkup(asset) {
  const mime = (asset.mime || '').toLowerCase();
  if (mime.startsWith('image/')) {
    return `<div class="asset-preview asset-preview-image"><img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.filename)}" loading="lazy"></div>`;
  }
  if (mime.startsWith('audio/')) {
    return `<div class="asset-preview asset-preview-audio"><span>♪</span><audio controls preload="none" src="${escapeHtml(asset.url)}"></audio></div>`;
  }
  const icon = { visual: '▧', audio: '♪', build: '⬇', other: '▤' }[asset.category] || '▤';
  const ext = asset.filename.split('.').pop().toUpperCase();
  return `<div class="asset-preview asset-preview-generic"><span>${icon}</span><small>${escapeHtml(ext || 'FILE')}</small></div>`;
}

function renderAssets(assets, total) {
  document.querySelector('#asset-total').textContent = `共 ${total} 个资产`;
  if (!assets || !assets.length) {
    assetGrid.innerHTML = '<div class="asset-empty"><span>EMPTY LIBRARY</span><h3>还没有素材资产</h3><p>登录后点击「上传资产」，把视觉稿、音频与构建包放进团队库。</p></div>';
    return;
  }
  assetGrid.innerHTML = assets.map((asset) => {
    const owned = currentMember && Number(asset.author_id) === Number(currentMember.id);
    const deleteButton = owned ? `<button type="button" class="asset-delete">删除</button>` : '';
    return `<article class="asset-card" data-asset-id="${asset.id}">${assetPreviewMarkup(asset)}<div class="asset-info"><strong title="${escapeHtml(asset.filename)}">${escapeHtml(asset.filename)}</strong><span>${assetCategoryLabels[asset.category] || asset.category} · ${formatBytes(asset.size)}</span><small>${escapeHtml(asset.author)} · ${formatDocumentTime(asset.created_at)}</small><div class="asset-actions"><a class="asset-download" href="${escapeHtml(asset.url)}" download="${escapeHtml(asset.filename)}">下载</a>${deleteButton}</div></div></article>`;
  }).join('');
  assetGrid.querySelectorAll('.asset-delete').forEach((button) => button.addEventListener('click', () => deleteAsset(Number(button.closest('.asset-card').dataset.assetId))));
}

function loadAssets() {
  const url = currentAssetCategory === 'all' ? '/api/assets' : `/api/assets?category=${encodeURIComponent(currentAssetCategory)}`;
  return api(url).then((data) => renderAssets(data.assets, data.total)).catch(() => {});
}

function deleteAsset(assetId) {
  if (!requireLogin()) return;
  if (!canWrite()) { serverState.textContent = '只读成员不能删除素材'; return; }
  if (!confirm('确认删除该素材？文件会从服务器移除，此操作无法撤销。')) return;
  api(`/api/assets/${assetId}`, { method: 'DELETE' }).then(() => { loadAssets(); refreshOverview(); }).catch((error) => { serverState.textContent = error.message; });
}

async function uploadAssets(files) {
  if (!files || !files.length) return;
  if (!requireLogin()) return;
  const uploadState = document.querySelector('#asset-upload-state');
  if (!canWrite()) { uploadState.textContent = '只读成员不能上传素材'; return; }
  let ok = 0;
  let failed = 0;
  uploadState.textContent = `上传中 0/${files.length}`;
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    uploadState.textContent = `上传中 ${i + 1}/${files.length}：${file.name}`;
    try {
      const dataUrl = await fileToDataURL(file);
      await api('/api/assets', { method: 'POST', body: JSON.stringify({ filename: file.name, category: guessAssetCategory(file), data: dataUrl }) });
      ok += 1;
    } catch (error) {
      failed += 1;
      console.warn('资产上传失败：', file.name, error);
    }
  }
  uploadState.textContent = failed ? `完成：成功 ${ok} 个，失败 ${failed} 个` : `完成：已上传 ${ok} 个资产`;
  toast(failed ? `上传完成：成功 ${ok} 个，失败 ${failed} 个` : `已上传 ${ok} 个资产`, failed ? 'error' : 'success');
  setTimeout(() => { uploadState.textContent = ''; }, 4000);
  await loadAssets();
  refreshOverview();
}

document.querySelectorAll('.asset-filters button').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.asset-filters button').forEach((item) => item.classList.remove('selected'));
  button.classList.add('selected');
  currentAssetCategory = button.dataset.assetCategory || 'all';
  loadAssets();
}));
const assetUpload = document.querySelector('#asset-upload');
document.querySelector('[data-trigger-upload]')?.addEventListener('click', () => {
  if (!requireLogin()) return;
  assetUpload.click();
});
assetUpload?.addEventListener('change', () => {
  uploadAssets(Array.from(assetUpload.files || []));
  assetUpload.value = '';
});
loadAssets();

const newDocumentDialog = document.querySelector('#new-document-dialog');
const documentTitleInput = document.querySelector('#document-title-input');
const documentCreateMessage = document.querySelector('#document-create-message');
let pendingDocumentCategory = 'planning';
let activeDocument = null;
let activeDocumentEditor = null;
let documentSaveTimer;

function documentCategoryLabel(category) {
  return category === 'environment' ? '环境安装指南' : '策划文档';
}

function formatDocumentTime(value) {
  if (!value) return '未知时间';
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const documentCache = { planning: [], environment: [] };

function renderDocumentList(category, documents) {
  const list = document.querySelector(`[data-document-list="${category}"]`);
  const keywordInput = document.querySelector(`[data-doc-search="${category}"]`);
  const keyword = (keywordInput ? keywordInput.value : '').trim().toLowerCase();
  const filtered = documents.filter((document) => !keyword
    || document.title.toLowerCase().includes(keyword)
    || (document.author || '').toLowerCase().includes(keyword)
    || (document.updated_by || '').toLowerCase().includes(keyword));
  if (!documents.length) {
    list.innerHTML = `<div class="document-empty">还没有${documentCategoryLabel(category)}</div>`;
    return;
  }
  if (!filtered.length) {
    list.innerHTML = '<div class="document-empty">没有匹配的文档，换个关键词试试。</div>';
    return;
  }
  list.innerHTML = filtered.map((document) => `<button class="document-card" type="button" data-document-id="${document.id}" data-category="${category}"><span class="document-icon">▤</span><div><strong>${escapeHtml(document.title)}</strong><p>作者 ${escapeHtml(document.author)} · 最后由 ${escapeHtml(document.updated_by)} 修改</p><small>${formatDocumentTime(document.updated_at)} · ${document.history_count} 条记录</small></div><b>→</b></button>`).join('');
  list.querySelectorAll('[data-document-id]').forEach((button) => button.addEventListener('click', () => openDocument(Number(button.dataset.documentId), button.dataset.category)));
}

function loadDocuments(category) {
  api(`/api/documents?category=${category}`).then((data) => {
    documentCache[category] = data.documents;
    renderDocumentList(category, data.documents);
  }).catch(() => {});
}

document.querySelectorAll('[data-doc-search]').forEach((input) => input.addEventListener('input', () => {
  const category = input.dataset.docSearch;
  renderDocumentList(category, documentCache[category] || []);
}));

function openDocument(id, category) {
  api(`/api/documents/${id}`).then((data) => {
    activeDocument = data.document;
    activeDocRevision = data.document.revision != null ? Number(data.document.revision) : null;
    docConflict = false;
    hideDocConflict();
    const panel = document.querySelector(`[data-view-panel="${category === 'environment' ? 'environment' : 'document'}"]`);
    panel.querySelector('.document-library').hidden = true;
    const editorShell = panel.querySelector('.document-editor');
    editorShell.hidden = false;
    activeDocumentEditor = editorShell.querySelector('.editor-page');
    activeDocumentEditor.contentEditable = canWrite() ? 'true' : 'false';
    activeDocumentEditor.innerHTML = `<h1>${escapeHtml(data.document.title)}</h1>${data.document.content || '<p>点击这里开始编辑。</p>'}`;
    renderDocumentHistory(editorShell, data.history);
  }).catch((error) => { saveState.textContent = error.message; });
}

function renderDocumentHistory(shell, history) {
  const list = shell.querySelector('.document-history-list') || shell.querySelector('#document-history-list');
  if (!history || !history.length) {
    list.innerHTML = '<p>暂无修改记录</p>';
    return;
  }
  list.innerHTML = history.map((item, index) => {
    const diffLabel = index === 0 ? '查看本次修改' : '差异对比';
    return `<div class="revision-entry"><strong>${escapeHtml(item.real_id)}</strong><span>${escapeHtml(item.action)}</span><small>${formatDocumentTime(item.created_at)}</small><span class="revision-actions"><button type="button" data-revision-diff="${item.id}">${diffLabel}</button><button type="button" data-revision-restore="${item.id}">恢复此版本</button></span></div>`;
  }).join('');
  list.querySelectorAll('[data-revision-diff]').forEach((button) => button.addEventListener('click', () => showRevisionDiff(shell, Number(button.dataset.revisionDiff))));
  list.querySelectorAll('[data-revision-restore]').forEach((button) => button.addEventListener('click', () => restoreRevision(shell, Number(button.dataset.revisionRestore))));
}

function showRevisionDiff(shell, historyId) {
  if (!activeDocument) return;
  clearTimeout(documentSaveTimer);
  const list = shell.querySelector('.document-history-list') || shell.querySelector('#document-history-list');
  const historyBox = list.closest('.document-history') || shell;
  let panel = historyBox.querySelector('.revision-diff');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'revision-diff';
    historyBox.appendChild(panel);
  }
  panel.hidden = false;
  panel.innerHTML = '<p class="rd-loading">正在计算差异…</p>';
  api(`/api/documents/${activeDocument.id}/revisions/${historyId}/diff`).then((data) => {
    const head = `<div class="rd-head"><b>${escapeHtml(data.member)} · ${escapeHtml(data.action)}</b><span>${formatDocumentTime(data.created_at)} · +${data.added} / −${data.removed}</span><button type="button" class="rd-close">收起</button></div>`;
    let body;
    if (data.empty) {
      body = '<p class="rd-note">这是文档创建时的初始版本，没有上一版可比对。</p>';
    } else {
      const titleNote = data.old_title !== data.new_title ? `<p class="rd-note">标题由「${escapeHtml(data.old_title || '（空）')}」改为「${escapeHtml(data.new_title || '（空）')}」</p>` : '';
      const lines = (data.ops || []).map((op) => {
        const kind = op[0];
        const sign = kind === 'add' ? '+' : kind === 'del' ? '−' : ' ';
        return `<div class="rd-line rd-${kind}"><span>${sign}</span><code>${escapeHtml(op[1])}</code></div>`;
      }).join('');
      body = `${titleNote}<div class="rd-body">${lines || '<p class="rd-note">两个版本内容一致。</p>'}</div>`;
    }
    panel.innerHTML = head + body;
    panel.querySelector('.rd-close')?.addEventListener('click', () => { panel.hidden = true; });
  }).catch((error) => {
    panel.innerHTML = `<p class="rd-loading">${escapeHtml(error.message)}</p>`;
  });
}

function restoreRevision(shell, historyId) {
  if (!activeDocument) return;
  if (!requireLogin()) return;
  if (!canWrite()) { saveState.textContent = '只读成员不能恢复版本'; return; }
  if (!confirm('恢复到此版本？文档内容将被该版本的快照覆盖，未保存的修改会丢失。')) return;
  clearTimeout(documentSaveTimer);
  api(`/api/documents/${activeDocument.id}/rollback`, { method: 'POST', body: JSON.stringify({ history_id: historyId }) }).then(() => {
    openDocument(activeDocument.id, activeDocument.category);
    refreshOverview();
  }).catch((error) => { saveState.textContent = error.message; });
}

function documentPanelFor(category) {
  return document.querySelector(`[data-view-panel="${category === 'environment' ? 'environment' : 'document'}"]`);
}

function leaveDocumentEditor(category) {
  clearTimeout(documentSaveTimer);
  const panel = documentPanelFor(category || 'planning');
  if (panel) {
    panel.querySelector('.document-editor').hidden = true;
    panel.querySelector('.document-library').hidden = false;
  }
  activeDocument = null;
  activeDocumentEditor = null;
  activeDocRevision = null;
  docConflict = false;
  hideDocConflict();
  loadDocuments(category || 'planning');
}

function duplicateActiveDocument() {
  if (!activeDocument) return;
  if (!requireLogin()) return;
  if (!canWrite()) { saveState.textContent = '只读成员不能复制文档'; return; }
  const category = activeDocument.category;
  api(`/api/documents/${activeDocument.id}/duplicate`, { method: 'POST', body: '{}' }).then((data) => {
    saveState.textContent = '已创建副本';
    toast('已创建副本并打开', 'success');
    openDocument(data.id, category);
  }).catch((error) => { saveState.textContent = error.message; });
}

function exportActiveDocument() {
  if (!activeDocument) return;
  api(`/api/documents/${activeDocument.id}/export`).then((data) => {
    const name = (data.title || 'document').replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([`${data.title || ''}\n\n${data.text || ''}`], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${name}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    saveState.textContent = '已导出 TXT';
    toast('已导出 TXT 文件', 'success');
  }).catch((error) => { saveState.textContent = error.message; });
}

function deleteActiveDocument() {
  if (!activeDocument) return;
  if (!requireLogin()) return;
  if (!canWrite()) { saveState.textContent = '只读成员不能删除文档'; return; }
  if (!confirm(`确认删除文档「${activeDocument.title}」？修改历史会一并删除，此操作无法撤销。`)) return;
  clearTimeout(documentSaveTimer);
  const category = activeDocument.category;
  api(`/api/documents/${activeDocument.id}`, { method: 'DELETE' }).then(() => {
    saveState.textContent = '文档已删除';
    toast('文档已删除', 'success');
    leaveDocumentEditor(category);
    refreshOverview();
  }).catch((error) => { saveState.textContent = error.message; });
}

document.querySelectorAll('[data-doc-duplicate]').forEach((button) => button.addEventListener('click', duplicateActiveDocument));
document.querySelectorAll('[data-doc-export]').forEach((button) => button.addEventListener('click', exportActiveDocument));
document.querySelectorAll('[data-doc-delete]').forEach((button) => button.addEventListener('click', deleteActiveDocument));

function saveActiveDocument(options = {}) {
  if (!activeDocument || !activeDocumentEditor || !canWrite()) return;
  const titleNode = activeDocumentEditor.querySelector('h1');
  const title = titleNode?.textContent.trim() || activeDocument.title;
  const clone = activeDocumentEditor.cloneNode(true);
  clone.querySelector('h1')?.remove();
  const state = activeDocumentEditor.closest('.document-editor').querySelector('.document-save-state') || document.querySelector('#document-save-state');
  state.textContent = '正在保存...';
  const body = { title, content: clone.innerHTML };
  if (options.force) {
    body.force = true;
  } else {
    body.base_revision = activeDocRevision || null;
  }
  api(`/api/documents/${activeDocument.id}`, { method: 'PUT', body: JSON.stringify(body) }).then((data) => {
    activeDocRevision = data.revision != null ? Number(data.revision) : activeDocRevision;
    docConflict = false;
    hideDocConflict();
    state.textContent = `已保存 · ${currentMember.real_id}`;
  }).catch((error) => {
    if (error.status === 409) {
      docConflict = true;
      showDocConflict('保存冲突：文档已被其他成员修改。选择「载入最新版本」或「以我的版本保存」。', true);
      state.textContent = '保存冲突，待处理';
    } else {
      state.textContent = error.message;
    }
  });
}

document.querySelectorAll('.editor-page').forEach((documentEditor) => documentEditor.addEventListener('input', () => {
  if (docConflict) return;
  clearTimeout(documentSaveTimer);
  documentSaveTimer = setTimeout(() => saveActiveDocument(), 900);
}));
document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => {
  if (!activeDocumentEditor) return;
  document.execCommand(button.dataset.command, false, button.dataset.value || null);
  activeDocumentEditor.focus();
  setTimeout(updateEditorFormatButtons, 0);
}));
document.querySelector('[data-share]')?.addEventListener('click', () => {
  const url = window.location.href;
  const done = () => toast('已复制当前页面链接，发给队友即可打开工作台', 'success');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
  } else {
    fallbackCopy(url, done);
  }
});
function fallbackCopy(text, done) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
    done();
  } catch (error) {
    toast('复制失败，请手动复制地址栏链接', 'error');
  }
  area.remove();
}

/* ---- 编辑器快捷键与格式状态 ---- */
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 's' && activeDocument && activeDocumentEditor && canWrite() && !docConflict) {
    event.preventDefault();
    clearTimeout(documentSaveTimer);
    saveActiveDocument();
  }
});
const editorFormatCommands = ['bold', 'italic', 'insertUnorderedList'];
function updateEditorFormatButtons() {
  const editor = activeDocumentEditor;
  if (!editor) return;
  const shell = editor.closest('.document-editor');
  if (!shell) return;
  shell.querySelectorAll('[data-command]').forEach((button) => {
    const command = button.dataset.command;
    const value = button.dataset.value || '';
    let active = false;
    try {
      if (command === 'formatBlock' && value.startsWith('h')) {
        const current = String(document.queryCommandValue('formatBlock') || '').replace(/[<>]/g, '').toLowerCase();
        active = current === value || current === `h${value.slice(1)}`;
      } else if (command === 'bold' || command === 'italic' || command === 'insertUnorderedList') {
        active = document.queryCommandState(command);
      }
    } catch (error) {
      active = false;
    }
    button.classList.toggle('active', active);
  });
}
document.addEventListener('selectionchange', () => {
  if (activeDocumentEditor && document.activeElement && document.activeElement.isContentEditable) updateEditorFormatButtons();
});
let savedDocRange = null;
document.addEventListener('selectionchange', () => {
  if (!activeDocumentEditor) return;
  const sel = document.getSelection();
  if (sel && sel.rangeCount && sel.anchorNode && activeDocumentEditor.contains(sel.anchorNode) && sel.focusNode && activeDocumentEditor.contains(sel.focusNode)) {
    savedDocRange = sel.getRangeAt(0).cloneRange();
  }
});
const docImageInput = document.querySelector('#doc-image-input');

function insertImageIntoEditor(url, alt) {
  if (!activeDocumentEditor) return;
  activeDocumentEditor.focus();
  const sel = document.getSelection();
  let range = null;
  if (savedDocRange && savedDocRange.startContainer && savedDocRange.startContainer.isConnected) {
    range = savedDocRange;
  } else if (activeDocumentEditor.firstChild) {
    range = document.createRange();
    range.selectNodeContents(activeDocumentEditor);
    range.collapse(false);
  } else {
    activeDocumentEditor.innerHTML = '<p></p>';
    range = document.createRange();
    range.selectNodeContents(activeDocumentEditor);
    range.collapse(false);
  }
  if (sel) sel.removeAllRanges();
  range.deleteContents();
  const img = document.createElement('img');
  img.src = url;
  if (alt) img.alt = alt;
  range.insertNode(img);
  range.setStartAfter(img);
  range.collapse(true);
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  savedDocRange = range.cloneRange();
  activeDocumentEditor.dispatchEvent(new Event('input', { bubbles: true }));
}

document.querySelectorAll('[data-doc-image]').forEach((button) => button.addEventListener('click', () => {
  if (!canWrite()) { saveState.textContent = '只读成员不能编辑文档'; return; }
  if (!activeDocumentEditor) return;
  docImageInput.value = '';
  docImageInput.click();
}));
if (docImageInput) {
  docImageInput.addEventListener('change', async () => {
    const file = docImageInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { saveState.textContent = '请选择图片文件'; return; }
    saveState.textContent = '图片处理中…';
    try {
      const dataUrl = await compressImageFile(file, 1600, 0.85);
      const data = await api('/api/docimages', { method: 'POST', body: JSON.stringify({ data: dataUrl }) });
      insertImageIntoEditor(data.url, file.name);
      saveState.textContent = '已插入图片，正在保存…';
    } catch (error) {
      saveState.textContent = error.message;
    }
  });
}
document.querySelectorAll('[data-back-documents]').forEach((button) => button.addEventListener('click', () => {
  const panel = button.closest('.workspace-view');
  const category = panel.dataset.viewPanel === 'environment' ? 'environment' : 'planning';
  if (docConflict && activeDocument) {
    window.alert('文档存在未解决的保存冲突，请先在冲突横幅中选择「载入最新版本」或「以我的版本保存」。');
    return;
  }
  clearTimeout(documentSaveTimer);
  saveActiveDocument();
  panel.querySelector('.document-editor').hidden = true;
  panel.querySelector('.document-library').hidden = false;
  activeDocument = null;
  activeDocumentEditor = null;
  loadDocuments(category);
}));
document.querySelectorAll('[data-new-document]').forEach((button) => button.addEventListener('click', () => {
  if (!requireLogin()) return;
  if (!canWrite()) { saveState.textContent = '只读成员不能新建文档'; return; }
  pendingDocumentCategory = button.dataset.newDocument;
  document.querySelector('#new-document-title').textContent = `新增${documentCategoryLabel(pendingDocumentCategory)}`;
  documentTitleInput.value = '';
  documentCreateMessage.textContent = '';
  newDocumentDialog.showModal();
  documentTitleInput.focus();
}));
document.querySelector('#create-document').addEventListener('click', () => {
  const title = documentTitleInput.value.trim();
  if (!title) { documentCreateMessage.textContent = '请输入文档标题'; return; }
  api('/api/documents', { method: 'POST', body: JSON.stringify({ title, category: pendingDocumentCategory }) }).then((data) => {
    newDocumentDialog.close();
    loadDocuments(pendingDocumentCategory);
    openDocument(data.id, pendingDocumentCategory);
    refreshOverview();
  }).catch((error) => { documentCreateMessage.textContent = error.message; });
});
document.querySelector('#new-document-form').addEventListener('submit', (event) => { event.preventDefault(); document.querySelector('#create-document').click(); });

function miniAvatarHTML(name, avatar) {
  const label = escapeHtml(name || '?');
  if (avatar) return `<span class="avatar-mini custom-avatar"><img src="${escapeHtml(avatar)}" alt="${label} 的头像"></span>`;
  return `<span class="avatar-mini avatar-placeholder" style="--hue:${nameHue(name)}">${escapeHtml((name || '?').slice(0, 1).toUpperCase())}</span>`;
}

function memberAvatarShell(member, wrapClass) {
  const name = member.real_id || member.name || '?';
  const label = escapeHtml(name);
  if (member.avatar) return `<div class="${wrapClass} custom-avatar"><img src="${escapeHtml(member.avatar)}" alt="${label} 的头像"></div>`;
  return `<div class="${wrapClass} avatar-placeholder" style="--hue:${nameHue(name)}"><span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span></div>`;
}

function refreshOverview() {
  return api('/api/overview').then(renderOverview).catch(() => {});
}

function openDocumentFromOverview(id, category) {
  clearTimeout(documentSaveTimer);
  switchView(category === 'environment' ? 'environment' : 'document');
  openDocument(id, category);
}

function renderOverview(data) {
  const counts = data.counts || {};
  const byStatus = data.tasks_by_status || {};
  const byType = data.tasks_by_type || {};
  const hours = data.hours || { total: 0, done: 0 };
  const projectName = (data.project && data.project.name) || '';
  document.querySelector('#workspace-greeting').textContent = projectName || '项目尚未启动';
  document.querySelector('#overview-subline').textContent = `${counts.members || 0} 位成员 · ${counts.tasks || 0} 个任务 · ${counts.documents || 0} 篇文档 · ${counts.ideas || 0} 条创意`;

  const totalTasks = counts.tasks || 0;
  const doneTasks = byStatus.done || 0;
  const percent = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const ring = document.querySelector('#overview-progress');
  ring.style.setProperty('--p', percent);
  ring.classList.toggle('empty', !totalTasks);
  document.querySelector('#overview-progress-num').textContent = totalTasks ? `${percent}%` : '--';
  document.querySelector('#overview-progress-label').textContent = totalTasks ? `${doneTasks}/${totalTasks} 已完成` : '暂无任务';

  const stats = [
    { label: 'MEMBERS', value: counts.members || 0, note: '团队成员' },
    { label: 'TASKS', value: counts.tasks || 0, note: `已完成 ${doneTasks}` },
    { label: 'DOCUMENTS', value: counts.documents || 0, note: '策划文档与环境指南' },
    { label: 'IDEAS', value: counts.ideas || 0, note: '创意中心信号' },
  ];
  document.querySelector('#overview-stats').innerHTML = stats.map((item) => `<article><span>${item.label}</span><strong>${item.value}</strong><small>${item.note}</small></article>`).join('');

  const statusMeta = [['todo', '待处理'], ['in_progress', '进行中'], ['review', '待评审'], ['done', '已完成']];
  const statusRows = statusMeta.map(([key, label]) => {
    const count = byStatus[key] || 0;
    const width = totalTasks ? Math.round((count / totalTasks) * 100) : 0;
    return `<div class="ov-board-row" data-jump-tasks title="打开看板"><span>${label}</span><div class="ov-board-track"><i style="width:${width}%"></i></div><b>${count}</b></div>`;
  }).join('');
  const hoursText = hours.total ? `总工时 ${hours.total}h · 已完成 ${hours.done}h` : '尚未估算工时';
  const typeText = ['planning', 'art', 'programming', 'audio', 'other'].map((key) => `${taskLabels[key]} ${byType[key] || 0}`).join(' · ');
  const boardBody = document.querySelector('#overview-board-body');
  boardBody.innerHTML = `<div class="ov-board-rows">${statusRows}</div><p class="ov-board-foot">${hoursText}<br>按类型：${typeText}</p>`;
  boardBody.querySelectorAll('[data-jump-tasks]').forEach((row) => row.addEventListener('click', () => switchView('tasks')));

  const ideas = (data.recent_ideas || []).slice(0, 5);
  const docs = (data.recent_documents || []).slice(0, 4);
  const recentTasks = (data.recent_tasks || []).slice(0, 4);
  const activity = document.querySelector('#overview-activity');
  const sections = [];
  if (ideas.length) {
    sections.push(`<li class="ov-group"><span>最近创意</span><b>${ideas.length}</b></li>`);
    ideas.forEach((item) => sections.push(`<li class="ov-item" data-jump-ideas>${miniAvatarHTML(item.name, item.avatar)}<div class="ov-item-body"><p><strong>${escapeHtml(item.name)}</strong>${relTimeMarkup(item.created_at, 'ov-item-time')}</p><p class="ov-item-text">${escapeHtml(item.content)}</p><small>${item.idea_type === 'concept' ? '概念创意' : '玩法创意'} · ♥ ${item.likes} · ${item.comments} 条评论</small></div></li>`));
  }
  if (docs.length) {
    sections.push(`<li class="ov-group"><span>最近文档</span><b>${docs.length}</b></li>`);
    docs.forEach((item) => sections.push(`<li class="ov-item" data-open-doc="${item.id}" data-doc-category="${item.category}"><span class="ov-icon">▤</span><div class="ov-item-body"><p><strong>${escapeHtml(item.title)}</strong>${relTimeMarkup(item.updated_at, 'ov-item-time')}</p><small>${item.category === 'environment' ? '环境安装指南' : '策划文档'} · ${escapeHtml(item.updated_by || item.author)} 最近修改</small></div></li>`));
  }
  if (recentTasks.length) {
    sections.push(`<li class="ov-group"><span>最近任务</span><b>${recentTasks.length}</b></li>`);
    recentTasks.forEach((item) => sections.push(`<li class="ov-item" data-jump-tasks><span class="ov-icon">✓</span><div class="ov-item-body"><p><strong>${escapeHtml(item.title)}</strong>${relTimeMarkup(item.updated_at, 'ov-item-time')}</p><small>${taskLabels[item.priority]}优先级 · ${taskLabels[item.task_type] || item.task_type} · ${escapeHtml(item.assignee || '未指派')}</small></div></li>`));
  }
  activity.innerHTML = sections.join('') || '';
  document.querySelector('#overview-activity-empty').hidden = Boolean(sections.length);
  document.querySelector('#overview-empty-state').hidden = Boolean(counts.members || counts.tasks || counts.documents || counts.ideas);
  activity.querySelectorAll('[data-jump-ideas]').forEach((row) => row.addEventListener('click', () => switchView('ideas')));
  activity.querySelectorAll('[data-open-doc]').forEach((row) => row.addEventListener('click', () => openDocumentFromOverview(Number(row.dataset.openDoc), row.dataset.docCategory)));
  activity.querySelectorAll('[data-jump-tasks]').forEach((row) => row.addEventListener('click', () => switchView('tasks')));
}

const taskLabels = {
  planning: '策划', art: '美术', programming: '程序', audio: '音效', other: '其他',
  urgent: '紧急', high: '高', medium: '中', low: '低'
};

function renderTask(task) {
  const due = task.due_date ? `截止 ${escapeHtml(task.due_date)}` : '未设置截止时间';
  const hours = task.estimated_hours == null ? '未估时' : `预计 ${task.estimated_hours}h`;
  const assignee = task.assignee || '未指派';
  const avatar = task.assignee_avatar ? `<span class="task-avatar custom-avatar"><img src="${escapeHtml(task.assignee_avatar)}" alt="${escapeHtml(assignee)} 的头像"></span>` : '<span class="task-avatar avatar-placeholder"></span>';
  return `<article class="task-card" draggable="true" data-task-id="${task.id}" data-task-type="${task.task_type}" data-task-priority="${task.priority}" data-task-assignee="${escapeHtml(task.assignee || 'unassigned')}"><div class="task-card-top"><span class="task-type type-${task.task_type}">${taskLabels[task.task_type]}</span><span class="task-priority priority-${task.priority}">${taskLabels[task.priority]}</span></div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description || '暂无任务描述')}</p><div class="task-meta"><span>${hours}</span><span>${due}</span></div><div class="task-actions"><button class="task-edit" type="button">编辑</button><button class="task-delete" type="button">删除</button></div><footer><div>${avatar}<span><b>${escapeHtml(assignee)}</b><small>指派人</small></span></div><div><b>${escapeHtml(task.author)}</b><small>作者</small></div></footer></article>`;
}

function renderTasks(tasks) {
  document.querySelectorAll('[data-task-status]').forEach((section) => {
    const statusTasks = tasks.filter((task) => task.status === section.dataset.taskStatus);
    section.querySelector('header b').textContent = statusTasks.length;
    section.querySelector('.task-column').innerHTML = statusTasks.length ? statusTasks.map(renderTask).join('') : '<div class="column-empty">暂无任务</div>';
  });
  bindTaskDrag();
}

function loadTasks() {
  api('/api/tasks').then((data) => { allTasks = data.tasks; applyTaskFilters(); }).catch((error) => { saveState.textContent = error.message; });
}

function applyTaskFilters() {
  const type = document.querySelector('#task-filter-type').value;
  const assignee = document.querySelector('#task-filter-assignee').value;
  const priority = document.querySelector('#task-filter-priority').value;
  const searchInput = document.querySelector('#task-search');
  const keyword = (searchInput ? searchInput.value : '').trim().toLowerCase();
  renderTasks(allTasks.filter((task) =>
    (type === 'all' || task.task_type === type)
    && (assignee === 'all' || (assignee === 'unassigned' ? !task.assignee : task.assignee === assignee))
    && (priority === 'all' || task.priority === priority)
    && (!keyword || (task.title || '').toLowerCase().includes(keyword) || (task.description || '').toLowerCase().includes(keyword))
  ));
}

function bindTaskDrag() {
  document.querySelectorAll('.task-card').forEach((card) => {
    card.addEventListener('dragstart', () => card.classList.add('dragging'));
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  document.querySelectorAll('.task-card .task-edit').forEach((button) => {
    button.addEventListener('click', () => openEditTaskDialog(Number(button.closest('.task-card').dataset.taskId)));
  });
  document.querySelectorAll('.task-card .task-delete').forEach((button) => {
    button.addEventListener('click', () => deleteTask(Number(button.closest('.task-card').dataset.taskId)));
  });
}

document.querySelectorAll('[data-task-status]').forEach((section) => {
  section.addEventListener('dragover', (event) => event.preventDefault());
  section.addEventListener('drop', () => {
    const card = document.querySelector('.task-card.dragging');
    if (!card || !requireLogin()) return;
    if (!canWrite()) { saveState.textContent = '只读成员不能移动任务'; return; }
    api(`/api/tasks/${card.dataset.taskId}`, { method: 'PUT', body: JSON.stringify({ status: section.dataset.taskStatus }) }).then(() => { loadTasks(); refreshOverview(); }).catch((error) => { saveState.textContent = error.message; });
  });
});
['task-filter-type', 'task-filter-assignee', 'task-filter-priority'].forEach((id) => document.querySelector(`#${id}`).addEventListener('change', applyTaskFilters));
const taskSearchInput = document.querySelector('#task-search');
if (taskSearchInput) taskSearchInput.addEventListener('input', applyTaskFilters);
document.querySelector('#task-clear-filters').addEventListener('click', () => {
  document.querySelector('#task-filter-type').value = 'all';
  document.querySelector('#task-filter-assignee').value = 'all';
  document.querySelector('#task-filter-priority').value = 'all';
  if (taskSearchInput) taskSearchInput.value = '';
  applyTaskFilters();
});

const newTaskDialog = document.querySelector('#new-task-dialog');
let editingTaskId = null;

function collectTaskFormPayload() {
  return {
    title: document.querySelector('#task-title').value.trim(),
    description: document.querySelector('#task-description').value.trim(),
    task_type: document.querySelector('#task-type').value,
    assignee_id: document.querySelector('#task-assignee').value,
    status: document.querySelector('#task-status').value,
    priority: document.querySelector('#task-priority').value,
    estimated_hours: document.querySelector('#task-hours').value,
    due_date: document.querySelector('#task-due-date').value
  };
}

function openNewTaskDialog() {
  if (!requireLogin()) return;
  if (!canWrite()) { saveState.textContent = '只读成员不能创建任务'; return; }
  editingTaskId = null;
  document.querySelector('#new-task-form').reset();
  document.querySelector('#task-dialog-heading').textContent = '新建任务';
  document.querySelector('#task-dialog-hint').textContent = '创建人将自动记录为当前账号。';
  document.querySelector('#task-create-message').textContent = `作者：${currentMember.real_id}`;
  newTaskDialog.showModal();
  document.querySelector('#task-title').focus();
}

function openEditTaskDialog(taskId) {
  if (!requireLogin()) return;
  if (!canWrite()) { saveState.textContent = '只读成员不能编辑任务'; return; }
  const task = allTasks.find((item) => item.id === taskId);
  if (!task) return;
  editingTaskId = taskId;
  document.querySelector('#task-dialog-heading').textContent = '编辑任务';
  document.querySelector('#task-dialog-hint').textContent = `创建人 ${task.author} · 保存后同步到看板`;
  document.querySelector('#task-title').value = task.title || '';
  document.querySelector('#task-description').value = task.description || '';
  document.querySelector('#task-type').value = task.task_type || 'planning';
  document.querySelector('#task-priority').value = task.priority || 'medium';
  document.querySelector('#task-status').value = task.status || 'todo';
  document.querySelector('#task-assignee').value = task.assignee_id ? String(task.assignee_id) : '';
  document.querySelector('#task-hours').value = task.estimated_hours == null ? '' : task.estimated_hours;
  document.querySelector('#task-due-date').value = task.due_date || '';
  document.querySelector('#task-create-message').textContent = '修改后保存到看板';
  newTaskDialog.showModal();
  document.querySelector('#task-title').focus();
}

function submitTaskForm() {
  const payload = collectTaskFormPayload();
  if (!payload.title) { document.querySelector('#task-create-message').textContent = '请输入任务标题'; return; }
  const request = editingTaskId
    ? api(`/api/tasks/${editingTaskId}`, { method: 'PUT', body: JSON.stringify(payload) })
    : api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
  request.then(() => {
    newTaskDialog.close();
    loadTasks();
    refreshOverview();
  }).catch((error) => { document.querySelector('#task-create-message').textContent = error.message; });
}

function deleteTask(taskId) {
  const task = allTasks.find((item) => item.id === taskId);
  if (!task) return;
  if (!canWrite()) { saveState.textContent = '只读成员不能删除任务'; return; }
  if (!confirm(`确认删除任务「${task.title}」？此操作无法撤销。`)) return;
  api(`/api/tasks/${taskId}`, { method: 'DELETE' }).then(() => {
    loadTasks();
    refreshOverview();
  }).catch((error) => { saveState.textContent = error.message; });
}

document.querySelector('[data-new-task]').addEventListener('click', openNewTaskDialog);
document.querySelector('#create-task').addEventListener('click', submitTaskForm);
document.querySelector('#new-task-form').addEventListener('submit', (event) => { event.preventDefault(); submitTaskForm(); });

document.querySelectorAll('.check').forEach((button) => {
  button.addEventListener('click', () => button.classList.toggle('checked'));
});

const menuButton = document.querySelector('.menu-button');
const mainNav = document.querySelector('.main-nav');
menuButton.addEventListener('click', () => {
  const isOpen = mainNav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
});
mainNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => mainNav.classList.remove('open')));
