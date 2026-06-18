const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');

const PORT = process.env.PORT || 3000;

// Statik fayllarni serve qilish
app.use(express.static(path.join(__dirname)));

// Ulangan foydalanuvchilar
const users = new Map();

// Xabarlar tarixi (serverda saqlanadi)
let chatHistory = [];

// Tizim parollari
let passwords = {
    adminPassword: '123',
    userPassword: '123'
};

io.on('connection', (socket) => {
    console.log('Foydalanuvchi ulandi:', socket.id);

    // --- CHAT ---

    // Xabarni barchaga tarqatish va serverda saqlash
    socket.on('chat-message', (msg) => {
        chatHistory.push(msg);
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
        console.log('Parollar yangilandi');
        callback({ success: true });
    });

    // --- WebRTC SIGNALING ---

    socket.on('call-user', (data) => {
        socket.broadcast.emit('call-made', {
            offer: data.offer,
            socket: socket.id,
            caller: data.caller
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
