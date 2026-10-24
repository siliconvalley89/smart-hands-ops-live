import { Camera, Trash2, Plus, Download } from 'lucide-react';
import { getJobPhotos } from '../lib/jobDisplay';

export default function JobPhotos({ job, profile, canDownloadPhotos, downloadPhotos, deletePhoto, handlePhotoUpload }) {
  return (
    <>
      {['before', 'after'].map((type) => {
        const photos = getJobPhotos(job, type);
        const label = type === 'before' ? 'Before' : 'After';
        return (
          <div key={type} className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-slate-300 text-sm">{label} photos {photos.length > 0 && `(${photos.length})`}</div>
              {canDownloadPhotos && photos.length > 0 && (
                <button type="button" onClick={() => downloadPhotos(photos)} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 transition">
                  <Download size={12} /> Download all
                </button>
              )}
            </div>
            {photos.length ? (
              <div className="grid grid-cols-2 gap-2">
                {photos.map((url) => (
                  <div key={url} className="relative">
                    <a href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={label} loading="lazy" decoding="async" className="w-full aspect-square rounded-xl object-cover" />
                    </a>
                    {['tech', 'admin'].includes(profile.role) && (
                      <button type="button" aria-label={`Delete ${type} photo`} onClick={() => deletePhoto(job, type, url)} className="absolute top-1 right-1 rounded-full border border-red-800 bg-red-950/80 p-1.5 text-red-300 hover:bg-red-900 transition">
                        <Trash2 size={13} />
                      </button>
                    )}
                    {canDownloadPhotos && (
                      <button type="button" aria-label={`Download ${type} photo`} title="Download photo" onClick={() => downloadPhotos([url])} className="absolute bottom-1 left-1 rounded-full border border-slate-600 bg-slate-900/80 p-1.5 text-slate-200 hover:bg-slate-800 transition">
                        <Download size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-500">No photos yet</div>
            )}
            {['tech', 'admin'].includes(profile.role) && (
              <div className="mt-3 flex flex-wrap gap-2">
                <label htmlFor={`${type}-cam-${job.id}`} className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                  <Camera size={15} /> Take photo
                </label>
                <input id={`${type}-cam-${job.id}`} type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => handlePhotoUpload(e, job, type)} />
                <label htmlFor={`${type}-file-${job.id}`} className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                  <Plus size={15} /> Add from gallery
                </label>
                <input id={`${type}-file-${job.id}`} type="file" multiple className="hidden" accept="image/*" onChange={(e) => handlePhotoUpload(e, job, type)} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
