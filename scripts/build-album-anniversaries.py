#!/usr/bin/env python3
"""Rebuild data/album-anniversaries.json.

Takes the most-listened albums of all time from ListenBrainz (popularity),
looks up each one's first release date on MusicBrainz, and saves
[{title, artist, date, listens}]. The site uses this to find albums hitting
a 10/20/25/30/40/50-year anniversary in the campaign window.

Run occasionally (it only changes as listening habits shift):
    python3 scripts/build-album-anniversaries.py
"""
import json, time, urllib.error, urllib.parse, urllib.request

UA = {'User-Agent': 'OrbitCultureCalendar/1.0 (henrywall10@gmail.com)'}
TOP_N = 2000

def get(url, tries=5):
    for n in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 503 or n == tries - 1:
                raise
            time.sleep(2 ** n)  # MusicBrainz returns 503 when rate-limited

top = []
for offset in range(0, TOP_N, 1000):
    p = get(f'https://api.listenbrainz.org/1/stats/sitewide/release-groups?range=all_time&count=1000&offset={offset}')
    top += p['payload']['release_groups']

dates = {}
for i in range(0, len(top), 50):
    ids = [rg['release_group_mbid'] for rg in top[i:i + 50]]
    q = urllib.parse.urlencode({'query': ' OR '.join(f'rgid:{x}' for x in ids), 'fmt': 'json', 'limit': 100})
    for rg in get(f'https://musicbrainz.org/ws/2/release-group?{q}')['release-groups']:
        if rg.get('primary-type') == 'Album' and len(rg.get('first-release-date', '')) == 10:
            dates[rg['id']] = rg['first-release-date']
    time.sleep(1.1)  # MusicBrainz: max 1 request/second

out = [{'title': rg['release_group_name'], 'artist': rg['artist_name'],
        'date': dates[rg['release_group_mbid']], 'listens': rg['listen_count']}
       for rg in top if rg['release_group_mbid'] in dates]
json.dump(out, open('data/album-anniversaries.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(f'{len(out)} albums with full release dates (of {len(top)})')
