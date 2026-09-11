import json, requests, time
items = json.load(open('narration_tts.json', encoding='utf-8'))
ref = r"B:\freeclone-backend\derek-voice.wav"
for s in items:
    t0 = time.time()
    with open(ref, 'rb') as f:
        r = requests.post('http://192.168.68.63:8300/api/clone', files={'prompt_audio': ('ref.wav', f, 'audio/wav')}, data={'text': s['tts'], 'lang': 'en'}, timeout=900)
    ok = r.status_code == 200 and len(r.content) > 2000
    if ok: open(f"wav/clone/{s['id']}.wav", 'wb').write(r.content)
    print(s['id'], 'OK' if ok else 'FAIL', len(r.content), f"{time.time()-t0:.0f}s", '' if ok else r.text[:200], flush=True)
