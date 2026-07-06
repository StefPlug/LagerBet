const ADMIN_PASSWORD = 'lagerbet2026';
const ADMIN_IDS = [959403755];
let currentUser = null;
let allEvents = [];
let allBets = [];
let betModal = { eventId: null, outcomeId: null, coeff: 0, outcomeName: '' };

// ===== Data Store (localStorage) =====
function getData(key, def = []) {
    try { return JSON.parse(localStorage.getItem('lb_' + key)) || def; }
    catch { return def; }
}

function setData(key, val) {
    localStorage.setItem('lb_' + key, JSON.stringify(val));
}

function getUsers() { return getData('users', []); }
function getEvents() { return getData('events', []); }
function getBets() { return getData('bets', []); }
function getTransactions() { return getData('transactions', []); }

function saveUsers(users) { setData('users', users); }
function saveEvents(events) { setData('events', events); }
function saveBets(bets) { setData('bets', bets); }
function saveTransactions(txs) { setData('transactions', txs); }

function genId(arr) { return arr.length ? Math.max(...arr.map(a => a.id || 0)) + 1 : 1; }

// ===== Init demo data =====
function initDemoData() {
    if (getUsers().length > 0) return;

    const users = [
        { id: 1, username: 'admin', password: ADMIN_PASSWORD, balance: 10000, role: 'admin', daily_bonus_last: null },
        { id: 2, username: 'Иван', password: '', balance: 1000, role: 'player', daily_bonus_last: null },
        { id: 3, username: 'Петр', password: '', balance: 1500, role: 'player', daily_bonus_last: null },
        { id: 4, username: 'Анна', password: '', balance: 800, role: 'player', daily_bonus_last: null },
    ];
    saveUsers(users);

    const events = [
        {
            id: 1, title: '🏓 Настольный теннис: Иванов vs Петров', deadline: '2 часа',
            status: 'active',
            outcomes: [
                { id: 1, name: 'Иванов', coefficient: 1.8 },
                { id: 2, name: 'Петров', coefficient: 2.2 },
                { id: 3, name: 'Ничья', coefficient: 3.5 },
            ]
        },
        {
            id: 2, title: '⚽ Футбол: Отряд 1 vs Отряд 2', deadline: '5 часов',
            status: 'active',
            outcomes: [
                { id: 4, name: 'Отряд 1', coefficient: 1.5 },
                { id: 5, name: 'Отряд 2', coefficient: 2.5 },
                { id: 6, name: 'Ничья', coefficient: 3.0 },
            ]
        }
    ];
    saveEvents(events);
    setData('next_event_id', 3);
    setData('next_outcome_id', 7);
    setData('next_bet_id', 1);
    setData('next_tx_id', 1);
}

// ===== Auth =====
function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username) { showToast('Введите никнейм', true); return; }

    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) { showToast('Пользователь не найден. Зарегистрируйтесь.', true); return; }

    if (user.role === 'admin') {
        if (password !== user.password) { showToast('Неверный пароль админа', true); return; }
    }

    currentUser = user;
    localStorage.setItem('lb_current_user', user.id);
    showMainApp();
}

function register() {
    const username = document.getElementById('login-username').value.trim();
    if (!username) { showToast('Введите никнейм', true); return; }

    const users = getUsers();
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
        showToast('Это имя уже занято', true);
        return;
    }

    const newUser = {
        id: genId(users),
        username,
        password: '',
        balance: 1000,
        role: 'player',
        daily_bonus_last: null
    };
    users.push(newUser);
    saveUsers(users);

    currentUser = newUser;
    localStorage.setItem('lb_current_user', newUser.id);
    showMainApp();
    showToast(`Добро пожаловать! Баланс: ${newUser.balance} 🪙`);
}

function logout() {
    currentUser = null;
    localStorage.removeItem('lb_current_user');
    document.getElementById('screen-main').classList.remove('active');
    document.getElementById('screen-login').classList.add('active');
}

function showMainApp() {
    document.getElementById('screen-login').classList.remove('active');
    document.getElementById('screen-main').classList.add('active');
    document.getElementById('header-username').textContent = currentUser.username;
    document.getElementById('login-password').value = '';
    updateBalanceUI();
    loadEvents();
    checkAdmin();
}

function checkAdmin() {
    const isAdmin = currentUser && currentUser.role === 'admin';
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });
}

// ===== Balance =====
function updateBalanceUI() {
    if (!currentUser) return;
    const users = getUsers();
    const fresh = users.find(u => u.id === currentUser.id);
    if (fresh) currentUser.balance = fresh.balance;
    document.getElementById('header-balance').innerHTML = `${currentUser.balance} &#129689;`;
}

// ===== Navigation =====
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    if (page === 'events') loadEvents();
    else if (page === 'mybets') loadBets();
    else if (page === 'balance') loadBalance();
    else if (page === 'leaderboard') loadLeaderboard();
    else if (page === 'admin') loadAdminData();
    else if (page === 'bonus') refreshBonusBtn();
}

// ===== Events =====
function loadEvents() {
    const events = getEvents().filter(e => e.status === 'active');
    allEvents = events;
    renderEvents(events);
}

function renderEvents(events) {
    const container = document.getElementById('events-list');
    if (!events.length) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">&#128528;</span>Нет активных событий</div>';
        return;
    }
    const bets = getBets();

    container.innerHTML = events.map(ev => {
        const evBets = bets.filter(b => b.event_id === ev.id && b.status === 'pending');
        const totalBets = evBets.length;
        const totalAmount = evBets.reduce((s, b) => s + b.amount, 0);

        const outcomesHtml = ev.outcomes.map(o => {
            const oBets = evBets.filter(b => b.outcome_id === o.id);
            const oAmount = oBets.reduce((s, b) => s + b.amount, 0);
            const pct = totalAmount > 0 ? Math.round(oAmount / totalAmount * 100) : 0;

            return `
                <div class="outcome-btn" onclick="openBetModal(${ev.id}, ${o.id}, ${o.coefficient}, '${o.name.replace(/'/g, "\\'")}')">
                    <span class="outcome-name">${o.name}</span>
                    <span class="outcome-coeff">К ${o.coefficient}</span>
                    ${oBets.length > 0 ? `<div class="stat-item" style="margin-top:8px">${oBets.length} ставок &bull; ${pct}%</div>` : ''}
                </div>
            `;
        }).join('');

        return `
            <div class="event-card">
                <div class="event-title">${ev.title}</div>
                <div class="event-deadline">&#128337; До конца ставок: ${ev.deadline}</div>
                <div class="outcomes-grid">${outcomesHtml}</div>
                ${totalBets > 0 ? `
                <div class="stats-bar">
                    <span class="stat-item">&#128101; Всего ставок: <strong>${totalBets}</strong></span>
                    <span class="stat-item">&#129689; Общая сумма: <strong>${totalAmount}</strong></span>
                </div>` : ''}
            </div>
        `;
    }).join('');
}

// ===== Bet Modal =====
function openBetModal(eventId, outcomeId, coeff, name) {
    betModal = { eventId, outcomeId, coeff, outcomeName: name };
    const ev = allEvents.find(e => e.id === eventId);
    document.getElementById('modal-title').textContent = `Ставка на «${name}»`;
    document.getElementById('modal-info').innerHTML = `Событие: <strong>${ev.title}</strong><br>Коэффициент: <strong style="color:var(--accent)">${coeff}</strong>`;
    document.getElementById('modal-balance').innerHTML = `Ваш баланс: <strong>${currentUser.balance} &#129689;</strong>`;
    document.getElementById('bet-amount').value = '';
    document.getElementById('modal-potential').textContent = '';
    document.getElementById('bet-modal').classList.remove('hidden');

    document.getElementById('bet-amount').oninput = function () {
        const val = parseInt(this.value) || 0;
        document.getElementById('modal-potential').textContent = val > 0 ? `Потенциальный выигрыш: ${Math.floor(val * coeff)} 🪙` : '';
    };
}

function closeModal() { document.getElementById('bet-modal').classList.add('hidden'); }

function setBetAmount(val) {
    if (val === 'all') val = currentUser.balance;
    document.getElementById('bet-amount').value = val;
    document.getElementById('modal-potential').textContent = `Потенциальный выигрыш: ${Math.floor(val * betModal.coeff)} 🪙`;
}

function confirmBet() {
    const amount = parseInt(document.getElementById('bet-amount').value) || 0;
    if (amount <= 0) { showToast('Введите сумму', true); return; }
    if (amount > currentUser.balance) { showToast('Недостаточно койнов', true); return; }

    const potentialWin = Math.floor(amount * betModal.coeff);

    // Deduct balance
    const users = getUsers();
    const user = users.find(u => u.id === currentUser.id);
    user.balance -= amount;
    saveUsers(users);

    // Create bet
    const bets = getBets();
    const betId = genId(bets);
    bets.push({
        id: betId,
        user_id: currentUser.id,
        event_id: betModal.eventId,
        outcome_id: betModal.outcomeId,
        amount,
        potential_win: potentialWin,
        status: 'pending',
        created_at: new Date().toISOString()
    });
    saveBets(bets);

    // Transaction
    const txs = getTransactions();
    txs.push({
        id: genId(txs),
        user_id: currentUser.id,
        amount: -amount,
        description: 'Ставка',
        timestamp: new Date().toISOString()
    });
    saveTransactions(txs);

    currentUser.balance = user.balance;
    updateBalanceUI();
    closeModal();
    showToast(`Ставка ${amount} 🪙 принята! Выигрыш: ${potentialWin} 🪙`);
    loadEvents();
}

// ===== My Bets =====
function loadBets() {
    const bets = getBets()
        .filter(b => b.user_id === currentUser.id)
        .reverse();
    allBets = bets;
    renderBets(bets);
}

function filterBets(status, btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filtered = status === 'all' ? allBets : allBets.filter(b => b.status === status);
    renderBets(filtered);
}

function renderBets(bets) {
    const container = document.getElementById('bets-list');
    if (!bets.length) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">&#127915;</span>Нет ставок</div>';
        return;
    }
    const events = getEvents();

    container.innerHTML = bets.map(b => {
        const ev = events.find(e => e.id === b.event_id);
        const outcome = ev ? ev.outcomes.find(o => o.id === b.outcome_id) : null;
        const outcomeName = outcome ? outcome.name : '?';
        const coeff = outcome ? outcome.coefficient : '?';
        const title = ev ? ev.title : 'Событие удалено';

        const statusClass = `status-${b.status}`;
        const statusText = { pending: 'Активна', won: 'Выиграна', lost: 'Проиграна' }[b.status];
        const amountClass = b.status === 'won' ? 'tx-positive' : '';

        return `
            <div class="bet-item">
                <div class="bet-info">
                    <h4>${title}</h4>
                    <p>${outcomeName} (К: ${coeff}) &bull; ${b.amount} 🪙</p>
                    <span class="bet-status ${statusClass}">${statusText}</span>
                </div>
                <div class="bet-amount ${amountClass}">${b.potential_win} &#129689;</div>
            </div>
        `;
    }).join('');
}

// ===== Balance =====
function loadBalance() {
    updateBalanceUI();
    document.getElementById('balance-info').innerHTML = `
        <div class="balance-label">Текущий баланс</div>
        <span class="balance-amount">${currentUser.balance} &#129689;</span>
    `;

    const txs = getTransactions()
        .filter(t => t.user_id === currentUser.id)
        .reverse()
        .slice(0, 30);

    const container = document.getElementById('transactions-list');
    if (!txs.length) {
        container.innerHTML = '<div class="empty-state">Нет транзакций</div>';
        return;
    }

    container.innerHTML = txs.map(t => {
        const cls = t.amount >= 0 ? 'tx-positive' : 'tx-negative';
        const sign = t.amount >= 0 ? '+' : '';
        return `
            <div class="tx-item">
                <span class="tx-desc">${t.description}</span>
                <span class="tx-amount ${cls}">${sign}${t.amount} &#129689;</span>
            </div>
        `;
    }).join('');
}

// ===== Leaderboard =====
function loadLeaderboard() {
    const users = [...getUsers()].sort((a, b) => b.balance - a.balance).slice(0, 20);
    const container = document.getElementById('leaderboard-list');
    const medals = ['&#129351;', '&#129352;', '&#129353;'];

    container.innerHTML = users.map((u, i) => {
        const topClass = i < 3 ? `top-${i + 1}` : '';
        const rank = i < 3 ? medals[i] : `${i + 1}`;
        return `
            <div class="leader-item ${topClass}">
                <span class="leader-rank">${rank}</span>
                <span class="leader-name">${u.username}</span>
                <span class="leader-balance">${u.balance} &#129689;</span>
            </div>
        `;
    }).join('');
}

// ===== Daily Bonus =====
function refreshBonusBtn() {
    const users = getUsers();
    const user = users.find(u => u.id === currentUser.id);
    const btn = document.getElementById('bonus-btn');
    const now = new Date();

    if (user.daily_bonus_last) {
        try {
            const last = new Date(user.daily_bonus_last);
            if (last.toDateString() === now.toDateString()) {
                btn.disabled = true;
                btn.textContent = 'Уже получено сегодня';
                return;
            }
        } catch { }
    }
    btn.disabled = false;
    btn.textContent = 'Получить бонус';
}

function claimBonus() {
    const users = getUsers();
    const user = users.find(u => u.id === currentUser.id);
    const now = new Date();

    if (user.daily_bonus_last) {
        try {
            const last = new Date(user.daily_bonus_last);
            if (last.toDateString() === now.toDateString()) {
                showToast('Бонус уже получен сегодня', true);
                return;
            }
        } catch { }
    }

    const bonus = 1000;
    user.balance += bonus;
    user.daily_bonus_last = now.toISOString();
    saveUsers(users);

    const txs = getTransactions();
    txs.push({
        id: genId(txs),
        user_id: currentUser.id,
        amount: bonus,
        description: 'Ежедневный бонус',
        timestamp: now.toISOString()
    });
    saveTransactions(txs);

    currentUser.balance = user.balance;
    updateBalanceUI();
    refreshBonusBtn();
    showToast(`Получено ${bonus} 🪙!`);
}

// ===== Admin =====
function loadAdminData() {
    const users = getUsers();
    const select = document.getElementById('admin-user-select');
    select.innerHTML = users.map(u => `<option value="${u.id}">${u.username} (${u.balance} 🪙)</option>`).join('');
    loadAdminEvents();
}

function showAdminTab(tab) {
    document.querySelectorAll('.admin-form').forEach(f => f.classList.add('hidden'));
    document.getElementById(`admin-${tab}`).classList.remove('hidden');
}

function addOutcomeRow() {
    const container = document.getElementById('outcomes-container');
    const row = document.createElement('div');
    row.className = 'outcome-row';
    row.innerHTML = `
        <input type="text" placeholder="Исход" class="outcome-name">
        <input type="number" placeholder="Коэфф." class="outcome-coeff" step="0.1" min="1.01">
    `;
    container.appendChild(row);
}

function createEvent() {
    const title = document.getElementById('ev-title').value.trim();
    const deadline = document.getElementById('ev-deadline').value.trim();
    const rows = document.querySelectorAll('#outcomes-container .outcome-row');
    const outcomes = [];

    rows.forEach(row => {
        const name = row.querySelector('.outcome-name').value.trim();
        const coeff = parseFloat(row.querySelector('.outcome-coeff').value);
        if (name && coeff > 1) outcomes.push({ id: 0, name, coefficient: coeff });
    });

    if (!title || !outcomes.length) { showToast('Заполните все поля', true); return; }

    const events = getEvents();
    const nextId = events.length ? Math.max(...events.map(e => e.id)) + 1 : 1;
    let nextOutcomeId = 1;
    events.forEach(e => e.outcomes.forEach(o => { if (o.id >= nextOutcomeId) nextOutcomeId = o.id + 1; }));

    outcomes.forEach((o, i) => { o.id = nextOutcomeId + i; });

    events.push({
        id: nextId,
        title,
        deadline: deadline || 'Не указан',
        status: 'active',
        outcomes
    });
    saveEvents(events);

    showToast('Событие создано!');
    document.getElementById('ev-title').value = '';
    document.getElementById('ev-deadline').value = '';
    document.getElementById('outcomes-container').innerHTML = `
        <div class="outcome-row">
            <input type="text" placeholder="Исход (напр. Отряд 1)" class="outcome-name">
            <input type="number" placeholder="Коэфф." class="outcome-coeff" step="0.1" min="1.01">
        </div>
    `;
    loadAdminEvents();
}

function loadAdminEvents() {
    const events = getEvents().filter(e => e.status === 'active');
    const container = document.getElementById('admin-events-list');

    if (!events.length) {
        container.innerHTML = '<div class="empty-state">Нет активных событий</div>';
        return;
    }

    container.innerHTML = events.map(ev => {
        const outcomesHtml = ev.outcomes.map(o => `
            <button class="btn btn-success" onclick="completeEvent(${ev.id}, ${o.id})" style="margin:4px">
                &#127942; ${o.name} (К: ${o.coefficient})
            </button>
        `).join('');
        return `
            <div style="background:var(--bg-input);border-radius:8px;padding:12px;margin-bottom:8px">
                <strong>${ev.title}</strong>
                <div style="margin-top:8px">${outcomesHtml}</div>
            </div>
        `;
    }).join('');
}

function completeEvent(eventId, winnerId) {
    if (!confirm('Завершить событие и начислить выигрыши?')) return;

    const events = getEvents();
    const ev = events.find(e => e.id === eventId);
    if (!ev) return;
    ev.status = 'completed';

    const bets = getBets();
    let winnersCount = 0;
    const users = getUsers();
    const txs = getTransactions();

    bets.forEach(b => {
        if (b.event_id === eventId && b.outcome_id === winnerId && b.status === 'pending') {
            b.status = 'won';
            winnersCount++;
            const user = users.find(u => u.id === b.user_id);
            if (user) {
                user.balance += b.potential_win;
                txs.push({
                    id: genId(txs),
                    user_id: user.id,
                    amount: b.potential_win,
                    description: `Выигрыш (${ev.title})`,
                    timestamp: new Date().toISOString()
                });
            }
        } else if (b.event_id === eventId && b.status === 'pending') {
            b.status = 'lost';
        }
    });

    saveEvents(events);
    saveBets(bets);
    saveUsers(users);
    saveTransactions(txs);

    showToast(`Событие завершено! Выигрыши: ${winnersCount} ставок`);
    loadAdminEvents();
}

function adminUpdateBalance(multiplier) {
    const userId = parseInt(document.getElementById('admin-user-select').value);
    const amount = parseInt(document.getElementById('admin-amount').value) || 0;
    const reason = document.getElementById('admin-reason').value.trim() || 'Коррекция баланса';

    if (amount <= 0) { showToast('Введите сумму', true); return; }

    const users = getUsers();
    const user = users.find(u => u.id === userId);
    if (!user) { showToast('Пользователь не найден', true); return; }

    user.balance += amount * multiplier;
    saveUsers(users);

    const txs = getTransactions();
    txs.push({
        id: genId(txs),
        user_id: userId,
        amount: amount * multiplier,
        description: reason,
        timestamp: new Date().toISOString()
    });
    saveTransactions(txs);

    const action = multiplier > 0 ? 'Начислено' : 'Списано';
    showToast(`${action} ${amount} 🪙! Новый баланс: ${user.balance}`);
    document.getElementById('admin-amount').value = '';
    document.getElementById('admin-reason').value = '';
    loadAdminData();
}

// ===== Toast =====
function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = isError ? 'toast error' : 'toast';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ===== Init =====
window.onload = function () {
    initDemoData();

    const savedId = localStorage.getItem('lb_current_user');
    if (savedId) {
        const users = getUsers();
        currentUser = users.find(u => u.id === parseInt(savedId));
        if (currentUser) { showMainApp(); return; }
    }

    document.getElementById('login-username').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') login();
    });
    document.getElementById('login-password').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') login();
    });
};
