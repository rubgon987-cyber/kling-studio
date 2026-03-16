// ══════════════════════════════════════════════
// KLING STUDIO — app.js
// ══════════════════════════════════════════════

const state = {
    mode: 'text',
    duration: 5,
    quality: 'std',
    aspect: '16:9',
    motionDuration: 5,
    multiDuration: 5,
    multiAspect: '16:9',
    lipMode: 'image',
    currentVideoUrl: null,
    history: JSON.parse(localStorage.getItem('kling_history') || '[]')
};

const PRICES = {
    'kling-v1-5': [0.07, 0.14],
    'kling-v1-6': [0.10, 0.20],
    'kling-v2-0': [0.14, 0.28],
    'kling-v2-1': [0.28, 0.56],
    'kling-v3': [0.42, 0.84],
};

const MODEL_NAMES = {
    'kling-v1-5': 'Kling 1.5',
    'kling-v1-6': 'Kling 1.6',
    'kling-v2-0': 'Kling 2.0',
    'kling-v2-1': 'Kling 2.1',
    'kling-v3': 'Kling 3.0',
};

// ──────────────────────────────────────────────
// NAVEGACIÓN
// ──────────────────────────────────────────────
function showTab(tab, el) {
    document.querySelectorAll('.tab-content').forEach(t => {
        t.classList.add('hidden');
        t.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const target = document.getElementById('tab-' + tab);
    target.classList.remove('hidden');
    target.classList.add('active');
    if (el) el.classList.add('active');

    if (tab === 'gallery') renderGallery();
}

// ──────────────────────────────────────────────
// TAB GENERAR — controles
// ──────────────────────────────────────────────

// FIX: prompt SIEMPRE visible, solo agrega/quita campo de imagen
function setMode(mode) {
    state.mode = mode;
    document.getElementById('btn-mode-text').classList.toggle('active', mode === 'text');
    document.getElementById('btn-mode-image').classList.toggle('active', mode === 'image');
    document.getElementById('field-image').classList.toggle('hidden', mode === 'text');
}

function setDuration(d) {
    state.duration = d;
    document.getElementById('dur-5').classList.toggle('active', d === 5);
    document.getElementById('dur-10').classList.toggle('active', d === 10);
    updateCost();
}

function setQuality(q) {
    state.quality = q;
    document.getElementById('q-std').classList.toggle('active', q === 'std');
    document.getElementById('q-pro').classList.toggle('active', q === 'pro');
}

function setAspect(a) {
    state.aspect = a;
    ['169','916','11'].forEach(id => document.getElementById('asp-'+id).classList.remove('active'));
    const map = {'16:9':'169','9:16':'916','1:1':'11'};
    document.getElementById('asp-'+map[a]).classList.add('active');
}

function updateCost() {
    const model = document.getElementById('model').value;
    const price = PRICES[model][state.duration === 5 ? 0 : 1];
    document.getElementById('cost-display').textContent = '$' + price.toFixed(2);
    document.getElementById('cost-note').textContent =
        MODEL_NAMES[model] + ' · ' + state.duration + ' seg · ' + (state.quality === 'std' ? 'Standard' : 'Pro');
}

// ──────────────────────────────────────────────
// GENERAR VIDEO (Texto/Imagen)
// ──────────────────────────────────────────────
async function generateVideo() {
    if (!checkApiKey()) return;

    const prompt = document.getElementById('prompt').value.trim();
    if (!prompt) { alert('Escribe una descripción del video'); return; }

    if (state.mode === 'image') {
        const img = document.getElementById('image-input');
        if (!img.files[0]) { alert('Sube una imagen de inicio'); return; }
    }

    showGenerating('generating', 'gen-status', 'preview-placeholder', 'result-video', 'video-actions', 'btn-generate', 'btn-label');

    try {
        const fd = buildBaseFormData();
        fd.append('action', 'generate');
        fd.append('prompt', prompt);
        fd.append('negative_prompt', document.getElementById('negative-prompt').value);
        fd.append('model', document.getElementById('model').value);
        fd.append('duration', state.duration);
        fd.append('aspect_ratio', state.aspect);
        fd.append('mode', state.mode);
        fd.append('quality', state.quality);

        if (state.mode === 'image') {
            fd.append('image', document.getElementById('image-input').files[0]);
        }

        const { taskId, taskType } = await submitTask(fd, 'gen-status');
        const url = await pollStatus(taskId, taskType, 'gen-status', 'progress-fill');

        showResult('result-video', url, 'generating', 'video-actions');
        saveHistory(url, prompt, document.getElementById('model').value, state.duration, 'Video');

    } catch(e) {
        handleError(e, 'generating', 'preview-placeholder', 'btn-generate', 'btn-label', '▶ Generar Video');
    }
}

// ──────────────────────────────────────────────
// LIP SYNC
// ──────────────────────────────────────────────
function setLipMode(mode) {
    state.lipMode = mode;
    document.getElementById('lip-btn-image').classList.toggle('active', mode === 'image');
    document.getElementById('lip-btn-video').classList.toggle('active', mode === 'video');
    document.getElementById('lip-field-image').classList.toggle('hidden', mode !== 'image');
    document.getElementById('lip-field-video').classList.toggle('hidden', mode !== 'video');
}

function toggleTTS(val) {
    document.getElementById('lip-tts-field').classList.toggle('hidden', val !== 'text2video');
}

function showAudioName(input) {
    if (input.files[0]) {
        document.getElementById('audio-name').textContent = '✓ ' + input.files[0].name;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const audioMode = document.getElementById('lip-audio-mode');
    if (audioMode) {
        audioMode.addEventListener('change', () => {
            const isTTS = audioMode.value === 'text2video';
            document.getElementById('lip-tts-field').classList.toggle('hidden', !isTTS);
        });
    }
});

async function generateLipSync() {
    if (!checkApiKey()) return;

    const hasImage = state.lipMode === 'image' && document.getElementById('lip-image-input').files[0];
    const hasVideo = state.lipMode === 'video' && document.getElementById('lip-video-input').files[0];
    const hasAudio = document.getElementById('lip-audio-input').files[0];
    const audioMode = document.getElementById('lip-audio-mode').value;
    const ttsText = document.getElementById('lip-tts-text').value.trim();

    if (!hasImage && !hasVideo) { alert('Sube una foto o video de la persona'); return; }
    if (audioMode === 'audio2video' && !hasAudio) { alert('Sube el archivo de audio'); return; }
    if (audioMode === 'text2video' && !ttsText) { alert('Escribe el texto que dirá la persona'); return; }

    showGenerating('lip-generating', 'lip-status', 'lip-placeholder', 'lip-result-video', 'lip-video-actions');

    try {
        const fd = buildBaseFormData();
        fd.append('action', 'lipsync');
        fd.append('lip_mode', state.lipMode);
        fd.append('audio_mode', audioMode);

        if (state.lipMode === 'image') fd.append('image', document.getElementById('lip-image-input').files[0]);
        else fd.append('video', document.getElementById('lip-video-input').files[0]);

        if (audioMode === 'audio2video') fd.append('audio', document.getElementById('lip-audio-input').files[0]);
        else fd.append('tts_text', ttsText);

        const { taskId, taskType } = await submitTask(fd, 'lip-status');
        const url = await pollStatus(taskId, taskType, 'lip-status');

        showResult('lip-result-video', url, 'lip-generating', 'lip-video-actions');
        saveHistory(url, 'Lip Sync', 'Kling', 0, 'Lip Sync');

    } catch(e) {
        handleError(e, 'lip-generating', 'lip-placeholder');
        alert('Error Lip Sync: ' + e.message);
    }
}

function resetLip() {
    document.getElementById('lip-result-video').classList.add('hidden');
    document.getElementById('lip-video-actions').classList.add('hidden');
    document.getElementById('lip-placeholder').style.display = 'flex';
}

// ──────────────────────────────────────────────
// MOTION CONTROL
// ──────────────────────────────────────────────
function updateCamLabel(sliderId, labelId) {
    document.getElementById(labelId).textContent = document.getElementById(sliderId).value;
    updateMotionCost();
}

function updateMotionCost() {
    // Motion Control fijo: kling-v1-5, pro, 5s — $0.07
    const el = document.getElementById('motion-cost');
    if (el) el.textContent = '$0.07';
}

function setMotionDuration(d) {
    state.motionDuration = d;
}

const PRESETS = {
    zoom_in:   {horizontal:0, vertical:0, zoom:8,  roll:0},
    zoom_out:  {horizontal:0, vertical:0, zoom:-8, roll:0},
    pan_left:  {horizontal:-8,vertical:0, zoom:0,  roll:0},
    pan_right: {horizontal:8, vertical:0, zoom:0,  roll:0},
    tilt_up:   {horizontal:0, vertical:8, zoom:0,  roll:0},
    orbit:     {horizontal:5, vertical:2, zoom:3,  roll:2},
};

function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    document.getElementById('cam-horizontal').value = p.horizontal;
    document.getElementById('cam-vertical').value = p.vertical;
    document.getElementById('cam-zoom').value = p.zoom;
    document.getElementById('cam-roll').value = p.roll;
    document.getElementById('cam-h-val').textContent = p.horizontal;
    document.getElementById('cam-v-val').textContent = p.vertical;
    document.getElementById('cam-z-val').textContent = p.zoom;
    document.getElementById('cam-r-val').textContent = p.roll;
}

function showMotionVideoName(input) {
    if (input.files[0]) {
        document.getElementById('motion-video-name').textContent = '✓ ' + input.files[0].name;
    }
}

async function generateMotion() {
    if (!checkApiKey()) return;

    const imgInput = document.getElementById('motion-image-input');
    if (!imgInput.files[0]) { alert('Sube una imagen base'); return; }

    showGenerating('motion-generating', 'motion-status', 'motion-placeholder', 'motion-result-video', 'motion-video-actions');

    try {
        const fd = buildBaseFormData();
        fd.append('action', 'motion');
        fd.append('image', imgInput.files[0]);
        fd.append('prompt', document.getElementById('motion-prompt').value);
        fd.append('model', 'kling-v1-5');
        fd.append('duration', state.motionDuration);
        fd.append('cam_horizontal', document.getElementById('cam-horizontal').value);
        fd.append('cam_vertical', document.getElementById('cam-vertical').value);
        fd.append('cam_zoom', document.getElementById('cam-zoom').value);
        fd.append('cam_roll', document.getElementById('cam-roll').value);

        const refVideo = document.getElementById('motion-video-input').files[0];
        if (refVideo) fd.append('ref_video', refVideo);

        const { taskId, taskType } = await submitTask(fd, 'motion-status');
        const url = await pollStatus(taskId, taskType, 'motion-status');

        showResult('motion-result-video', url, 'motion-generating', 'motion-video-actions');
        saveHistory(url, document.getElementById('motion-prompt').value || 'Motion Control', 'kling-v1-5', 5, 'Motion');

    } catch(e) {
        handleError(e, 'motion-generating', 'motion-placeholder');
        alert('Error Motion Control: ' + e.message);
    }
}

function resetMotion() {
    document.getElementById('motion-result-video').classList.add('hidden');
    document.getElementById('motion-video-actions').classList.add('hidden');
    document.getElementById('motion-placeholder').style.display = 'flex';
}

// ──────────────────────────────────────────────
// MULTI-IMAGEN
// ──────────────────────────────────────────────
function previewMulti(i) {
    const file = document.getElementById('multi-file-' + i).files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const img = document.getElementById('multi-preview-' + i);
        img.src = e.target.result;
        img.classList.remove('hidden');
        const slot = document.getElementById('slot-' + i);
        const icon = slot.querySelector('.slot-icon');
        const text = slot.querySelector('.slot-text');
        if (icon) icon.style.display = 'none';
        if (text) text.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function setMultiDuration(d) {
    state.multiDuration = d;
    document.getElementById('multidur-5').classList.toggle('active', d === 5);
    document.getElementById('multidur-10').classList.toggle('active', d === 10);
}

function setMultiAspect(a) {
    state.multiAspect = a;
    ['169','916','11'].forEach(id => document.getElementById('masp-'+id).classList.remove('active'));
    const map = {'16:9':'169','9:16':'916','1:1':'11'};
    document.getElementById('masp-'+map[a]).classList.add('active');
}

async function generateMulti() {
    if (!checkApiKey()) return;

    const prompt = document.getElementById('multi-prompt').value.trim();
    if (!prompt) { alert('Escribe una descripción del video'); return; }

    const files = [0,1,2,3].map(i => document.getElementById('multi-file-'+i).files[0]).filter(Boolean);
    if (files.length < 2) { alert('Sube al menos 2 imágenes'); return; }

    showGenerating('multi-generating', 'multi-status', 'multi-placeholder', 'multi-result-video', 'multi-video-actions');

    try {
        const fd = buildBaseFormData();
        fd.append('action', 'multi');
        fd.append('prompt', prompt);
        fd.append('negative_prompt', document.getElementById('multi-neg-prompt').value);
        fd.append('model', document.getElementById('multi-model').value);
        fd.append('duration', state.multiDuration);
        fd.append('aspect_ratio', state.multiAspect);
        files.forEach((f, i) => fd.append('images[]', f));

        const { taskId, taskType } = await submitTask(fd, 'multi-status');
        const url = await pollStatus(taskId, taskType, 'multi-status');

        showResult('multi-result-video', url, 'multi-generating', 'multi-video-actions');
        saveHistory(url, prompt, document.getElementById('multi-model').value, state.multiDuration, 'Multi-Imagen');

    } catch(e) {
        handleError(e, 'multi-generating', 'multi-placeholder');
        alert('Error Multi-Imagen: ' + e.message);
    }
}

function resetMulti() {
    document.getElementById('multi-result-video').classList.add('hidden');
    document.getElementById('multi-video-actions').classList.add('hidden');
    document.getElementById('multi-placeholder').style.display = 'flex';
}

// ──────────────────────────────────────────────
// GALERÍA
// ──────────────────────────────────────────────
function renderGallery() {
    const grid = document.getElementById('gallery-grid');
    if (!state.history.length) {
        grid.innerHTML = `<div class="gallery-empty"><div style="font-size:48px;opacity:0.3">▶</div><p>Aún no has generado videos</p></div>`;
        return;
    }
    grid.innerHTML = state.history.map(item => `
        <div class="gallery-item">
            <video src="${item.url}" controls preload="metadata"></video>
            <div class="gallery-item-info">
                <div class="gallery-item-prompt">${item.prompt}</div>
                <div class="gallery-item-meta">${item.type} · ${item.model} · ${item.date}</div>
            </div>
        </div>
    `).join('');
}

// ──────────────────────────────────────────────
// CONFIGURACIÓN API
// ──────────────────────────────────────────────
function saveApiKey() {
    const key    = document.getElementById('api-key-input').value.trim();
    const secret = document.getElementById('api-secret-input').value.trim();
    const status = document.getElementById('api-status');

    if (!key || !secret) {
        status.className = 'api-status error';
        status.textContent = 'Ingresa tanto la API Key como el API Secret';
        return;
    }

    localStorage.setItem('kling_api_key', key);
    localStorage.setItem('kling_api_secret', secret);
    status.className = 'api-status success';
    status.textContent = '✓ API Key guardada correctamente';
    document.getElementById('credits-display').textContent = 'API conectada ✓';
}

function checkApiKey() {
    const key = localStorage.getItem('kling_api_key');
    const secret = localStorage.getItem('kling_api_secret');
    if (!key || !secret) {
        alert('⚠️ Primero configura tu API Key en Configuración');
        return false;
    }
    return true;
}

// ──────────────────────────────────────────────
// HELPERS COMPARTIDOS
// ──────────────────────────────────────────────
function buildBaseFormData() {
    const fd = new FormData();
    fd.append('api_key', localStorage.getItem('kling_api_key'));
    fd.append('api_secret', localStorage.getItem('kling_api_secret'));
    return fd;
}

async function submitTask(fd, statusId) {
    const res = await fetch('api.php', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!data.task_id) throw new Error('No se recibió task_id de la API');
    document.getElementById(statusId).textContent = 'Procesando en Kling (1-3 min)...';
    return { taskId: data.task_id, taskType: data.task_type || '' };
}

async function pollStatus(taskId, taskType, statusId, progressId) {
    const apiKey    = localStorage.getItem('kling_api_key');
    const apiSecret = localStorage.getItem('kling_api_secret');

    for (let i = 0; i < 72; i++) {
        await sleep(5000);
        const url = `api.php?action=status&task_id=${taskId}&task_type=${encodeURIComponent(taskType)}&api_key=${encodeURIComponent(apiKey)}&api_secret=${encodeURIComponent(apiSecret)}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.status === 'succeed' && data.video_url) return data.video_url;
        if (data.status === 'failed') throw new Error('La generación falló en Kling');

        const pct = Math.min(88, (i / 72) * 100);
        if (statusId) document.getElementById(statusId).textContent = `Procesando... ${Math.round(pct)}%`;
        if (progressId) document.getElementById(progressId).style.width = pct + '%';
    }
    throw new Error('Tiempo de espera agotado (6 min). Intenta de nuevo.');
}

function showGenerating(genId, statusId, placeholderId, videoId, actionsId, btnId, btnLabelId) {
    if (placeholderId) document.getElementById(placeholderId).style.display = 'none';
    if (videoId)    document.getElementById(videoId).classList.add('hidden');
    if (actionsId)  document.getElementById(actionsId).classList.add('hidden');
    document.getElementById(genId).classList.remove('hidden');
    if (btnId)      document.getElementById(btnId).disabled = true;
    if (btnLabelId) document.getElementById(btnLabelId).textContent = 'Generando...';
}

function showResult(videoId, url, genId, actionsId) {
    document.getElementById(genId).classList.add('hidden');
    const video = document.getElementById(videoId);
    video.src = url;
    video.classList.remove('hidden');
    document.getElementById(actionsId).classList.remove('hidden');
    state.currentVideoUrl = url;
}

function handleError(e, genId, placeholderId, btnId, btnLabelId, btnText) {
    document.getElementById(genId).classList.add('hidden');
    if (placeholderId) document.getElementById(placeholderId).style.display = 'flex';
    if (btnId) document.getElementById(btnId).disabled = false;
    if (btnLabelId) document.getElementById(btnLabelId).textContent = btnText || '▶ Generar';
    console.error(e);
}

function saveHistory(url, prompt, model, duration, type) {
    state.history.unshift({
        url, prompt,
        model: MODEL_NAMES[model] || model,
        duration, type,
        date: new Date().toLocaleDateString('es-ES')
    });
    localStorage.setItem('kling_history', JSON.stringify(state.history));
}

function previewImage(input, previewId) {
    if (!input.files[0]) return;
    const reader = new FileReader();
    reader.onload = e => {
        const img = document.getElementById(previewId);
        img.src = e.target.result;
        img.classList.remove('hidden');
    };
    reader.readAsDataURL(input.files[0]);
}

function downloadVideo(videoId) {
    const video = document.getElementById(videoId);
    if (video && video.src) {
        const a = document.createElement('a');
        a.href = video.src;
        a.download = 'kling_video_' + Date.now() + '.mp4';
        a.click();
    }
}

function resetPreview() {
    state.currentVideoUrl = null;
    document.getElementById('result-video').classList.add('hidden');
    document.getElementById('video-actions').classList.add('hidden');
    document.getElementById('preview-placeholder').style.display = 'flex';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    const key    = localStorage.getItem('kling_api_key');
    const secret = localStorage.getItem('kling_api_secret');
    if (key)    document.getElementById('api-key-input').value = key;
    if (secret) document.getElementById('api-secret-input').value = secret;
    if (key)    document.getElementById('credits-display').textContent = 'API conectada ✓';
    updateCost();
    updateMotionCost();
});
