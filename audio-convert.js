export async function convertBlobToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const tmp = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const ch = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) tmp[i] += ch[i] / channels;
  }
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeString = (v, o) => { for (let i = 0; i < v.length; i++) view.setUint8(o + i, v.charCodeAt(i)); };
  writeString('RIFF', 0); view.setUint32(4, 36 + length * 2, true); writeString('WAVE', 8);
  writeString('fmt ', 12); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeString('data', 36); view.setUint32(40, length * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    let s = Math.max(-1, Math.min(1, tmp[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}