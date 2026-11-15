#!/usr/bin/env python3
"""
Pictures for the portal's Guide page, made from the showcase captures (showcase/.out, demo data).

Each picture is a screenshot cropped to the part a guide topic talks about, saved as WebP in
public/guide/, with the boxes of its marked buttons and fields (in % of the picture) written to
src/guide/shots.json, so the page can put numbered markers on them.

    python3 showcase/guide/images.py        (after the captures in showcase/capture/ have run)
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

SHOWCASE = Path(__file__).resolve().parent.parent
PORTAL = SHOWCASE.parent
OUT = SHOWCASE / '.out'
PUBLIC = PORTAL / 'public' / 'guide'
JSON_OUT = PORTAL / 'src' / 'guide' / 'shots.json'
VIDEO = SHOWCASE / 'bannuar-showcase.mp4'

MAIN = {'x': 252, 'y': 0, 'w': 1188, 'h': 900}  # the portal's work area, right of the menu
MAX_W = {'desktop': 1600, 'tablet': 1600, 'phone': 780, 'phone-web': 780, 'paper': 1400}

# id: (shot, crop, pad)  crop: None (whole screen), 'main', a mark name or list of names (their
# union), or a box {x, y, w, h} in CSS pixels. pad: CSS pixels around a union of marks.
PICTURES = {
    # start here
    'hr-setup': ('hr-setup', ['email', 'make'], (70, 190, 70, 60)),
    'hr-signin': ('hr-signin', ['email', 'setup'], (70, 120, 70, 50)),
    'hr-dashboard': ('hr-dashboard', None, 0),
    # HR portal
    'hr-employees': ('hr-employees', 'main', 0),
    'hr-employee': ('hr-employee', 'main', 0),
    'hr-employee-docs': ('hr-employee-docs', 'main', 0),
    'hr-compliance': ('hr-compliance', 'main', 0),
    'hr-employee-account': ('hr-employee-account', {'x': 252, 'y': 0, 'w': 1188, 'h': 470}, 0),
    'hr-posts': ('hr-posts', 'main', 0),
    'hr-post': ('hr-post', 'main', 0),
    'hr-deploy': ('hr-deploy', 'dialog0', 14),
    'hr-attendance': ('hr-attendance', 'main', 0),
    'hr-attendance-log': ('hr-attendance-log', 'dialog0', 14),
    'hr-leave-approve': ('hr-leave-approve', 'dialog0', 14),
    'hr-coe': ('hr-coe', 'main', 0),
    'hr-coe-issue': ('hr-coe-issue', 'dialog0', 14),
    'hr-changes': ('hr-changes', 'main', 0),
    'hr-reports': ('hr-reports', 'main', 0),
    'hr-report': ('hr-report', 'dialog0', 14),
    'hr-discipline-cases': ('hr-discipline-cases', 'main', 0),
    'hr-discipline-case': ('hr-discipline-case', 'dialog0', 14),
    'hr-discipline-code': ('hr-discipline-code', 'main', 0),
    'hr-announcements': ('hr-announcements', 'main', 0),
    'hr-announce-write': ('hr-announce-write', 'dialog0', 14),
    'hr-recruitment': ('hr-recruitment', 'dialog0', 14),
    'hr-inquiries': ('hr-inquiries', 'main', 0),
    'hr-client-access': ('hr-client-access', 'dialog0', 14),
    'hr-client-requests': ('hr-client-requests', 'main', 0),
    'hr-users': ('hr-users', 'main', 0),
    'hr-invite': ('hr-invite', 'dialog0', 14),
    'hr-audit': ('hr-audit', 'main', 0),
    # payroll
    'hr-pay-rules': ('hr-pay-rules', 'main', 0),
    'hr-pay-rule': ('hr-pay-rule', 'dialog0', 14),
    'hr-pay-rule-2': ('hr-pay-rule-2', 'dialog0', 14),
    'hr-post-pay': ('hr-post-pay', 'pay', 16),
    'hr-payroll': ('hr-payroll', 'main', 0),
    'hr-cutoff': ('hr-cutoff', 'main', 0),
    'hr-cutoff-2': ('hr-cutoff-2', 'main', 0),
    'hr-import': ('hr-import', 'dialog0', 14),
    'hr-work-out-pay': ('hr-work-out-pay', 'dialog0', 14),
    'hr-13th': ('hr-13th', 'main', 0),
    'hr-concerns': ('hr-concerns', 'main', 0),
    'hr-coe-pdf': ('hr-coe-pdf', {'x': 120, 'y': 1180, 'w': 1480, 'h': 900}, 0),
    # client portal (tablet)
    'client-posts': ('client-posts', None, 0),
    'client-attendance': ('client-attendance', None, 0),
    'client-cutoff': ('client-cutoff', None, 0),
    'client-cutoff-disputed': ('client-cutoff-disputed', None, 0),
    'client-reports': ('client-reports', None, 0),
    'client-report-form': ('client-report-form', 'dialog0', 14),
    'client-requests': ('client-requests', None, 0),
    'client-request-form': ('client-request-form', 'dialog0', 14),
    # employee app (phone)
    **{k: (k, None, 0) for k in [
        'app-signin', 'app-activate', 'app-home', 'app-timein-located', 'app-timein-photo', 'app-timein-logged',
        'app-payslip-hidden', 'app-payslip', 'app-payslip-lines', 'app-leave', 'app-leave-form', 'app-leave-filed',
        'app-more', 'app-coe', 'app-coe-form', 'app-cert', 'app-announcement', 'app-documents', 'app-upload',
        'app-upload-checked', 'app-notice', 'app-notice-explain', 'app-notifications', 'app-home-dark',
        'cmd-home', 'cmd-mypost', 'cmd-endorse', 'cmd-guard', 'cmd-log-for', 'cmd-incident',
    ]},
    # website
    'web-openings': ('web-openings', ['opening0', 'opening1'], 24),
    'web-applied': ('web-applied', 'done', 30),
    'web-proposal': ('web-proposal', None, 0),
    'web-verify': ('web-verify', ['form0', 'result'], 30),
}
# frames of the tour video itself: (id, seconds)
FRAMES = [('video-poster', 5.4), ('one-system', 387.5)]


def union(boxes):
    x0 = min(b['x'] for b in boxes)
    y0 = min(b['y'] for b in boxes)
    x1 = max(b['x'] + b['w'] for b in boxes)
    y1 = max(b['y'] + b['h'] for b in boxes)
    return {'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0}


def main():
    manifest = json.loads((OUT / 'manifest.json').read_text())['shots']
    PUBLIC.mkdir(parents=True, exist_ok=True)
    JSON_OUT.parent.mkdir(parents=True, exist_ok=True)
    result = {}
    total = 0
    problems = []
    for pid, (shot, crop, pad) in PICTURES.items():
        info = manifest.get(shot)
        if shot == 'hr-coe-pdf':
            info = {'device': 'paper', 'file': 'shots/hr-coe-pdf.png', 'w': 1700, 'h': 2200, 'marks': {}}
        if not info:
            problems.append(f'{pid}: no capture {shot}')
            continue
        img = Image.open(OUT / info['file']).convert('RGB')
        scale = img.width / info['w']
        marks = info.get('marks') or {}
        if crop is None:
            box = {'x': 0, 'y': 0, 'w': info['w'], 'h': info['h']}
        elif crop == 'main':
            box = dict(MAIN)
        elif isinstance(crop, dict):
            box = dict(crop)
        else:
            names = [crop] if isinstance(crop, str) else crop
            found = [marks[n] for n in names if n in marks]
            if len(found) != len(names):
                problems.append(f'{pid}: missing mark(s) {[n for n in names if n not in marks]} on {shot}')
                if not found:
                    continue
            u = union(found)
            l, t, r, b = (pad, pad, pad, pad) if isinstance(pad, (int, float)) else pad
            box = {'x': u['x'] - l, 'y': u['y'] - t, 'w': u['w'] + l + r, 'h': u['h'] + t + b}
        # keep the box on the screen
        box['x'] = max(0, box['x'])
        box['y'] = max(0, box['y'])
        box['w'] = min(info['w'] - box['x'], box['w'])
        box['h'] = min(info['h'] - box['y'], box['h'])
        px = tuple(round(v * scale) for v in (box['x'], box['y'], box['x'] + box['w'], box['y'] + box['h']))
        part = img.crop(px)
        width = min(part.width, MAX_W[info['device']])
        if width < part.width:
            part = part.resize((width, round(part.height * width / part.width)), Image.LANCZOS)
        path = PUBLIC / f'{pid}.webp'
        part.save(path, 'WEBP', quality=84, method=6)
        total += path.stat().st_size
        # marks inside the crop, as % of the picture
        inside = {}
        for name, m in marks.items():
            x0 = max(m['x'], box['x'])
            y0 = max(m['y'], box['y'])
            x1 = min(m['x'] + m['w'], box['x'] + box['w'])
            y1 = min(m['y'] + m['h'], box['y'] + box['h'])
            if x1 - x0 < 4 or y1 - y0 < 4:
                continue
            inside[name] = [round(100 * (x0 - box['x']) / box['w'], 2), round(100 * (y0 - box['y']) / box['h'], 2),
                            round(100 * (x1 - x0) / box['w'], 2), round(100 * (y1 - y0) / box['h'], 2)]
        result[pid] = {'src': f'/guide/{pid}.webp', 'w': part.width, 'h': part.height, 'device': info['device'], 'marks': inside}

    if VIDEO.exists():
        with tempfile.TemporaryDirectory() as tmp:
            for pid, at in FRAMES:
                png = Path(tmp) / f'{pid}.png'
                subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(at), '-i', str(VIDEO), '-frames:v', '1', str(png)], check=True)
                frame = Image.open(png).convert('RGB').resize((1600, 900), Image.LANCZOS)
                path = PUBLIC / f'{pid}.webp'
                frame.save(path, 'WEBP', quality=84, method=6)
                total += path.stat().st_size
                result[pid] = {'src': f'/guide/{pid}.webp', 'w': 1600, 'h': 900, 'device': 'video', 'marks': {}}
    else:
        problems.append(f'no video at {VIDEO}: the poster and the one-system frame were not made')

    JSON_OUT.write_text(json.dumps(result, indent=1, sort_keys=True) + '\n')
    print(f'{len(result)} pictures, {total / 1e6:.1f} MB in {PUBLIC}')
    for p in problems:
        print(f'  ! {p}')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
