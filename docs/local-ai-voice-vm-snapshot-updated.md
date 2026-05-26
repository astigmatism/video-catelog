# local-ai-voice VM Snapshot and Handoff Notes

_Last updated: 2026-05-26_

## Purpose

`local-ai-voice` is an Ubuntu VM dedicated to local speech-to-text and text-to-speech services. It exposes a public HTTP API used by external tools/orchestrators, while keeping the GPU-backed model services resident on the VM.

The current target architecture is:

- Keep speech-to-text unchanged.
- Use Chatterbox as the primary text-to-speech system.
- Use Chatterbox Turbo as the default active TTS model for performance.
- Preserve a single public API surface on port `8000`.
- Run Chatterbox TTS as an internal localhost-only backend service on port `8001`.

## Host and OS

```text
Hostname: local-ai-voice
OS: Ubuntu 24.04.4 LTS
Kernel: Linux 6.8.0-117-generic
Virtualization: VMware
GPU: NVIDIA GeForce RTX 3080
GPU VRAM: 10240 MiB
NVIDIA driver: 595.71.05
CUDA reported by nvidia-smi: 13.2
```

## Network

Known LAN address during setup:

```text
192.168.1.22
```

Public API endpoint for clients/orchestrators:

```text
http://192.168.1.22:8000
```

Internal Chatterbox backend endpoint:

```text
http://127.0.0.1:8001
```

The `8001` service is intended to be localhost-only and should not be treated as the public integration contract.

## Systemd Services

### Public API service

```text
Service: local-ai-voice-stt.service
Unit: /etc/systemd/system/local-ai-voice-stt.service
Override: /etc/systemd/system/local-ai-voice-stt.service.d/override.conf
WorkingDirectory: /home/astigmatism/ai-services/stt
ExecStart: /home/astigmatism/ai-services/stt/.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
User: astigmatism
Enabled: yes
```

This service exposes the public API on port `8000`. It owns the public `/transcribe`, `/speak`, `/health`, `/gpu`, voice, and model-management endpoints.

### Internal Chatterbox TTS service

```text
Service: local-ai-voice-tts-chatterbox.service
Unit: /etc/systemd/system/local-ai-voice-tts-chatterbox.service
WorkingDirectory: /home/astigmatism/ai-services/tts-chatterbox
ExecStart: /home/astigmatism/ai-services/tts-chatterbox/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8001
User: astigmatism
Enabled: yes
```

This service keeps the selected Chatterbox model resident in memory. The public API proxies TTS, voice, and model-management calls to this backend.

## Directory Layout

```text
/home/astigmatism/ai-services/
  stt/
    app.py
    .venv/
    app.py.backup.*
    transcribe.py
    transcribe.sh
    transcribe_test.py
    transcribe_vad_test.py
    run_transcribe_test.sh

  tts-chatterbox/
    app.py
    synthesize.py
    .venv/
    voices/
      eric-neutral.wav
    voice-config.json
    app.py.backup.*

  tts-kokoro/
    models/
      kokoro-v1.0.onnx
      voices-v1.0.bin
    .venv/
    long-tts-test.py
    kokoro-test-output.wav
    kokoro-long-test-output.wav

  tts/
    models/
      en_US-lessac-medium.onnx
      en_US-lessac-medium.onnx.json
    .venv/
    test-output.wav
```

The active production-ish services are `stt/` and `tts-chatterbox/`.

`tts/` and `tts-kokoro/` are historical/exploration areas and are not currently used by systemd.

## Public API: Port 8000

Base URL:

```text
http://192.168.1.22:8000
```

Local URL:

```text
http://127.0.0.1:8000
```

### Health

```http
GET /health
```

Reports STT status and Chatterbox backend status.

Expected TTS state after current setup:

```json
{
  "tts": {
    "engine": "chatterbox-tts",
    "backend_url": "http://127.0.0.1:8001",
    "backend": {
      "status": "ok",
      "service": "local-ai-voice-chatterbox-tts",
      "engine": "chatterbox-tts",
      "device": "cuda",
      "loaded": true
    }
  }
}
```

### GPU Snapshot

```http
GET /gpu
```

Runs `nvidia-smi` and returns a parsed GPU snapshot.

Fields include:

```text
timestamp
name
temperature_gpu_c
utilization_gpu_percent
memory_used_mib
memory_total_mib
power_draw_w
power_limit_w
fan_speed_percent
performance_state
```

Note: If a browser or monitor polls `/gpu` during TTS generation and sees delayed responses, this does not necessarily mean CPU inference. It can also mean the API worker is busy or waiting on the TTS backend. Use raw `nvidia-smi` or `nvidia-smi dmon` directly for inference-time GPU confirmation.

### Speech-to-Text

```http
POST /transcribe
Content-Type: multipart/form-data
```

Form fields:

```text
file: audio upload, required
model: optional, default large-v3-turbo
```

Allowed STT models:

```text
large-v3
large-v3-turbo
```

Current STT implementation:

```text
Library: faster-whisper
Default model: large-v3-turbo
Device: cuda
Compute type: float16
Beam size: 5
VAD filter: true
Minimum silence duration: 1000 ms
```

The STT path was intentionally left unchanged during the Chatterbox migration.

### Text-to-Speech

```http
POST /speak
Content-Type: multipart/form-data
```

Public `/speak` on port `8000` proxies to internal Chatterbox `/speak` on `127.0.0.1:8001`.

Supported form fields:

```text
text: required
voice: optional stored reference voice name
model: optional model override: standard, turbo, multilingual
language_id: optional, default en; required/used for multilingual
exaggeration: optional
cfg_weight: optional
temperature: optional
repetition_penalty: optional
min_p: optional
top_p: optional
top_k: optional, used by turbo
norm_loudness: optional boolean-ish string, used by turbo
```

Current default state:

```text
default_model: turbo
active_model: turbo
default_voice: eric-neutral
```

Output:

```text
Content-Type: audio/wav
Format: RIFF/WAVE
Encoding: PCM 16-bit
Channels: mono
Sample rate: 24000 Hz
```

Example:

```bash
curl -s -X POST http://127.0.0.1:8000/speak \
  -F 'text=This is a test through the public local AI voice API.' \
  --output /tmp/speech.wav && file /tmp/speech.wav
```

## Chatterbox Model APIs

Model APIs are available through the public service on port `8000` and proxy to the internal Chatterbox service.

### List models

```http
GET /models
```

Example:

```bash
curl -s http://127.0.0.1:8000/models | python3 -m json.tool
```

Current expected output shape:

```json
{
  "default_model": "turbo",
  "active_model": "turbo",
  "allowed_models": [
    {
      "name": "standard",
      "description": "Full Chatterbox English TTS model."
    },
    {
      "name": "turbo",
      "description": "Faster Chatterbox Turbo TTS model."
    },
    {
      "name": "multilingual",
      "description": "Chatterbox multilingual TTS model. Requires language_id."
    }
  ]
}
```

### Get default model

```http
GET /model/default
```

### Set default model

```http
POST /model/default
Content-Type: multipart/form-data
```

Form fields:

```text
model: standard | turbo | multilingual
```

Example:

```bash
curl -s -X POST http://127.0.0.1:8000/model/default \
  -F 'model=turbo' \
  | python3 -m json.tool
```

Behavior:

- Updates `voice-config.json`.
- Unloads the active Chatterbox model.
- Loads the selected model on the next `/speak` request or service startup.
- Only one Chatterbox model is kept active at a time to avoid holding standard + turbo + multilingual in VRAM simultaneously.

## Chatterbox Model Classes

Verified installed package:

```text
Package: chatterbox-tts==0.1.7
```

Verified classes:

```text
standard:
  chatterbox.tts.ChatterboxTTS

turbo:
  chatterbox.tts_turbo.ChatterboxTurboTTS

multilingual:
  chatterbox.mtl_tts.ChatterboxMultilingualTTS
```

Verified generation signatures:

```text
standard:
  generate(text, repetition_penalty=1.2, min_p=0.05, top_p=1.0,
           audio_prompt_path=None, exaggeration=0.5, cfg_weight=0.5,
           temperature=0.8)

turbo:
  generate(text, repetition_penalty=1.2, min_p=0.0, top_p=0.95,
           audio_prompt_path=None, exaggeration=0.0, cfg_weight=0.0,
           temperature=0.8, top_k=1000, norm_loudness=True)

multilingual:
  generate(text, language_id, audio_prompt_path=None, exaggeration=0.5,
           cfg_weight=0.5, temperature=0.8, repetition_penalty=2.0,
           min_p=0.05, top_p=1.0)
```

## Voice Reference APIs

Chatterbox does not expose Kokoro-style named built-in voices. Voice control is reference-audio based.

In this system, a "voice" means:

```text
A stored reference audio prompt file used as Chatterbox audio_prompt_path.
```

Current default voice:

```text
eric-neutral
```

Stored file:

```text
/home/astigmatism/ai-services/tts-chatterbox/voices/eric-neutral.wav
```

### List voices

```http
GET /voices
```

Example:

```bash
curl -s http://127.0.0.1:8000/voices | python3 -m json.tool
```

Expected current shape:

```json
{
  "default_voice": "eric-neutral",
  "voices": [
    {
      "name": "eric-neutral",
      "filename": "eric-neutral.wav",
      "path": "/home/astigmatism/ai-services/tts-chatterbox/voices/eric-neutral.wav",
      "size_bytes": 1697742,
      "extension": ".wav"
    }
  ]
}
```

### Upload/register voice reference

```http
POST /voices
Content-Type: multipart/form-data
```

Form fields:

```text
name: required
file: required audio file
```

Allowed file extensions:

```text
.wav
.mp3
.m4a
.flac
.ogg
```

Example:

```bash
curl -s -X POST http://127.0.0.1:8000/voices \
  -F 'name=eric-neutral' \
  -F 'file=@/home/astigmatism/recordings/eric-neutral.wav' \
  | python3 -m json.tool
```

### Get default voice

```http
GET /voice/default
```

### Set default voice

```http
POST /voice/default
Content-Type: multipart/form-data
```

Form fields:

```text
voice: stored voice name
```

Example:

```bash
curl -s -X POST http://127.0.0.1:8000/voice/default \
  -F 'voice=eric-neutral' \
  | python3 -m json.tool
```

## Reference Voice Recording Guidance

For Chatterbox voice conditioning, a reference audio file should generally be:

```text
Length: about 10-20 seconds for first tests
Speaker: one speaker only
Room: quiet
Style: natural and clear
Format: WAV preferred
Background: no music, no keyboard clicks, no fan noise if possible
Avoid: long silence, clipping, echo, multiple speakers
```

The current `eric-neutral.wav` was uploaded and set as the default reference voice.

## Configuration State

Chatterbox runtime/default state is stored at:

```text
/home/astigmatism/ai-services/tts-chatterbox/voice-config.json
```

Expected current state:

```json
{
  "default_voice": "eric-neutral",
  "default_model": "turbo",
  "default_language_id": "en"
}
```

The file name is historical; it now stores both voice and model defaults.

## Chatterbox Python Environment

Path:

```text
/home/astigmatism/ai-services/tts-chatterbox/.venv
```

Key verified packages:

```text
chatterbox-tts==0.1.7
torch==2.6.0+cu124
torchaudio==2.6.0+cu124
fastapi
uvicorn
python-multipart
```

CUDA verification performed:

```text
torch.cuda.is_available(): True
torch.cuda.device_count(): 1
torch.cuda.get_device_name(0): NVIDIA GeForce RTX 3080
```

## Important Dependency Note: Perth / setuptools

Initial Chatterbox load failed with:

```text
TypeError: 'NoneType' object is not callable
```

Root cause:

```text
perth.PerthImplicitWatermarker was None
```

Hidden import error:

```text
ModuleNotFoundError: No module named 'pkg_resources'
```

Fix applied inside the Chatterbox venv:

```bash
/home/astigmatism/ai-services/tts-chatterbox/.venv/bin/python -m pip install 'setuptools<81'
```

Current compatible setuptools observed:

```text
setuptools 80.10.2
```

This causes a warning about `pkg_resources` deprecation, but Chatterbox loads and runs successfully.

Do not upgrade setuptools in this venv past 80.x unless the Perth package has been fixed or replaced.

## Performance Findings

### Standard model

Standard Chatterbox was functionally correct but slower than desired for orchestrator use. A paragraph of a few sentences was observed around ~11 seconds in user testing.

### Turbo model

Turbo was added as a selectable/default model.

Observed timings:

```text
Turbo first request after model switch:
  52.088s
  Includes unload/load/download/init overhead.

Turbo second request while resident:
  2.348s
  This is the meaningful warmed runtime measurement.
```

Current recommendation:

```text
Use turbo as default_model for day-to-day orchestration.
Use standard only for slower quality experiments.
Use multilingual only when language_id support is needed.
```

Do not use the first request after a service restart or model switch as a performance benchmark.

## GPU Residency

Observed GPU process state after both services were running:

```text
Chatterbox process:
  /home/astigmatism/ai-services/tts-chatterbox/.venv/bin/python
  about 3612 MiB GPU memory

STT process:
  /home/astigmatism/ai-services/stt/.venv/bin/python3
  about 2296 MiB GPU memory

Total observed usage:
  about 5923 MiB / 10240 MiB
```

This confirms both STT and Chatterbox can coexist in VRAM on the RTX 3080.

For live GPU diagnostics, prefer:

```bash
nvidia-smi
```

or:

```bash
nvidia-smi dmon -s pucm -d 1
```

rather than relying only on `/gpu` polling during active generation.

## Operational Commands

### Check public service

```bash
systemctl status local-ai-voice-stt.service --no-pager -l
```

### Restart public service

```bash
sudo systemctl restart local-ai-voice-stt.service
```

### Check internal Chatterbox service

```bash
systemctl status local-ai-voice-tts-chatterbox.service --no-pager -l
```

### Restart internal Chatterbox service

```bash
sudo systemctl restart local-ai-voice-tts-chatterbox.service
```

### Follow Chatterbox logs

```bash
journalctl -u local-ai-voice-tts-chatterbox.service -f
```

### Follow public API logs

```bash
journalctl -u local-ai-voice-stt.service -f
```

### Check current model

```bash
curl -s http://127.0.0.1:8000/models | python3 -m json.tool
```

### Set Turbo as default

```bash
curl -s -X POST http://127.0.0.1:8000/model/default \
  -F 'model=turbo' \
  | python3 -m json.tool
```

### Set Standard as default

```bash
curl -s -X POST http://127.0.0.1:8000/model/default \
  -F 'model=standard' \
  | python3 -m json.tool
```

### Set Multilingual as default

```bash
curl -s -X POST http://127.0.0.1:8000/model/default \
  -F 'model=multilingual' \
  | python3 -m json.tool
```

### Generate TTS sample

```bash
curl -s -X POST http://127.0.0.1:8000/speak \
  -F 'text=This is a test through the public local AI voice API.' \
  --output /tmp/speech.wav && file /tmp/speech.wav
```

### Generate multilingual sample

```bash
curl -s -X POST http://127.0.0.1:8000/speak \
  -F 'model=multilingual' \
  -F 'language_id=en' \
  -F 'text=This is a multilingual model test using English.' \
  --output /tmp/multilingual-test.wav && file /tmp/multilingual-test.wav
```

## Rollback Notes

Backups exist in both active service directories.

Public API backups:

```text
/home/astigmatism/ai-services/stt/app.py.backup.*
/home/astigmatism/ai-services/stt/app.py.backup.before-chatterbox-proxy
/home/astigmatism/ai-services/stt/app.py.backup.before-public-voice-api
/home/astigmatism/ai-services/stt/app.py.backup.before-public-model-api
```

Internal Chatterbox backups:

```text
/home/astigmatism/ai-services/tts-chatterbox/app.py.backup.before-voice-api
/home/astigmatism/ai-services/tts-chatterbox/app.py.backup.before-model-api
```

To rollback public API code:

```bash
cp /path/to/desired/backup.py /home/astigmatism/ai-services/stt/app.py
sudo systemctl restart local-ai-voice-stt.service
```

To rollback internal Chatterbox code:

```bash
cp /path/to/desired/backup.py /home/astigmatism/ai-services/tts-chatterbox/app.py
sudo systemctl restart local-ai-voice-tts-chatterbox.service
```

To stop Chatterbox service:

```bash
sudo systemctl stop local-ai-voice-tts-chatterbox.service
```

To disable Chatterbox service at boot:

```bash
sudo systemctl disable local-ai-voice-tts-chatterbox.service
```

## Notes for Future AI Model / Developer

The desired design direction is:

```text
1. Keep STT stable.
2. Use port 8000 as the only public integration surface.
3. Treat port 8001 as an internal Chatterbox backend.
4. Keep Chatterbox Turbo as the default for speed unless quality requires otherwise.
5. Treat Chatterbox voices as reference-audio prompts, not built-in named speakers.
6. Keep only one Chatterbox model loaded at a time for VRAM safety.
7. Avoid installing Chatterbox into the STT venv because of conflicting/heavy PyTorch/CUDA dependencies.
```

The user prefers terminal-level instructions, one step at a time, with minimal filesystem noise unless a change is intentional.
