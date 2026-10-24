import cv2,json,numpy as np
B=json.load(open('boards.json'))
ROW_Y={'top':[262,306,350,394],'bot':[499,543,587,631]}
icons={}
rows=[]
for name,b in B.items():
    im=cv2.imread(f'board_{name}.png'); eg='top' if b['own_group']=='bot' else 'bot'
    line=[]
    for g in ('top','bot'):
        for i,y in enumerate(ROW_Y[g]):
            y0=int((y+0)*1.5); c=im[y0:y0+51, 1044:1128]   # weapon
            s=im[y0:y0+51, 1590:1650]  # special col approx
            icons[f'{name}|{g}{i}']=dict(enemy=(g==eg))
            cv2.imwrite(f'ic/{name}_{g}{i}.png',c)
            t=cv2.resize(c,None,fx=1.5,fy=1.5); 
            if g==eg: cv2.rectangle(t,(0,0),(t.shape[1]-1,t.shape[0]-1),(0,0,255),2)
            line.append(t)
    lab=np.zeros((line[0].shape[0],260,3),np.uint8); cv2.putText(lab,name,(3,45),0,0.7,(255,255,255),2)
    rows.append(np.hstack([lab]+line))
cv2.imwrite('mont_all.png',np.vstack(rows))
json.dump(icons,open('icons.json','w'))
