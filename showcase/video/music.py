#!/usr/bin/env python3
"""
The showcase video's soundtrack: a calm, warm piece in D major, made with numpy alone (no samples and
nothing downloaded, so there is nothing to license). It follows the timeline render.mjs writes:

  title    pads and a bell          website  a piano-like line comes in
  portal   a soft beat under it     client   lighter, new chords
  app      the fullest part         ending   resolves home to D

A soft click lands on every tap shown on screen, a swell leads into each chapter, and two chimes
mark the links in the "one time in, three places" scene.

    python3 showcase/video/music.py showcase/.out/timeline.json showcase/.out/music.wav
"""
import json
import sys
import wave

import numpy as np

SR = 44100
BPM = 78
BEAT = 60.0 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(11)


def hz(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


# bass root, pad voicing, piano line (MIDI note numbers)
CHORDS = {
    'D': (38, [57, 62, 64, 66, 69], [62, 66, 69, 74, 76, 74, 69, 66]),
    'Bm': (35, [54, 59, 62, 66, 69], [59, 62, 66, 71, 74, 71, 66, 62]),
    'G': (43, [55, 59, 62, 66, 69], [59, 62, 67, 71, 74, 71, 67, 62]),
    'Asus': (45, [57, 62, 64, 69, 71], [57, 62, 64, 69, 74, 69, 64, 62]),
    'A': (45, [57, 61, 64, 69, 71], [57, 61, 64, 69, 73, 69, 64, 61]),
    'F#m': (42, [54, 57, 61, 64, 69], [57, 61, 64, 69, 73, 69, 64, 61]),
    'Em': (40, [55, 59, 62, 66, 71], [59, 62, 66, 71, 74, 71, 66, 62]),
}
PROGRESSIONS = {
    'A': ['D', 'Bm', 'G', 'Asus'],
    'B': ['G', 'A', 'F#m', 'Bm'],
    'C': ['Em', 'G', 'D', 'A'],
}
# per section: progressions in turn, then levels for pads, the piano line (and notes a bar), bass, kick, shaker, clap, bell
FEEL = {
    'title': dict(progs=['A'], pad=1.0, arp=0.0, rate=0, bass=0.0, kick=0, hat=0, clap=0, bell=1),
    'website': dict(progs=['A'], pad=0.9, arp=0.9, rate=4, bass=0.7, kick=0, hat=0, clap=0, bell=0),
    'portal': dict(progs=['A', 'A', 'B', 'A'], pad=0.8, arp=1.0, rate=8, bass=0.9, kick=1, hat=0.6, clap=0, bell=0),
    'client': dict(progs=['C', 'B'], pad=0.9, arp=0.85, rate=8, bass=0.8, kick=0, hat=0.5, clap=0, bell=0),
    'app': dict(progs=['A', 'B', 'A', 'C'], pad=0.8, arp=1.0, rate=8, bass=1.0, kick=1, hat=0.8, clap=0.6, bell=0),
    'ending': dict(progs=['A'], pad=1.0, arp=0.7, rate=4, bass=0.6, kick=0, hat=0, clap=0, bell=1),
}


def seconds(n):
    return np.arange(n) / SR


# ------------------------------------------------------------------ instruments
def pad_note(freq, dur, release=2.2):
    n = int((dur + release) * SR)
    t = seconds(n)
    left = np.zeros(n)
    right = np.zeros(n)
    for cents, pan in ((-7, 0.18), (0, 0.5), (7, 0.82)):
        f = freq * 2 ** (cents / 1200)
        v = np.zeros(n)
        for h, amp in ((1, 1.0), (2, 0.32), (3, 0.13), (4, 0.05)):
            v += amp * np.sin(2 * np.pi * f * h * t + rng.uniform(0, 2 * np.pi))
        left += v * np.cos(pan * np.pi / 2)
        right += v * np.sin(pan * np.pi / 2)
    env = np.ones(n)
    a = min(int(1.4 * SR), int(dur * SR))
    env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    s = int(dur * SR)
    env[s:] = env[s - 1] * np.cos(np.linspace(0, np.pi / 2, n - s)) ** 2
    env *= 1 + 0.08 * np.sin(2 * np.pi * 0.17 * t + rng.uniform(0, 2 * np.pi))
    return left * env, right * env


def piano(freq, vel, length=2.6):
    n = int(length * SR)
    t = seconds(n)
    v = np.zeros(n)
    for h, amp in ((1, 1.0), (2, 0.48), (3, 0.22), (4, 0.11), (5, 0.05), (6, 0.025)):
        v += amp * np.exp(-(1.5 + 1.25 * h) * t) * np.sin(2 * np.pi * freq * h * (1 + 0.0002 * h * h) * t + rng.uniform(0, 2 * np.pi))
    v += rng.standard_normal(n) * np.exp(-t * 260) * 0.015
    v *= np.minimum(1, t / 0.003)
    tail = int(0.25 * SR)
    v[-tail:] *= np.linspace(1, 0, tail)
    return v * vel


def bell(freq, vel, length=5.0):
    n = int(length * SR)
    t = seconds(n)
    v = np.zeros(n)
    for m, amp, dec in ((1, 1.0, 0.8), (2.0, 0.3, 1.5), (3.01, 0.16, 2.3), (4.17, 0.07, 3.4), (5.43, 0.03, 4.5)):
        v += amp * np.exp(-dec * t) * np.sin(2 * np.pi * freq * m * t + rng.uniform(0, 2 * np.pi))
    v *= np.minimum(1, t / 0.004)
    tail = int(0.4 * SR)
    v[-tail:] *= np.linspace(1, 0, tail)
    return v * vel


def bass_note(freq, dur, vel):
    n = int((dur + 0.3) * SR)
    t = seconds(n)
    v = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t) + 0.08 * np.sin(2 * np.pi * 3 * freq * t)
    env = np.minimum(1, t / 0.012) * (0.72 + 0.28 * np.exp(-t * 3))
    s = int(dur * SR)
    env[s:] *= np.cos(np.linspace(0, np.pi / 2, n - s)) ** 2
    return v * env * vel


def kick(vel):
    n = int(0.5 * SR)
    t = seconds(n)
    f = 47 + 72 * np.exp(-t * 30)
    v = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6.5)
    v += rng.standard_normal(n) * np.exp(-t * 420) * 0.05
    return v * np.minimum(1, t / 0.002) * vel


def shaker(vel):
    n = int(0.07 * SR)
    t = seconds(n)
    x = np.diff(np.diff(rng.standard_normal(n + 2)))
    return x * np.exp(-t * 55) * np.minimum(1, t / 0.005) * vel


def clap(vel):
    n = int(0.32 * SR)
    t = seconds(n)
    x = np.diff(rng.standard_normal(n + 1))
    env = np.exp(-t * 19)
    for k in (0.0, 0.011, 0.022):
        env += 0.6 * np.exp(-np.maximum(0, t - k) * 260) * (t >= k)
    body = 0.35 * np.sin(2 * np.pi * 185 * t) * np.exp(-t * 32)
    return (x * env * 0.5 + body) * vel


def click():
    n = int(0.09 * SR)
    t = seconds(n)
    v = 0.6 * np.sin(2 * np.pi * 1320 * t) * np.exp(-t * 75) + 0.22 * np.sin(2 * np.pi * 2640 * t) * np.exp(-t * 120)
    v += rng.standard_normal(n) * np.exp(-t * 900) * 0.2
    return v * np.minimum(1, t / 0.0015)


def swell(rise=1.6, fall=1.1):
    n = int((rise + fall) * SR)
    t = seconds(n)
    x = rng.standard_normal(n)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec *= np.exp(-((np.log(f + 1) - np.log(1400)) ** 2) / (2 * 0.75 ** 2))
    x = np.fft.irfft(spec, n)
    x /= np.max(np.abs(x))
    env = np.where(t < rise, (t / rise) ** 2.6, np.exp(-(t - rise) * 4.2))
    return x * env


# ------------------------------------------------------------------ space
def reverb_ir(length=2.8, seed=3):
    n = int(length * SR)
    t = seconds(n)
    r = np.random.default_rng(seed)
    f = np.fft.rfftfreq(n, 1 / SR)
    irs = []
    for _ in range(2):
        x = r.standard_normal(n) * np.exp(-6.9 * t / length)
        spec = np.fft.rfft(x) / (1 + (f / 4200) ** 2)
        x = np.fft.irfft(spec, n)
        x[: int(0.015 * SR)] = 0
        irs.append(x / np.sqrt(np.sum(x ** 2)))
    return irs


def convolve(x, ir):
    m = len(ir)
    size = 1 << int(np.ceil(np.log2(m + (1 << 17))))
    block = size - m + 1
    spec_ir = np.fft.rfft(ir, size)
    y = np.zeros(len(x) + m)
    for i in range(0, len(x), block):
        seg = x[i:i + block]
        z = np.fft.irfft(np.fft.rfft(seg, size) * spec_ir, size)[: len(seg) + m - 1]
        y[i:i + len(z)] += z
    return y[: len(x)]


# ------------------------------------------------------------------ the arrangement
def main():
    timeline = json.load(open(sys.argv[1]))
    out_path = sys.argv[2]
    duration = timeline['duration']
    n = int(np.ceil(duration * SR))
    stems = {name: [np.zeros(n), np.zeros(n)] for name in ('pad', 'piano', 'bell', 'bass', 'kick', 'shaker', 'clap', 'click', 'swell')}

    def place(stem, x, at, gain=1.0, pan=0.5):
        i = int(round(at * SR))
        if i >= n or i < 0:
            return
        j = min(n, i + (len(x[0]) if isinstance(x, tuple) else len(x)))
        if isinstance(x, tuple):
            stems[stem][0][i:j] += x[0][: j - i] * gain
            stems[stem][1][i:j] += x[1][: j - i] * gain
        else:
            stems[stem][0][i:j] += x[: j - i] * gain * np.cos(pan * np.pi / 2)
            stems[stem][1][i:j] += x[: j - i] * gain * np.sin(pan * np.pi / 2)

    chapters = {c['id']: c for c in timeline['chapters']}
    starts = [('title', 0.0), ('website', chapters['website']['start']), ('portal', chapters['portal']['start']),
              ('client', chapters['client']['start']), ('app', chapters['app']['start']), ('ending', chapters['app']['end'])]
    firsts = [(name, int(round(at / BAR))) for name, at in starts]
    nbars = int(np.ceil(duration / BAR))

    def section(b):
        current = firsts[0]
        for s in firsts:
            if s[1] <= b:
                current = s
        nxt = next((f for _, f in firsts if f > b), nbars + 8)
        return current[0], current[1], nxt

    for b in range(nbars):
        at = b * BAR
        name, first, nxt = section(b)
        feel = FEEL[name]
        rel = b - first
        if name == 'ending':
            sequence = ['G', 'Asus', 'D']
            chord = sequence[min(rel, 2)]
            new_chord = rel <= 2
            pad_bars = 1 if rel < 2 else (duration - at) / BAR - 1.0
        else:
            prog = PROGRESSIONS[feel['progs'][(rel // 8) % len(feel['progs'])]]
            chord = prog[(rel // 2) % 4]
            new_chord = rel % 2 == 0
            pad_bars = min(2, nxt - b)
        root, voicing, line = CHORDS[chord]
        if new_chord:
            for m in voicing:
                place('pad', pad_note(hz(m), max(0.8, pad_bars * BAR)), at, feel['pad'] / len(voicing))
            if feel['bell']:
                place('bell', bell(hz(line[3] + 12), 0.8), at + 0.15, pan=0.62)
                if name == 'title' or rel < 2:
                    place('bell', bell(hz(line[2] + 12), 0.55), at + 2 * BEAT + 0.1, pan=0.38)
        if name == 'ending' and rel > 2:
            continue
        # the piano line
        if feel['arp'] and feel['rate']:
            step = 4 * BEAT / feel['rate']
            half = (rel % 2) * feel['rate']
            for k in range(feel['rate']):
                note = line[(half + k) % 8]
                vel = (1.0 if k == 0 else 0.8 if k % 2 == 0 else 0.68) * rng.uniform(0.88, 1.08) * feel['arp']
                jitter = rng.uniform(-0.006, 0.006)
                place('piano', piano(hz(note), vel), at + k * step + max(0, jitter), pan=0.4 if k % 2 else 0.6)
        # bass
        if feel['bass']:
            if feel['rate'] >= 8:
                place('bass', bass_note(hz(root), 2.5 * BEAT, feel['bass']), at)
                place('bass', bass_note(hz(root), 0.5 * BEAT, 0.7 * feel['bass']), at + 3.5 * BEAT)
            else:
                place('bass', bass_note(hz(root), 3.6 * BEAT, feel['bass']), at)
        # drums
        if feel['kick']:
            place('kick', kick(1.0), at)
            place('kick', kick(0.8), at + 2 * BEAT)
            if rel % 4 == 3:
                place('kick', kick(0.5), at + 3.5 * BEAT)
        if feel['clap']:
            place('clap', clap(0.9), at + BEAT, pan=0.5)
            place('clap', clap(0.85), at + 3 * BEAT, pan=0.5)
        if feel['hat']:
            for k in range(8):
                place('shaker', shaker((1.0 if k % 2 else 0.55) * feel['hat'] * rng.uniform(0.85, 1.1)), at + k * BEAT / 2, pan=0.66)

    # what happens on screen
    for t in timeline['taps']:
        place('click', click(), t, pan=0.5)
    for s in timeline['scenes']:
        if s['type'] == 'chapter':
            place('swell', swell(), s['start'] + 0.25 - 1.6, pan=0.5)
        if s['type'] == 'connect':
            place('bell', bell(hz(81), 0.7), s['start'] + 3.0, pan=0.4)
            place('bell', bell(hz(86), 0.7), s['start'] + 5.0, pan=0.6)

    # each part at its level (RMS while it sounds, in dBFS), then the room
    levels = {'pad': -21, 'piano': -24, 'bell': -29, 'bass': -24, 'kick': -25, 'shaker': -40, 'clap': -35, 'click': -30, 'swell': -31}
    for name, (l, r) in stems.items():
        both = np.concatenate([l, r])
        active = both[np.abs(both) > 1e-4]
        if len(active) == 0:
            continue
        g = 10 ** (levels[name] / 20) / np.sqrt(np.mean(active ** 2))
        l *= g
        r *= g
        print(f'  {name:7s} gain {20 * np.log10(g):6.1f} dB')
    send = {'pad': 0.35, 'piano': 0.32, 'bell': 0.55, 'clap': 0.2, 'swell': 0.3, 'click': 0.08}
    ir_l, ir_r = reverb_ir()
    wet_in_l = sum(stems[k][0] * v for k, v in send.items())
    wet_in_r = sum(stems[k][1] * v for k, v in send.items())
    wet_l = convolve(wet_in_l, ir_l)
    wet_r = convolve(wet_in_r, ir_r)
    left = sum(s[0] for s in stems.values()) + 0.55 * wet_l
    right = sum(s[1] for s in stems.values()) + 0.55 * wet_r

    # master: gentle saturation and fades
    peak = max(np.max(np.abs(left)), np.max(np.abs(right)))
    left, right = left / peak, right / peak
    drive = 1.6
    left = np.tanh(left * drive) / np.tanh(drive)
    right = np.tanh(right * drive) / np.tanh(drive)
    t = seconds(n)
    fade = np.minimum(1, t / 1.5) * np.clip((duration - t) / 4.0, 0, 1)
    left *= fade
    right *= fade
    # −1 dBFS peak, but no louder than −17 dBFS RMS: music under the pictures, not over them
    peak = max(np.max(np.abs(left)), np.max(np.abs(right)))
    rms = np.sqrt(np.mean(np.concatenate([left, right]) ** 2))
    g = min(0.89 / peak, 10 ** (-17 / 20) / rms)
    left, right = left * g, right * g
    rms = np.sqrt(np.mean(np.concatenate([left, right]) ** 2))
    print(f'  master RMS {20 * np.log10(rms):.1f} dBFS, {duration:.1f} s')

    pcm = (np.clip(np.stack([left, right], axis=1), -1, 1) * 32767).astype('<i2')
    with wave.open(out_path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f'Music: {out_path}')


if __name__ == '__main__':
    main()
