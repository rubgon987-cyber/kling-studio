const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const KLING_BASE = 'https://api-app-global.klingai.com';

// ─── Uploads dir ────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
try {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
    console.warn('No se pudo crear uploads/, usando /tmp:', e.message);
}

// ─── Multer storage (v2 async API) ───────────────────────────────────────────
const storage = multer.diskStorage({
    destination: async (req, file) => UPLOAD_DIR,
    filename:    async (req, file) => {
        const ext = path.extname(file.originalname);
        return 'kling_' + Date.now() + '_' + Math.random().toString(36).slice(2) + ext;
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const uploadFields = upload.fields([
    { name: 'image',     maxCount: 1 },
    { name: 'video',     maxCount: 1 },
    { name: 'audio',     maxCount: 1 },
    { name: 'ref_video', maxCount: 1 },
    { name: 'images',    maxCount: 4 },
]);

// ─── Static files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

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

// ─── Kling API call ──────────────────────────────────────────────────────────
async function klingCall(method, endpoint, token, body = null) {
    const url  = KLING_BASE + endpoint;
    const opts = {
        method,
        headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + token,
        },
    };
    if (body) opts.body = JSON.stringify(body);

    const res  = await fetch(url, opts);
    const data = await res.json();

    if (!res.ok) {
        throw new Error((data.message || '') + ' (HTTP ' + res.status + ')');
    }
    if (data.code !== undefined && data.code !== 0) {
        throw new Error('[' + data.code + '] ' + (data.message || 'Error de API Kling'));
    }
    return data;
}

// ─── File URL helper ─────────────────────────────────────────────────────────
function fileUrl(req, filename) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host  = req.headers['x-forwarded-host']  || req.get('host');
    return `${proto}://${host}/uploads/${filename}`;
}

// ─── Cleanup old uploads (>1h) ───────────────────────────────────────────────
function cleanOldFiles() {
    const limit = Date.now() - 3600 * 1000;
    fs.readdirSync(UPLOAD_DIR).forEach(f => {
        if (!f.startsWith('kling_')) return;
        try {
            const stat = fs.statSync(path.join(UPLOAD_DIR, f));
            if (stat.mtimeMs < limit) fs.unlinkSync(path.join(UPLOAD_DIR, f));
        } catch (_) {}
    });
}

// ─── Credentials ─────────────────────────────────────────────────────────────
function getCredentials(body) {
    const k = body.api_key;
    const s = body.api_secret;
    if (!k || !s) throw new Error('API Key y Secret son requeridos');
    return [k, s];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
    res.json({ ok: true, node: process.version, uptime: process.uptime() });
});
app.post('/api/:action', uploadFields, async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { action } = req.params;

    try {
        switch (action) {
            case 'generate': return await handleGenerate(req, res);
            case 'lipsync':  return await handleLipSync(req, res);
            case 'motion':   return await handleMotion(req, res);
            case 'multi':    return await handleMulti(req, res);
            default: throw new Error('Accion desconocida: ' + action);
        }
    } catch (e) {
        res.json({ error: e.message });
    }
});

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
            } catch (_) {
                continue;
            }
        }
        res.json({ status: 'processing', video_url: null });
    } catch (e) {
        res.json({ error: e.message });
    }
});

app.post('/api/cleanup', (req, res) => {
    cleanOldFiles();
    res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════
async function handleGenerate(req, res) {
    const [apiKey, apiSecret] = getCredentials(req.body);
    const token    = makeJWT(apiKey, apiSecret);
    const mode     = req.body.mode     || 'text';
    const model    = req.body.model    || 'kling-v1-6';
    const prompt   = req.body.prompt   || '';
    const negPrmpt = req.body.negative_prompt || '';
    const duration = req.body.duration || '5';
    const aspect   = req.body.aspect_ratio    || '16:9';
    const quality  = req.body.quality  || 'std';

    let endpoint, taskType, body;

    if (mode === 'image') {
        const imgFile = req.files?.image?.[0];
        if (!imgFile) throw new Error('Imagen no recibida');
        cleanOldFiles();
        body = {
            model_name:      model,
            image:           fileUrl(req, imgFile.filename),
            prompt,
            negative_prompt: negPrmpt,
            duration,
            mode:            quality,
            cfg_scale:       0.5,
        };
        endpoint = '/v1/videos/image2video';
        taskType = 'image2video';
    } else {
        body = {
            model_name:      model,
            prompt,
            negative_prompt: negPrmpt,
            duration,
            aspect_ratio:    aspect,
            mode:            quality,
            cfg_scale:       0.5,
        };
        endpoint = '/v1/videos/text2video';
        taskType = 'text2video';
    }

    const data = await klingCall('POST', endpoint, token, body);
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
        body.image = fileUrl(req, imgFile.filename);
    } else {
        const vidFile = req.files?.video?.[0];
        if (!vidFile) throw new Error('Video no recibido');
        body.video = fileUrl(req, vidFile.filename);
    }

    if (audioMode === 'audio2video') {
        const audFile = req.files?.audio?.[0];
        if (!audFile) throw new Error('Audio no recibido');
        body.audio = fileUrl(req, audFile.filename);
    } else {
        body.text     = req.body.tts_text || '';
        body.voice_id = 'en_us_001';
    }

    cleanOldFiles();
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
        image:      fileUrl(req, imgFile.filename),
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
    if (refFile) body.video_reference = fileUrl(req, refFile.filename);

    cleanOldFiles();
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

    const urls = images.map(f => fileUrl(req, f.filename));

    const body = {
        model_name:      req.body.model    || 'kling-v2-1',
        image:           urls[0],
        image_tail:      urls[urls.length - 1],
        prompt:          req.body.prompt   || '',
        negative_prompt: req.body.negative_prompt || '',
        duration:        req.body.duration || '5',
        mode:            'std',
        cfg_scale:       0.5,
    };

    cleanOldFiles();
    const data   = await klingCall('POST', '/v1/videos/image2video', token, body);
    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(data.message || 'Error en Multi-Imagen');
    res.json({ task_id: taskId, task_type: 'image2video' });
}

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`Kling Studio corriendo en http://localhost:${PORT}`);
});
