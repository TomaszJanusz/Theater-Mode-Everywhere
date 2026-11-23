"""Regenerate the committed PCM16 fixtures with Flite 2.2 and NumPy."""
import argparse
import ctypes
import tempfile
import wave
from pathlib import Path

import numpy as np


RATE = 16_000
SPEECH = (
    b"Soft steps cross the room.",
    b"Six bright bells ring.",
)
ROOMS = {
    "room-rt030": (0.30, 28030),
    "room-rt080": (0.80, 28080),
    "room-rt150": (1.50, 28150),
    "wall-reflection": (0.80, 28042),
}


def read_pcm(path):
    with wave.open(str(path), "rb") as src:
        assert src.getframerate() == RATE and src.getsampwidth() == 2
        assert src.getnchannels() == 1
        return np.frombuffer(src.readframes(src.getnframes()), dtype="<i2") / 32768


def write_pcm(path, samples):
    pcm = np.rint(np.clip(samples * 32768, -32768, 32767)).astype("<i2")
    with wave.open(str(path), "wb") as dst:
        dst.setparams((1 if pcm.ndim == 1 else pcm.shape[1], 2, RATE, 0, "NONE", ""))
        dst.writeframes(pcm.tobytes())


def dry_speech():
    # Use the same CMU US English RMS voice as `flite -voice rms`. runner02 has
    # the shared libraries from Ubuntu's libflite1, without the Flite CLI.
    engine = ctypes.CDLL("libflite.so.1", mode=ctypes.RTLD_GLOBAL)
    engine.flite_init()
    voice_lib = ctypes.CDLL("libflite_cmu_us_rms.so.1")
    register = voice_lib.register_cmu_us_rms
    register.argtypes = (ctypes.c_char_p,)
    register.restype = ctypes.c_void_p
    voice = register(None)
    synth = engine.flite_text_to_speech
    synth.argtypes = (ctypes.c_char_p, ctypes.c_void_p, ctypes.c_char_p)
    synth.restype = ctypes.c_float

    phrases = []
    with tempfile.TemporaryDirectory(prefix="tme-audio-lab-speech-") as temp:
        wav_file = Path(temp) / "phrase.wav"
        for phrase in SPEECH:
            synth(phrase, voice, bytes(wav_file))
            audio = read_pcm(wav_file)
            active = np.flatnonzero(np.abs(audio) > 0.001)
            phrases.append(audio[max(0, active[0] - 160):active[-1] + 161])

    # Silence after the last phrase leaves room for the longest decay.
    return 0.72 * np.concatenate((
        np.zeros(RATE // 10), phrases[0], np.zeros(RATE // 4), phrases[1],
        np.zeros(3 * RATE // 2),
    ))


def music_bed(length):
    t = np.arange(length) / RATE
    bed = np.zeros((length, 2))
    beat_seconds = 0.52
    chords = ((110, 164.81, 220), (98, 146.83, 196), (130.81, 196, 261.63), (82.41, 123.47, 164.81))
    for beat, start in enumerate(np.arange(0, t[-1], beat_seconds)):
        age = np.maximum(0, t - start)
        envelope = (1 - np.exp(-age * 190)) * np.exp(-age * 6)
        for note, hz in enumerate(chords[beat // 2 % len(chords)]):
            phase = 2 * np.pi * hz * age
            tone = (np.sin(phase) + 0.42 * np.sin(2 * phase) + 0.17 * np.sin(3 * phase)) * envelope
            bed += 0.035 * tone[:, None] * ((1, 0.42), (0.72, 0.72), (0.42, 1))[note]
    return bed * np.clip((t[-1] - t[:, None]) / 0.18, 0, 1)


def room_response(rt60, seed, wall):
    # The amplitude envelope drops 60 dB in the nominal RT60. Preserve the
    # early taps explicitly so direct arrival and the wall echo are reproducible.
    t = np.arange(round((rt60 + 0.08) * RATE)) / RATE
    rng = np.random.default_rng(seed)
    white = rng.standard_normal(len(t) + 2)
    noise = (white[2:] + 0.65 * white[1:-1] + 0.25 * white[:-2]) / 1.22
    age = np.maximum(0, t - 0.018)
    envelope = np.clip(age / 0.025, 0, 1) * np.exp(-np.log(1000) * age / rt60)
    taps = [(0, 0.22), (0.042, 0.77), (0.076, -0.26)] if wall else [
        (0, 0.75), (0.008, 0.18), (0.017, -0.11), (0.029, 0.07),
    ]
    response = noise * envelope * (0.031 if wall else 0.019)
    for delay, gain in taps:
        response[round(delay * RATE)] += gain
    return response


def generate(out):
    out.mkdir(parents=True, exist_ok=True)
    dry_file = out / "dry-speech.wav"
    write_pcm(dry_file, dry_speech())
    dry = read_pcm(dry_file)
    write_pcm(out / "speech-over-music.wav", dry[:, None] + music_bed(len(dry)))
    for name, (rt60, seed) in ROOMS.items():
        ir_file = out / f"{name}-ir.wav"
        write_pcm(ir_file, room_response(rt60, seed, wall=name == "wall-reflection"))
        # Convolve the frozen, quantized sources. Trim to the dry timeline
        # including its 1.5 s of trailing silence so A/B is time aligned.
        ir = read_pcm(ir_file)
        nfft = 1 << (len(dry) + len(ir) - 2).bit_length()
        filtered = np.fft.irfft(np.fft.rfft(dry, nfft) * np.fft.rfft(ir, nfft), nfft)
        write_pcm(out / f"{name}.wav", filtered[:len(dry)])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent)
    generate(parser.parse_args().out)
