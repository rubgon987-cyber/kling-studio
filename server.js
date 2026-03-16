const express = require('express');
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const KLING_BASE = 'https://api-app-global.klingai.com';

// ─── Multer: memoria, sin disco, sin permisos ────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 50 * 1024 * 1024 }
});

const uploadFields = upload.fields([
    { name: 'image',     maxCount: 1 },
    { name: 'video',     maxCount: 1 },
    { name: 'audio',     maxCount: 1 },
    { name: 'ref_video', maxCount: 1 },
    { name: 'images',    maxCount: 4 },
]);

// ─── Static files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

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

// ─── Archivo a base64 para la API de Kling ───────────────────────────────────
function fileToBase64(file) {
    return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
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
    const data = await res.json();
    if (!res.ok) throw new Error((data.message || '') + ' (HTTP ' + res.status + ')');
    if (data.code !== undefined && data.code !== 0)
        throw new Error('[' + data.code + '] ' + (data.message || 'Error de API Kling'));
    return data;
}

// ─── Credentials ─────────────────────────────────────────────────────────────
function getCredentials(body) {
    const k = body.api_key, s = body.api_secret;
    if (!k || !s) throw new Error('API Key y Secret son requeridos');
    return [k, s];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
    res.json({ ok: true, node: process.version, uptime: Math.round(process.uptime()) });
});

// Multer error handler wrapper
function withUpload(handler) {
    return (req, res) => {
        uploadFields(req, res, async (err) => {
            res.setHeader('Content-Type', 'application/json');
            if (err) return res.status(400).json({ error: 'Upload error: ' + err.message });
            try {
                await handler(req, res);
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });
    };
}

app.post('/api/generate', withUpload(handleGenerate));
app.post('/api/lipsync',  withUpload(handleLipSync));
app.post('/api/motion',   withUpload(handleMotion));
app.post('/api/multi',    withUpload(handleMulti));

app.get('/api/status', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
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
    } catch (e) {
        res.json({ error: e.message });
    }
});

// Global error handler — siempre devuelve JSON, nunca HTML
app.use((err, req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════
async function handleGenerate(req, res) {
    const [apiKey, apiSecret] = getCredentials(req.body);
    const token    = makeJWT(apiKey, apiSecret);
    const mode     = req.body.mode    || 'text';
    const model    = req.body.model   || 'kling-v1-6';
    const quality  = req.body.quality || 'std';

    let endpoint, taskType, body;

    if (mode === 'image') {
        const imgFile = req.files?.image?.[0];
        if (!imgFile) throw new Error('Imagen no recibida');
        body = {
            model_name:      model,
            image:           fileToBase64(imgFile),
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
    const [apiKey, apiSecret] = getCredentials(req.body);
    const token     = makeJWT(apiKey, apiSecret);
    const lipMode   = req.body.lip_mode   || 'image';
    const audioMode = req.body.audio_mode || 'audio2video';

    const body = { mode: audioMode };

    if (lipMode === 'image') {
        const imgFile = req.files?.image?.[0];
        if (!imgFile) throw new Error('Foto no recibida');
        body.image = fileToBase64(imgFile);
    } else {
        const vidFile = req.files?.video?.[0];
        if (!vidFile) throw new Error('Video no recibido');
        body.video = fileToBase64(vidFile);
    }

    if (audioMode === 'audio2video') {
        const audFile = req.files?.audio?.[0];
        if (!audFile) throw new Error('Audio no recibido');
        body.audio = fileToBase64(audFile);
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
    const [apiKey, apiSecret] = getCredentials(req.body);
    const token   = makeJWT(apiKey, apiSecret);
    const imgFile = req.files?.image?.[0];
    if (!imgFile) throw new Error('Imagen no recibida');

    const body = {
        model_name: 'kling-v1-5',
        image:      fileToBase64(imgFile),
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

    const refFile = req.files?.ref_video?.[0];
    if (refFile) body.video_reference = fileToBase64(refFile);

    const data   = await klingCall('POST', '/v1/videos/image2video', token, body);
    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(data.message || 'Error en Motion Control');
    res.json({ task_id: taskId, task_type: 'image2video' });
}

async function handleMulti(req, res) {
    const [apiKey, apiSecret] = getCredentials(req.body);
    const token  = makeJWT(apiKey, apiSecret);
    const images = req.files?.images || [];

    if (images.length < 2) throw new Error('Se necesitan al menos 2 imagenes');

    const body = {
        model_name:      req.body.model    || 'kling-v2-1',
        image:           fileToBase64(images[0]),
        image_tail:      fileToBase64(images[images.length - 1]),
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
app.listen(PORT, () => console.log(`Kling Studio en http://localhost:${PORT}`));
