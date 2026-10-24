import { Download } from 'lucide-react';
import useJobPhotos from '../hooks/useJobPhotos';

export default function CompletedJobPhotos({ job, canDownloadPhotos, downloadPhotos }) {
  const { photos } = useJobPhotos(job);
  return (
    <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
      {['before', 'after'].map((type) => {
        const items = photos[type];
        if (!items.length) return null;
        return (
          <div key={type} className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-slate-300 text-sm">{type === 'before' ? 'Before' : 'After'} photos</div>
              {canDownloadPhotos && (
                <button type="button" onClick={() => downloadPhotos(items.map((p) => p.url))} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 transition">
                  <Download size={12} /> Download all
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {items.map((photo) => (
                <div key={photo.id} className="relative">
                  <a href={photo.url} target="_blank" rel="noreferrer">
                    <img src={photo.url} alt={type} loading="lazy" decoding="async" className="w-full aspect-square rounded-xl object-cover" />
                  </a>
                  {canDownloadPhotos && (
                    <button type="button" aria-label={`Download ${type} photo`} title="Download photo" onClick={() => downloadPhotos([photo.url])} className="absolute bottom-1 left-1 rounded-full border border-slate-600 bg-slate-900/80 p-1.5 text-slate-200 hover:bg-slate-800 transition">
                      <Download size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
