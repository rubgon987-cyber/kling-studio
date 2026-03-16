<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

define('KLING_BASE', 'https://api-app-global.klingai.com');

// URL base del sitio — Kling necesita URLs públicas para acceder a los archivos
$protocol  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host      = $_SERVER['HTTP_HOST'] ?? 'localhost';
$scriptDir = dirname($_SERVER['SCRIPT_NAME']);
define('SITE_URL', $protocol . '://' . $host . rtrim($scriptDir, '/'));

// Directorio de uploads temporales
define('UPLOAD_DIR', __DIR__ . '/uploads/');

// Crear directorio uploads si no existe
if (!is_dir(UPLOAD_DIR)) {
    mkdir(UPLOAD_DIR, 0755, true);
}

$action = $_POST['action'] ?? $_GET['action'] ?? 'generate';

try {
    switch ($action) {
        case 'generate': handleGenerate(); break;
        case 'lipsync':  handleLipSync();  break;
        case 'motion':   handleMotion();   break;
        case 'multi':    handleMulti();    break;
        case 'status':   handleStatus();   break;
        case 'cleanup':  handleCleanup();  break;
        default: throw new Exception('Accion desconocida: ' . $action);
    }
} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}

// ────────────────────────────────────────────
// GUARDAR ARCHIVO Y RETORNAR URL PÚBLICA
// ────────────────────────────────────────────
function saveFile($fileKey) {
    if (!isset($_FILES[$fileKey]) || $_FILES[$fileKey]['error'] !== 0) {
        return null;
    }
    $file     = $_FILES[$fileKey];
    $ext      = pathinfo($file['name'], PATHINFO_EXTENSION);
    $filename = uniqid('kling_', true) . '.' . $ext;
    $dest     = UPLOAD_DIR . $filename;

    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        throw new Exception('No se pudo guardar el archivo: ' . $fileKey);
    }

    // Limpiar archivos viejos (+1 hora) en segundo plano
    cleanOldFiles();

    return SITE_URL . '/uploads/' . $filename;
}

function cleanOldFiles() {
    $files = glob(UPLOAD_DIR . 'kling_*');
    if (!$files) return;
    $limit = time() - 3600; // 1 hora
    foreach ($files as $file) {
        if (filemtime($file) < $limit) @unlink($file);
    }
}

// ────────────────────────────────────────────
// GENERAR VIDEO (Texto o Imagen)
// ────────────────────────────────────────────
function handleGenerate() {
    [$apiKey, $apiSecret] = getCredentials();
    $token    = makeJWT($apiKey, $apiSecret);
    $mode     = post('mode', 'text');
    $model    = post('model', 'kling-v1-6');
    $prompt   = post('prompt', '');
    $negPrmpt = post('negative_prompt', '');
    $duration = post('duration', '5');
    $aspect   = post('aspect_ratio', '16:9');

    $quality = post('quality', 'std');

    if ($mode === 'image') {
        $imageUrl = saveFile('image');
        if (!$imageUrl) throw new Exception('Imagen no recibida');

        $body = [
            'model_name'      => $model,
            'image'           => $imageUrl,
            'prompt'          => $prompt,
            'negative_prompt' => $negPrmpt,
            'duration'        => $duration,
            'mode'            => $quality,
            'cfg_scale'       => 0.5
        ];
        $endpoint  = '/v1/videos/image2video';
        $taskType  = 'image2video';
    } else {
        $body = [
            'model_name'      => $model,
            'prompt'          => $prompt,
            'negative_prompt' => $negPrmpt,
            'duration'        => $duration,
            'aspect_ratio'    => $aspect,
            'mode'            => $quality,
            'cfg_scale'       => 0.5
        ];
        $endpoint = '/v1/videos/text2video';
        $taskType = 'text2video';
    }

    // Audio nativo — kling-v2-6 y kling-v3 requieren enable_audio y mode pro
    $audioModels = ['kling-v2-6', 'kling-v3'];
    if (in_array($model, $audioModels)) {
        $body['enable_audio'] = true;
        $body['mode'] = 'pro';
    }

    $res = apiCall('POST', $endpoint, $token, $body);
    if (!isset($res['data']['task_id'])) {
        throw new Exception($res['message'] ?? 'Error: no se recibio task_id');
    }
    echo json_encode(['task_id' => $res['data']['task_id'], 'task_type' => $taskType]);
}

// ────────────────────────────────────────────
// LIP SYNC
// ────────────────────────────────────────────
function handleLipSync() {
    [$apiKey, $apiSecret] = getCredentials();
    $token     = makeJWT($apiKey, $apiSecret);
    $lipMode   = post('lip_mode', 'image');
    $audioMode = post('audio_mode', 'audio2video');

    $body = ['mode' => $audioMode];

    if ($lipMode === 'image') {
        $url = saveFile('image');
        if (!$url) throw new Exception('Foto no recibida');
        $body['image'] = $url;
    } else {
        $url = saveFile('video');
        if (!$url) throw new Exception('Video no recibido');
        $body['video'] = $url;
    }

    if ($audioMode === 'audio2video') {
        $audioUrl = saveFile('audio');
        if (!$audioUrl) throw new Exception('Audio no recibido');
        $body['audio'] = $audioUrl;
    } else {
        $body['text']     = post('tts_text', '');
        $body['voice_id'] = 'en_us_001';
    }

    $res = apiCall('POST', '/v1/videos/lip-sync', $token, $body);
    if (!isset($res['data']['task_id'])) {
        throw new Exception($res['message'] ?? 'Error en Lip Sync');
    }
    echo json_encode(['task_id' => $res['data']['task_id'], 'task_type' => 'lip-sync']);
}

// ────────────────────────────────────────────
// MOTION CONTROL
// ────────────────────────────────────────────
function handleMotion() {
    [$apiKey, $apiSecret] = getCredentials();
    $token = makeJWT($apiKey, $apiSecret);

    $imageUrl = saveFile('image');
    if (!$imageUrl) throw new Exception('Imagen no recibida');

    $camH = (float)post('cam_horizontal', '0');
    $camV = (float)post('cam_vertical',   '0');
    $camZ = (float)post('cam_zoom',       '0');
    $camR = (float)post('cam_roll',       '0');

    $body = [
        'model_name' => 'kling-v1-5',  // unico modelo que soporta camera_control
        'image'      => $imageUrl,
        'prompt'     => post('prompt', ''),
        'duration'   => '5',           // solo 5s permitido
        'mode'       => 'pro',         // debe ser pro
        'camera_control' => [
            'type'   => 'simple',
            'config' => [
                'horizontal' => $camH,
                'vertical'   => $camV,
                'zoom'       => $camZ,
                'roll'       => $camR,
                'tilt'       => 0,
                'pan'        => 0,
            ]
        ]
    ];

    // Video de referencia opcional
    $refUrl = saveFile('ref_video');
    if ($refUrl) {
        $body['video_reference'] = $refUrl;
    }

    $res = apiCall('POST', '/v1/videos/image2video', $token, $body);
    if (!isset($res['data']['task_id'])) {
        throw new Exception($res['message'] ?? 'Error en Motion Control');
    }
    echo json_encode(['task_id' => $res['data']['task_id'], 'task_type' => 'image2video']);
}

// ────────────────────────────────────────────
// MULTI-IMAGEN
// ────────────────────────────────────────────
function handleMulti() {
    [$apiKey, $apiSecret] = getCredentials();
    $token = makeJWT($apiKey, $apiSecret);

    $imageUrls = [];
    if (isset($_FILES['images'])) {
        $count = count($_FILES['images']['tmp_name']);
        for ($i = 0; $i < $count; $i++) {
            if ($_FILES['images']['error'][$i] === 0) {
                $ext      = pathinfo($_FILES['images']['name'][$i], PATHINFO_EXTENSION);
                $filename = uniqid('kling_multi_', true) . '.' . $ext;
                $dest     = UPLOAD_DIR . $filename;
                if (move_uploaded_file($_FILES['images']['tmp_name'][$i], $dest)) {
                    $imageUrls[] = SITE_URL . '/uploads/' . $filename;
                }
            }
        }
    }

    if (count($imageUrls) < 2) throw new Exception('Se necesitan al menos 2 imagenes');

    $body = [
        'model_name'      => post('model', 'kling-v2-1'),
        'image'           => $imageUrls[0],
        'image_tail'      => $imageUrls[count($imageUrls) - 1],
        'prompt'          => post('prompt', ''),
        'negative_prompt' => post('negative_prompt', ''),
        'duration'        => post('duration', '5'),
        'mode'            => 'std',
        'cfg_scale'       => 0.5,
    ];

    // Audio nativo — kling-v3 soporta enable_audio en multi-imagen
    $multiModel = post('model', 'kling-v2-1');
    if ($multiModel === 'kling-v3') {
        $body['enable_audio'] = true;
        $body['mode'] = 'pro';
    }

    $res = apiCall('POST', '/v1/videos/image2video', $token, $body);
    if (!isset($res['data']['task_id'])) {
        throw new Exception($res['message'] ?? 'Error en Multi-Imagen');
    }
    echo json_encode(['task_id' => $res['data']['task_id'], 'task_type' => 'image2video']);
}

// ────────────────────────────────────────────
// ESTADO DE TAREA
// ────────────────────────────────────────────
function handleStatus() {
    $taskId    = $_GET['task_id']    ?? '';
    $apiKey    = $_GET['api_key']    ?? '';
    $apiSecret = $_GET['api_secret'] ?? '';
    $taskType  = $_GET['task_type']  ?? '';

    if (!$taskId || !$apiKey || !$apiSecret) throw new Exception('Parametros incompletos');

    $token = makeJWT($apiKey, $apiSecret);

    // Mapa de tipos a endpoints
    $endpointMap = [
        'text2video'  => '/v1/videos/text2video/',
        'image2video' => '/v1/videos/image2video/',
        'lip-sync'    => '/v1/videos/lip-sync/',
    ];

    // Si tenemos el tipo, consultar solo ese endpoint
    if ($taskType && isset($endpointMap[$taskType])) {
        $endpoints = [$endpointMap[$taskType]];
    } else {
        // Fallback: probar todos
        $endpoints = array_values($endpointMap);
    }

    foreach ($endpoints as $ep) {
        try {
            $res    = apiCall('GET', $ep . $taskId, $token);
            $status = $res['data']['task_status'] ?? null;
            if (!$status) continue;
            $videos = $res['data']['task_result']['videos'] ?? [];
            $url    = $videos[0]['url'] ?? null;
            echo json_encode(['status' => $status, 'video_url' => $url]);
            return;
        } catch (Exception $e) {
            continue;
        }
    }

    echo json_encode(['status' => 'processing', 'video_url' => null]);
}

function handleCleanup() {
    cleanOldFiles();
    echo json_encode(['ok' => true]);
}

// ────────────────────────────────────────────
// UTILIDADES
// ────────────────────────────────────────────
function apiCall($method, $endpoint, $token, $body = null) {
    $url = KLING_BASE . $endpoint;
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $token,
        ],
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $response = curl_exec($ch);
    $curlErr  = curl_error($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($curlErr)   throw new Exception('Error de conexion: ' . $curlErr);
    if (!$response) throw new Exception('Sin respuesta de Kling API');
    $data = json_decode($response, true);
    if ($code >= 400) throw new Exception(($data['message'] ?? '') . ' (HTTP ' . $code . ')');
    if (isset($data['code']) && $data['code'] !== 0) {
        throw new Exception('[' . $data['code'] . '] ' . ($data['message'] ?? 'Error de API'));
    }
    return $data;
}

function makeJWT($key, $secret) {
    $h = b64u(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $t = time();
    $p = b64u(json_encode(['iss' => $key, 'exp' => $t + 1800, 'nbf' => $t - 5]));
    $s = b64u(hash_hmac('sha256', "$h.$p", $secret, true));
    return "$h.$p.$s";
}

function b64u($d) { return rtrim(strtr(base64_encode($d), '+/', '-_'), '='); }

function getCredentials() {
    $k = $_POST['api_key']    ?? '';
    $s = $_POST['api_secret'] ?? '';
    if (!$k || !$s) throw new Exception('API Key y Secret son requeridos');
    return [$k, $s];
}

function post($key, $default = '') { return $_POST[$key] ?? $default; }
