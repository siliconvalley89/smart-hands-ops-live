export const isFieldRole = (role) => role === 'tech' || role === 'seniorConsultant';

const ROLE_LABELS = { adminAssistant: 'Admin Assistant', seniorConsultant: 'Senior Consultant' };

export const roleLabel = (role) => ROLE_LABELS[role] ?? role;
