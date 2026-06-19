const express = require('express');
const fs = require('fs');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    }
});
const path = require('path');

const PORT = process.env.PORT || 3000;

// CORS headers barcha so'rovlar uchun
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Statik fayllarni serve qilish
app.use(express.static(__dirname));
// Ulangan foydalanuvchilar
const users = new Map();

const DATA_FILE = path.join(__dirname, 'data.json');

// Xabarlar tarixi (serverda saqlanadi)
let chatHistory = [];
// Tizim parollari
let passwords = {
    adminPassword: '123',
    userPassword: '123'
};

// Saqlangan ma'lumotlarni o'qish
if (fs.existsSync(DATA_FILE)) {
    try {
        const rawData = fs.readFileSync(DATA_FILE);
        const parsed = JSON.parse(rawData);
        chatHistory = parsed.chatHistory || [];
        passwords = parsed.passwords || passwords;
    } catch (err) {
        console.error("Ma'lumotlarni o'qishda xatolik:", err);
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ chatHistory, passwords }, null, 2));
    } catch (err) {
        console.error("Ma'lumotlarni saqlashda xatolik:", err);
    }
}

// Har 1 soatda xabarlarni tekshirib, 1 haftadan eskilari avtomatik o'chiriladi
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    const before = chatHistory.length;
    chatHistory = chatHistory.filter(msg => (now - msg.id) <= ONE_WEEK_MS);
    
    // Agar eski xabarlar o'chirilgan bo'lsa, barcha mijozlarga admin panel uchun xabar sonini yangilashni aytamiz
    if (chatHistory.length < before) {
        saveData();
        io.emit('history-count', chatHistory.length);
        console.log(`Avtomatik tozalash: ${before - chatHistory.length} ta eski xabar o'chirildi.`);
    }
}, 60 * 60 * 1000); // 1 soatda bir marta ishlaydi

io.on('connection', (socket) => {
    console.log('Foydalanuvchi ulandi:', socket.id);

    // --- CHAT ---

    // Xabarni barchaga tarqatish va serverda saqlash
    socket.on('chat-message', (msg) => {
        chatHistory.push(msg);
        saveData();
        io.emit('chat-message', msg);
        // Admin uchun xabar sonini yangilash
        io.emit('history-count', chatHistory.length);
    });

    // FAQAT o'z ekranini tozalash (server da qoladi)
    socket.on('clear-my-chat', () => {
        socket.emit('chat-cleared-local');
    });

    // Login sahifasidagi "Tozalash" — serverdan ham o'chiriladi (MAXFIY)
    socket.on('privacy-clear', () => {
        chatHistory = [];
        saveData();
        // Barcha ulangan foydalanuvchilarning ekranini ham tozalash
        io.emit('chat-cleared');
        io.emit('history-count', 0);
        console.log('Maxfiylik: chat tarixi o\'chirildi');
    });

    // --- ADMIN ---

    // Bitta xabarni o'chirish (Super Admin)
    socket.on('admin-delete-message', (msgId, callback) => {
        const before = chatHistory.length;
        chatHistory = chatHistory.filter(m => m.id !== msgId);
        if (chatHistory.length < before) {
            saveData();
            io.emit('message-deleted', msgId);
            io.emit('history-count', chatHistory.length);
            callback({ success: true });
        } else {
            callback({ success: false });
        }
    });

    // Barcha xabarlarni o'chirish (Super Admin)
    socket.on('admin-clear-all', (callback) => {
        chatHistory = [];
        saveData();
        io.emit('chat-cleared');
        io.emit('history-count', 0);
        callback({ success: true });
    });

    // Chat tarixini yuborish (Super Admin uchun)
    socket.on('get-chat-history', (callback) => {
        callback(chatHistory);
    });

    // --- USER ---

    // Yangi foydalanuvchi qo'shilganda
    socket.on('user-joined', (user) => {
        users.set(socket.id, user);
        io.emit('users-update', Array.from(users.values()));
        // Yangi kirgan foydalanuvchiga mavjud chat tarixini yuborish
        socket.emit('chat-history', chatHistory);
    });

    // --- LOGIN ---

    socket.on('verify-login', (data, callback) => {
        if (data.password === passwords.adminPassword) {
            callback({ success: true, role: 'Super Admin', name: 'Super Admin' });
        } else if (data.password === passwords.userPassword) {
            callback({ success: true, role: 'User', needsName: true });
        } else {
            callback({ success: false, message: 'Kiritilgan parol noto\'g\'ri!' });
        }
    });

    socket.on('get-passwords', (callback) => {
        callback({
            userPassword: passwords.userPassword,
            adminPassword: passwords.adminPassword
        });
    });

    socket.on('update-passwords', (data, callback) => {
        passwords.userPassword = data.userPassword;
        passwords.adminPassword = data.adminPassword;
        saveData();
        console.log('Parollar yangilandi');
        callback({ success: true });
    });

    // --- WebRTC SIGNALING ---

    socket.on('call-user', (data) => {
        socket.broadcast.emit('call-made', {
            offer: data.offer,
            socket: socket.id,
            caller: data.caller,
            callType: data.callType || 'video'
        });
    });

    socket.on('make-answer', (data) => {
        socket.to(data.to).emit('answer-made', {
            socket: socket.id,
            answer: data.answer
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.broadcast.emit('ice-candidate', data);
    });

    socket.on('end-call', () => {
        socket.broadcast.emit('end-call');
    });

    // --- DISCONNECT ---

    socket.on('disconnect', () => {
        console.log('Foydalanuvchi uzildi:', socket.id);
        users.delete(socket.id);
        io.emit('users-update', Array.from(users.values()));
    });
});

http.listen(PORT, () => {
    console.log(`Server http://localhost:${PORT} manzilida ishga tushdi.`);
});
