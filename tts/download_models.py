#!/usr/bin/env python3
"""Download the F5TTS_Base checkpoint (ModelScope) used to clone the wuyongss voice.

The vocoder (vocos-mel-24khz) is fetched automatically by f5-tts on first run
via HuggingFace; ensure HF is reachable on the machine running inference.
"""
import os

MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "tts_models", "F5TTS_Base")
os.makedirs(MODELS_DIR, exist_ok=True)

def main():
    from modelscope.hub.file_download import model_file_download
    # F5TTS_Base checkpoint (verified reachable on ModelScope from this environment)
    cands = [
        "F5TTS_Base/model_1200000.pt",
        "F5TTS_Base/model_last.pt",
        "F5TTS_Base/model_1200000.safetensors",
    ]
    for fp in cands:
        try:
            p = model_file_download(
                model_id="AI-ModelScope/F5-TTS",
                file_path=fp,
                revision="master",
                local_dir=MODELS_DIR,
            )
            print("downloaded:", p)
            return
        except Exception as e:
            print("skip", fp, "->", repr(e)[:120])
    raise SystemExit("F5TTS checkpoint download failed")

if __name__ == "__main__":
    main()
