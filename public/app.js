'use strict';

const elements = {
  accountArea: document.getElementById('account-area'),
  adminPanel: document.getElementById('admin-panel'),
  applicationView: document.getElementById('application-view'),
  cancelModeration: document.getElementById('cancel-moderation'),
  characterCount: document.getElementById('character-count'),
  form: document.getElementById('kudos-form'),
  formError: document.getElementById('form-error'),
  hiddenFeed: document.getElementById('hidden-feed'),
  loadMore: document.getElementById('load-more'),
  loginButton: document.getElementById('login-button'),
  loginUser: document.getElementById('login-user'),
  loginView: document.getElementById('login-view'),
  message: document.getElementById('message'),
  moderationCount: document.getElementById('moderation-count'),
  moderationDescription: document.getElementById('moderation-description'),
  moderationDialog: document.getElementById('moderation-dialog'),
  moderationError: document.getElementById('moderation-error'),
  moderationForm: document.getElementById('moderation-form'),
  moderationReason: document.getElementById('moderation-reason'),
  moderationTitle: document.getElementById('moderation-title'),
  publicFeed: document.getElementById('public-feed'),
  recipient: document.getElementById('recipient'),
  confirmModeration: document.getElementById('confirm-moderation'),
  refreshFeed: document.getElementById('refresh-feed'),
  statusMessage: document.getElementById('status-message')
};

let currentUser = null;
let feedOffset = 0;
let pendingModeration = null;
const FEED_PAGE_SIZE = 8;

async function apiRequest(url, options = {}) {
  const requestOptions = { ...options };

  if (options.body) {
    requestOptions.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
  }

  const response = await fetch(url, requestOptions);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || 'Something went wrong.');
  }

  return body;
}

function showStatus(message) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.hidden = false;

  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    elements.statusMessage.hidden = true;
  }, 3500);
}

function getInitials(name) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function relativeTime(timestamp) {
  const seconds = Math.max(
    1,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  );

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function createFeedState(message) {
  const state = document.createElement('div');
  state.className = 'feed-state';
  state.textContent = message;
  return state;
}

function createActionButton(label, action, isDanger = false) {
  const button = document.createElement('button');
  button.className = isDanger ? 'card-action danger' : 'card-action';
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function createKudosCard(item, options = {}) {
  const card = document.createElement('article');
  card.className = 'kudos-card';

  const header = document.createElement('div');
  header.className = 'kudos-card-header';

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = getInitials(item.senderName);

  const identity = document.createElement('div');
  identity.className = 'kudos-identity';
  identity.append(document.createTextNode(`${item.senderName} → `));

  const recipient = document.createElement('span');
  recipient.className = 'kudos-recipient';
  recipient.textContent = item.recipientName;
  identity.append(recipient);

  const time = document.createElement('time');
  time.className = 'kudos-time';
  time.dateTime = item.createdAt;
  time.textContent = relativeTime(item.createdAt);

  const message = document.createElement('p');
  message.className = 'kudos-message';
  message.textContent = `“${item.message}”`;

  header.append(avatar, identity, time);
  card.append(header, message);

  if (options.hidden && item.moderationReason) {
    const moderationNote = document.createElement('p');
    moderationNote.className = 'moderation-note';
    moderationNote.textContent = `Hidden by ${item.moderatorName}: ${item.moderationReason}`;
    card.append(moderationNote);
  }

  if (currentUser?.role === 'admin') {
    const actions = document.createElement('div');
    actions.className = 'card-actions';

    if (options.hidden) {
      actions.append(
        createActionButton('Restore', () => restoreKudos(item.id)),
        createActionButton(
          'Delete permanently',
          () => permanentlyDeleteKudos(item.id),
          true
        )
      );
    } else {
      actions.append(
        createActionButton('Hide', () => hideKudos(item.id))
      );
    }

    card.append(actions);
  }

  return card;
}

async function loadPublicFeed(reset = true) {
  if (reset) {
    feedOffset = 0;
    elements.publicFeed.replaceChildren(createFeedState('Loading kudos…'));
  }

  elements.loadMore.disabled = true;

  try {
    const page = await apiRequest(
      `/api/kudos?limit=${FEED_PAGE_SIZE}&offset=${feedOffset}`
    );

    if (reset) elements.publicFeed.replaceChildren();

    if (reset && page.items.length === 0) {
      elements.publicFeed.append(
        createFeedState('No kudos yet. Be the first to celebrate someone.')
      );
    } else {
      for (const item of page.items) {
        elements.publicFeed.append(createKudosCard(item));
      }
    }

    feedOffset = page.nextOffset;
    elements.loadMore.hidden = !page.hasMore;
  } catch (error) {
    if (reset) {
      elements.publicFeed.replaceChildren(
        createFeedState('The kudos feed could not be loaded.')
      );
    }
    showStatus(error.message);
  } finally {
    elements.loadMore.disabled = false;
  }
}

async function loadHiddenKudos() {
  if (currentUser?.role !== 'admin') return;

  elements.hiddenFeed.replaceChildren(
    createFeedState('Loading hidden kudos…')
  );

  try {
    const { items } = await apiRequest(
      '/api/admin/kudos?visibility=hidden'
    );

    elements.hiddenFeed.replaceChildren();

    if (items.length === 0) {
      elements.hiddenFeed.append(
        createFeedState('Nothing needs attention.')
      );
      return;
    }

    for (const item of items) {
      elements.hiddenFeed.append(createKudosCard(item, { hidden: true }));
    }
  } catch (error) {
    elements.hiddenFeed.replaceChildren(
      createFeedState('The moderation queue could not be loaded.')
    );
    showStatus(error.message);
  }
}

async function refreshAllFeeds() {
  await loadPublicFeed();
  if (currentUser?.role === 'admin') await loadHiddenKudos();
}

function openModerationDialog(action, kudosId) {
  pendingModeration = { action, kudosId };
  elements.moderationForm.reset();
  elements.moderationCount.value = '0';
  elements.moderationError.textContent = '';

  const isDeletion = action === 'delete';
  elements.moderationTitle.textContent = isDeletion
    ? 'Permanently delete kudos?'
    : 'Hide this kudos?';
  elements.moderationDescription.textContent = isDeletion
    ? 'This cannot be undone. The reason and audit entry will be retained.'
    : 'It will leave the public feed and remain available for administrator review.';
  elements.confirmModeration.textContent = isDeletion
    ? 'Delete permanently'
    : 'Hide kudos';
  elements.confirmModeration.classList.toggle('danger', isDeletion);

  elements.moderationDialog.showModal();
  elements.moderationReason.focus();
}

function hideKudos(kudosId) {
  openModerationDialog('hide', kudosId);
}

async function restoreKudos(kudosId) {
  try {
    await apiRequest(`/api/admin/kudos/${kudosId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isVisible: true })
    });
    showStatus('The kudos has been restored.');
    await refreshAllFeeds();
  } catch (error) {
    showStatus(error.message);
  }
}

function permanentlyDeleteKudos(kudosId) {
  openModerationDialog('delete', kudosId);
}

async function submitModeration(event) {
  event.preventDefault();
  if (!pendingModeration) return;

  const reason = elements.moderationReason.value.trim();
  if (reason.length < 3 || reason.length > 200) {
    elements.moderationError.textContent =
      'Reason must be between 3 and 200 characters.';
    return;
  }

  elements.confirmModeration.disabled = true;
  try {
    const isDeletion = pendingModeration.action === 'delete';
    await apiRequest(`/api/admin/kudos/${pendingModeration.kudosId}`, {
      method: isDeletion ? 'DELETE' : 'PATCH',
      body: JSON.stringify(
        isDeletion ? { reason } : { isVisible: false, reason }
      )
    });
    elements.moderationDialog.close();
    pendingModeration = null;
    showStatus(
      isDeletion
        ? 'The kudos has been permanently deleted.'
        : 'The kudos has been hidden from the public feed.'
    );
    await refreshAllFeeds();
  } catch (error) {
    elements.moderationError.textContent = error.message;
  } finally {
    elements.confirmModeration.disabled = false;
  }
}

function renderAccount(user) {
  const container = document.createElement('div');
  container.className = 'account';

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = getInitials(user.name);

  const identity = document.createElement('span');
  identity.className = 'account-name';
  identity.textContent = user.name;

  const role = document.createElement('span');
  role.className = 'account-role';
  role.textContent = user.role;
  identity.append(role);

  const signOut = document.createElement('button');
  signOut.className = 'sign-out-button';
  signOut.type = 'button';
  signOut.textContent = 'Sign out';
  signOut.addEventListener('click', logout);

  container.append(avatar, identity, signOut);
  elements.accountArea.replaceChildren(container);
}

async function loadColleagues() {
  const { users } = await apiRequest('/api/users');

  // Retain only the original prompt before adding fresh user options.
  elements.recipient.length = 1;

  for (const user of users) {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = user.name;
    elements.recipient.append(option);
  }
}

async function enterApplication(user) {
  currentUser = user;
  renderAccount(user);
  elements.loginView.hidden = true;
  elements.applicationView.hidden = false;
  elements.adminPanel.hidden = user.role !== 'admin';

  const initialRequests = [loadColleagues(), loadPublicFeed()];
  if (user.role === 'admin') initialRequests.push(loadHiddenKudos());
  await Promise.all(initialRequests);
}

async function login() {
  elements.loginButton.disabled = true;

  try {
    const { user } = await apiRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        userId: Number(elements.loginUser.value)
      })
    });

    await enterApplication(user);
    showStatus(`Welcome, ${user.name}.`);
  } catch (error) {
    showStatus(error.message);
  } finally {
    elements.loginButton.disabled = false;
  }
}

async function logout() {
  try {
    await apiRequest('/api/logout', { method: 'POST' });
  } catch (error) {
    showStatus(error.message);
    return;
  }

  currentUser = null;
  elements.accountArea.replaceChildren();
  elements.applicationView.hidden = true;
  elements.loginView.hidden = false;
  elements.recipient.length = 1;
  elements.publicFeed.replaceChildren();
  elements.hiddenFeed.replaceChildren();
}

async function submitKudos(event) {
  event.preventDefault();
  elements.formError.textContent = '';

  const submitButton = event.submitter;
  submitButton.disabled = true;

  try {
    await apiRequest('/api/kudos', {
      method: 'POST',
      body: JSON.stringify({
        recipientId: Number(elements.recipient.value),
        message: elements.message.value
      })
    });

    elements.form.reset();
    elements.characterCount.value = '0';
    showStatus('Your kudos is now in the public feed.');
    await loadPublicFeed();
  } catch (error) {
    elements.formError.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
}

async function restoreExistingSession() {
  try {
    const { user } = await apiRequest('/api/me');
    await enterApplication(user);
  } catch {
    // A 401 response is the normal state for a visitor who has not signed in.
  }
}

elements.loginButton.addEventListener('click', login);
elements.form.addEventListener('submit', submitKudos);
elements.message.addEventListener('input', () => {
  elements.characterCount.value = String(elements.message.value.length);
});
elements.refreshFeed.addEventListener('click', () => loadPublicFeed());
elements.loadMore.addEventListener('click', () => loadPublicFeed(false));
elements.moderationForm.addEventListener('submit', submitModeration);
elements.moderationReason.addEventListener('input', () => {
  elements.moderationCount.value = String(
    elements.moderationReason.value.length
  );
});
elements.cancelModeration.addEventListener('click', () => {
  elements.moderationDialog.close();
  pendingModeration = null;
});
restoreExistingSession();
