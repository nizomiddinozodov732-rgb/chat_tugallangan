// Railway server URL (o'zingizning Railway URL-ni qo'ying)
const SERVER_URL = window.location.hostname === 'localhost' 
    ? '/' 
    : 'https://chattugallangan-production.up.railway.app';

const socket = io(SERVER_URL, {
    transports: ['websocket', 'polling']
});

socket.on('connect', () => {
    console.log('Socket.io serverga ulandi:', socket.id);
});

socket.on('connect_error', (err) => {
    console.error('Socket.io ulanish xatosi:', err);
});
let localStream;
let peerConnection;
let isCaller = false;
let callActive = false;

// WebRTC Configuration (using Google's public STUN server)
const peerConnectionConfig = {
    'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'}
    ]
};

// --- STATE MANAGEMENT ---
const state = {
    isLoggedIn: false,
    currentUser: null,
    theme: localStorage.getItem('theme') || 'dark',
    users: [],
    messages: [],
    notificationCount: 0,
    callTimer: null,
    callSeconds: 0
};


// --- DOM ELEMENTS ---
const elements = {
    themeToggle: document.getElementById('theme-toggle'),
    screens: {
        login: document.getElementById('login-screen'),
        dashboard: document.getElementById('dashboard-screen')
    },
    login: {
        form: document.getElementById('login-form'),
        password: document.getElementById('password-input'),
        error: document.getElementById('login-error'),
        clearBtn: document.getElementById('clear-btn'),
        msgCount: document.getElementById('login-msg-count')
    },
    dashboard: {
        username: document.getElementById('display-username'),
        role: document.getElementById('display-role'),
        avatar: document.getElementById('user-avatar'),
        logoutBtn: document.getElementById('logout-btn'),
        navItems: document.querySelectorAll('.nav-item'),
        views: document.querySelectorAll('.view-section'),
        adminOnlyNav: document.querySelector('.admin-only'),
        onlineCount: document.getElementById('online-count')
    },
    chat: {
        container: document.getElementById('chat-messages'),
        form: document.getElementById('chat-form'),
        input: document.getElementById('message-input'),
        fileUpload: document.getElementById('file-upload'),
        dropZone: document.getElementById('drop-zone'),
        previewContainer: document.getElementById('file-preview-container'),
        previewContent: document.getElementById('file-preview-content'),
        closePreview: document.getElementById('close-preview')
    },
    call: {
        audioBtn: document.getElementById('start-audio-call'),
        videoBtn: document.getElementById('start-video-call'),
        incomingModal: document.getElementById('incoming-call-modal'),
        activeModal: document.getElementById('active-call-modal'),
        acceptBtn: document.getElementById('accept-call'),
        rejectBtn: document.getElementById('reject-call'),
        endBtn: document.getElementById('end-call'),
        duration: document.getElementById('call-duration'),
        toggleMic: document.getElementById('toggle-mic'),
        toggleCam: document.getElementById('toggle-cam'),
        localVideo: document.getElementById('local-video'),
        remoteVideo: document.getElementById('remote-video'),
        localPlaceholder: document.getElementById('local-placeholder'),
        remotePlaceholder: document.getElementById('remote-placeholder'),
        callerName: document.getElementById('caller-name'),
        callTypeText: document.getElementById('call-type-text')
    },
    admin: {
        statUsers: document.getElementById('stat-users'),
        statMessages: document.getElementById('stat-messages'),
        tableBody: document.getElementById('users-table-body'),
        addBtn: document.getElementById('add-user-btn'),
        addModal: document.getElementById('add-user-modal'),
        addForm: document.getElementById('add-user-form'),
        cancelAddBtn: document.getElementById('cancel-add-user'),
        changePasswordsForm: document.getElementById('change-passwords-form'),
        userPassInput: document.getElementById('admin-user-pass-input'),
        adminPassInput: document.getElementById('admin-admin-pass-input')
    }
};

let currentFile = null;

// --- INITIALIZATION ---
function init() {
    applyTheme(state.theme);
    
    if (state.isLoggedIn && state.currentUser) {
        showDashboard();
        socket.emit('user-joined', state.currentUser);
    } else {
        showLogin();
    }
    
    setupEventListeners();
    setupSocketListeners();
}

// --- SOCKET.IO LISTENERS ---
function setupSocketListeners() {
    // Chat Message
    socket.on('chat-message', (msg) => {
        state.messages.push(msg);
        renderMessages();
        if (!state.isLoggedIn) {
            state.notificationCount++;
            elements.login.msgCount.textContent = state.notificationCount;
        }
    });

    // Users update
    socket.on('users-update', (users) => {
        state.users = users;
        if (elements.dashboard.onlineCount) {
            elements.dashboard.onlineCount.textContent = users.length;
        }
        if (state.currentUser && state.currentUser.role === 'Super Admin') {
            renderAdminPanel();
        }
    });

    // Chat tozalanganda
    socket.on('chat-cleared', () => {
        state.messages = [];
        renderMessages();
    });

    // Call signaling
    socket.on('call-made', async (data) => {
        if (callActive) return; // Busy
        
        // Modal shows incoming call
        elements.call.callerName.textContent = data.caller.name || 'Foydalanuvchi';
        elements.call.callTypeText.textContent = 'Qo\'ng\'iroq qilmoqda...';
        elements.call.incomingModal.classList.remove('hidden');
        
        // Store incoming call info globally to accept/reject
        window.incomingCallData = data;
    });

    socket.on('answer-made', async (data) => {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        if (!callActive) {
            startCallTimer();
            callActive = true;
        }
    });

    socket.on('ice-candidate', (data) => {
        if (peerConnection) {
            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    });

    socket.on('end-call', () => {
        closeCall();
    });
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    // Theme Toggle
    elements.themeToggle.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', state.theme);
        applyTheme(state.theme);
    });

    // Login Form
    elements.login.form.addEventListener('submit', handleLogin);
    elements.login.clearBtn.addEventListener('click', () => {
        elements.login.password.value = '';
        elements.login.error.classList.remove('show');
    });

    // Logout
    elements.dashboard.logoutBtn.addEventListener('click', handleLogout);

    // Navigation
    elements.dashboard.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = e.currentTarget.getAttribute('data-target');
            switchView(target);
            
            elements.dashboard.navItems.forEach(nav => nav.classList.remove('active'));
            e.currentTarget.classList.add('active');
        });
    });

    // Chat
    elements.chat.form.addEventListener('submit', handleSendMessage);
    elements.chat.fileUpload.addEventListener('change', handleFileSelect);
    elements.chat.closePreview.addEventListener('click', clearFilePreview);

    // Call Buttons
    elements.call.audioBtn.addEventListener('click', () => initiateCall(false));
    elements.call.videoBtn.addEventListener('click', () => initiateCall(true));
    elements.call.acceptBtn.addEventListener('click', acceptCall);
    elements.call.rejectBtn.addEventListener('click', rejectCall);
    elements.call.endBtn.addEventListener('click', handleEndCall);
    
    elements.call.toggleMic.addEventListener('click', toggleMic);
    elements.call.toggleCam.addEventListener('click', toggleCam);

    // Xavfsizlik: Boshqa oynaga (tab) o'tganda yoki brauzer yopilganda avtomatik chiqib ketish
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && state.isLoggedIn) {
            handleLogout();
        }
    });

    // Parollarni o'zgartirish formasi
    if (elements.admin.changePasswordsForm) {
        elements.admin.changePasswordsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const userPassword = elements.admin.userPassInput.value;
            const adminPassword = elements.admin.adminPassInput.value;
            
            socket.emit('update-passwords', { userPassword, adminPassword }, (res) => {
                if (res.success) {
                    alert("Tizim parollari muvaffaqiyatli o'zgartirildi!");
                }
            });
        });
    }
}

// --- CORE FUNCTIONS ---

function applyTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    const icon = elements.themeToggle.querySelector('i');
    icon.className = themeName === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

function handleLogin(e) {
    e.preventDefault();
    const password = elements.login.password.value.trim();

    // Disable button to prevent multiple clicks
    const submitBtn = elements.login.form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = 'Kutilmoqda... <i class="fas fa-spinner fa-spin"></i>';
    submitBtn.disabled = true;

    // Timeout in case server doesn't respond
    const timeout = setTimeout(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
        alert("Serverdan javob kelmadi. Internet aloqangizni tekshiring yoki sahifani yangilang.");
    }, 10000);

    socket.emit('verify-login', { password }, (res) => {
        clearTimeout(timeout);
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
        if (res.success) {
            elements.login.error.classList.remove('show');
            
            let name = res.name || 'Foydalanuvchi';
            if (res.needsName) {
                name = prompt("Ismingizni kiriting:", "Foydalanuvchi") || "Foydalanuvchi";
            }
            
            const user = { name: name, role: res.role, id: Date.now() };
            
            state.isLoggedIn = true;
            state.currentUser = user;
            
            elements.login.password.value = '';
            state.notificationCount = 0;
            showDashboard();
            socket.emit('user-joined', user);
        } else {
            elements.login.error.textContent = res.message;
            elements.login.error.classList.add('show');
        }
    });
}

function handleLogout() {
    state.isLoggedIn = false;
    state.currentUser = null;
    location.reload(); // Reload to reset state fully
}

function showLogin() {
    elements.screens.dashboard.classList.remove('active');
    elements.screens.dashboard.classList.add('hidden');
    elements.screens.login.classList.remove('hidden');
    elements.screens.login.classList.add('active');
}

function showDashboard() {
    elements.screens.login.classList.remove('active');
    elements.screens.login.classList.add('hidden');
    elements.screens.dashboard.classList.remove('hidden');
    elements.screens.dashboard.classList.add('active');

    elements.dashboard.username.textContent = state.currentUser.name;
    elements.dashboard.role.textContent = state.currentUser.role;
    elements.dashboard.avatar.src = `https://ui-avatars.com/api/?name=${state.currentUser.name.replace(' ', '+')}&background=random`;

    if (state.currentUser.role === 'Super Admin') {
        elements.dashboard.adminOnlyNav.classList.remove('hidden');
        renderAdminPanel();
    } else {
        elements.dashboard.adminOnlyNav.classList.add('hidden');
    }
    
    switchView('chat-view');
    scrollToBottom();
}

function switchView(viewId) {
    elements.dashboard.views.forEach(view => {
        if (view.id === viewId) {
            view.classList.remove('hidden');
            view.classList.add('active');
        } else {
            view.classList.remove('active');
            view.classList.add('hidden');
        }
    });
    if (viewId === 'chat-view') scrollToBottom();
}

// --- CHAT FUNCTIONS ---

function renderMessages() {
    elements.chat.container.innerHTML = '';
    state.messages.forEach(msg => {
        const isSent = state.currentUser && msg.senderId === state.currentUser.id;
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        
        let contentHtml = '';
        if (msg.type === 'text') {
            contentHtml = `<div class="message-content">${escapeHTML(msg.text)}</div>`;
        } else if (msg.type === 'image') {
            contentHtml = `<img src="${msg.file}" alt="image" style="max-width: 250px;">`;
            if (msg.text) contentHtml += `<div class="message-content">${escapeHTML(msg.text)}</div>`;
        } else if (msg.type === 'video') {
            contentHtml = `<video src="${msg.file}" controls style="max-width: 250px;"></video>`;
            if (msg.text) contentHtml += `<div class="message-content">${escapeHTML(msg.text)}</div>`;
        }
        
        msgDiv.innerHTML = `
            ${contentHtml}
            <span class="message-time">${msg.time} ${!isSent ? '- ' + msg.sender : ''}</span>
        `;
        elements.chat.container.appendChild(msgDiv);
    });
    scrollToBottom();
}

function handleSendMessage(e) {
    e.preventDefault();
    const text = elements.chat.input.value.trim();
    if (!text && !currentFile) return;

    // Chatni tozalash buyrug'i tekshiruvi
    if (text.toLowerCase() === '/clear' || text.toLowerCase() === '/tozalash') {
        socket.emit('clear-chat');
        elements.chat.input.value = '';
        return;
    }

    const newMsg = {
        id: Date.now(),
        senderId: state.currentUser.id,
        sender: state.currentUser.name,
        time: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }),
        type: currentFile ? currentFile.type.split('/')[0] : 'text',
        text: text
    };

    if (currentFile) {
        const reader = new FileReader();
        reader.onload = (e) => {
            newMsg.file = e.target.result;
            socket.emit('chat-message', newMsg);
            finishSendMessage();
        };
        reader.readAsDataURL(currentFile);
    } else {
        socket.emit('chat-message', newMsg);
        finishSendMessage();
    }
}

function finishSendMessage() {
    elements.chat.input.value = '';
    clearFilePreview();
    scrollToBottom();
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        alert('Faqat rasm yoki video yuklashingiz mumkin!');
        return;
    }
    currentFile = file;
    const objectUrl = URL.createObjectURL(file);
    elements.chat.previewContainer.classList.remove('hidden');
    if (file.type.startsWith('image/')) {
        elements.chat.previewContent.innerHTML = `<img src="${objectUrl}" alt="preview">`;
    } else {
        elements.chat.previewContent.innerHTML = `<video src="${objectUrl}" muted></video>`;
    }
}

function clearFilePreview() {
    currentFile = null;
    elements.chat.fileUpload.value = '';
    elements.chat.previewContainer.classList.add('hidden');
    elements.chat.previewContent.innerHTML = '';
}

function scrollToBottom() {
    elements.chat.container.scrollTop = elements.chat.container.scrollHeight;
}

// --- WEBRTC CALL FUNCTIONS ---

async function getMedia(videoEnabled) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: videoEnabled, audio: true });
        elements.call.localVideo.srcObject = localStream;
        elements.call.localVideo.classList.remove('hidden');
        elements.call.localPlaceholder.classList.add('hidden');
    } catch (err) {
        console.error('Media error:', err);
        alert("Kamera yoki mikrofonga ruxsat berilmadi!");
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(peerConnectionConfig);

    // Add local tracks to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
        elements.call.remoteVideo.srcObject = event.streams[0];
        elements.call.remoteVideo.classList.remove('hidden');
        elements.call.remotePlaceholder.classList.add('hidden');
    };

    // Send ICE candidates to signaling server
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { candidate: event.candidate });
        }
    };
}

async function initiateCall(videoEnabled) {
    isCaller = true;
    elements.call.activeModal.classList.remove('hidden');
    await getMedia(videoEnabled);
    createPeerConnection();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('call-user', { offer: offer, caller: state.currentUser });
}

async function acceptCall() {
    elements.call.incomingModal.classList.add('hidden');
    elements.call.activeModal.classList.remove('hidden');
    
    // Assume video call for simplicity, or we could pass type in data
    await getMedia(true); 
    createPeerConnection();

    const data = window.incomingCallData;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('make-answer', { answer: answer, to: data.socket });
    
    startCallTimer();
    callActive = true;
}

function rejectCall() {
    elements.call.incomingModal.classList.add('hidden');
    // We could emit a reject event
}

function handleEndCall() {
    socket.emit('end-call');
    closeCall();
}

function closeCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    elements.call.activeModal.classList.add('hidden');
    elements.call.localVideo.classList.add('hidden');
    elements.call.remoteVideo.classList.add('hidden');
    elements.call.localPlaceholder.classList.remove('hidden');
    elements.call.remotePlaceholder.classList.remove('hidden');
    stopCallTimer();
    callActive = false;
    isCaller = false;
}

function startCallTimer() {
    state.callSeconds = 0;
    elements.call.duration.textContent = '00:00';
    state.callTimer = setInterval(() => {
        state.callSeconds++;
        const mins = Math.floor(state.callSeconds / 60).toString().padStart(2, '0');
        const secs = (state.callSeconds % 60).toString().padStart(2, '0');
        elements.call.duration.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopCallTimer() {
    clearInterval(state.callTimer);
}

function toggleMic(e) {
    const btn = e.currentTarget;
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            toggleCallControl(btn, 'fa-microphone', 'fa-microphone-slash', audioTrack.enabled);
        }
    }
}

function toggleCam(e) {
    const btn = e.currentTarget;
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            toggleCallControl(btn, 'fa-video', 'fa-video-slash', videoTrack.enabled);
        }
    }
}

function toggleCallControl(btn, iconOn, iconOff, isEnabled) {
    const icon = btn.querySelector('i');
    if (isEnabled) {
        btn.classList.remove('muted');
        btn.classList.add('active');
        icon.classList.remove(iconOff);
        icon.classList.add(iconOn);
    } else {
        btn.classList.remove('active');
        btn.classList.add('muted');
        icon.classList.remove(iconOn);
        icon.classList.add(iconOff);
    }
}

// --- ADMIN FUNCTIONS ---
function renderAdminPanel() {
    elements.admin.statUsers.textContent = state.users.length;
    elements.admin.statMessages.textContent = state.messages.length;
    
    // Serverdan parollarni so'rash va inputlarga joylash
    socket.emit('get-passwords', (passwords) => {
        elements.admin.userPassInput.value = passwords.userPassword;
        elements.admin.adminPassInput.value = passwords.adminPassword;
    });

    elements.admin.tableBody.innerHTML = '';
    state.users.forEach((user) => {
        const tr = document.createElement('tr');
        const roleClass = user.role === 'Super Admin' || user.role === 'Admin' ? 'admin' : 'user';
        
        tr.innerHTML = `
            <td>#${user.id ? user.id.toString().slice(-4) : '---'}</td>
            <td>${escapeHTML(user.name)}</td>
            <td><span class="badge ${roleClass}">${user.role}</span></td>
            <td><span style="color: var(--success-color)"><i class="fas fa-circle" style="font-size:8px; vertical-align:middle; margin-right:4px;"></i>online</span></td>
            <td>
                <button class="action-btn delete" onclick="alert('Demo: Haqiqiy serverda uziladi')" ${user.role === 'Super Admin' ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
            </td>
        `;
        elements.admin.tableBody.appendChild(tr);
    });
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])
    );
}

// Start App
init();
