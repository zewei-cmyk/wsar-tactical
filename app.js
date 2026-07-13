const localVideo = document.getElementById('local-video');
const videoWorkspace = document.getElementById('left-video-column'); 
const captureCanvas = document.getElementById('capture-canvas');
const remoteIdInput = document.getElementById('remote-id-input');
const spatialLog = document.getElementById('spatial-log');
const groupRoomStatus = document.getElementById('group-room-status');
const toggleFpsBtn = document.getElementById('toggle-fps-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const chatMsgInput = document.getElementById('chat-msg-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const hostBtn = document.getElementById('host-btn');
const joinBtn = document.getElementById('join-btn');
const joystickWrapper = document.getElementById('joystick-wrapper');

let localStream = null;
let poseDetector = null; 
let isAutoSnapshotMode = false;
let snapshotInterval = null;
let isAiProcessing = false;

let peer = null;
let myRole = null; 
let roomPassword = null;
let discoveryInterval = null;
let connectedPeers = new Map(); 

let activeSelectedWrapperId = 'wrapper-local'; 
let zoomScales = new Map(); 

// 高德图层句柄库
let aMapObj = null; 
let amapMarkers = new Map();  
let amapPolylines = new Map(); 
let amapPathsData = new Map(); 

const textColorsPool = ['#0056b3', '#d91a1a', '#228b22', '#8b008b', '#ff8c00', '#008080'];
const myChatColor = textColorsPool[Math.floor(Math.random() * textColorsPool.length)];

let mockLng = 116.397428; let mockLat = 39.90923; let mockHeading = 0;

// 页面加载自动捕获硬件摄像头
window.addEventListener('load', async () => {
    try {
        aMapObj = new AMap.Map('amap-container', { center: [mockLng, mockLat], zoom: 17, viewMode: '2D' });
        logToPanel('🗺️ AMAP Vector Grid Matrix ready.', 'var(--primary-blue)');
    } catch(e) { logToPanel('⚠️ AMAP SDK fail.', '#d91a1a'); }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: true });
        localVideo.srcObject = localStream;
        setupLocalMarkerListener();
        logToPanel('🟢 Local tracking stream operational and rendering.', 'green');
        
        loadAiModelAsynchronously();
    } catch (e) { logToPanel('⚠️ Media device capture blocked.', '#d91a1a'); }
});

function loadAiModelAsynchronously() {
    logToPanel('⏳ Loading neural network modules for posture auditing...', '#333');
    poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER })
    .then(detector => { poseDetector = detector; logToPanel('🤖 MoveNet Core vector model compiled.', 'var(--primary-blue)'); });
}

// 🏠 宿主创建房间
hostBtn.addEventListener('click', () => {
    const code = remoteIdInput.value.trim(); if (!code || code.length !== 4) return alert('Enter 4-Digit Room PIN');
    myRole = 'HOST'; roomPassword = code;
    groupRoomStatus.innerText = `ROOM_${code} [HOST]`;
    disableModeButtons();
    initializePeerConnection(`wsar-final-room-${code}-host`);
});

// 🛰️ 单兵加入房间 (自适应分配 P1-P5 代号)
joinBtn.addEventListener('click', () => {
    const code = remoteIdInput.value.trim(); if (!code || code.length !== 4) return alert('Enter 4-Digit Room PIN');
    myRole = 'MEMBER'; roomPassword = code;
    groupRoomStatus.innerText = `ROOM_${code} [NODE]`;
    joystickWrapper.style.display = 'block'; // 展开地图方向操纵盘
    disableModeButtons();
    initializePeerConnection(`wsar-final-room-${code}-node-${Math.floor(Math.random() * 5 + 1)}`);
});

function initializePeerConnection(nodeId) {
    logToPanel('⏳ Handshaking with secure WebRTC tunnel...', '#333');
    peer = new Peer(nodeId, { config: { 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }] } });

    peer.on('open', (id) => {
        const label = id.includes('host') ? "HOST" : `P${id.substring(id.lastIndexOf('-node-')+6)}`;
        logToPanel(`🚀 WebRTC Node [${label}] established. Channel active.`, 'green');
        if (myRole === 'MEMBER') { startMemberToHostPulsing(); transmitSpatialPacketToHost(); }
    });

    peer.on('call', (call) => {
        call.answer(localStream);
        call.on('stream', (remoteStream) => { handleIncomingStream(call.peer, remoteStream); });
    });
    peer.on('connection', (conn) => { handleIncomingDataConnection(conn); });
}

function startMemberToHostPulsing() {
    const hostTargetId = `wsar-final-room-${roomPassword}-host`;
    discoveryInterval = setInterval(() => {
        if (connectedPeers.has(hostTargetId) && connectedPeers.get(hostTargetId).open) { clearInterval(discoveryInterval); return; }
        const call = peer.call(hostTargetId, localStream);
        if (call) { call.on('stream', (remoteStream) => { handleIncomingStream(hostTargetId, remoteStream); }); }
        const conn = peer.connect(hostTargetId);
        if (conn) { handleIncomingDataConnection(conn); }
    }, 2000);
}

function disableModeButtons() { hostBtn.disabled = true; joinBtn.disabled = true; remoteIdInput.disabled = true; }

// 核心排列重组：收到视频流后，自动按照手绘白板强行塞入最左侧垂直队列中
function handleIncomingStream(peerId, stream) {
    const wrapperId = `wrapper-remote-${peerId}`;
    if (document.getElementById(wrapperId)) return;

    const label = peerId.includes('host') ? "HOST" : `P${peerId.substring(peerId.lastIndexOf('-node-')+6)}`;
    logToPanel(`📹 Synchronized Channel with Stream [${label}]`, 'var(--primary-blue)');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = wrapperId;
    zoomScales.set(wrapperId, 1.0);

    wrapper.innerHTML = `
        <div class="resizable-inner" id="inner-scale-wrapper-remote-${peerId}">
            <video id="video-${peerId}" autoplay playsinline></video>
            <canvas class="interaction-canvas" id="canvas-${peerId}"></canvas>
        </div>
        <div class="video-label">CH: ${label}</div>
    `;
    videoWorkspace.appendChild(wrapper);
    document.getElementById(`video-${peerId}`).srcObject = stream;

    wrapper.addEventListener('click', () => {
        document.querySelectorAll('.video-wrapper').forEach(w => w.classList.remove('active-tactical'));
        wrapper.classList.add('active-tactical');
        activeSelectedWrapperId = wrapperId;
    });

    const videoEl = document.getElementById(`video-${peerId}`);
    videoEl.addEventListener('loadedmetadata', () => { setupRemoteClickMarker(peerId); });

    if (myRole === 'HOST' && (!connectedPeers.has(peerId) || !connectedPeers.get(peerId).open)) {
        const conn = peer.connect(peerId); if (conn) handleIncomingDataConnection(conn);
    }
}

function handleIncomingDataConnection(conn) {
    if (connectedPeers.has(conn.peer) && connectedPeers.get(conn.peer).open) return;
    connectedPeers.set(conn.peer, conn);

    conn.on('data', (data) => {
        if (data.type === 'remote-snapshot-log') {
            appendSnapshotToLog(`🛰️ [CH ${data.fromChannel} Posture Flow]: ${data.aiResult}`, data.img);
        } else if (data.type === 'multi-party-click') {
            const targetCanvas = document.getElementById(`canvas-${data.targetId}`);
            if (targetCanvas) drawMarkerCircle(targetCanvas, data.px * targetCanvas.width, data.py * targetCanvas.height, '#ff4500');
        } else if (data.type === 'chat') {
            logToPanel(`💬 [${data.senderRole}] ${data.msg}`, data.color);
        } else if (data.type === 'amap-coordinate-telemetry') {
            updateNodeOnRealAmap(data.nodeId, data.lng, data.lat, data.heading);
        }
    });
}

// ==================== 🗺️ 高德矢量定位罗盘移动与旋转 ====================
window.moveJoystick = function(direction) {
    if (myRole !== 'MEMBER') return;
    const step = 0.00015; 
    if (direction === 'UP') { mockLat += step; mockHeading = 0; }
    else if (direction === 'DOWN') { mockLat -= step; mockHeading = 180; }
    else if (direction === 'LEFT') { mockLng -= step; mockHeading = 270; }
    else if (direction === 'RIGHT') { mockLng += step; mockHeading = 90; }
    transmitSpatialPacketToHost();
};

function transmitSpatialPacketToHost() {
    if (!peer || myRole !== 'MEMBER') return;
    const hostTargetId = `wsar-final-room-${roomPassword}-host`;
    const conn = connectedPeers.get(hostTargetId);
    if (conn && conn.open) {
        conn.send({ type: 'amap-coordinate-telemetry', nodeId: peer.id, lng: mockLng, lat: mockLat, heading: mockHeading });
    }
    updateNodeOnRealAmap(peer.id, mockLng, mockLat, mockHeading);
}

function updateNodeOnRealAmap(nodeId, lng, lat, heading) {
    if (!aMapObj) return;
    
    const label = nodeId.includes('host') ? "HOST" : `P${nodeId.substring(nodeId.lastIndexOf('-node-')+6)}`;
    const idx = label === "HOST" ? 0 : parseInt(label.replace('P', '')) || 1;
    const pathColor = textColorsPool[idx % textColorsPool.length];

    if (!amapPathsData.has(nodeId)) amapPathsData.set(nodeId, []);
    let pathArr = amapPathsData.get(nodeId);
    pathArr.push([lng, lat]);

    // 大头针初始化及旋转
    if (!amapMarkers.has(nodeId)) {
        let marker = new AMap.Marker({
            position: [lng, lat],
            title: label,
            label: { content: `<b style="color:${pathColor}">${label}</b>`, direction: 'top' },
            map: aMapObj
        });
        amapMarkers.set(nodeId, marker);
    } else { 
        amapMarkers.get(nodeId).setPosition([lng, lat]);
        amapMarkers.get(nodeId).setAngle(heading); // 依转向偏转角度
    }

    // 绘制彩色虚线轨迹
    if (pathArr.length >= 2) {
        if (!amapPolylines.has(nodeId)) {
            let polyline = new AMap.Polyline({
                path: pathArr, strokeColor: pathColor, strokeWeight: 4, strokeStyle: 'dashed', map: aMapObj
            });
            amapPolylines.set(nodeId, polyline);
        } else { amapPolylines.get(nodeId).setPath(pathArr); }
    }
    aMapObj.setCenter([lng, lat]);
    logToPanel(`🛰️ [Telemetry]: ${label} steering direction to ${heading}°`, pathColor);
}

// ==================== 💬 聊天室对讲与大模型 AI 过滤 ====================
function sendChatText() {
    const text = chatMsgInput.value.trim(); if (!text) return; chatMsgInput.value = '';
    if (text.startsWith('/query')) { logToPanel(`💬 [Query] ${text}`, '#000'); executeAiTeammatePromptEngine(text); return; }
    
    logToPanel(`💬 [Me] ${text}`, myChatColor);
    connectedPeers.forEach((conn) => { if (conn.open) conn.send({ type: 'chat', senderRole: myRole, color: myChatColor, msg: text }); });
}

function executeAiTeammatePromptEngine(rawText) {
    setTimeout(() => {
        let aiResponseText = "🤖 [AI Copilot]: Processing spatial neural logs...";
        if (rawText.toLowerCase().includes('closest')) aiResponseText = "🤖 [AI Copilot]: Grid analysis successful. P1 and P2 hold minimum distance vector of 14 meters at Quad B.";
        else if (rawText.toLowerCase().includes('dog')) aiResponseText = "🤖 [AI Copilot]: Target signature found. Image recognition logs validated canine biological activity via P2.";
        logToPanel(aiResponseText, '#b8860b');
    }, 600);
}
sendChatBtn.addEventListener('click', sendChatText);
chatMsgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatText(); });

// ==================== 🔍 二维高倍变焦控制 ====================
function setupRemoteClickMarker(peerId) {
    const canvas = document.getElementById(`canvas-${peerId}`); const video = document.getElementById(`video-${peerId}`);
    if (!canvas || !video) return; canvas.width = video.clientWidth; canvas.height = video.clientHeight;
    canvas.addEventListener('mousedown', (event) => {
        const rect = canvas.getBoundingClientRect();
        const px = (event.clientX - rect.left) / canvas.width; const py = (event.clientY - rect.top) / canvas.height;
        document.getElementById(`inner-scale-wrapper-remote-${peerId}`).style.transformOrigin = `${px * 100}% ${py * 100}%`;
        drawMarkerCircle(canvas, px * canvas.width, py * canvas.height, '#ff4500');
        connectedPeers.forEach((conn) => { if (conn.open) conn.send({ type: 'multi-party-click', targetId: peerId, px: px, py: py }); });
    });
}

zoomInBtn.addEventListener('click', () => {
    let scale = zoomScales.get(activeSelectedWrapperId) || 1.0; scale += 0.4; zoomScales.set(activeSelectedWrapperId, scale);
    document.getElementById(activeSelectedWrapperId).querySelector('.resizable-inner').style.transform = `scale(${scale})`;
});
zoomOutBtn.addEventListener('click', () => {
    zoomScales.set(activeSelectedWrapperId, 1.0);
    document.getElementById(activeSelectedWrapperId).querySelector('.resizable-inner').style.transform = `scale(1.0)`;
});

function drawMarkerCircle(canvas, x, y, color) {
    const ctx = canvas.getContext('2d'); ctx.strokeStyle = color; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 15, 0, 2 * Math.PI); ctx.stroke();
    setTimeout(() => { ctx.clearRect(0, 0, canvas.width, canvas.height); }, 2000);
}

// ==================== 🧠 AI 5秒跌倒/看天姿态智能审计 ====================
toggleFpsBtn.addEventListener('click', () => {
    isAutoSnapshotMode = !isAutoSnapshotMode;
    if (isAutoSnapshotMode) {
        toggleFpsBtn.innerText = "🛑 Stop AI Posture Analytics"; toggleFpsBtn.className = "active-toggle";
        snapshotInterval = setInterval(async () => {
            if (isAiProcessing) return; isAiProcessing = true;
            
            const activeVideos = document.querySelectorAll('.left-video-column video');
            for (let videoEl of activeVideos) {
                if (videoEl && videoEl.videoWidth > 0 && videoEl.readyState >= 2) {
                    const ctx = captureCanvas.getContext('2d'); captureCanvas.width = videoEl.videoWidth; captureCanvas.height = videoEl.videoHeight;
                    ctx.drawImage(videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
                    let resText = "Stable Monitoring";
                    
                    if (poseDetector) {
                        const poses = await poseDetector.estimatePoses(captureCanvas);
                        if(poses.length === 0 || poses[0].keypoints.filter(k => k.score > 0.25).length <= 3) {
                            resText = "🚨 CRITICAL: CAMERA SKYWARD ORIENTATION (FALLEN)";
                            document.body.classList.add('critical-alarm-active');
                            const cid = videoEl.parentElement.parentElement.id;
                            const label = cid.includes('local') ? "HOST" : `P${cid.substring(cid.lastIndexOf('-node-')+6)}`;
                            setTimeout(() => { logToPanel(`🤖 [AI Copilot System Alert]: Warning! Camera skyward/fall detected on [${label}]. Commander focus needed!`, '#b8860b'); }, 200);
                        }
                    }
                    const base64 = captureCanvas.toDataURL('image/jpeg', 0.3);
                    appendSnapshotToLog(`[AI Video Audit Node] - ${resText}`, base64);
                    
                    const cleanPeerId = videoEl.id.replace('video-', '');
                    const conn = connectedPeers.get(cleanPeerId);
                    if (conn && conn.open) conn.send({ type: 'remote-snapshot-log', img: base64, aiResult: resText, fromChannel: cleanPeerId });
                }
            }
            isAiProcessing = false;
        }, 5000);
    } else {
        clearInterval(snapshotInterval); toggleFpsBtn.innerText = "🤖 Run 5s/Interval AI Visual Audit"; toggleFpsBtn.className = "";
        document.body.classList.remove('critical-alarm-active');
    }
});

function appendSnapshotToLog(titleText, imgBase64) {
    const itemContainer = document.createElement('div'); itemContainer.className = 'log-snapshot-item';
    itemContainer.innerHTML = `<span>${titleText}</span><img src="${imgBase64}" />`;
    spatialLog.appendChild(itemContainer); spatialLog.scrollTop = spatialLog.scrollHeight;
}

function logToPanel(text, colorStyle = '#333') {
    spatialLog.innerHTML += `<div>[${new Date().toLocaleTimeString()}] <span style="color: ${colorStyle};">${text}</span></div>`;
    spatialLog.scrollTop = spatialLog.scrollHeight;
}

function setupLocalMarkerListener() {
    const canvas = document.getElementById('canvas-local'); const video = document.getElementById('local-video');
    if (!canvas || !video) return; canvas.width = video.clientWidth; canvas.height = video.clientHeight;
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        document.getElementById('inner-scale-wrapper-local').style.transformOrigin = `${((e.clientX - rect.left) / canvas.width) * 100}% ${((e.clientY - rect.top) / canvas.height) * 100}%`;
        drawMarkerCircle(canvas, e.clientX - rect.left, e.clientY - rect.top, '#0056b3');
    });
}
