// ==========================================
// 1. FIREBASE CONFIGURATION
// ==========================================

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();

// ==========================================
// 2. GLOBAL STATE
// ==========================================
const API_URL = "http://127.0.0.1:8000/api";
let userId = null;
let userEmail = null;
let activeTopic = ""; 
let isRagMode = false;

// Solo Quiz State
let currentQuiz = [];
let currentQuestionIndex = 0;
let currentScore = 0;

// Arena/Multiplayer State
let currentLobbyId = null;
let isArenaHost = false;
let arenaUnsubscribe = null; 

// ==========================================
// 3. ROUTING & UI SETUP
// ==========================================
function setAppView(viewName) {
    const views = ['login-overlay', 'setup-view', 'dashboard-view', 'app-loading', 'loading-view'];
    views.forEach(v => {
        const el = document.getElementById(v);
        if (el) el.classList.add('hidden');
    });

    const sidebar = document.getElementById('sidebar');
    if (viewName === 'login-overlay' || viewName === 'app-loading' || viewName === 'setup-view' || viewName === 'loading-view') {
        sidebar.classList.add('hidden');
        sidebar.classList.remove('flex');
    } else {
        sidebar.classList.remove('hidden');
        sidebar.classList.add('flex');
    }

    const activeView = document.getElementById(viewName);
    if (activeView) {
        activeView.classList.remove('hidden');
        if(viewName !== 'app-loading' && viewName !== 'loading-view') {
            activeView.classList.add('animate-fade-in');
        }
    }
}

function switchTab(tabName) {
    const allTabs = ['overview', 'vault', 'arena', 'friends', 'roadmap', 'resources', 'tutor', 'quiz'];
    allTabs.forEach(t => {
        const tabEl = document.getElementById(`tab-${t}`);
        if(tabEl) tabEl.classList.add('hidden');
        
        const btn = document.getElementById(`btn-${t}`);
        if(btn) {
            btn.classList.remove('bg-indigo-600/20', 'text-indigo-300', 'border', 'border-indigo-500/30');
            btn.classList.add('text-slate-400', 'hover:bg-white/5', 'hover:text-white');
        }
    });

    const selectedTab = document.getElementById(`tab-${tabName}`);
    if(selectedTab) selectedTab.classList.remove('hidden');

    const selectedBtn = document.getElementById(`btn-${tabName}`);
    if(selectedBtn) {
        selectedBtn.classList.remove('text-slate-400', 'hover:bg-white/5', 'hover:text-white');
        selectedBtn.classList.add('bg-indigo-600/20', 'text-indigo-300', 'border', 'border-indigo-500/30');
    }
}

// ==========================================
// 4. AUTH & CONSISTENCY ENGINE
// ==========================================
auth.onAuthStateChanged(async (user) => {
    if (user) {
        userId = user.uid;
        userEmail = user.email.toLowerCase(); // Force lowercase for searching
        setAppView('app-loading');
        
        document.getElementById("user-profile").classList.remove("hidden");
        document.getElementById("user-email").innerText = userEmail;
        document.getElementById("user-initials").innerText = userEmail.charAt(0).toUpperCase();
        
        await initializeUserProfile(user);
        
        try {
            const snapshot = await db.collection('users').doc(userId).collection('roadmaps').limit(1).get();
            if (snapshot.empty) {
                setAppView('setup-view');
            } else {
                setAppView('dashboard-view');
                switchTab('overview'); 
                loadVault();    
                renderRealHeatmap(); 
                loadFriendsList();
            }
        } catch (error) { setAppView('setup-view'); }
    } else {
        userId = null;
        document.getElementById("user-profile").classList.add("hidden");
        setAppView('login-overlay');
    }
});

async function initializeUserProfile(user) {
    const userRef = db.collection('users').doc(user.uid);
    const doc = await userRef.get();
    const today = new Date().toISOString().split('T')[0];
    const userEmailLower = user.email.toLowerCase();

    if (!doc.exists) {
        await userRef.set({
            email: userEmailLower,
            xp: 0,
            streak: 1,
            battles_won: 0,
            last_login: today,
            activity: { [today]: 1 }
        });
        document.getElementById('stat-streak').innerText = 1;
        document.getElementById('stat-xp').innerText = 0;
        document.getElementById('stat-wins').innerText = 0;
    } else {
        const data = doc.data();
        let newStreak = data.streak || 0;
        let activityLog = data.activity || {};
        
        if (data.last_login !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yestString = yesterday.toISOString().split('T')[0];
            
            if (data.last_login === yestString) newStreak += 1; 
            else newStreak = 1; 
            
            activityLog[today] = (activityLog[today] || 0) + 1;
        }
        
        // 🔥 THE FIX: Using { merge: true } forces the email field onto old accounts!
        await userRef.set({
            email: userEmailLower,
            streak: newStreak,
            last_login: today,
            activity: activityLog
        }, { merge: true });
        
        document.getElementById('stat-streak').innerText = newStreak;
        document.getElementById('stat-xp').innerText = data.xp || 0;
        document.getElementById('stat-wins').innerText = data.battles_won || 0;
    }
}

async function addXP(amount, triggerActivity = true) {
    if (!userId) return;
    const userRef = db.collection('users').doc(userId);
    const today = new Date().toISOString().split('T')[0];
    
    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(userRef);
        if (!doc.exists) return;
        const data = doc.data();
        let newXp = (data.xp || 0) + amount;
        let act = data.activity || {};
        
        if (triggerActivity) act[today] = (act[today] || 0) + 1;
        
        transaction.update(userRef, { xp: newXp, activity: act });
        document.getElementById('stat-xp').innerText = newXp;
    });
    
    if (triggerActivity) renderRealHeatmap();
}

function renderRealHeatmap() {
    if(!userId) return;
    db.collection('users').doc(userId).get().then(doc => {
        const activity = doc.data().activity || {};
        const container = document.getElementById('heatmap-container');
        container.innerHTML = "";
        
        const todayDate = new Date();
        for (let i = 364; i >= 0; i--) {
            const targetDate = new Date(todayDate);
            targetDate.setDate(todayDate.getDate() - i);
            const dateStr = targetDate.toISOString().split('T')[0];
            
            const div = document.createElement('div');
            div.className = "w-3 h-3 rounded-sm transition-colors duration-300";
            
            const count = activity[dateStr] || 0;
            if (count > 5) div.classList.add('heat-level-3');
            else if (count > 2) div.classList.add('heat-level-2');
            else if (count > 0) div.classList.add('heat-level-1');
            else div.classList.add('heat-level-0');
            
            div.title = `${dateStr}: ${count} activities`;
            container.appendChild(div);
        }
    });
}

function handleEmailLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    if (!email || !password) return showLoginError("Enter email & password.");
    auth.signInWithEmailAndPassword(email, password).catch(e => showLoginError(e.message));
}
function handleEmailSignup() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    if (!email || !password) return showLoginError("Enter email & password.");
    auth.createUserWithEmailAndPassword(email, password).catch(e => showLoginError(e.message));
}
function handleLogout() { auth.signOut().then(() => location.reload()); }
function showLoginError(msg) {
    const el = document.getElementById('login-error');
    el.innerText = msg; el.classList.remove('hidden');
}


// ==========================================
// 5. SOCIAL GRAPH (FRIENDS) - EXACT MATCH & MUTUAL
// ==========================================
async function searchFriends() {
    const query = document.getElementById('friend-search-input').value.trim().toLowerCase();
    if (!query) return;
    
    const resultsContainer = document.getElementById('friend-search-results');
    const list = document.getElementById('search-results-list');
    list.innerHTML = `<p class="text-slate-400 text-sm">Searching...</p>`;
    resultsContainer.classList.remove('hidden');

    try {
        // EXACT MATCH search to prevent Firebase index quirks
        const snapshot = await db.collection('users').where('email', '==', query).limit(1).get();
        
        if (snapshot.empty) {
            list.innerHTML = `<p class="text-slate-400 text-sm">No user found with exact email: ${query}</p>`;
            return;
        }

        list.innerHTML = "";
        snapshot.forEach(doc => {
            if(doc.id === userId) {
                list.innerHTML = `<p class="text-slate-400 text-sm">That's you!</p>`;
                return; 
            }
            const data = doc.data();
            list.innerHTML += `
                <div class="flex justify-between items-center bg-slate-800/50 p-3 rounded-lg border border-white/5">
                    <div>
                        <p class="text-white text-sm font-bold">${data.email}</p>
                        <p class="text-xs text-indigo-400">XP: ${data.xp || 0} | Streak: ${data.streak || 0}🔥</p>
                    </div>
                    <button onclick="addFriend('${doc.id}', '${data.email}')" class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-lg">Follow</button>
                </div>
            `;
        });
    } catch(e) { 
        console.error(e);
        list.innerHTML = `<p class="text-red-400 text-sm">Error searching.</p>`; 
    }
}

async function addFriend(friendId, friendEmail) {
    if(!userId) return;
    
    // Mutually add both users to each other's friend lists
    await db.collection('users').doc(userId).collection('friends').doc(friendId).set({
        email: friendEmail,
        added_at: Date.now()
    });
    
    await db.collection('users').doc(friendId).collection('friends').doc(userId).set({
        email: userEmail,
        added_at: Date.now()
    });

    alert(`You and ${friendEmail} are now mutually connected!`);
    loadFriendsList();
}

async function loadFriendsList() {
    if(!userId) return;
    const list = document.getElementById('friends-list');
    
    db.collection('users').doc(userId).collection('friends').onSnapshot(async (snapshot) => {
        if (snapshot.empty) {
            list.innerHTML = `<p class="text-slate-500 text-sm py-4 border border-dashed border-white/10 rounded-xl text-center">No friends added yet.</p>`;
            return;
        }
        
        list.innerHTML = "";
        snapshot.forEach(async (fdoc) => {
            const friendDoc = await db.collection('users').doc(fdoc.id).get();
            const data = friendDoc.data();
            if(data) {
                list.innerHTML += `
                    <div class="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/5 animate-fade-in">
                        <div class="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold">${data.email.charAt(0).toUpperCase()}</div>
                        <div class="flex-1">
                            <p class="text-white text-sm font-bold">${data.email}</p>
                            <div class="flex gap-2 text-xs">
                                <span class="text-indigo-300">${data.xp || 0} XP</span>
                                <span class="text-orange-400">${data.streak || 0}🔥 Day Streak</span>
                            </div>
                        </div>
                    </div>
                `;
            }
        });
    });
}


// ==========================================
// 6. THE ARENA (MULTIPLAYER)
// ==========================================
function getBulletproofQuiz(topic) {
    // Failsafe JSON if Python doesn't return exactly what we need
    return [
        { question: `What is a fundamental principle of ${topic}?`, options: ["Consistency", "Speed", "Randomness", "Luck"], correct_index: 0, explanation: "Fundamentals are built on consistency." },
        { question: `Which method is considered best practice?`, options: ["Method A", "Method B", "Method C", "Method D"], correct_index: 1, explanation: "Method B is industry standard." },
        { question: `How do you optimize this process?`, options: ["Ignore it", "Add more data", "Refactor logic", "Delete it"], correct_index: 2, explanation: "Refactoring improves efficiency." }
    ];
}

async function createLobby() {
    if(!activeTopic) return alert("Select a Roadmap from your vault to fight about!");
    
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    currentLobbyId = code;
    isArenaHost = true;

    try {
        document.getElementById('arena-setup').innerHTML = `<p class="text-white mt-10">Generating Battle Questions...</p>`;
        
        let quizData = [];
        try {
            const res = await fetch(`${API_URL}/quiz/generate`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId, topic: activeTopic })
            });
            const data = await res.json();
            if (data.quiz && Array.isArray(data.quiz) && data.quiz.length > 0) {
                quizData = data.quiz;
            } else {
                quizData = getBulletproofQuiz(activeTopic);
            }
        } catch(e) {
            quizData = getBulletproofQuiz(activeTopic);
        }

        await db.collection('arenas').doc(code).set({
            host: userEmail, guest: null, status: "waiting", 
            quiz: quizData, hostScore: 0, guestScore: 0, created_at: Date.now()
        });

        document.getElementById('arena-setup').classList.add('hidden');
        document.getElementById('arena-setup').innerHTML = ""; 
        document.getElementById('arena-waiting').classList.remove('hidden');
        document.getElementById('lobby-code-display').innerText = code;
        listenToLobby(code);

    } catch (e) {
        alert("Failed to create Arena.");
        resetArena();
    }
}

async function joinLobby() {
    const code = document.getElementById('join-code').value.toUpperCase().trim();
    if(!code) return;

    const doc = await db.collection('arenas').doc(code).get();
    if (!doc.exists) return alert("Lobby not found!");
    if (doc.data().status !== "waiting") return alert("Battle already started!");

    currentLobbyId = code;
    isArenaHost = false;

    await db.collection('arenas').doc(code).update({ guest: userEmail });

    document.getElementById('arena-setup').classList.add('hidden');
    document.getElementById('arena-waiting').classList.remove('hidden');
    document.getElementById('lobby-code-display').innerText = code;
    document.getElementById('lobby-status').innerText = "Waiting for host to start...";
    
    listenToLobby(code);
}

function listenToLobby(code) {
    if (arenaUnsubscribe) arenaUnsubscribe(); 
    
    arenaUnsubscribe = db.collection('arenas').doc(code).onSnapshot((doc) => {
        if(!doc.exists) return;
        const data = doc.data();

        if (data.status === "waiting" && data.guest) {
            document.getElementById('lobby-status').innerText = `${data.guest} joined!`;
            document.getElementById('lobby-status').classList.remove('animate-pulse');
            document.getElementById('lobby-status').classList.add('text-green-400', 'font-bold');
            if (isArenaHost) document.getElementById('start-battle-btn').classList.remove('hidden');
        }

        if (data.status === "playing") {
            document.getElementById('arena-waiting').classList.add('hidden');
            document.getElementById('arena-battle').classList.remove('hidden');
            
            document.getElementById('opponent-name').innerText = isArenaHost ? data.guest : data.host;
            
            const totalQ = data.quiz.length;
            const myScore = isArenaHost ? data.hostScore : data.guestScore;
            const oppScore = isArenaHost ? data.guestScore : data.hostScore;
            
            document.getElementById('arena-p1-score').innerText = `Score: ${myScore}`;
            document.getElementById('arena-p1-bar').style.width = `${(myScore/totalQ)*100}%`;
            
            document.getElementById('arena-p2-score').innerText = `Score: ${oppScore}`;
            document.getElementById('arena-p2-bar').style.width = `${(oppScore/totalQ)*100}%`;

            if (currentQuiz.length === 0) {
                currentQuiz = data.quiz;
                currentQuestionIndex = 0;
                displayArenaQuestion();
            }
        }
        
        if (data.status === "finished") {
            const myScore = isArenaHost ? data.hostScore : data.guestScore;
            const oppScore = isArenaHost ? data.guestScore : data.hostScore;
            
            document.getElementById('arena-question-container').classList.add('hidden');
            document.getElementById('arena-results').classList.remove('hidden');
            
            if (myScore > oppScore) {
                document.getElementById('arena-result-title').innerText = "Victory!";
                document.getElementById('arena-result-title').className = "text-3xl font-bold text-green-400 mb-2";
                if(isArenaHost) addXP(50, false); 
                db.collection('users').doc(userId).update({ battles_won: firebase.firestore.FieldValue.increment(1) });
            } else if (myScore < oppScore) {
                document.getElementById('arena-result-title').innerText = "Defeat!";
                document.getElementById('arena-result-title').className = "text-3xl font-bold text-red-400 mb-2";
            } else {
                document.getElementById('arena-result-title').innerText = "Draw!";
                document.getElementById('arena-result-title').className = "text-3xl font-bold text-yellow-400 mb-2";
            }
        }
    });
}

function startBattle() {
    if(!currentLobbyId || !isArenaHost) return;
    db.collection('arenas').doc(currentLobbyId).update({ status: "playing" });
}

function displayArenaQuestion() {
    const q = currentQuiz[currentQuestionIndex];
    if(!q || !q.options) return; 
    
    document.getElementById('arena-question').innerText = q.question;
    
    const optionsHtml = q.options.map((opt, idx) => `
        <button onclick="handleArenaAnswer(${idx})" id="arena-opt-${idx}" class="w-full text-left px-6 py-4 rounded-xl bg-slate-900 border border-white/10 hover:border-indigo-500 hover:bg-indigo-500/10 transition text-slate-300 font-medium">
            <span class="inline-block w-6 text-slate-500">${['A','B','C','D'][idx]}.</span> ${opt}
        </button>
    `).join('');
    
    document.getElementById('arena-options').innerHTML = optionsHtml;
}

function handleArenaAnswer(selectedIndex) {
    const q = currentQuiz[currentQuestionIndex];
    const isCorrect = (selectedIndex === q.correct_index);
    
    const buttons = document.getElementById('arena-options').getElementsByTagName('button');
    for(let i=0; i<buttons.length; i++) {
        buttons[i].disabled = true;
        if(i === q.correct_index) buttons[i].classList.add('bg-green-500/20', 'border-green-500', 'text-green-300');
        else if(i === selectedIndex && !isCorrect) buttons[i].classList.add('bg-red-500/20', 'border-red-500', 'text-red-300');
        else buttons[i].classList.add('opacity-50');
    }

    if(isCorrect) {
        const field = isArenaHost ? "hostScore" : "guestScore";
        db.collection('arenas').doc(currentLobbyId).update({
            [field]: firebase.firestore.FieldValue.increment(1)
        });
    }

    setTimeout(() => {
        currentQuestionIndex++;
        if (currentQuestionIndex < currentQuiz.length) {
            displayArenaQuestion();
        } else {
            document.getElementById('arena-question').innerText = "Waiting for opponent to finish...";
            document.getElementById('arena-options').innerHTML = "";
            
            if (isArenaHost) {
                setTimeout(() => {
                    db.collection('arenas').doc(currentLobbyId).update({ status: "finished" });
                }, 3000);
            }
        }
    }, 1500);
}

function resetArena() {
    if(arenaUnsubscribe) arenaUnsubscribe();
    currentLobbyId = null; currentQuiz = [];
    document.getElementById('arena-results').classList.add('hidden');
    document.getElementById('arena-battle').classList.add('hidden');
    document.getElementById('arena-waiting').classList.add('hidden');
    document.getElementById('arena-setup').classList.remove('hidden');
    
    document.getElementById('arena-setup').innerHTML = `
        <div class="absolute top-0 right-0 w-64 h-64 bg-red-600/10 rounded-full blur-[80px]"></div>
        <div class="text-6xl mb-4">⚔️</div>
        <h2 class="text-3xl font-bold text-white mb-2 tracking-tight">The Arena</h2>
        <p class="text-slate-400 max-w-lg mx-auto mb-8">Create a lobby or join a friend to battle in real-time.</p>
        <div class="flex flex-col sm:flex-row justify-center gap-4 max-w-md mx-auto mb-4">
            <button onclick="createLobby()" class="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-6 rounded-xl transition shadow-[0_0_20px_rgba(220,38,38,0.3)]">Create 1v1 Lobby</button>
        </div>
        <div class="flex items-center justify-center gap-2 max-w-md mx-auto">
            <input type="text" id="join-code" placeholder="Enter 6-Digit Code" class="px-4 py-3 bg-slate-900 border border-white/10 rounded-xl text-white focus:outline-none focus:border-red-500 text-center uppercase font-bold tracking-widest w-48">
            <button onclick="joinLobby()" class="bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold py-3 px-6 rounded-xl transition">Join</button>
        </div>
    `;
}

// ==========================================
// 7. CORE FUNCTIONS (Roadmap, Solo Quiz)
// ==========================================
async function loadVault() {
    if (!userId) return;
    const grid = document.getElementById('vault-grid');
    grid.innerHTML = ""; 
    try {
        const snapshot = await db.collection('users').doc(userId).collection('roadmaps').orderBy('created_at', 'desc').get();
        if (snapshot.empty) {
            grid.innerHTML = `<div class="glass-panel p-6 rounded-2xl border border-white/10 flex flex-col justify-center items-center text-center h-48 opacity-50 col-span-full"><div class="text-4xl mb-2">🗂️</div><p class="text-slate-400 text-sm">Your saved roadmaps will appear here.</p></div>`;
            return;
        }
        snapshot.forEach(doc => {
            const data = doc.data();
            const dateStr = new Date(data.created_at).toLocaleDateString();
            const card = document.createElement('div');
            card.className = "glass-panel p-6 rounded-2xl border border-white/10 hover:border-indigo-500/50 transition cursor-pointer group relative";
            card.onclick = () => loadRoadmapIntoView(data);
            card.innerHTML = `
                <div class="absolute top-4 right-4 text-xs font-medium text-slate-500 bg-slate-900/50 px-2 py-1 rounded">${dateStr}</div>
                <h3 class="text-lg font-bold text-white mb-3 mt-1 group-hover:text-indigo-400 transition">${data.topic}</h3>
                <div class="flex gap-2 mb-4">
                    <span class="text-xs bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 px-2 py-1 rounded-md">${data.level}</span>
                    <span class="text-xs bg-white/5 border border-white/10 text-slate-300 px-2 py-1 rounded-md">${data.time}</span>
                </div>
                <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div class="bg-indigo-500 h-full shadow-[0_0_10px_#6366f1]" style="width: ${data.progress || 0}%"></div>
                </div>
                <p class="text-xs text-slate-500 mt-2 font-medium">${data.progress || 0}% Complete</p>`;
            grid.appendChild(card);
        });
    } catch (e) {}
}

function loadRoadmapIntoView(data) {
    activeTopic = data.topic;
    document.getElementById('roadmap-content').innerHTML = marked.parse(data.roadmap);
    document.getElementById('resources-content').innerHTML = marked.parse(data.resources);
    setAppView('dashboard-view');
    switchTab('roadmap');
}

async function startPlan() {
    const topic = document.getElementById('input-topic').value;
    const level = document.getElementById('input-level').value;
    const time = document.getElementById('input-time').value;

    if (!topic) return alert("Please enter a topic to master!");

    setAppView('loading-view');
    const loadingText = document.getElementById('loading-text');
    if(loadingText) loadingText.innerText = "Analyzing Knowledge Profile...";
    
    try {
        const response = await fetch(`${API_URL}/start`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                user_id: userId, 
                topic: topic, 
                knowledge_level: level, 
                time_available: time, 
                learning_goal: "Mastery", 
                learning_style: "Visual",
                subject_category: "General" 
            })
        });
        
        if(!response.ok) throw new Error("Backend rejected request");
        
        const data = await response.json();

        await db.collection('users').doc(userId).collection('roadmaps').add({
            topic: topic, level: level, time: time, roadmap: data.roadmap, resources: data.resources, created_at: Date.now(), progress: 0
        });

        addXP(20); 

        activeTopic = topic;
        document.getElementById('roadmap-content').innerHTML = marked.parse(data.roadmap);
        document.getElementById('resources-content').innerHTML = marked.parse(data.resources);
        
        loadVault(); 
        setAppView('dashboard-view');
        switchTab('roadmap');
    } catch (error) {
        console.error(error);
        alert("Servers are busy. Please check the backend connection.");
        setAppView('setup-view');
    }
}

async function generateQuiz() {
    if (!activeTopic) return alert("Please select a roadmap from your Vault first.");
    document.getElementById('quiz-start-area').classList.add('hidden'); document.getElementById('quiz-results').classList.add('hidden'); document.getElementById('quiz-loading').classList.remove('hidden');

    try {
        const res = await fetch(`${API_URL}/quiz/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, topic: activeTopic }) });
        const data = await res.json();
        
        if(data.quiz && Array.isArray(data.quiz) && data.quiz.length > 0) {
            currentQuiz = data.quiz; 
        } else {
            currentQuiz = getBulletproofQuiz(activeTopic);
        }
        
        currentQuestionIndex = 0; currentScore = 0;
        document.getElementById('quiz-loading').classList.add('hidden'); document.getElementById('quiz-container').classList.remove('hidden');
        displayQuestion();
    } catch (error) { 
        currentQuiz = getBulletproofQuiz(activeTopic);
        currentQuestionIndex = 0; currentScore = 0;
        document.getElementById('quiz-loading').classList.add('hidden'); document.getElementById('quiz-container').classList.remove('hidden');
        displayQuestion();
    }
}

function displayQuestion() {
    const q = currentQuiz[currentQuestionIndex];
    document.getElementById('quiz-question').innerText = q.question;
    const progress = ((currentQuestionIndex) / currentQuiz.length) * 100;
    document.getElementById('quiz-progress-bar').style.width = `${progress}%`;
    document.getElementById('quiz-progress-text').innerText = `Question ${currentQuestionIndex + 1} of ${currentQuiz.length}`;
    document.getElementById('quiz-score-text').innerText = `Score: ${currentScore}`;
    document.getElementById('quiz-options').innerHTML = q.options.map((opt, idx) => `<button onclick="handleAnswer(${idx})" id="opt-${idx}" class="w-full text-left px-6 py-4 rounded-xl bg-slate-900 border border-white/10 hover:border-indigo-500 hover:bg-indigo-500/10 transition text-slate-300 font-medium group"><span class="inline-block w-6 text-slate-500 group-hover:text-indigo-400">${['A','B','C','D'][idx]}.</span> ${opt}</button>`).join('');
    document.getElementById('quiz-feedback').classList.add('hidden');
    const buttons = document.getElementById('quiz-options').getElementsByTagName('button');
    for(let b of buttons) b.disabled = false;
}

function handleAnswer(selectedIndex) {
    const q = currentQuiz[currentQuestionIndex];
    const isCorrect = (selectedIndex === q.correct_index);
    const buttons = document.getElementById('quiz-options').getElementsByTagName('button');
    for(let i=0; i<buttons.length; i++) {
        buttons[i].disabled = true; buttons[i].classList.remove('hover:border-indigo-500', 'hover:bg-indigo-500/10');
        if(i === q.correct_index) buttons[i].classList.add('bg-green-500/20', 'border-green-500', 'text-green-300');
        else if (i === selectedIndex && !isCorrect) buttons[i].classList.add('bg-red-500/20', 'border-red-500', 'text-red-300');
        else buttons[i].classList.add('opacity-50');
    }
    if (isCorrect) currentScore++;
    document.getElementById('quiz-score-text').innerText = `Score: ${currentScore}`;
    document.getElementById('feedback-text').innerHTML = isCorrect ? `<span class="text-green-400 font-bold">✅ Correct!</span> ${q.explanation}` : `<span class="text-red-400 font-bold">❌ Incorrect.</span> ${q.explanation}`;
    document.getElementById('quiz-feedback').classList.remove('hidden');
}

function nextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < currentQuiz.length) displayQuestion();
    else showResults();
}

function showResults() {
    document.getElementById('quiz-container').classList.add('hidden'); document.getElementById('quiz-results').classList.remove('hidden');
    document.getElementById('final-score').innerText = `${currentScore}/${currentQuiz.length}`;
    const percentage = currentScore / currentQuiz.length;
    if (percentage === 1) document.getElementById('result-message').innerText = "Flawless! You have mastered this module.";
    else if (percentage >= 0.6) document.getElementById('result-message').innerText = "Solid work! Review the specific gaps in your knowledge.";
    else document.getElementById('result-message').innerText = "Keep practicing! Review your AI Tutor notes and try again.";
    
    addXP(currentScore * 5); 
}

function resetQuizUI() {
    document.getElementById('quiz-results').classList.add('hidden'); document.getElementById('quiz-loading').classList.add('hidden'); document.getElementById('quiz-container').classList.add('hidden'); document.getElementById('quiz-start-area').classList.remove('hidden');
}

async function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    const history = document.getElementById('chat-history');
    history.innerHTML += `<div class="flex gap-4 flex-row-reverse animate-fade-in"><div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold border border-white/20 text-white shrink-0">U</div><div class="bg-indigo-600 text-white p-4 rounded-2xl rounded-tr-none text-sm shadow-lg shadow-indigo-500/20">${msg}</div></div>`;
    input.value = ""; history.scrollTop = history.scrollHeight;

    const endpoint = isRagMode ? "/rag/query" : "/chat";
    const loadingId = "typing-" + Date.now();
    history.innerHTML += `<div id="${loadingId}" class="text-xs text-indigo-400 font-medium ml-16 mt-2 animate-pulse">Agent is typing...</div>`;

    try {
        const response = await fetch(`${API_URL}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, message: msg }) });
        const data = await response.json();
        document.getElementById(loadingId).remove();
        history.innerHTML += `<div class="flex gap-4 animate-fade-in"><div class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-500/30 shrink-0">AI</div><div class="bg-slate-800/80 border border-white/10 p-4 rounded-2xl rounded-tl-none text-sm text-slate-200 shadow-sm backdrop-blur-sm prose prose-invert">${marked.parse(data.reply)}</div></div>`;
        history.scrollTop = history.scrollHeight;
    } catch (e) { document.getElementById(loadingId).remove(); }
}
function handleEnter(e) { if (e.key === 'Enter') sendChat(); }

async function uploadFile() {
    const file = document.getElementById('doc-upload').files[0];
    if (!file) return;
    const status = document.getElementById('upload-status');
    status.innerText = "Processing Document..."; status.classList.add("text-indigo-400", "animate-pulse");
    
    const formData = new FormData();
    formData.append("file", file); formData.append("user_id", userId);

    try {
        const res = await fetch(`${API_URL}/rag/upload`, { method: "POST", body: formData });
        if (res.ok) {
            status.innerText = "✅ Knowledge Base Synced"; status.classList.remove("animate-pulse", "text-indigo-400"); status.classList.add("text-green-400");
            isRagMode = true;
            document.getElementById('chat-history').innerHTML += `<div class="flex gap-4 animate-fade-in my-4"><div class="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center text-white font-bold shadow-lg shadow-green-500/30 shrink-0">✓</div><div class="bg-green-500/10 border border-green-500/20 p-3 rounded-2xl rounded-tl-none text-sm text-green-400 shadow-sm">System context updated. I can now answer questions based strictly on your uploaded document.</div></div>`;
            addXP(10); 
        } else status.innerText = "❌ Upload Failed";
    } catch (e) { status.innerText = "❌ Server Error"; status.classList.remove("animate-pulse"); }
}