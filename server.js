const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const KLING_BASE = 'https://api.klingai.com';

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
            const url = data.data?.task_result?.videos?.[0]?.url ?? null;
            return res.json({ status, video_url: url });
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

    const data   = await klingCall('POST', endpoint, token, body);
    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(data.message || 'No se recibio task_id');
    res.json({ task_id: taskId, task_type: taskType });
}

async function handleLipSync(req, res) {
    const [apiKey, apiSecret] = creds(req.body);
    const token     = makeJWT(apiKey, apiSecret);
    const lipMode   = req.body.lip_mode   || 'image';
    const audioMode = req.body.audio_mode || 'audio2video';
    const body      = { mode: audioMode };

    if (lipMode === 'image') {
        if (!req.body.image_data) throw new Error('Foto no recibida');
        body.image = stripDataUrl(req.body.image_data);
    } else {
        if (!req.body.video_data) throw new Error('Video no recibido');
        body.video = stripDataUrl(req.body.video_data);
    }

    if (audioMode === 'audio2video') {
        if (!req.body.audio_data) throw new Error('Audio no recibido');
        body.audio = stripDataUrl(req.body.audio_data);
    } else {
        body.text     = req.body.tts_text || '';
        body.voice_id = 'en_us_001';
    }

    const data   = await klingCall('POST', '/v1/videos/lip-sync', token, body);
    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(data.message || 'Error en Lip Sync');
    res.json({ task_id: taskId, task_type: 'lip-sync' });
}

async function handleMotion(req, res) {
    const [apiKey, apiSecret] = creds(req.body);
    const token = makeJWT(apiKey, apiSecret);
    if (!req.body.image_data) throw new Error('Imagen no recibida');

    const body = {
        model_name: 'kling-v1-5',
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

    if (req.body.ref_video_data) body.video_reference = stripDataUrl(req.body.ref_video_data);

    const data   = await klingCall('POST', '/v1/videos/image2video', token, body);
    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(data.message || 'Error en Motion Control');
    res.json({ task_id: taskId, task_type: 'image2video' });
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

    const data   = await klingCall('POST', '/v1/videos/image2video', token, body);
    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(data.message || 'Error en Multi-Imagen');
    res.json({ task_id: taskId, task_type: 'image2video' });
}

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Kling Studio v6 en http://localhost:${PORT}`));
