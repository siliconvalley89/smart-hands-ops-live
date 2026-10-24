const TechNameWithPhoto = ({ job, techs }) => {
  const tech = (techs || []).find((t) => t.email && t.email === job.assignedTechEmail);
  const photo = tech?.profilePhotoUrl;
  return (
    <div className="flex items-center justify-end gap-2">
      {job.assignedTechName && (photo ? (
        <img src={photo} alt={job.assignedTechName} className="h-9 w-9 rounded-full object-cover ring-2 ring-slate-600" />
      ) : (
        <div className="h-9 w-9 rounded-full bg-slate-700 text-slate-300 flex items-center justify-center text-sm font-semibold">
          {job.assignedTechName.trim().charAt(0).toUpperCase()}
        </div>
      ))}
      <div className="font-semibold">{job.assignedTechName || 'Unassigned'}</div>
    </div>
  );
};

export default TechNameWithPhoto;
