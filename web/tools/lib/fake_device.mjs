// ブラウザのテスト用: キャプチャーボードの代わりに、canvas の動画を映像として返す（getUserMedia／enumerateDevices を差し替える）
export async function fakeDevice(page) {
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = `hsl(${(n++ * 7) % 360},60%,40%)`; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText('fake device ' + n, 40, 100); }, 40);
    navigator.mediaDevices.getUserMedia = async () => c.captureStream(30);
    navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', label: 'Fake Capture Card', deviceId: 'fake', groupId: 'g' }];
  });
}
