const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

const KLING_BASE   = 'https://api.klingai.com';
const UPLOADS_DIR  = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Guarda base64 en disco y devuelve URL publica
function saveBase64(base64, ext, req) {
    const buf  = Buffer.from(base64, 'base64');
    const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
    // Limpia archivos >1h en background
    setTimeout(() => {
        try { const files = fs.readdirSync(UPLOADS_DIR); const lim = Date.now()-3600000; files.forEach(f=>{ try{ if(fs.statSync(path.join(UPLOADS_DIR,f)).mtimeMs<lim) fs.unlinkSync(path.join(UPLOADS_DIR,f)); }catch(_){} }); } catch(_){}
    }, 100);
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host  = req.headers['x-forwarded-host']  || req.headers.host;
    return proto + '://' + host + '/uploads/' + name;
}

// Detecta extension de base64 data-URL
function getExt(dataUrl, fallback) {
    if (!dataUrl || !dataUrl.startsWith('data:')) return fallback;
    const semi = dataUrl.indexOf(';');
    const slash = dataUrl.lastIndexOf('/', semi);
    if (slash < 0 || semi < 0) return fallback;
    const ext = dataUrl.substring(slash + 1, semi);
    return ext === 'jpeg' ? 'jpg' : (ext || fallback);
}

// ─── Body parser: JSON con límite de 50MB para base64 ───────────────────────
app.use(express.json({ limit: '50mb' }));

// ─── Static files (sin caché para forzar actualizaciones) ────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
}));

// ─── JWT ─────────────────────────────────────────────────────────────────────
function makeJWT(key, secret) {
    const header  = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now     = Math.floor(Date.now() / 1000);
    const payload = b64u(JSON.stringify({ iss: key, exp: now + 1800, nbf: now - 5 }));
    const sig     = b64u(crypto.createHmac('sha256', secret)
                         .update(`${header}.${payload}`)
                         .digest());
    return `${header}.${payload}.${sig}`;
}
function b64u(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Strip data-URL prefix (Kling espera base64 puro, sin "data:...;base64,") ─
function stripDataUrl(str) {
    if (typeof str === 'string' && str.startsWith('data:')) {
        const idx = str.indexOf(',');
        if (idx !== -1) return str.slice(idx + 1);
    }
    return str;
}

// ─── Kling API call ──────────────────────────────────────────────────────────
async function klingCall(method, endpoint, token, body = null) {
    const res  = await fetch(KLING_BASE + endpoint, {
        method,
        headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + token,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch(_) { throw new Error('Kling devolvio respuesta no-JSON (HTTP ' + res.status + '): ' + text.slice(0, 300)); }
    if (!res.ok) throw new Error((data.message || '') + ' (HTTP ' + res.status + ')');
    if (data.code !== undefined && data.code !== 0)
        throw new Error('[' + data.code + '] ' + (data.message || 'Error de API Kling'));
    return data;
}

// ─── Credentials ─────────────────────────────────────────────────────────────
function creds(body) {
    if (!body.api_key || !body.api_secret) throw new Error('API Key y Secret son requeridos');
    return [body.api_key, body.api_secret];
}

// ─── Route wrapper — siempre HTTP 200 + JSON, nunca HTML ─────────────────────
function route(handler) {
    return async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try { await handler(req, res); }
        catch (e) {
            console.error('[ERROR]', e.message);
            res.json({ error: e.message });
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
    res.json({ ok: true, node: process.version, uptime: Math.round(process.uptime()) });
});

app.post('/api/generate', route(handleGenerate));
app.post('/api/debug-audio', route(handleDebugAudio));
app.get('/api/debug-status', route(handleDebugStatus));
app.post('/api/lipsync',  route(handleLipSync));
app.post('/api/motion',   route(handleMotion));
app.post('/api/multi',    route(handleMulti));

app.get('/api/status', route(async (req, res) => {
    const { task_id, task_type, api_key, api_secret } = req.query;
    if (!task_id || !api_key || !api_secret) throw new Error('Parametros incompletos');
    const token = makeJWT(api_key, api_secret);
    const endpointMap = {
        'text2video':  '/v1/videos/text2video/',
        'image2video': '/v1/videos/image2video/',
        'lip-sync':    '/v1/videos/lip-sync/',
    };
    const endpoints = (task_type && endpointMap[task_type])
        ? [endpointMap[task_type]]
        : Object.values(endpointMap);
    for (const ep of endpoints) {
        try {
            const data   = await klingCall('GET', ep + task_id, token);
            const status = data.data?.task_status;
            if (!status) continue;
            const url     = data.data?.task_result?.videos?.[0]?.url ?? null;
            const failMsg = data.data?.task_status_msg || data.data?.failed_reason || null;
            return res.json({ status, video_url: url, fail_reason: failMsg });
        } catch (_) { continue; }
    }
    res.json({ status: 'processing', video_url: null });
}));

// Global JSON error handler
app.use((err, req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ error: err.message || 'Error interno' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS — reciben archivos como base64 en el body JSON
// ═══════════════════════════════════════════════════════════════════════════════
async function handleGenerate(req, res) {
    const [apiKey, apiSecret] = creds(req.body);
    const token   = makeJWT(apiKey, apiSecret);
    const mode    = req.body.mode    || 'text';
    const model   = req.body.model   || 'kling-v1-6';
    const quality = req.body.quality || 'std';

    let endpoint, taskType, body;

    if (mode === 'image') {
        if (!req.body.image_data) throw new Error('Imagen no recibida');
        body = {
            model_name:      model,
            image:           stripDataUrl(req.body.image_data),
            prompt:          req.body.prompt          || '',
            negative_prompt: req.body.negative_prompt || '',
            duration:        req.body.duration        || '5',
            mode:            quality,
            cfg_scale:       0.5,
        };
        endpoint = '/v1/videos/image2video';
        taskType = 'image2video';
    } else {
        body = {
            model_name:      model,
            prompt:          req.body.prompt          || '',
            negative_prompt: req.body.negative_prompt || '',
            duration:        req.body.duration        || '5',
            aspect_ratio:    req.body.aspect_ratio    || '16:9',
            mode:            quality,
            cfg_scale:       0.5,
        };
        endpoint = '/v1/videos/text2video';
        taskType = 'text2video';
    }

    // Audio nativo — kling-v2-6 y kling-v3 (requiere mode: pro)
    const audioModels = new Set(['kling-v2-6', 'kling-v3']);
    if (audioModels.has(model) && req.body.enable_audio !== false) {
        body.enable_audio   = true;
        body.generate_audio = true;
        body.mode = 'pro';
    }

    console.log('[handleGenerate] body enviado a Kling:', JSON.stringify({ ...body, image: body.image ? '[base64]' : undefined }));
    const data   = await klingCall('POST', endpoint, token, body);
    console.log('[handleGenerate] respuesta Kling:', JSON.stringify(data).slice(0, 300));
    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(data.message || 'No se recibio task_id');
    res.json({ task_id: taskId, task_type: taskType });
}

async function handleLipSync(req, res) {
    const [apiKey, apiSecret] = creds(req.body);
    const token     = makeJWT(apiKey, apiSecret);
    const lipMode   = req.body.lip_mode   || 'image';
    const audioMode = req.body.audio_mode || 'audio2video';

    // Kling lip-sync requiere URLs publicas, no base64
    const input = { mode: audioMode };

    // Kling LipSync solo acepta video MP4 (no imagenes estaticas)
    if (!req.body.video_data) throw new Error('Video MP4 requerido');
    input.video_url = saveBase64(stripDataUrl(req.body.video_data), 'mp4', req);

    if (audioMode === 'audio2video') {
        if (!req.body.audio_data) throw new Error('Audio no recibido');
        const raw = req.body.audio_data;
        const ext = getExt(raw, 'mp3');
        input.audio_url = saveBase64(stripDataUrl(raw), ext, req);
    } else {
        input.text     = req.body.tts_text || '';
        input.voice_id = req.body.voice_id || 'en_us_001';
    }

    const body = { input };
    console.log('[lipsync] input fields:', Object.keys(input), '| image_url/video_url:', input.image_url || input.video_url);

    const data   = await klingCall('POST', '/v1/videos/lip-sync', token, body);
    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(data.message || 'Error en Lip Sync');
    res.json({ task_id: taskId, task_type: 'lip-sync' });
}

// v1.x → camera_control + /v1/videos/image2video
// v2.6/v3 → video reference + /v1/videos/motion-control
const CAMERA_CTRL_MODELS = new Set(['kling-v1-5', 'kling-v1-6']);

async function handleMotion(req, res) {
    const [apiKey, apiSecret] = creds(req.body);
    const token = makeJWT(apiKey, apiSecret);
    if (!req.body.image_data) throw new Error('Imagen no recibida');

    const model     = req.body.model || 'kling-v1-5';
    const useCamera = CAMERA_CTRL_MODELS.has(model);

    let data, taskType;

    if (useCamera) {
        // ── Kling v1.5 / v1.6 — Camera Control ─────────────────────────
        const body = {
            model_name: model,
            image:      stripDataUrl(req.body.image_data),
            prompt:     req.body.prompt || '',
            duration:   '5',
            mode:       'pro',
            cfg_scale:  0.5,
            camera_control: {
                type:   'simple',
                config: {
                    horizontal: parseFloat(req.body.cam_horizontal || '0'),
                    vertical:   parseFloat(req.body.cam_vertical   || '0'),
                    zoom:       parseFloat(req.body.cam_zoom       || '0'),
                    roll:       parseFloat(req.body.cam_roll       || '0'),
                    tilt:       0,
                    pan:        0,
                }
            }
        };
        data     = await klingCall('POST', '/v1/videos/image2video', token, body);
        taskType = 'image2video';

    } else {
        // ── Kling v2.6 / v3.0 — Motion Control con video de referencia ──
        if (!req.body.ref_video_url && !req.body.ref_video_data) {
            throw new Error('Kling 2.6 y 3.0 requieren un video de referencia de movimiento.');
        }
        const body = {
            model_name:            model,
            image:                 stripDataUrl(req.body.image_data),
            prompt:                req.body.prompt || '',
            character_orientation: req.body.character_orientation || 'video',
            duration:              req.body.duration || '5',
            mode:                  'pro',
            cfg_scale:             parseFloat(req.body.cfg_scale || '0.5'),
        };

        // Video de referencia de movimiento
        if (req.body.ref_video_url) {
            body.video_reference = req.body.ref_video_url;
        } else {
            body.video_reference = stripDataUrl(req.body.ref_video_data);
        }

        // Audio: preservar del video de referencia O generar nativo (v2.6 y v3.0)
        body.keep_original_sound = req.body.keep_sound !== 'false' && req.body.keep_sound !== false;
        if (model === 'kling-v2-6' || model === 'kling-v3') {
            body.enable_audio   = true;
            body.generate_audio = true;
        }

        data     = await klingCall('POST', '/v1/videos/image2video', token, body);
        taskType = 'image2video';
    }

    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(data.message || 'Error en Motion Control');
    res.json({ task_id: taskId, task_type: taskType });
}

async function handleMulti(req, res) {
    const [apiKey, apiSecret] = creds(req.body);
    const token  = makeJWT(apiKey, apiSecret);
    const images = req.body.images_data || [];
    if (images.length < 2) throw new Error('Se necesitan al menos 2 imagenes');

    const body = {
        model_name:      req.body.model    || 'kling-v2-1',
        image:           stripDataUrl(images[0]),
        image_tail:      stripDataUrl(images[images.length - 1]),
        prompt:          req.body.prompt   || '',
        negative_prompt: req.body.negative_prompt || '',
        duration:        req.body.duration || '5',
        mode:            'std',
        cfg_scale:       0.5,
    };

    // Audio nativo — kling-v3 soporta enable_audio en multi-imagen
    const multiModel = req.body.model || 'kling-v2-1';
    if (multiModel === 'kling-v3' || multiModel === 'kling-v3-omni') {
        body.enable_audio   = true;
        body.generate_audio = true;
        body.mode = 'pro';
    }

    const data   = await klingCall('POST', '/v1/videos/image2video', token, body);
    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(data.message || 'Error en Multi-Imagen');
    res.json({ task_id: taskId, task_type: 'image2video' });
}

// ─── Start ───────────────────────────────────────────────────────────────────
// ─── Debug: diagnóstico audio ────────────────────────────────────────────────
async function handleDebugStatus(req, res) {
    const { task_id, task_type, api_key, api_secret } = req.query;
    if (!task_id || !api_key || !api_secret) throw new Error('Parametros incompletos');
    const token = makeJWT(api_key, api_secret);
    const ep = task_type === 'image2video' ? '/v1/videos/image2video/' : '/v1/videos/text2video/';
    const data = await klingCall('GET', ep + task_id, token);
    res.json({ full_kling_response: data });
}

async function handleDebugAudio(req, res) {
    const [apiKey, apiSecret] = creds(req.body);
    const token  = makeJWT(apiKey, apiSecret);
    const model  = req.body.model || 'kling-v3';

    const requestBody = {
        model_name:   model,
        prompt:       req.body.prompt || 'A person talking. Room ambience, clear speech.',
        duration:     '5',
        aspect_ratio: '16:9',
        mode:         'pro',
        cfg_scale:    0.5,
        enable_audio:   true,
        generate_audio: true,
    };

    let klingResponse = null;
    let klingError    = null;
    try {
        const r    = await fetch(KLING_BASE + '/v1/videos/text2video', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body:    JSON.stringify(requestBody),
        });
        const txt = await r.text();
        try { klingResponse = JSON.parse(txt); } catch(_) { klingResponse = txt; }
    } catch(e) { klingError = e.message; }

    res.json({
        request_sent_to_kling: requestBody,
        kling_raw_response:    klingResponse,
        kling_error:           klingError,
        api_base:              KLING_BASE,
    });
}

app.listen(PORT, () => console.log(`Kling Studio v6 en http://localhost:${PORT}`));
