// ══════════════════════════════════════════════
// KLING STUDIO — app.js v7
// ══════════════════════════════════════════════
window.APP_VERSION = 'v16';

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

    // Audio nativo solo disponible en kling-v3
    const audioSection = document.getElementById('field-audio-native');
    if (audioSection) audioSection.classList.toggle('hidden', model !== 'kling-v3');
}

function toggleVoiceLang() {
    const enabled = document.getElementById('gen-audio').checked;
    const langField = document.getElementById('field-voice-lang');
    if (langField) langField.classList.toggle('hidden', !enabled);
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
        const payload = buildBasePayload();
        payload.prompt          = prompt;
        payload.negative_prompt = document.getElementById('negative-prompt').value;
        payload.model           = document.getElementById('model').value;
        payload.duration        = String(state.duration);
        payload.aspect_ratio    = state.aspect;
        payload.mode            = state.mode;
        payload.quality         = state.quality;

        if (state.mode === 'image') {
            payload.image_data = await fileToBase64(document.getElementById('image-input').files[0]);
        }

        // Audio nativo (solo kling-v3)
        if (payload.model === 'kling-v3') {
            const genAudio = document.getElementById('gen-audio');
            payload.generate_audio = genAudio ? genAudio.checked : true;
            if (payload.generate_audio) {
                const voiceLang = document.getElementById('voice-language');
                payload.voice_language = voiceLang ? voiceLang.value : 'en';
            }
        }

        const { taskId, taskType } = await submitTask(payload, 'generate', 'gen-status');
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
        const payload = buildBasePayload();
        payload.lip_mode   = state.lipMode;
        payload.audio_mode = audioMode;

        if (state.lipMode === 'image') payload.image_data = await fileToBase64(document.getElementById('lip-image-input').files[0]);
        else payload.video_data = await fileToBase64(document.getElementById('lip-video-input').files[0]);

        if (audioMode === 'audio2video') payload.audio_data = await fileToBase64(document.getElementById('lip-audio-input').files[0]);
        else payload.tts_text = ttsText;

        const { taskId, taskType } = await submitTask(payload, 'lipsync', 'lip-status');
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

const MOTION_PRICES = {
    'kling-v1-5': 0.07,
    'kling-v1-6': 0.14,
    'kling-v2-6': 0.28,
    'kling-v3':   0.42,
};
const MOTION_MODEL_NAMES = {
    'kling-v1-5': 'Kling 1.5',
    'kling-v1-6': 'Kling 1.6',
    'kling-v2-6': 'Kling 2.6',
    'kling-v3':   'Kling 3.0',
};

const CAMERA_CTRL_MODELS = new Set(['kling-v1-5', 'kling-v1-6']);

function updateMotionCost() {
    const model = document.getElementById('motion-model')?.value || 'kling-v1-5';
    const price = MOTION_PRICES[model] || 0.07;
    const el = document.getElementById('motion-cost');
    const note = document.getElementById('motion-cost-note');
    if (el) el.textContent = '$' + price.toFixed(2);
    if (note) note.textContent = (MOTION_MODEL_NAMES[model] || model) + ' · Pro · 5 seg';

    // Mostrar/ocultar sliders de cámara y opciones avanzadas según modelo
    const isOld = CAMERA_CTRL_MODELS.has(model);
    const camSection    = document.getElementById('cam-controls-section');
    const newModelHint  = document.getElementById('new-model-hint');
    const newModelOpts  = document.getElementById('new-model-options');
    if (camSection)   camSection.classList.toggle('hidden', !isOld);
    if (newModelHint) newModelHint.classList.toggle('hidden', isOld);
    if (newModelOpts) newModelOpts.classList.toggle('hidden', isOld);
}

function setRefVideoMode(mode) {
    document.getElementById('refvid-btn-url').classList.toggle('active', mode === 'url');
    document.getElementById('refvid-btn-file').classList.toggle('active', mode === 'file');
    document.getElementById('refvid-url-field').classList.toggle('hidden', mode !== 'url');
    document.getElementById('refvid-file-field').classList.toggle('hidden', mode !== 'file');
}

function setMotionDuration(d) {
    state.motionDuration = d;
    document.getElementById('mdur-5').classList.toggle('active', d === 5);
    document.getElementById('mdur-10').classList.toggle('active', d === 10);
    updateMotionCost();
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

    const model = document.getElementById('motion-model').value;

    // Video de referencia: URL o archivo
    const refVideoUrl  = document.getElementById('motion-video-url').value.trim();
    const refVideoFile = document.getElementById('motion-video-input')?.files[0];
    const isFileMode   = !document.getElementById('refvid-file-field').classList.contains('hidden');

    const MAX_VIDEO_MB = 5;
    if (isFileMode && refVideoFile && refVideoFile.size > MAX_VIDEO_MB * 1024 * 1024) {
        alert(`El video es demasiado grande (${(refVideoFile.size/1024/1024).toFixed(1)}MB). Maximo: ${MAX_VIDEO_MB}MB.\nUsa la opcion "Pegar URL" para videos grandes.`);
        return;
    }

    showGenerating('motion-generating', 'motion-status', 'motion-placeholder', 'motion-result-video', 'motion-video-actions');

    try {
        const payload = buildBasePayload();
        payload.image_data     = await fileToBase64(imgInput.files[0]);
        payload.model          = model;
        payload.prompt         = document.getElementById('motion-prompt').value;
        payload.cam_horizontal = document.getElementById('cam-horizontal').value;
        payload.cam_vertical   = document.getElementById('cam-vertical').value;
        payload.cam_zoom       = document.getElementById('cam-zoom').value;
        payload.cam_roll       = document.getElementById('cam-roll').value;

        if (!isFileMode && refVideoUrl) {
            payload.ref_video_url = refVideoUrl;
        } else if (isFileMode && refVideoFile) {
            payload.ref_video_data = await fileToBase64(refVideoFile);
        }

        // Opciones de v2.6 / v3.0
        if (!CAMERA_CTRL_MODELS.has(model)) {
            payload.character_orientation = document.getElementById('character-orientation').value;
            payload.keep_sound            = document.getElementById('keep-sound').checked;
            payload.cfg_scale             = document.getElementById('motion-cfg').value;
            payload.duration              = String(state.motionDuration);
        }

        const { taskId, taskType } = await submitTask(payload, 'motion', 'motion-status');
        const url = await pollStatus(taskId, taskType, 'motion-status');

        showResult('motion-result-video', url, 'motion-generating', 'motion-video-actions');
        saveHistory(url, document.getElementById('motion-prompt').value || 'Motion Control', model, 5, 'Motion');

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
        const payload = buildBasePayload();
        payload.prompt          = prompt;
        payload.negative_prompt = document.getElementById('multi-neg-prompt').value;
        payload.model           = document.getElementById('multi-model').value;
        payload.duration        = String(state.multiDuration);
        payload.aspect_ratio    = state.multiAspect;
        payload.images_data     = await Promise.all(files.map(fileToBase64));

        const { taskId, taskType } = await submitTask(payload, 'multi', 'multi-status');
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

// Comprime imagen a máx 480px JPEG 65% (~15-35KB) para pasar límite del proxy nginx
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
            return;
        }
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = e => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                const MAX = 480;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) {
                    if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                    else       { w = Math.round(w * MAX / h); h = MAX; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.65));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function buildBasePayload() {
    return {
        api_key:    localStorage.getItem('kling_api_key'),
        api_secret: localStorage.getItem('kling_api_secret'),
    };
}

async function submitTask(payload, action, statusId) {
    const bodyStr = JSON.stringify(payload);
    console.log('[Kling v7] POST /api/' + action + ' — payload: ' + (bodyStr.length / 1024).toFixed(1) + 'KB');

    const res  = await fetch('/api/' + action, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    bodyStr,
    });

    const text = await res.text();
    console.log('[Kling v7] HTTP ' + res.status + ' — primeros 120 chars: ' + text.slice(0, 120));

    let data;
    try {
        data = JSON.parse(text);
    } catch(parseErr) {
        console.error('[Kling v7] JSON.parse falló:', parseErr.message);
        throw new Error('HTTP ' + res.status + ' — servidor devolvio HTML en vez de JSON (payload: ' + (bodyStr.length/1024).toFixed(1) + 'KB). Revisa la consola.');
    }
    if (data.error) throw new Error(data.error);
    if (!data.task_id) throw new Error('No se recibio task_id de la API');
    document.getElementById(statusId).textContent = 'Procesando en Kling (1-3 min)...';
    return { taskId: data.task_id, taskType: data.task_type || '' };
}

async function pollStatus(taskId, taskType, statusId, progressId) {
    const apiKey    = localStorage.getItem('kling_api_key');
    const apiSecret = localStorage.getItem('kling_api_secret');

    const MAX = 120; // 10 minutos
    for (let i = 0; i < MAX; i++) {
        await sleep(5000);
        const url = `/api/status?task_id=${taskId}&task_type=${encodeURIComponent(taskType)}&api_key=${encodeURIComponent(apiKey)}&api_secret=${encodeURIComponent(apiSecret)}`;
        const res  = await fetch(url);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch(_) {
            console.warn('[Poll] parse error en intento', i, text.slice(0, 80));
            continue;
        }

        console.log('[Poll] intento', i, '→ status:', data.status, '| error:', data.error || '-');

        if (data.error) throw new Error(data.error);
        if (data.status === 'succeed' && data.video_url) return data.video_url;
        if (data.status === 'failed') {
            const reason = data.fail_reason ? (' — ' + data.fail_reason) : '';
            throw new Error('La generacion fallo en Kling' + reason);
        }

        const pct = Math.min(88, (i / MAX) * 100);
        if (statusId) document.getElementById(statusId).textContent = `Procesando... ${Math.round(pct)}%`;
        if (progressId) document.getElementById(progressId).style.width = pct + '%';
    }
    throw new Error('Tiempo de espera agotado (10 min). Intenta de nuevo.');
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
