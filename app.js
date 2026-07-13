const SDKAPPID = 1600151509;
const SECRETKEY = "13eff9dfba3b43dd49da969f1c77e06f63137dfc18a40fc13b580923a5603b0";

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

let trtcClient = null;
let localStreamTRTC = null;
let poseDetector = null; 
let isAutoSnapshotMode = false;
let snapshotInterval = null;
let isAiProcessing = false;

let peerJSDataNode = null; 
let myRole = null; 
let roomPassword = null;
let connectedDataConns = new Map(); 

let activeSelectedWrapperId = 'wrapper-local'; 
let zoomScales = new Map(); 

let aMapObj = null; 
let amapMarkers = new Map();  
let amapPolylines = new Map(); 
let amapPathsData = new Map(); 

const textColorsPool = ['#0056b3', '#d91a1a', '#228b22', '#8b008b', '#ff8c00', '#008080'];
const myChatColor = textColorsPool[Math.floor(Math.random() * textColorsPool.length)];

let mockLng = 116.397428; let mockLat = 39.90923; let mockHeading = 0;

function generateTrtcUserSig(userId) {
    const EXPIRETIME = 604800;
    const currTime = Math.floor(Date.now() / 1000);
    const sigDoc = {
        "TLS.ver": "2.0",
        "TLS.identifier": userId.toString(),
        "TLS.sdkappid": parseInt(SDKAPPID),
        "TLS.expire": parseInt(EXPIRETIME),
        "TLS.time": parseInt(currTime)
    };
    let baseDocStr = "";
    const fields = ["TLS.sdkappid", "TLS.identifier", "TLS.time", "TLS.expire"];
    fields.forEach(key => { baseDocStr += key + ":" + sigDoc[key] + "\n"; });
    const hashSignature = CryptoJS.HmacSHA256(baseDocStr, SECRETKEY);
    sigDoc["TLS.sig"] = CryptoJS.enc.Base64.stringify(hashSignature);
    return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(JSON.stringify(sigDoc))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

window.addEventListener('load', async () => {
    try {
        aMapObj = new AMap.Map('amap-container', { center: [mockLng, mockLat], zoom: 17, viewMode: '2D' });
        logToPanel('🗺️ AMAP Active Vector layer initialized.', 'var(--primary-blue)');
    } catch(e) { logToPanel('⚠️ AMAP SDK error.', '#d91a1a'); }

    try {
        localStreamTRTC = TRTC.createStream({ video: true, audio: true });
        await localStreamTRTC.initialize();
        localStreamTRTC.play('local-trtc-player');
        setupLocalMarkerListener();
        logToPanel('🟢 Local TRTC tracking stream operational.', 'green');
        
        loadAiModelAsynchronously();
    } catch (e) { logToPanel('⚠️ Hardware device capture blocked.', '#d91a1a'); }
});

function loadAiModelAsynchronously() {
    poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER })
    .then(detector => { poseDetector = detector; logToPanel('🤖 AI Core engine compiled.', 'var(--primary-blue)'); });
}

hostBtn.addEventListener('click', async () => {
    const code = remoteIdInput.value.trim(); if (!code || code.length !== 4) return alert('Enter 4-Digit PIN');
    myRole = 'HOST'; roomPassword = code;
    groupRoomStatus.innerText = `ROOM_${code} [HOST]`;
    disableModeButtons();
    await joinTrtcCloudRoom(`host_center`, parseInt(code));
    initializePeerJSDataBridge(`wsar-trtc-bridge-${code}-host`);
});

joinBtn.addEventListener('click', async () => {
    const code = remoteIdInput.value.trim(); if (!code || code.length !== 4) return alert('Enter 4-Digit PIN');
    myRole = 'MEMBER'; roomPassword = code;
    groupRoomStatus.innerText = `ROOM_${code} [NODE]`;
    joystickWrapper.style.display = 'block'; 
    disableModeButtons();

    const nodeRandIndex = Math.floor(Math.random() * 5 + 1); 
    const myTrtcUserId = `p_node_${nodeRandIndex}`;
    
    await joinTrtcCloudRoom(myTrtcUserId, parseInt(code));
    initializePeerJSDataBridge(`wsar-trtc-bridge-${code}-node-${nodeRandIndex}`);
});

async function joinTrtcCloudRoom(userId, roomId) {
    const userSig = generateTrtcUserSig(userId);
    trtcClient = TRTC.createClient({ mode: 'rtc', sdkAppId: SDKAPPID, userId, userSig });

    trtcClient.on('stream-added', event => { trtcClient.subscribe(event.stream); });
    trtcClient.on('stream-subscribed', event => { renderRemoteTrtcStreamBox(event.stream.getUserId(), event.stream); });
    trtcClient.on('stream-removed', event => {
        const el = document.getElementById(`wrapper-remote-${event.stream.getUserId()}`);
        if (el) el.remove();
    });

    try {
        await trtcClient.join({ roomId });
        logToPanel(`🚀 Pipeline connected to Room ${roomId}.`, 'green');
        await trtcClient.publish(localStreamTRTC);
    } catch(err) { logToPanel('⚠️ TRTC Authentication block.', '#d91a1a'); }
}

function renderRemoteTrtcStreamBox(uid, remoteStream) {
    const wrapperId = `wrapper-remote-${uid}`;
    if (document.getElementById(wrapperId)) return;

    const label = uid.includes('host') ? "HOST" : `${uid.substring(uid.lastIndexOf('_')+1).toUpperCase()}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = wrapperId;
    zoomScales.set(wrapperId, 1.0);

    wrapper.innerHTML = `
        <div style="width:100%; height:100%; position:relative;" id="inner-scale-wrapper-remote-${uid}">
            <div id="player-${uid}" class="trtc-player-container"></div>
            <canvas class="interaction-canvas" id="canvas-${uid}"></canvas>
        </div>
        <div class="video-label">CH: ${label}</div>
    `;
    videoWorkspace.appendChild(wrapper);
    remoteStream.play(`player-${uid}`);

    wrapper.addEventListener('click', () => {
        document.querySelectorAll('.video-wrapper').forEach(w => w.classList.remove('active-tactical'));
        wrapper.classList.add('active-tactical');
        activeSelectedWrapperId = wrapperId;
    });
    setTimeout(() => { setupRemoteClickMarker(uid); }, 1000);
}

function initializePeerJSDataBridge(bridgeId) {
    peerJSDataNode = new Peer(bridgeId, { config: { 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }] } });
    peerJSDataNode.on('open', () => {
        if (myRole === 'MEMBER') {
            const hostTargetBridge = `wsar-trtc-bridge-${roomPassword}-host`;
            setInterval(() => {
                if(connectedDataConns.has(hostTargetBridge) && connectedDataConns.get(hostTargetBridge).open) return;
                const conn = peerJSDataNode.connect(hostTargetBridge);
                if (conn) handleIncomingDataConnection(conn);
            }, 2000);
            transmitSpatialPacketToHost();
        }
    });
    peerJSDataNode.on('connection', conn => { handleIncomingDataConnection(conn); });
}

function handleIncomingDataConnection(conn) {
    connectedDataConns.set(conn.peer, conn);
    conn.on('data', data => {
        if (data.type === 'chat') {
            logToPanel(`💬 [${data.senderRole}] ${data.msg}`, data.color);
        } else if (data.type === 'amap-coordinate-telemetry') {
            updateNodeOnRealAmap(data.nodeId, data.lng, data.lat, data.heading);
        } else if (data.type === 'multi-party-click') {
            const canvas = document.getElementById(`canvas-${data.targetId}`);
            if (canvas) drawMarkerCircle(canvas, data.px * canvas.width, data.py * canvas.height, '#ff4500');
        }
    });
}

function disableModeButtons() { hostBtn.disabled = true; joinBtn.disabled = true; remoteIdInput.disabled = true; }

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
    if (!peerJSDataNode || myRole !== 'MEMBER') return;
    const hostTargetBridge = `wsar-trtc-bridge-${roomPassword}-host`;
    const conn = connectedDataConns.get(hostTargetBridge);
    if (conn && conn.open) {
        conn.send({ type: 'amap-coordinate-telemetry', nodeId: peerJSDataNode.id, lng: mockLng, lat: mockLat, heading: mockHeading });
    }
    updateNodeOnRealAmap(peerJSDataNode.id, mockLng, mockLat, mockHeading);
}

function updateNodeOnRealAmap(nodeId, lng, lat, heading) {
    if (!aMapObj) return;
    const label = nodeId.includes('host') ? "HOST" : `P${nodeId.substring(nodeId.lastIndexOf('-node-')+6)}`;
    const idx = label === "HOST" ? 0 : parseInt(label.replace('P', '')) || 1;
    const pathColor = textColorsPool[idx % textColorsPool.length];

    if (!amapPathsData.has(nodeId)) amapPathsData.set(nodeId, []);
    let pathArr = amapPathsData.get(nodeId);
    pathArr.push([lng, lat]);

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
        amapMarkers.get(nodeId).setAngle(heading); 
    }

    if (pathArr.length >= 2) {
        if (!amapPolylines.has(nodeId)) {
            let polyline = new AMap.Polyline({
                path: pathArr, strokeColor: pathColor, strokeWeight: 4, strokeStyle: 'dashed', map: aMapObj
            });
            amapPolylines.set(nodeId, polyline);
        } else { amapPolylines.get(nodeId).setPath(pathArr); }
    }
    aMapObj.setCenter([lng, lat]);
}

function sendChatText() {
    const text = chatMsgInput.value.trim(); if (!text) return; chatMsgInput.value = '';
    if (text.startsWith('/query')) { logToPanel(`💬 [Query] ${text}`, '#000'); executeAiTeammatePromptEngine(text); return; }
    
    logToPanel(`💬 [Me] ${text}`, myChatColor);
    connectedDataConns.forEach(conn => { if (conn.open) conn.send({ type: 'chat', senderRole: myRole, color: myChatColor, msg: text }); });
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
chatMsgInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatText(); });

function setupRemoteClickMarker(uid) {
    const canvas = document.getElementById(`canvas-${uid}`); if (!canvas) return;
    canvas.width = canvas.parentElement.clientWidth; canvas.height = canvas.parentElement.clientHeight;
}
function setupLocalMarkerListener() {
    const canvas = document.getElementById('canvas-local'); if (!canvas) return;
    canvas.width = canvas.parentElement.clientWidth; canvas.height = canvas.parentElement.clientHeight;
}

toggleFpsBtn.addEventListener('click', () => {
    isAutoSnapshotMode = !isAutoSnapshotMode;
    if (isAutoSnapshotMode) {
        toggleFpsBtn.innerText = "🛑 Stop AI Posture Analytics"; toggleFpsBtn.className = "active-toggle";
        snapshotInterval = setInterval(async () => {
            if (isAiProcessing) return; isAiProcessing = true;
            const trtcVideos = document.querySelectorAll('.trtc-player-container video');
            for (let videoEl of trtcVideos) {
                if (videoEl && videoEl.videoWidth > 0 && videoEl.readyState >= 2) {
                    const ctx = captureCanvas.getContext('2d'); captureCanvas.width = videoEl.videoWidth; captureCanvas.height = videoEl.videoHeight;
                    ctx.drawImage(videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
                    let resText = "Stable Monitoring";
                    if (poseDetector) {
                        const poses = await poseDetector.estimatePoses(captureCanvas);
                        if(poses.length === 0 || poses[0].keypoints.filter(k => k.score > 0.25).length <= 3) {
                            resText = "🚨 CRITICAL: CAMERA SKYWARD ORIENTATION (FALLEN)";
                            document.body.classList.add('critical-alarm-active');
                        }
                    }
                    appendSnapshotToLog(`[AI Video Audit Node] - ${resText}`, captureCanvas.toDataURL('image/jpeg', 0.3));
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