"""Original 60 s score for the Canvas Study Agent demo.

120 BPM, 2-second bars aligned to scene cuts (10, 16, 22, 32, 38, 44, 50, 54 s).
Everything is synthesized here: no samples, no third-party audio.
"""
import sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
DUR = 60.0
N = int(SR * DUR)
rng = np.random.default_rng(7)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def t_arr(n):
    return np.arange(n) / SR


def lp(x, fc, order=2):
    return sosfilt(butter(order, fc, "low", fs=SR, output="sos"), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def add(buf, start, sig):
    i = int(start * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i]


def saw(freq, n, bright):
    """Band-limited additive saw; `bright` sets the harmonic roll-off."""
    t = t_arr(n)
    out = np.zeros(n)
    k = 1
    while k * freq < 9000 and k < 40:
        out += np.sin(2 * np.pi * freq * k * t + rng.uniform(0, 6.28)) / k * np.exp(-k / bright)
        k += 1
    return out


def pad_chord(notes, dur, bright, level):
    n = int((dur + 1.2) * SR)
    sig = np.zeros(n)
    for m in notes:
        for det in (-0.08, 0.0, 0.07):
            sig += saw(midi(m + det), n, bright)
    t = t_arr(n)
    env = np.minimum(1, t / 0.6) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.35))
    return sig * env * level / (len(notes) * 3)


def pluck(m, level, decay=0.32, bright=1.0):
    n = int(SR * (decay * 5))
    t = t_arr(n)
    f = midi(m)
    sig = (np.sin(2 * np.pi * f * t) + 0.35 * bright * np.sin(2 * np.pi * 2 * f * t)
           + 0.12 * bright * np.sin(2 * np.pi * 3 * f * t + 1.0))
    env = np.exp(-t / decay) * np.minimum(1, t / 0.004)
    return sig * env * level


def bell(m, level, decay=2.5):
    n = int(SR * decay * 2.5)
    t = t_arr(n)
    f = midi(m)
    sig = np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / 0.6) \
        + 0.18 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t / 0.3)
    return sig * np.exp(-t / decay) * np.minimum(1, t / 0.003) * level


def kick(level):
    n = int(SR * 0.45)
    t = t_arr(n)
    f = 45 + 85 * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.16)
    click = hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.004) * 0.12
    return (body + click) * level


def hat(level):
    n = int(SR * 0.06)
    t = t_arr(n)
    return hp(rng.standard_normal(n), 7500, 4) * np.exp(-t / 0.018) * level


def clap(level):
    n = int(SR * 0.25)
    t = t_arr(n)
    noise = bp(rng.standard_normal(n), 900, 3500)
    env = np.zeros(n)
    for o in (0.0, 0.011, 0.022):
        env += np.where(t >= o, np.exp(-(t - o) / 0.012), 0)
    env += np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.09) * 0.6, 0)
    return noise * env * level


def bass(m, dur, level):
    n = int(SR * (dur + 0.1))
    t = t_arr(n)
    f = midi(m)
    sig = np.tanh(1.6 * (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)))
    env = np.minimum(1, t / 0.01) * np.where(t < dur, 1, np.exp(-(t - dur) / 0.03))
    return lp(sig, 900) * env * level


CH = {
    "Fmaj7": ([53, 57, 60, 64], 41),
    "G6": ([55, 59, 62, 64], 43),
    "Am7": ([57, 60, 64, 67], 45),
    "Cmaj7": ([55, 60, 64, 71], 48),
}
PROG = ["Fmaj7", "G6", "Am7", "Cmaj7"]
ARP = [0, 2, 1, 3, 2, 1, 3, 2]

pad = np.zeros(N)
plk = np.zeros(N)
drm = np.zeros(N)
bas = np.zeros(N)
fx = np.zeros(N)
kick_times = []

# --- intro 0-4: swelling pad
for i, c in enumerate(["Fmaj7", "G6"]):
    p = pad_chord(CH[c][0], 2.0, 3.0 + i * 2, 0.55)
    p *= np.linspace(0.35 + 0.3 * i, 0.65 + 0.35 * i, len(p))
    add(pad, i * 2.0, p)
for k, m in enumerate([72, 76, 79]):
    add(plk, 0.5 + k * 0.5, bell(m, 0.10, 1.6))

# --- problem 4-10: darker, muted quarter-note pulse
for i, c in enumerate(["Am7", "Fmaj7", "G6"]):
    add(pad, 4 + i * 2.0, pad_chord(CH[c][0], 2.0, 2.0, 0.55))
    for b in range(4):
        add(plk, 4 + i * 2 + b * 0.5, pluck(CH[c][1] + 12, 0.22, decay=0.12, bright=0.3))

# --- main 10-50
for bar in range(20):
    t0 = 10 + bar * 2.0
    c = PROG[bar % 4]
    notes, root = CH[c]
    full = t0 >= 22
    add(pad, t0, pad_chord(notes, 2.0, 5.0 if full else 4.0, 0.48))
    for e in range(8):
        m = notes[ARP[e]] + 12
        add(plk, t0 + e * 0.25, pluck(m, 0.17 if full else 0.14, decay=0.26, bright=0.9))
    for b in (0, 1, 2, 3):
        add(bas, t0 + b * 0.5, bass(root, 0.42, 0.30))
    for b in (0, 2) if not full else (0, 1, 2, 3):
        add(drm, t0 + b * 0.5, kick(0.85 if b % 2 == 0 else 0.6))
        kick_times.append(t0 + b * 0.5)
    if full:
        for b in range(4):
            add(drm, t0 + b * 0.5 + 0.25, hat(0.10))
        for b in (1, 3):
            add(drm, t0 + b * 0.5, clap(0.16))

# --- breakdown 50-54: pads + soft arp + riser
for i, c in enumerate(["Fmaj7", "G6"]):
    notes, root = CH[c]
    add(pad, 50 + i * 2, pad_chord(notes, 2.0, 4.0, 0.5))
    for e in range(8):
        add(plk, 50 + i * 2 + e * 0.25, pluck(notes[ARP[e]] + 12, 0.10, decay=0.3))
n = int(SR * 2.0)
t = t_arr(n)
riser = bp(rng.standard_normal(n), 1500, 8000) * (t / 2.0) ** 2 * 0.12
add(fx, 52.0, riser)

# --- resolve 54-60: Cmaj9 with bells, long tail
add(pad, 54, pad_chord([48, 55, 60, 64, 71, 74], 4.2, 5.0, 0.62))
add(bas, 54, bass(36, 3.0, 0.28))
add(drm, 54, kick(0.9))
kick_times.append(54)
for k, m in enumerate([76, 79, 83, 86]):
    add(plk, 54 + k * 0.25, bell(m, 0.09, 2.2))

# sidechain duck for pad + bass
duck = np.ones(N)
for kt in kick_times:
    i = int(kt * SR)
    m = int(0.3 * SR)
    tt = t_arr(m)
    j = min(N, i + m)
    duck[i:j] = np.minimum(duck[i:j], (1 - 0.35 * np.exp(-tt / 0.12))[: j - i])

# reverb
ir_n = int(SR * 2.4)
ir_t = t_arr(ir_n)
ir = lp(rng.standard_normal(ir_n), 5000) * np.exp(-ir_t / 0.55)
ir /= np.sqrt(np.sum(ir ** 2))
wet_src = pad * 0.6 + plk
wet = fftconvolve(wet_src, ir)[:N] * 0.35

pad_f = lp(pad, 5200)
mono = pad_f * duck + plk + bas * duck + drm + fx + wet

# stereo: widen plucks / reverb with small delays
d = int(0.011 * SR)
left = mono + np.concatenate([np.zeros(d), (plk * 0.25 + wet * 0.3)[:-d]])
right = mono + np.concatenate([(plk * 0.25 + wet * 0.3)[d:], np.zeros(d)])
st = np.stack([left, right], 1)

# master fades
tt = t_arr(N)
fade = np.minimum(1, tt / 0.3) * np.clip((60.0 - tt) / 2.0, 0, 1) ** 1.5
st *= fade[:, None]
st = np.tanh(st * 1.2) / 1.2
st /= np.max(np.abs(st)) * 1.12
wavfile.write(sys.argv[1], SR, (st * 32767).astype(np.int16))
print("ok", st.shape)
