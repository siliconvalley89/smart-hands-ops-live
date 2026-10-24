import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import logoPath from '../assets/sv-smart-dispatch-logo.jpg';
import { loadImageDataUrl, loadImageElement } from './media';

export const renderBadge = async (profile, uid) => {
  {
    const W = 638;
    const H = 1011;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, 170);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(0, 170, W, 10);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px Arial, sans-serif';
    ctx.fillText('SILICON VALLEY', W / 2, 72);
    ctx.fillText('SMART HANDS LLC', W / 2, 122);

    const photo = await loadImageElement(profile.profilePhotoData || await loadImageDataUrl(profile.profilePhotoUrl));
    const cx = W / 2;
    const cy = 335;
    const r = 130;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max((r * 2) / photo.width, (r * 2) / photo.height);
    const pw = photo.width * scale;
    const ph = photo.height * scale;
    ctx.drawImage(photo, cx - pw / 2, cy - ph / 2, pw, ph);
    ctx.restore();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.stroke();

    const name = profile.displayName || 'Staff';
    ctx.fillStyle = '#0f172a';
    let size = 50;
    ctx.font = `bold ${size}px Arial, sans-serif`;
    while (ctx.measureText(name).width > W - 60 && size > 24) {
      size -= 2;
      ctx.font = `bold ${size}px Arial, sans-serif`;
    }
    ctx.fillText(name, W / 2, 530);

    ctx.fillStyle = '#b45309';
    ctx.font = 'bold 32px Arial, sans-serif';
    const roleText = (profile.role === 'adminAssistant' ? 'Admin Assistant' : profile.role || 'Staff').toUpperCase();
    ctx.fillText(roleText, W / 2, 577);

    ctx.fillStyle = '#475569';
    ctx.font = '24px Arial, sans-serif';
    ctx.fillText(`ID: ${uid.slice(0, 8).toUpperCase()}`, W / 2, 615);

    const qrSize = 200;
    const QRCode = (await import('qrcode')).default;
    const qrCanvas = document.createElement('canvas');
    await QRCode.toCanvas(qrCanvas, `${window.location.origin}/verify/${uid}`, { width: qrSize, margin: 1, errorCorrectionLevel: 'M' });
    ctx.drawImage(qrCanvas, (W - qrSize) / 2, 640, qrSize, qrSize);
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.fillText('SCAN TO VERIFY BADGE', W / 2, 868);

    const logo = await loadImageElement(logoPath);
    const lh = 80;
    const lw = Math.min((logo.width / logo.height) * lh, W - 120);
    ctx.drawImage(logo, (W - lw) / 2, 895, lw, lh);

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    const thumb = document.createElement('canvas');
    thumb.width = 300;
    thumb.height = 300;
    const ts = Math.max(300 / photo.width, 300 / photo.height);
    thumb.getContext('2d').drawImage(photo, (300 - photo.width * ts) / 2, (300 - photo.height * ts) / 2, photo.width * ts, photo.height * ts);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.95), photoData: thumb.toDataURL('image/jpeg', 0.8) };
  }
};

export const prepareBadge = async (profile, uid) => {
  const result = await renderBadge(profile, uid);
  await setDoc(doc(db, 'badges', uid), {
    displayName: profile.displayName || '',
    role: profile.role || '',
    photoData: result.photoData,
    updatedAt: Date.now(),
  });
  return result.dataUrl;
};

export const generateBadgePdf = async (profile, uid, onError) => {
  try {
    const dataUrl = await prepareBadge(profile, uid);
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'mm', format: [53.98, 85.6], orientation: 'portrait' });
    pdf.addImage(dataUrl, 'JPEG', 0, 0, 53.98, 85.6);
    pdf.save(`badge-${(profile.displayName || 'staff').replace(/\s+/g, '-').toLowerCase()}.pdf`);
  } catch (error) {
    console.error('Badge generation failed', error);
    onError?.('Badge generation failed. Please re-upload your profile photo and try again.');
  }
};
