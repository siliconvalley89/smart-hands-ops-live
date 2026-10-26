import { Camera, FileText, Plus, Trash2 } from 'lucide-react';
import { ATTACHMENT_ACCEPT, formatFileSize } from '../lib/media';
import useJobPhotos from '../hooks/useJobPhotos';
import JobPhotos from './JobPhotos';

export default function JobMedia({
  job,
  profile,
  now,
  uploadingPhotos,
  uploadingFiles,
  canDownloadPhotos,
  downloadPhotos,
  deletePhoto,
  handlePhotoUpload,
  deleteAttachment,
  handleAttachmentUpload,
}) {
  const { photos, files } = useJobPhotos(job);
  const canUpload = ['tech', 'admin'].includes(profile.role);

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-slate-400 uppercase tracking-[0.18em] mb-4">
        <Camera size={16} /> Job photos
        {uploadingPhotos && <span className="text-teal-300 normal-case tracking-normal">Uploading photo...</span>}
      </div>
      <div className="grid gap-3">
        <JobPhotos job={job} profile={profile} now={now} photos={photos} canDownloadPhotos={canDownloadPhotos} downloadPhotos={downloadPhotos} deletePhoto={deletePhoto} handlePhotoUpload={handlePhotoUpload} />
        <div className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
          <div className="text-slate-300 text-sm mb-2 flex items-center gap-2">
            <FileText size={15} /> Files &amp; documents {files.length > 0 && `(${files.length})`}
            {uploadingFiles && <span className="text-teal-300 text-xs">Uploading...</span>}
          </div>
          {files.length ? (
            <ul className="space-y-2">
              {files.map((file) => (
                <li key={file.id} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm">
                  <a href={file.url} target="_blank" rel="noreferrer" download={file.name} className="flex-1 min-w-0 truncate text-teal-300 hover:underline">{file.name}</a>
                  <span className="text-slate-500 text-xs shrink-0">{formatFileSize(file.size)}</span>
                  {canUpload && (
                    <button type="button" aria-label={`Delete ${file.name}`} onClick={() => deleteAttachment(job, file)} className="text-red-300 hover:text-red-200">
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-700 p-4 text-center text-slate-500 text-sm">No files yet</div>
          )}
          {canUpload && (
            <div className="mt-3">
              <label htmlFor={`attach-${job.id}`} className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                <Plus size={15} /> Add files
              </label>
              <input id={`attach-${job.id}`} type="file" multiple className="hidden" accept={ATTACHMENT_ACCEPT} onChange={(e) => handleAttachmentUpload(e, job)} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
