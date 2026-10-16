"""usage: python analyze.py VIDEO.mp4 [-o out_dir]  -> timeline.json, timeline.csv, timeline.png"""
import argparse, json, os, sys, csv
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from inkgraph.detect import analyze
from inkgraph.viz import plot
def write(res,out,names=None):
    os.makedirs(out,exist_ok=True)
    json.dump(res,open(os.path.join(out,'timeline.json'),'w'),indent=1,ensure_ascii=False)
    with open(os.path.join(out,'timeline.csv'),'w',newline='',encoding='utf-8') as f:
        w=csv.writer(f); w.writerow(['match','event','slot','start_s','end_s','source'])
        for m in res:
            for k,v in m['squid_down'].items():
                for e in v: w.writerow([m['match'],'own_death' if k=='L0' else 'squid_down',k,e['start'],e['end'],e['src']])
            for e in m['special']: w.writerow([m['match'],'special_'+e['outcome'],'L0',e['ready'],e['end'],'gauge'])
            for e in m['own_kills']: w.writerow([m['match'],'own_kill','L0',e['start'],e['end'],'notice'])
            for a_,b_ in m['map_open']: w.writerow([m['match'],'map_open','-',a_,b_,'uncertain'])
            for a_,b_ in m['hud_hidden']: w.writerow([m['match'],'hud_hidden','-',a_,b_,'uncertain'])
    plot(res,os.path.join(out,'timeline.png'),names)
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('video'); ap.add_argument('-o','--out',default='out'); a=ap.parse_args()
    write(analyze(a.video),a.out); print('wrote',a.out)
if __name__=='__main__': main()
