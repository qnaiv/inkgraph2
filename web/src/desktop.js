// D71: デスクトップ版（Electron）の口。window.inkgraphDesktop があればデスクトップ版。Web 版（ブラウザ）では null。
export const desktop = () => (typeof window !== 'undefined' && window.inkgraphDesktop) || null;
export const isDesktop = () => !!desktop();
// 録画できるのはデスクトップ版だけ。ブラウザ版はウィンドウが隠れると映像が止まり録画が安定しないため、対応しない
// （検証・テスト用に localStorage['inkgraph.videoBrowser']='1' でブラウザ録画を試せるが、サポート外）
export const recordingAvailable = () => { if (isDesktop()) return true; try { return localStorage.getItem('inkgraph.videoBrowser') === '1'; } catch { return false; } };
